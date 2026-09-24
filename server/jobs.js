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

// Refund requests the bank rejected or that failed to reach it: ask again.
async function retryRefunds() {
  const { rows } = await query(
    `SELECT id, refund_reason FROM bookings WHERE status = 'refund_pending' AND refund_error IS NOT NULL ORDER BY refund_requested_at LIMIT 50`
  );
  for (const { id, refund_reason: reason } of rows) {
    try { await payments.refundBooking(id, reason || 'no_answer_deadline'); }
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
    try { await payments.syncBooking(id); }
    catch (err) { console.error(`[jobs] could not confirm refund for ${id}:`, err.message); }
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

// Licenses about to expire (a reminder for the admin) and licenses that expired (the mentor is taken off the site).
async function checkLicenses() {
  const r = await require('./verification/monitoring').licenseSweep();
  if (r.reminded || r.delisted) console.log(`[jobs] license check: ${r.reminded} reminder(s), ${r.delisted} mentor(s) taken off the site`);
}

// People on the waiting list are told once the site is open and a mentor in their field is listed.
async function notifyWaitingList() {
  const n = await require('./waitlist').launchDay();
  if (n) console.log(`[jobs] told ${n} person/people on the waiting list that mentors are available`);
}

async function runSweep() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_ID]);
    if (!rows[0].got) return;
    try {
      await refundOverdue();
      await sendReminders();
      await retryRefunds();
      await confirmRefunds();
      await reconcilePending();
      await purgeDocuments();
      await releaseHeldAnswers();
      await checkLicenses();
      await notifyWaitingList();
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

module.exports = { startJobs, runSweep };
