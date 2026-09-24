const config = require('./config');

async function sendEmail({ to, subject, html }) {
  if (!config.EMAIL_ENABLED) return { sent: false, reason: 'not_configured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, html })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`email_send_failed: ${res.status} ${text}`);
  }
  return { sent: true };
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendEmail, escapeHtml };
