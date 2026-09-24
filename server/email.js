// Email delivery. The provider is chosen with EMAIL_PROVIDER and can be swapped without touching
// any other code: every provider implements  send({ to, subject, html, text, replyTo }).
//   resend    - https://resend.com            (needs RESEND_API_KEY)
//   postmark  - https://postmarkapp.com       (needs POSTMARK_TOKEN)
//   log       - development/tests only: appends each message to EMAIL_LOG_FILE, sends nothing
const fs = require('fs');
const config = require('./config');

// One attempt. A failure is marked retryable when it is temporary, so sendEmail() can try once more.
async function postJson(url, headers, body, label) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    const err = new Error(`email_send_failed: ${label} network error: ${e.message}`);
    err.retryable = true;
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
    send: (m) => postJson(config.RESEND_API_URL, { Authorization: `Bearer ${config.RESEND_API_KEY}` }, {
      from: config.EMAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {})
    }, 'resend')
  },

  postmark: {
    configured: () => Boolean(config.POSTMARK_TOKEN),
    send: (m) => postJson('https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': config.POSTMARK_TOKEN }, {
      From: config.EMAIL_FROM, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text,
      MessageStream: 'outbound', ...(m.replyTo ? { ReplyTo: m.replyTo } : {})
    }, 'postmark')
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

function provider() {
  return providers[config.EMAIL_PROVIDER] || null;
}

// Throws on failure (callers decide whether that matters). Returns { sent: false } when no
// provider is configured, which is normal in local development.
async function sendEmail(message) {
  const p = provider();
  if (!p || !p.configured()) return { sent: false, reason: 'not_configured' };
  const clean = { ...message, subject: String(message.subject).replace(/[\r\n]+/g, ' ') };
  if (config.SUPPORT_EMAIL && !clean.replyTo) clean.replyTo = config.SUPPORT_EMAIL;
  try {
    return await p.send(clean);
  } catch (err) {
    if (!err.retryable) throw err;
    await new Promise((r) => setTimeout(r, 700));
    return p.send(clean); // one retry after a temporary failure
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendEmail, escapeHtml, providerNames: Object.keys(providers) };
