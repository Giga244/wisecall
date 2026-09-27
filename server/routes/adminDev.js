// DEVELOPMENT ONLY (mounted by index.js only when config.DEV_MODE, that is never with NODE_ENV=production): a way to try the parts of a
// booking that depend on days passing without waiting for them. "Fast-forward" moves every clock of ONE booking back by N days (when it
// was paid, answered, when the answer is due, when the payout becomes payable, when ratings were given), then runs the housekeeping the
// server runs by itself every few minutes, so the automatic refund of an unanswered question, the release of a held answer, the reveal of
// ratings and the moment a mentor's earnings become payable all happen right now.
const express = require('express');
const { query, tx } = require('../db');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const jobs = require('../jobs');

const router = express.Router();
const UUID = /^[0-9a-f-]{36}$/i;

// What an admin wants to see change.
async function snapshot(bookingId) {
  const { rows } = await query(
    `SELECT b.status, b.answer_review, b.refund_reason, b.answer_deadline,
            p.status AS payout_status, (p.status = 'pending' AND p.payable_at <= now()) AS payable_now,
            (SELECT count(*)::int FROM ratings r WHERE r.booking_id = b.id) AS ratings,
            (SELECT count(*)::int FROM ratings r WHERE r.booking_id = b.id AND r.revealed_at IS NOT NULL) AS ratings_revealed
       FROM bookings b LEFT JOIN payouts p ON p.booking_id = b.id WHERE b.id = $1`, [bookingId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status, answerReview: r.answer_review, refundReason: r.refund_reason, payoutStatus: r.payout_status || null, payableNow: Boolean(r.payable_now),
    ratings: r.ratings, ratingsRevealed: r.ratings_revealed
  };
}

router.post('/bookings/:id/fast-forward', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) return res.status(404).json({ error: 'not_found' });
  const days = req.body && req.body.days === undefined ? 7 : (req.body || {}).days;
  if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'invalid_days' });
  const before = await snapshot(id);
  if (!before) return res.status(404).json({ error: 'not_found' });

  await tx(async (client) => {
    const back = (table, where, columns) => client.query(
      `UPDATE ${table} SET ${columns.map((c) => `${c} = ${c} - make_interval(days => $2)`).join(', ')} WHERE ${where}`, [id, days]
    );
    await back('bookings', 'id = $1', ['created_at', 'paid_at', 'answered_at', 'answer_deadline', 'refund_requested_at', 'refunded_at', 'reminder_sent_at', 'answer_held_until', 'answer_released_at', 'answer_flagged_at']);
    await back('payouts', 'booking_id = $1', ['created_at', 'payable_at', 'debt_flagged_at']);
    await back('ratings', 'booking_id = $1', ['submitted_at', 'edited_at', 'revealed_at', 'hidden_at']);
    await back('rating_reminders', 'booking_id = $1', ['sent_at']);
  });
  await jobs.runSweep({ wait: true }); // the same housekeeping as the timer, right now (waits for one already running)

  const after = await snapshot(id);
  console.log(`[admin] ${req.adminUser.email} fast-forwarded booking ${id} by ${days} day(s): ${before.status} -> ${after.status}`);
  res.json({ days, before, after });
}));

// An error on purpose, to try error monitoring (SENTRY_DSN): the message carries an email address that must never reach the report.
router.post('/crash', requireAuth, requireAdmin, asyncHandler(async () => {
  throw new Error('A test error for someone@example.com (development only)');
}));

module.exports = router;
