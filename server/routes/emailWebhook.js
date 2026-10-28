// What the email provider (Resend) reports about an email after we handed it over: delivered, delayed, bounced, complained
// (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 1). Kept as the last result per person (users.email_status), so an admin sees
// when someone's code never arrived. Off unless RESEND_WEBHOOK_SECRET is set (Resend → Webhooks → the endpoint's signing secret).
//
// Mounted with express.raw() in index.js: the signature covers the exact bytes. Resend signs with Svix: the headers svix-id,
// svix-timestamp and svix-signature ("v1,<base64>" values, separated by spaces), the signature being HMAC-SHA256 of
// "<id>.<timestamp>.<body>" with the secret (the part after "whsec_", base64). Nothing in the body is trusted before that check.
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query } = require('../db');

const router = express.Router();
const TOLERANCE_S = 5 * 60; // (an older or newer timestamp is refused: a replayed request)
const STATUS = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.bounced': 'bounced', 'email.complained': 'complained' };

function verified(req) {
  const secret = String(config.RESEND_WEBHOOK_SECRET || '');
  const id = req.get('svix-id');
  const ts = req.get('svix-timestamp');
  const sig = req.get('svix-signature');
  if (!secret || !id || !ts || !sig || !Buffer.isBuffer(req.body)) return false;
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${req.body.toString('utf8')}`).digest();
  return sig.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const got = Buffer.from(value, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

router.post('/', async (req, res) => {
  if (!config.RESEND_WEBHOOK_SECRET) return res.status(404).json({ error: 'not_found' });
  if (!verified(req)) return res.status(401).json({ error: 'invalid_signature' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'invalid_body' }); }
  const status = STATUS[event && event.type];
  const to = event && event.data && event.data.to;
  const addresses = (Array.isArray(to) ? to : [to]).filter((a) => typeof a === 'string' && a.length <= 254).map((a) => a.trim().toLowerCase());
  if (status && addresses.length) {
    // (a newer result never loses to an older one that arrives late; "sent" never replaces a provider's answer)
    await query(
      `UPDATE users SET email_status = $2, email_status_at = now()
        WHERE lower(email) = ANY($1::text[]) AND ($2 <> 'sent' OR email_status IS NULL OR email_status = 'sent')`, [addresses, status]);
  }
  res.json({ ok: true });
});

module.exports = router;
