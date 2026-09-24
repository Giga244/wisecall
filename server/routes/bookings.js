const express = require('express');
const crypto = require('crypto');
const { load, withDb } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');
const stripe = require('../stripeClient');
const { sendEmail, escapeHtml } = require('../email');
const { isListable } = require('../util');

const router = express.Router();

async function notifyMentorNewQuestion(mentor, booking) {
  if (!config.EMAIL_ENABLED) return;
  try {
    await sendEmail({
      to: mentor.email,
      subject: 'You have a new paid question on Wisecall',
      html: `<p>Someone paid $${(booking.amount / 100).toFixed(2)} to ask you a question on Wisecall.</p><p>"${escapeHtml(booking.question)}"</p><p><a href="${config.APP_URL}/dashboard.html">Answer it in your dashboard</a>.</p>`
    });
  } catch (e) {
    console.error('[email] new-question notify failed:', e.message);
  }
}

async function notifySeekerAnswered(seeker, mentor, booking) {
  if (!config.EMAIL_ENABLED) return;
  try {
    await sendEmail({
      to: seeker.email,
      subject: `${String(mentor.name).replace(/[\r\n]/g, " ")} answered your question on Wisecall`,
      html: `<p>${escapeHtml(mentor.name)} just answered your question:</p><p>"${escapeHtml(booking.answer)}"</p><p><a href="${config.APP_URL}/dashboard.html">Read it in your dashboard</a>.</p>`
    });
  } catch (e) {
    console.error('[email] answer notify failed:', e.message);
  }
}

router.post('/', requireAuth, async (req, res) => {
  const { mentorId, question } = req.body || {};
  if (!mentorId || !question || question.trim().length < 5) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const data = load();
  const mentor = data.users.find(u => u.id === mentorId && isListable(u));
  const seeker = data.users.find(u => u.id === req.userToken.id);
  if (!mentor) return res.status(404).json({ error: 'mentor_not_found' });
  if (mentor.id === seeker.id) return res.status(400).json({ error: 'cannot_book_self' });
  if (!mentor.price) return res.status(400).json({ error: 'mentor_price_not_set' });

  const amount = Math.round(mentor.price * 100);
  const feeAmount = Math.round(amount * (config.PLATFORM_FEE_PERCENT / 100));
  const mentorNet = amount - feeAmount;
  const simulated = !config.STRIPE_ENABLED;

  const booking = {
    id: crypto.randomUUID(),
    seekerId: seeker.id,
    mentorId: mentor.id,
    question: question.trim().slice(0, 4000),
    answer: null,
    rating: null,
    review: null,
    reviewedAt: null,
    amount,
    currency: config.CURRENCY,
    platformFeePercent: config.PLATFORM_FEE_PERCENT,
    platformFeeAmount: feeAmount,
    mentorNetAmount: mentorNet,
    status: simulated ? 'paid' : 'pending_payment',
    mode: simulated ? 'simulated' : 'stripe',
    stripeSessionId: null,
    stripePaymentIntentId: null,
    paidAt: simulated ? new Date().toISOString() : null,
    createdAt: new Date().toISOString()
  };

  withDb(d => { d.bookings.push(booking); });

  if (simulated) {
    notifyMentorNewQuestion(mentor, booking);
    return res.status(201).json({ booking, simulated: true });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: config.CURRENCY,
          product_data: { name: `Advice from ${mentor.name}`, description: question.trim().slice(0, 300) },
          unit_amount: amount
        },
        quantity: 1
      }],
      payment_intent_data: {
        application_fee_amount: feeAmount,
        ...(mentor.stripeAccountId ? { transfer_data: { destination: mentor.stripeAccountId } } : {})
      },
      metadata: { bookingId: booking.id },
      success_url: `${config.APP_URL}/expert.html?id=${mentor.id}&booking=${booking.id}&status=success`,
      cancel_url: `${config.APP_URL}/expert.html?id=${mentor.id}&booking=${booking.id}&status=cancelled`
    });

    withDb(d => {
      const b = d.bookings.find(x => x.id === booking.id);
      if (b) b.stripeSessionId = session.id;
    });

    res.status(201).json({ booking, checkoutUrl: session.url, simulated: false });
  } catch (err) {
    withDb(d => {
      const idx = d.bookings.findIndex(x => x.id === booking.id);
      if (idx >= 0) d.bookings.splice(idx, 1);
    });
    res.status(502).json({ error: 'stripe_error', message: err.message });
  }
});

router.get('/mine', requireAuth, (req, res) => {
  const data = load();
  const asked = data.bookings.filter(b => b.seekerId === req.userToken.id);
  const received = data.bookings.filter(b => b.mentorId === req.userToken.id);

  const withNames = (list, otherKey) => list.map(b => {
    const other = data.users.find(u => u.id === b[otherKey]);
    return { ...b, otherPartyName: other ? other.name : 'Unknown', otherPartyColor: other ? other.color : '#999' };
  });

  res.json({
    asked: withNames(asked, 'mentorId').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    received: withNames(received, 'seekerId').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

router.get('/:id', requireAuth, (req, res) => {
  const data = load();
  const booking = data.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (booking.seekerId !== req.userToken.id && booking.mentorId !== req.userToken.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ booking });
});

router.post('/:id/answer', requireAuth, (req, res) => {
  const { answer } = req.body || {};
  if (!answer || answer.trim().length < 2) return res.status(400).json({ error: 'missing_answer' });

  const result = withDb(data => {
    const booking = data.bookings.find(b => b.id === req.params.id);
    if (!booking) return { error: 'not_found' };
    if (booking.mentorId !== req.userToken.id) return { error: 'forbidden' };
    if (booking.status !== 'paid' && booking.status !== 'answered') return { error: 'not_paid' };
    booking.answer = answer.trim().slice(0, 8000);
    booking.status = 'answered';
    booking.answeredAt = new Date().toISOString();
    return { booking };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: result.error });
  if (result.error) return res.status(400).json({ error: result.error });

  const data = load();
  const seeker = data.users.find(u => u.id === result.booking.seekerId);
  const mentor = data.users.find(u => u.id === result.booking.mentorId);
  if (seeker && mentor) notifySeekerAnswered(seeker, mentor, result.booking);

  res.json({ booking: result.booking });
});

router.post('/:id/review', requireAuth, (req, res) => {
  const { rating, review } = req.body || {};
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'invalid_rating' });
  }

  const result = withDb(data => {
    const booking = data.bookings.find(b => b.id === req.params.id);
    if (!booking) return { error: 'not_found' };
    if (booking.seekerId !== req.userToken.id) return { error: 'forbidden' };
    if (booking.status !== 'answered') return { error: 'not_answered' };
    if (booking.rating) return { error: 'already_reviewed' };
    booking.rating = ratingNum;
    booking.review = review ? String(review).trim().slice(0, 2000) : null;
    booking.reviewedAt = new Date().toISOString();
    return { booking };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: result.error });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ booking: result.booking });
});

module.exports = router;
