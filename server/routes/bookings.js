const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');
const payments = require('../payments');
const notify = require('../notify');
const { isListable, asyncHandler } = require('../util');
const { bookingFromRow, getUserById, getBookingById, updateBooking } = require('../models');

const router = express.Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { mentorId, question } = req.body || {};
  if (!mentorId || !question || String(question).trim().length < 5) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const mentor = await getUserById(mentorId);
  const seeker = await getUserById(req.userToken.id);
  if (!seeker) return res.status(401).json({ error: 'not_authenticated' });
  // isListable also requires connected payouts when Stripe is on, so a question can never
  // be paid to a mentor we cannot pay out.
  if (!isListable(mentor)) return res.status(404).json({ error: 'mentor_not_found' });
  if (mentor.id === seeker.id) return res.status(400).json({ error: 'cannot_book_self' });

  const amount = Math.round(mentor.price * 100);
  const feeAmount = Math.round(amount * (config.PLATFORM_FEE_PERCENT / 100));
  const simulated = !config.STRIPE_ENABLED;
  const cleanQuestion = String(question).trim().slice(0, 4000);

  const { rows } = await query(
    `INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent,
                           platform_fee_amount, mentor_net_amount, status, mode, paid_at, answer_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [seeker.id, mentor.id, cleanQuestion, amount, config.CURRENCY, config.PLATFORM_FEE_PERCENT,
      feeAmount, amount - feeAmount, simulated ? 'paid' : 'pending_payment', simulated ? 'simulated' : 'stripe',
      simulated ? new Date() : null, simulated ? payments.deadlineFromNow() : null]
  );
  const booking = bookingFromRow(rows[0]);

  if (simulated) {
    notify.notifyMentorNewQuestion(mentor, booking);
    return res.status(201).json({ booking, simulated: true });
  }

  try {
    const session = await payments.createCheckoutSession(booking, mentor, seeker);
    const updated = await updateBooking(booking.id, { stripeSessionId: session.id });
    res.status(201).json({ booking: updated, checkoutUrl: session.url, simulated: false });
  } catch (err) {
    console.error('[payments] could not create Checkout Session:', err.message);
    await updateBooking(booking.id, { status: 'expired' });
    res.status(502).json({ error: 'stripe_error', message: 'Could not start the payment. Please try again.' });
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
  res.json({ asked: await list('seeker', 'mentor'), received: await list('mentor', 'seeker') });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (booking.seekerId !== req.userToken.id && booking.mentorId !== req.userToken.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ booking });
}));

router.post('/:id/answer', requireAuth, asyncHandler(async (req, res) => {
  const { answer } = req.body || {};
  if (!answer || String(answer).trim().length < 2) return res.status(400).json({ error: 'missing_answer' });

  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.mentorId !== req.userToken.id) return res.status(400).json({ error: 'forbidden' });
  if (existing.status !== 'paid' && existing.status !== 'answered') return res.status(400).json({ error: 'not_paid' });

  let booking = await updateBooking(existing.id, {
    answer: String(answer).trim().slice(0, 8000),
    status: 'answered',
    answeredAt: existing.answeredAt || new Date()
  });

  // Release the mentor's share. A failure is recorded and retried by the background job.
  if (booking.mode === 'stripe' && !booking.stripeTransferId) {
    booking = (await payments.transferToMentor(booking.id)) || booking;
  }

  if (!existing.answeredAt) {
    const [seeker, mentor] = await Promise.all([getUserById(booking.seekerId), getUserById(booking.mentorId)]);
    if (seeker && mentor) notify.notifySeekerAnswered(seeker, mentor, booking);
  }
  res.json({ booking });
}));

router.post('/:id/review', requireAuth, asyncHandler(async (req, res) => {
  const { rating, review } = req.body || {};
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'invalid_rating' });

  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.seekerId !== req.userToken.id) return res.status(400).json({ error: 'forbidden' });
  if (existing.status !== 'answered') return res.status(400).json({ error: 'not_answered' });
  if (existing.rating) return res.status(400).json({ error: 'already_reviewed' });

  const booking = await updateBooking(existing.id, {
    rating: ratingNum,
    review: review ? String(review).trim().slice(0, 2000) : null,
    reviewedAt: new Date()
  });
  res.json({ booking });
}));

module.exports = router;
