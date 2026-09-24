const express = require('express');
const { tx } = require('../db');
const { bookingFromRow, getUserById } = require('../models');
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
router.post('/stripe', async (req, res) => {
  if (!config.STRIPE_ENABLED) return res.status(400).send('stripe not configured');

  let event;
  try {
    if (config.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.STRIPE_WEBHOOK_SECRET);
    } else if (config.IS_PROD) {
      return res.status(400).send('STRIPE_WEBHOOK_SECRET is required in production');
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    let justPaid = null;
    await tx(async (client) => {
      // Idempotency: Stripe retries webhooks, so each event id is handled only once.
      const seen = await client.query('INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [event.id, event.type]);
      if (!seen.rowCount) return;

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const bookingId = session.metadata && session.metadata.bookingId;
        if (bookingId && session.payment_status === 'paid') {
          const { rows } = await client.query(
            `UPDATE bookings SET status = 'paid', paid_at = now(), stripe_payment_intent_id = $2
              WHERE id = $1 AND status = 'pending_payment' RETURNING *`,
            [bookingId, session.payment_intent]
          );
          if (rows[0]) justPaid = bookingFromRow(rows[0]);
        }
      }
    });

    if (justPaid) {
      const mentor = await getUserById(justPaid.mentorId);
      if (mentor) notifyMentorNewQuestion(mentor, justPaid);
    }
    res.json({ received: true });
  } catch (err) {
    // A 500 makes Stripe retry later; the idempotency row was rolled back with the transaction.
    console.error('[webhook] processing failed:', err.message);
    res.status(500).send('processing failed');
  }
});

module.exports = router;
