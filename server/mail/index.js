const { render } = require('./templates');
const { sendEmail } = require('../email');

// Renders a template in the recipient's language and sends it. Throws if delivery fails, so
// callers that need to know (verification codes, password resets) can react.
// attachments: [{ filename, content (base64), contentType }] (a calendar file for a live-session ticket).
async function sendTemplate(name, { to, lang, data, replyTo, attachments }) {
  return sendEmail({ to, ...(replyTo ? { replyTo } : {}), ...(attachments && attachments.length ? { attachments } : {}), ...render(name, lang, data) });
}

module.exports = { sendTemplate, render };
