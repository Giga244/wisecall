const express = require('express');
const { tx } = require('../db');
const config = require('../config');
const stripe = require('../stripeClient');
const payments = require('../payments');

const router = express.Router();

// Mounted with express.raw() in index.js: the signature check needs the exact bytes Stripe sent.
router.post('/stripe', async (req, res) => {
  if (!config.STRIPE_ENABLED) return res.status(400).send('stripe not configured');

  let event;
  try {
    if (config.STRIPE_WEBHOOK_SECRET) {
      // Stripe gives each webhook endpoint its own secret (one for your account, one for connected
      // accounts), so STRIPE_WEBHOOK_SECRET may hold several, separated by commas.
      const secrets = config.STRIPE_WEBHOOK_SECRET.split(',').map((s) => s.trim()).filter(Boolean);
      let lastError;
      for (const secret of secrets) {
        try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); break; } catch (e) { lastError = e; }
      }
      if (!event) throw lastError;
    } else if (config.IS_PROD) {
      return res.status(400).send('STRIPE_WEBHOOK_SECRET is required in production');
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    let after = [];
    await tx(async (client) => {
      // Idempotency: Stripe retries webhooks, so each event id is handled only once.
      const seen = await client.query(
        'INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [event.id, event.type]
      );
      if (!seen.rowCount) return;
      after = await payments.applyStripeEvent(client, event);
    });
    // Emails etc. run only after the database changes have committed.
    for (const fn of after) fn().catch((e) => console.error('[webhook] follow-up failed:', e.message));
    res.json({ received: true });
  } catch (err) {
    // A 500 makes Stripe retry later; the idempotency row rolled back with the transaction.
    console.error('[webhook] processing failed:', err.message);
    res.status(500).send('processing failed');
  }
});

module.exports = router;
