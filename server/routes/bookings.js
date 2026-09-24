const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');
const payments = require('../payments');
const pay = require('../pay');
const ledger = require('../ledger');
const notify = require('../notify');
const probation = require('../probation');
const monitoring = require('../verification/monitoring');
const { isListable, asyncHandler } = require('../util');
const { bookingFromRow, getUserById, getBookingById, updateBooking } = require('../models');

const router = express.Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { mentorId, question } = req.body || {};
  if (typeof mentorId !== 'string' || typeof question !== 'string' || question.trim().length < 5) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const mentor = await getUserById(mentorId);
  const seeker = await getUserById(req.userToken.id);
  if (!seeker) return res.status(401).json({ error: 'not_authenticated' });
  if (!isListable(mentor)) return res.status(404).json({ error: 'mentor_not_found' });
  if (mentor.id === seeker.id) return res.status(400).json({ error: 'cannot_book_self' });

  const amount = Math.round(mentor.price * 100);
  const feeAmount = Math.round(amount * (config.PLATFORM_FEE_PERCENT / 100));
  const cleanQuestion = question.trim().slice(0, 4000);

  let providerName;
  try { providerName = pay.current().name; } catch (e) { return res.status(503).json({ error: 'payments_unavailable' }); }

  const { rows } = await query(
    `INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent,
                           platform_fee_amount, mentor_net_amount, status, provider)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment', $9) RETURNING *`,
    [seeker.id, mentor.id, cleanQuestion, amount, config.CURRENCY, config.PLATFORM_FEE_PERCENT,
      feeAmount, amount - feeAmount, providerName]
  );
  const booking = bookingFromRow(rows[0]);

  try {
    const order = await payments.startPayment(booking, mentor, seeker);
    const updated = await updateBooking(booking.id, { providerOrderId: order.orderId });
    res.status(201).json({ booking: updated, checkoutUrl: order.redirectUrl });
  } catch (err) {
    console.error('[payments] could not start the bank payment:', err.message);
    await updateBooking(booking.id, { status: 'expired' });
    res.status(502).json({ error: 'payment_error', message: 'Could not start the payment. Please try again.' });
  }
}));
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const list = async (mine, other) => {
    const { rows } = await query(
      `SELECT b.*, u.name AS other_name, u.color AS other_color
         FROM bookings b JOIN users u ON u.id = b.${other}_id
        WHERE b.${mine}_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
      [req.userToken.id]
    );
    return rows.map((r) => ({ ...bookingFromRow(r), otherPartyName: r.other_name, otherPartyColor: r.other_color }));
  };
  const me = req.userToken.id;
  // A buyer never sees an answer that is still being checked (see server/probation.js).
  const asked = (await list('seeker', 'mentor')).map((b) => probation.forViewer(b, me));
  res.json({ asked, received: (await list('mentor', 'seeker')).map((b) => ({ ...b, answerHeld: b.answerReview === 'held' })) });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (booking.seekerId !== req.userToken.id && booking.mentorId !== req.userToken.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));

// The buyer came back from the bank (or is waiting on the page). We do not believe the redirect:
// this asks the BANK about the payment and records what it says. Throttled per booking.
const lastSync = new Map();
router.post('/:id/sync', requireAuth, asyncHandler(async (req, res) => {
  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.seekerId !== req.userToken.id) return res.status(403).json({ error: 'forbidden' });

  const last = lastSync.get(existing.id) || 0;
  let booking = existing;
  if (Date.now() - last > 2000) {
    lastSync.set(existing.id, Date.now());
    if (lastSync.size > 5000) lastSync.clear();
    try { booking = (await payments.syncBooking(existing.id)) || existing; }
    catch (err) { console.error('[payments] status check failed:', err.message); }
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));
router.post('/:id/answer', requireAuth, asyncHandler(async (req, res) => {
  const { answer } = req.body || {};
  if (typeof answer !== 'string' || answer.trim().length < 2) return res.status(400).json({ error: 'missing_answer' });

  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.mentorId !== req.userToken.id) return res.status(400).json({ error: 'forbidden' });
  if (existing.status !== 'paid' && existing.status !== 'answered') return res.status(400).json({ error: 'not_paid' });
  // A suspended mentor cannot answer (their open questions were refunded).
  const mentorNow = await getUserById(existing.mentorId);
  if (!mentorNow || mentorNow.verificationStatus === 'suspended') return res.status(403).json({ error: 'suspended' });

  const first = !existing.answeredAt;
  // One of a new mentor's first answers? Then it waits for an admin before the buyer sees it.
  const held = first && await probation.shouldHold(existing.mentorId);
  let booking = await updateBooking(existing.id, {
    answer: String(answer).trim().slice(0, 8000),
    status: 'answered',
    answeredAt: existing.answeredAt || new Date()
  });
  if (held) booking = (await probation.hold(booking.id)) || booking;

  if (first && !held) {
    // Record the mentor's earnings in the payout ledger (once, however many times the answer is edited).
    await ledger.onAnswered(booking);
    const [seeker, mentor] = await Promise.all([getUserById(booking.seekerId), getUserById(booking.mentorId)]);
    if (seeker && mentor) notify.notifySeekerAnswered(seeker, mentor, booking);
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));

router.post('/:id/review', requireAuth, asyncHandler(async (req, res) => {
  const { rating, review } = req.body || {};
  if (review !== undefined && review !== null && typeof review !== 'string') return res.status(400).json({ error: 'invalid_review' });
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'invalid_rating' });

  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.seekerId !== req.userToken.id) return res.status(400).json({ error: 'forbidden' });
  if (existing.status !== 'answered' || existing.answerReview === 'held') return res.status(400).json({ error: 'not_answered' });
  if (existing.rating) return res.status(400).json({ error: 'already_reviewed' });

  const booking = await updateBooking(existing.id, {
    rating: ratingNum,
    review: review ? String(review).trim().slice(0, 2000) : null,
    reviewedAt: new Date()
  });
  // A mentor whose average drops below the limit after enough reviews is flagged for an admin.
  await monitoring.afterReview(existing.mentorId);
  res.json({ booking });
}));

module.exports = router;
