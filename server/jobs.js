// Background housekeeping, run on a timer inside the web process. A Postgres advisory lock
// makes sure only one running instance does the work at a time, and every action is
// idempotent, so overlapping runs during a deploy are harmless.
const { pool, query } = require('./db');
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

async function retryTransfers() {
  const { rows } = await query(
    `SELECT id FROM bookings WHERE status = 'answered' AND mode = 'stripe' AND stripe_transfer_id IS NULL
        AND answered_at < now() - interval '10 seconds' ORDER BY answered_at LIMIT 50`
  );
  for (const { id } of rows) await payments.transferToMentor(id);
}

async function reconcilePending() {
  const { rows } = await query(
    `SELECT * FROM bookings WHERE status = 'pending_payment' AND created_at < now() - interval '40 minutes' LIMIT 50`
  );
  for (const row of rows) {
    try { await payments.reconcilePendingBooking(bookingFromRow(row)); }
    catch (err) { console.error(`[jobs] could not reconcile booking ${row.id}:`, err.message); }
  }
}

async function runSweep() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_ID]);
    if (!rows[0].got) return;
    try {
      await refundOverdue();
      await sendReminders();
      await retryTransfers();
      await reconcilePending();
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
