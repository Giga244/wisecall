const express = require('express');
const { withDb, load } = require('../db');
const config = require('../config');
const stripe = require('../stripeClient');
const { sendEmail, escapeHtml } = require('../email');

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

// Mounted with express.raw() in index.js so the Stripe signature can be verified.
router.post('/stripe', (req, res) => {
  if (!config.STRIPE_ENABLED) return res.status(400).send('stripe not configured');

  let event;
  try {
    if (config.STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
    } else if (config.IS_PROD) {
      return res.status(400).send('STRIPE_WEBHOOK_SECRET is required in production');
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata && session.metadata.bookingId;
    if (bookingId) {
      let justPaid = null;
      withDb(data => {
        const booking = data.bookings.find(b => b.id === bookingId);
        if (booking && booking.status === 'pending_payment') {
          booking.status = 'paid';
          booking.paidAt = new Date().toISOString();
          booking.stripePaymentIntentId = session.payment_intent;
          justPaid = booking;
        }
      });
      if (justPaid) {
        const data = load();
        const mentor = data.users.find(u => u.id === justPaid.mentorId);
        if (mentor) notifyMentorNewQuestion(mentor, justPaid);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
