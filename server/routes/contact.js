const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../util');
const { optionalAuth } = require('../auth');
const { sendTemplate } = require('../mail');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Messages from the public contact form go to the admins (ADMIN_EMAILS), never to SUPPORT_EMAIL: the admin
// addresses stay private, and SUPPORT_EMAIL is only the public address shown on the site.
// Replying to the email replies to the visitor. A signed-in person's message becomes a support conversation in their Inbox instead
// (the admins answer it in the admin panel, and the person sees the reply in the Inbox and by email).
router.post('/', optionalAuth, asyncHandler(async (req, res) => {
  const { name, email, message, website } = req.body || {};
  // Hidden field that real people never fill in: quietly pretend it worked.
  if (website) return res.json({ ok: true });

  if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string' ||
      !name.trim() || message.trim().length < 10) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!EMAIL_RE.test(email.trim()) || email.length > 254) return res.status(400).json({ error: 'invalid_email' });

  const data = { name: name.trim().slice(0, 100), email: email.trim(), message: message.trim().slice(0, 3000) };

  if (req.userToken) {
    const user = await require('../models').getUserById(req.userToken.id);
    if (user) {
      try {
        const thread = await require('../inbox').startSupport(user, { subject: 'Contact form', body: data.message, source: 'contact' });
        return res.json({ ok: true, threadId: thread.id });
      } catch (e) {
        if (!(e instanceof require('../inbox').InboxError)) throw e; // (too many open conversations: the email below still reaches us)
      }
    }
  }
  const recipients = [...new Set(config.ADMIN_EMAILS)];

  if (!config.EMAIL_ENABLED || !recipients.length) {
    if (config.IS_PROD) return res.status(503).json({ error: 'send_failed' });
    console.log(`[contact] (dev) message from ${data.name} <${data.email}>: ${data.message}`);
    return res.json({ ok: true, devMode: true });
  }
  try {
    // One message per admin, so a failure for one address does not hide the message from the others.
    const results = await Promise.allSettled(recipients.map((to) => sendTemplate('contact', { to, lang: 'en', data, replyTo: data.email })));
    if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  } catch (e) {
    console.error('[email] contact form send failed:', e.message);
    return res.status(502).json({ error: 'send_failed' });
  }
  res.json({ ok: true });
}));

module.exports = router;
