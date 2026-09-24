const { render } = require('./templates');
const { sendEmail } = require('../email');

// Renders a template in the recipient's language and sends it. Throws if delivery fails, so
// callers that need to know (verification codes, password resets) can react.
async function sendTemplate(name, { to, lang, data }) {
  return sendEmail({ to, ...render(name, lang, data) });
}

module.exports = { sendTemplate, render };
