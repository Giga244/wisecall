// Email delivery. The provider is chosen with EMAIL_PROVIDER and can be swapped without touching
// any other code: every provider implements  send({ to, subject, html, text, replyTo }).
//   resend    - https://resend.com            (needs RESEND_API_KEY)
//   postmark  - https://postmarkapp.com       (needs POSTMARK_TOKEN)
//   log       - development/tests only: appends each message to EMAIL_LOG_FILE, sends nothing
const fs = require('fs');
const config = require('./config');

// One attempt. A failure is marked retryable when it is temporary, so sendEmail() can try once more.
async function postJson(url, headers, body, label, timeoutMs = 15000) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const err = new Error(`email_send_failed: ${label} network error: ${e.message}`);
    err.retryable = true;
    err.network = true; // (no answer at all, or a timeout)
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`email_send_failed: ${label} ${res.status} ${text.slice(0, 300)}`);
    // Server errors and rate limits are worth one more try; a 4xx (bad key, unverified domain) is not.
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  return { sent: true };
}

const providers = {
  resend: {
    configured: () => Boolean(config.RESEND_API_KEY),
    send: (m, o = {}) => postJson(config.RESEND_API_URL, { Authorization: `Bearer ${config.RESEND_API_KEY}` }, {
      from: config.EMAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      ...(m.headers ? { headers: m.headers } : {}),
      ...(m.attachments ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) } : {})
    }, 'resend', o.timeoutMs)
  },

  postmark: {
    configured: () => Boolean(config.POSTMARK_TOKEN),
    send: (m, o = {}) => postJson(config.POSTMARK_API_URL + '/email', { 'X-Postmark-Server-Token': config.POSTMARK_TOKEN }, {
      From: config.EMAIL_FROM, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text,
      MessageStream: 'outbound', ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
      ...(m.headers ? { Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
      ...(m.attachments ? { Attachments: m.attachments.map((a) => ({ Name: a.filename, Content: a.content, ContentType: a.contentType || 'application/octet-stream' })) } : {})
    }, 'postmark', o.timeoutMs)
  },

  log: {
    configured: () => !config.IS_PROD,
    async send(m) {
      const line = JSON.stringify({ at: new Date().toISOString(), ...m });
      if (config.EMAIL_LOG_FILE) fs.appendFileSync(config.EMAIL_LOG_FILE, line + '\n');
      else console.log(`[email:log] to=${m.to} subject="${m.subject}"`);
      return { sent: true };
    }
  }
};

// For the launch check: proves the key works and (Resend) that the sending domain is verified, because an
// unverified domain is the most common reason a launch day email never arrives.
// Returns { detail, warning? }; throws when something is wrong.
async function ping() {
  const from = String(config.EMAIL_FROM || '');
  const domain = (from.match(/@([^>\s]+)>?\s*$/) || [])[1];
  if (config.EMAIL_PROVIDER === 'postmark') {
    const res = await fetch(config.POSTMARK_API_URL + '/server', { headers: { Accept: 'application/json', 'X-Postmark-Server-Token': config.POSTMARK_TOKEN }, signal: AbortSignal.timeout(15000) }).catch((e) => { throw new Error(`network error calling Postmark: ${e.message}`); });
    if (res.status === 401 || res.status === 403) throw new Error('Postmark rejected the server token (POSTMARK_TOKEN)');
    if (!res.ok) throw new Error(`Postmark answered ${res.status}`);
    return { detail: 'server token accepted', warning: `Check in Postmark that ${domain || 'the EMAIL_FROM domain'} has a confirmed sender signature or domain` };
  }
  if (config.EMAIL_PROVIDER !== 'resend') throw new Error(`EMAIL_PROVIDER=${config.EMAIL_PROVIDER} sends nothing`);
  const res = await fetch(new URL(config.RESEND_API_URL).origin + '/domains', { headers: { Accept: 'application/json', Authorization: `Bearer ${config.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000) }).catch((e) => { throw new Error(`network error calling Resend: ${e.message}`); });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && /restricted/i.test(`${body.name} ${body.message}`)) {
    // A "sending access" key is the safer kind to use on a server, but it cannot list domains.
    return { detail: 'key accepted (a sending-only key)', warning: `Cannot check that ${domain} is verified with a sending-only key. Confirm it shows "Verified" at resend.com/domains` };
  }
  if (res.status === 401 || res.status === 403) throw new Error('Resend rejected the API key (RESEND_API_KEY)');
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  const found = (body.data || []).find((d) => String(d.name).toLowerCase() === String(domain).toLowerCase());
  if (!found) throw new Error(`Resend accepted the key, but ${domain} is not one of its domains. Add it at resend.com/domains and set the DNS records`);
  if (found.status !== 'verified') throw new Error(`Resend accepted the key, but ${domain} is "${found.status}", not verified. Finish the DNS records at resend.com/domains`);
  return { detail: `key accepted and ${domain} is verified` };
}

function provider() {
  return providers[config.EMAIL_PROVIDER] || null;
}

// Throws on failure (callers decide whether that matters). Returns { sent: false } when no
// provider is configured, which is normal in local development.
// `quick`: a person is waiting for this one (a sign-up code, a reset link): 5 seconds, and a second try only after a fast answer (a 5xx
// or 429), never after a timeout, so a hanging email service never makes a page wait half a minute (docs/TODO-REHEARSAL.md R-7).
// Background emails keep 15 seconds and one retry.
async function sendEmail(message, { quick = false } = {}) {
  const p = provider();
  if (!p || !p.configured()) return { sent: false, reason: 'not_configured' };
  const clean = { ...message, subject: String(message.subject).replace(/[\r\n]+/g, ' ') };
  if (config.SUPPORT_EMAIL && !clean.replyTo) clean.replyTo = config.SUPPORT_EMAIL;
  const opts = quick ? { timeoutMs: 5000 } : {};
  try {
    return await p.send(clean, opts);
  } catch (err) {
    if (!err.retryable || (quick && err.network)) throw err;
    await new Promise((r) => setTimeout(r, 700));
    return p.send(clean); // one retry after a temporary failure
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendEmail, ping, escapeHtml, providerNames: Object.keys(providers) };
