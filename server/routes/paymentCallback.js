const express = require('express');
const payments = require('../payments');

const router = express.Router();

// The bank's callback URL: register  {APP_URL}/api/payments/callback  with your bank.
// Mounted with express.raw() in index.js because a signature (BOG) covers the exact bytes sent.
// Whatever the callback says, the payment status is then read from the bank's API.
router.post('/callback', async (req, res) => {
  try {
    await payments.handleCallback({ rawBody: req.body, headers: req.headers, ip: req.ip });
    res.json({ received: true });
  } catch (err) {
    // A forged or unreadable callback is refused. A real one we could not process (for example the
    // bank's API was briefly down) gets a 500 so the bank can retry; the sweep job also catches it.
    if (err.code === 'invalid_callback') {
      console.warn('[payments] rejected callback:', err.message);
      return res.status(400).json({ error: 'invalid_callback' });
    }
    console.error('[payments] callback processing failed:', err.message);
    res.status(500).json({ error: 'processing_failed' });
  }
});

// Flitt sends the buyer back with a form POST to the response_url (server/pay/flitt.js): this sends the browser on to the page it came
// from, with a GET. Only to an address on this site (never an open redirect). What happened to the payment is read from the bank.
router.all('/flitt/return', (req, res) => {
  const config = require('../config');
  const next = String(req.query.next || '');
  const ok = next.startsWith(config.PUBLIC_URL + '/') && !/[\r\n]/.test(next);
  res.redirect(303, ok ? next : config.PUBLIC_URL + '/dashboard.html');
});

// Flitt's callback about a payout (PAYOUT_METHOD=flitt_iban): checked like a payment's (Flitt's address, the payout key's signature), then
// the payout's status is read from Flitt (server/withdrawals.js syncPayout).
router.post('/flitt/payout-callback', async (req, res) => {
  let orderId;
  try { ({ orderId } = require('../pay/flitt').verifyPayoutCallback({ rawBody: req.body, ip: req.ip })); } catch (e) {
    console.warn('[payments] rejected payout callback:', e.message);
    return res.status(400).json({ error: 'invalid_callback' });
  }
  try {
    const { query } = require('../db');
    const { rows: [b] } = await query('SELECT id FROM payout_batches WHERE provider_order_id = $1', [orderId]);
    if (b) await require('../withdrawals').syncPayout(b.id);
    res.json({ received: true });
  } catch (err) {
    console.error('[payments] payout callback failed:', err.message);
    res.status(500).json({ error: 'processing_failed' });
  }
});

module.exports = router;
