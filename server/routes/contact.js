const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../util');
const { sendTemplate } = require('../mail');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Messages from the public contact form go to the site owner (SUPPORT_EMAIL, or the first admin).
// Replying to the email replies to the visitor.
router.post('/', asyncHandler(async (req, res) => {
  const { name, email, message, website } = req.body || {};
  // Hidden field that real people never fill in: quietly pretend it worked.
  if (website) return res.json({ ok: true });

  if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string' ||
      !name.trim() || message.trim().length < 10) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!EMAIL_RE.test(email.trim()) || email.length > 254) return res.status(400).json({ error: 'invalid_email' });

  const data = { name: name.trim().slice(0, 100), email: email.trim(), message: message.trim().slice(0, 3000) };
  const to = config.SUPPORT_EMAIL || config.ADMIN_EMAILS[0];

  if (!config.EMAIL_ENABLED || !to) {
    if (config.IS_PROD) return res.status(503).json({ error: 'send_failed' });
    console.log(`[contact] (dev) message from ${data.name} <${data.email}>: ${data.message}`);
    return res.json({ ok: true, devMode: true });
  }
  try {
    await sendTemplate('contact', { to, lang: 'en', data, replyTo: data.email });
  } catch (e) {
    console.error('[email] contact form send failed:', e.message);
    return res.status(502).json({ error: 'send_failed' });
  }
  res.json({ ok: true });
}));

module.exports = router;
