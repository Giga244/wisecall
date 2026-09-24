const express = require('express');
const kyc = require('../verification/kyc');

const router = express.Router();

// The ID-verification provider calls this address when a check finishes:
//   {PUBLIC_URL}/api/kyc/webhook
// It is mounted with express.raw() in index.js because the signature covers the exact bytes sent,
// and it is exempt from the CSRF header rule because it comes from the provider's servers.
router.post('/webhook', async (req, res) => {
  try {
    await kyc.handleWebhook({ rawBody: req.body, headers: req.headers });
    res.json({ received: true });
  } catch (err) {
    if (err.code === 'invalid_webhook') {
      console.warn('[kyc] rejected webhook:', err.detail);
      return res.status(400).json({ error: 'invalid_webhook' });
    }
    // A real event we could not process: a 500 makes the provider retry.
    console.error('[kyc] webhook processing failed:', err.message);
    res.status(500).json({ error: 'processing_failed' });
  }
});

module.exports = router;