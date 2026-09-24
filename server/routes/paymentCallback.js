const express = require('express');
const payments = require('../payments');

const router = express.Router();

// The bank's callback URL: register  {APP_URL}/api/payments/callback  with your bank.
// Mounted with express.raw() in index.js because a signature (BOG) covers the exact bytes sent.
// Whatever the callback says, the payment status is then read from the bank's API.
router.post('/callback', async (req, res) => {
  try {
    await payments.handleCallback({ rawBody: req.body, headers: req.headers });
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

module.exports = router;
