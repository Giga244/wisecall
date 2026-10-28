// Background housekeeping, run on a timer inside the web process. A Postgres advisory lock
// makes sure only one running instance does the work at a time, and every action is
// idempotent, so overlapping runs during a deploy are harmless.
const { pool, query, tx } = require('./db');
const config = require('./config');
const { bookingFromRow, getUserById } = require('./models');
const payments = require('./payments');
const notify = require('./notify');

const LOCK_ID = 7272002;

async function refundOverdue() {
  const { rows } = await query(
    `SELECT id FROM bookings WHERE status = 'paid' AND answer_deadline < now() ORDER BY answer_deadline LIMIT 50`
  );
  for (const { id } of rows) {
    try { await payments.refundBooking(id, 'no_answer_deadline'); console.log(`[jobs] auto-refunded unanswered booking ${id}`); }
    catch (err) { console.error(`[jobs] auto-refund of ${id} failed (will retry):`, err.message); }
  }
}

async function sendReminders() {
  // The UPDATE claims the rows, so two instances can never send the same reminder twice.
  const { rows } = await query(
    `UPDATE bookings SET reminder_sent_at = now()
      WHERE id IN (SELECT id FROM bookings WHERE status = 'paid' AND reminder_sent_at IS NULL
                     AND answer_deadline > now() AND answer_deadline < now() + interval '48 hours' LIMIT 50)
      RETURNING *`
  );
  for (const row of rows) {
    const booking = bookingFromRow(row);
    const mentor = await getUserById(booking.mentorId);
    if (mentor) notify.notifyMentorDeadlineSoon(mentor, booking);
  }
}

// Refund requests the bank rejected or that failed to reach it: first ask the bank whether it was carried out after all (a lost answer,
// docs/AUDIT.md #5), and only ask again (with the same idempotency key) when it was not.
async function retryRefunds() {
  const { rows } = await query(
    `SELECT id, refund_reason FROM bookings WHERE status = 'refund_pending' AND refund_error IS NOT NULL ORDER BY refund_requested_at LIMIT 50`
  );
  for (const { id, refund_reason: reason } of rows) {
    try {
      const now = await payments.syncBooking(id);
      if (now && now.status === 'refunded') continue;
      await payments.refundBooking(id, reason || 'no_answer_deadline');
    }
    catch (err) { console.error(`[jobs] refund retry for ${id} failed:`, err.message); }
  }
}

// Refunds the bank accepted: check whether the money has actually been returned yet.
async function confirmRefunds() {
  const { rows } = await query(
    `SELECT id FROM bookings WHERE status = 'refund_pending' AND refund_error IS NULL AND refund_requested_at < now() - interval '1 minute'
      ORDER BY refund_requested_at LIMIT 50`
  );
  for (const { id } of rows) {
    try {
      const b = await payments.syncBooking(id);
      if (b && b.status === 'refund_pending') {
        // (marked failed, and so sent again, only when that cannot return the money twice: a bank without idempotent refunds must show the
        // payment still paid with nothing returned, not a refund in progress)
        if (!(await payments.safeToResendRefund(b))) continue;
        await query(`UPDATE bookings SET refund_error = 'the bank still shows the payment as paid'
                      WHERE id = $1 AND status = 'refund_pending' AND refund_error IS NULL AND refund_requested_at < now() - interval '5 minutes'`, [id]);
      }
    } catch (err) { console.error(`[jobs] could not confirm refund for ${id}:`, err.message); }
  }
}

// Safety net for missed callbacks: ask the bank about bookings still waiting for payment. The bank
// order lives PAYMENT_TTL_MINUTES; once that (plus a margin) has passed, the booking is closed.
async function reconcilePending() {
  const { rows } = await query(
    `SELECT id, created_at FROM bookings WHERE status = 'pending_payment' AND created_at < now() - interval '3 minutes' LIMIT 50`
  );
  const give_up_ms = (config.PAYMENT_TTL_MINUTES + 10) * 60 * 1000;
  for (const row of rows) {
    try {
      const b = await payments.syncBooking(row.id);
      if (b && b.status === 'pending_payment' && Date.now() - new Date(row.created_at).getTime() > give_up_ms) {
        await tx((client) => payments.expirePending(client, row.id));
      }
    } catch (err) { console.error(`[jobs] could not reconcile booking ${row.id}:`, err.message); }
  }
}
// Attempts to ask a question that were never paid (cancelled, failed or timed out at the bank) are deleted after a week: nobody was charged,
// there is nothing to pay out or refund, and the buyer's dashboard hides them anyway. A booking that was ever paid is never touched.
async function purgeUnpaid() {
  const { rows: candidates } = await query(
    `SELECT id FROM bookings b WHERE b.paid_at IS NULL AND b.status IN ('expired', 'pending_payment') AND b.provider_order_id IS NOT NULL
        AND b.created_at < now() - make_interval(days => $1) ORDER BY b.created_at LIMIT 200`, [config.UNPAID_ATTEMPT_DAYS]);
  const unsure = [];
  for (const { id } of candidates) {
    try { await payments.syncBooking(id); } catch (e) { unsure.push(id); } // (a late payment is recorded now; an unreachable bank: keep it)
  }
  const { rowCount } = await query(
    `DELETE FROM bookings b
      WHERE b.paid_at IS NULL AND b.status IN ('expired', 'pending_payment') AND b.created_at < now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.booking_id = b.id) AND NOT (b.id = ANY($2::uuid[]))`, [config.UNPAID_ATTEMPT_DAYS, unsure]
  );
  if (rowCount) console.log(`[jobs] deleted ${rowCount} unpaid attempt(s) older than ${config.UNPAID_ATTEMPT_DAYS} days`);
  return rowCount;
}
// Verification documents are deleted 90 days after a decision.
async function purgeDocuments() {
  const n = await require('./verification/credentials').purgeExpiredDocuments();
  if (n) console.log(`[jobs] deleted ${n} verification document(s) past their retention date`);
}

// A new mentor's first answers wait for an admin; the ones nobody flagged are released after the check window.
async function releaseHeldAnswers() {
  const n = await require('./probation').releaseDue();
  if (n) console.log(`[jobs] released ${n} held answer(s) after the check window`);
}

// Follow-up questions waiting for the mentor's reply: a reminder after 2 days; after 3, the asker may report it and the admins are told.
async function followUpDeadlines() {
  const r = await require('./inbox').followUpSweep();
  if (r.reminded || r.missed) console.log(`[jobs] follow-ups: ${r.reminded} reminder(s), ${r.missed} reply deadline(s) missed`);
}

// Licenses about to expire (a reminder for the admin) and licenses that expired (the mentor is taken off the site).
async function checkLicenses() {
  const r = await require('./verification/monitoring').licenseSweep();
  if (r.reminded || r.delisted) console.log(`[jobs] license check: ${r.reminded} reminder(s), ${r.delisted} mentor(s) taken off the site`);
}

// People on the waiting list are told once the site is open and a mentor in their field is listed.
async function notifyWaitingList() {
  const expired = await require('./mentorRequests').expire(); // ("find me a mentor" requests end after 60 days)
  if (expired) console.log(`[jobs] ${expired} mentor request(s) expired`);
  const n = await require('./waitlist').launchDay();
  if (n) console.log(`[jobs] told ${n} person/people on the waiting list that mentors are available`);
}

// Ratings become visible once both people have rated or 7 days after the answer; "please rate" emails after 2 and 6 days.
async function ratingsHousekeeping() {
  const ratings = require('./ratings');
  const revealed = await ratings.revealDue();
  if (revealed) console.log(`[jobs] revealed ${revealed} rating(s)`);
  const reminded = await ratings.sendReminders();
  if (reminded) console.log(`[jobs] sent ${reminded} rating reminder(s)`);
}

// Mentor verification: account signals older than their retention are deleted; an analysis that never finished (the server restarted in
// the middle) is marked failed and started again for applications still waiting; submitted applications that were waiting for the ID
// check are looked at again (in case a result arrived while the server was down).
// Emergency checks keep the question text for a limited time only (server/safety.js).
// Accounts whose deletion grace period is over are emptied of personal details (server/account.js).
async function accountHousekeeping() {
  const n = await require('./account').deletionSweep();
  if (n) console.log(`[jobs] looked at ${n} account(s) due for deletion`);
  await require('./loginGuard').purgeOld(); // (wrong-password counts and lockouts older than a day)
}

async function safetyHousekeeping() {
  const n = await require('./safety').purgeOld();
  if (n) console.log(`[jobs] deleted the text of ${n} old emergency check(s)`);
}

async function verificationHousekeeping() {
  // An approved mentor with a failed required step is taken off the site (normally at once by the step itself; this catches the rest).
  await require('./verification/steps').delistFailedApproved();
  const purged = await require('./verification/signals').purgeOld();
  if (purged) console.log(`[jobs] deleted ${purged} old account signal(s)`);
  const { rows } = await query(
    `UPDATE verification_reviews SET status = 'failed', ai_error = coalesce(ai_error, 'interrupted'), finished_at = now()
      WHERE status = 'running' AND created_at < now() - interval '15 minutes' RETURNING user_id`);
  const analysis = require('./verification/analysis');
  for (const { user_id: id } of rows) analysis.afterIdentityChange(id);
  const stale = await query(
    `SELECT u.id FROM users u WHERE u.verification_status = 'pending' AND u.application_submitted_at < now() - interval '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM verification_reviews r WHERE r.user_id = u.id AND r.submitted_at = u.application_submitted_at) LIMIT 50`);
  for (const { id } of stale.rows) analysis.afterIdentityChange(id);
}

// When the last sweep finished without an error (for the /status page).
let lastSweepAt = null;

// `wait` (used by the development-only fast-forward tool): if another run is in progress, wait for it and then run, instead of skipping.
async function runSweep({ wait = false } = {}) {
  const client = await pool.connect();
  try {
    const { rows } = wait
      ? (await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]), { rows: [{ got: true }] })
      : await client.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_ID]);
    if (!rows[0].got) return;
    try {
      await require('./launch').refresh();
      await refundOverdue();
      await sendReminders();
      await retryRefunds();
      await confirmRefunds();
      await require('./payments').settleUnconfirmedRefunds(); // (partial refunds whose answer from the bank was lost: docs/REVIEW-2.md #3)
      await require('./withdrawals').syncSending(); // (payouts sent through the bank whose callback has not come: PAYOUT_METHOD=flitt_iban)
      await reconcilePending();
      await purgeUnpaid();
      await purgeDocuments();
      await releaseHeldAnswers();
      await followUpDeadlines();
      await checkLicenses();
      await notifyWaitingList();
      await ratingsHousekeeping();
      await verificationHousekeeping();
      await safetyHousekeeping();
      await accountHousekeeping();
      await require('./verification/reminders').sweep().catch((e) => console.error('[jobs] application reminders failed:', e.message)); // (an unfinished application)
      await require('./live/settle').sweep(); // (live sessions: holds, refunds, minimum, no-shows, endings, reminders, clean-up)
      lastSweepAt = new Date();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } catch (err) {
    console.error('[jobs] sweep failed:', err.message);
  } finally {
    client.release();
  }
}

function startJobs() {
  const every = Math.max(1, config.SWEEP_INTERVAL_SECONDS) * 1000;
  const timer = setInterval(runSweep, every);
  const first = setTimeout(runSweep, Math.min(every, 15000));
  timer.unref();
  first.unref();
  return () => { clearInterval(timer); clearTimeout(first); };
}

module.exports = { startJobs, runSweep, purgeUnpaid, lastSweep: () => lastSweepAt };
