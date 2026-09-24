// A tiny stand-in for the Resend HTTP API. Every request it receives is kept in `sent`, so a test can
// prove which emails went out, to whom, in which language, and read the codes and links inside them.
const http = require('http');
const { client, wait } = require('./helpers');

function createFakeResend() {
  const sent = [];
  let server;
  const api = {
    sent,
    url: '',
    start: () => new Promise((resolve) => {
      server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        sent.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'email_' + sent.length }));
      });
      server.listen(0, () => { api.url = `http://localhost:${server.address().port}/emails`; resolve(); });
    }),
    stop: () => new Promise((resolve) => server.close(resolve)),
    to: (address, subjectPart) => sent.filter((m) => m.body.to === address && (!subjectPart || m.body.subject.includes(subjectPart))),
    // The 6-digit code shown in an email.
    codeIn: (mail) => (mail.body.html.match(/letter-spacing:8px[^>]*>(\d{6})</) || [])[1],
    // Waits for a NEW email: one more than `already` matching messages. Returns the newest.
    waitForNew: async (address, subjectPart, already, ms = 8000) => {
      const end = Date.now() + ms;
      for (;;) {
        const m = api.to(address, subjectPart);
        if (m.length > already) return m[m.length - 1];
        if (Date.now() > end) throw new Error(`no new email to ${address} matching "${subjectPart || ''}"`);
        await wait(100);
      }
    },
    // Waits until an email matching the filter has arrived.
    waitFor: async (address, subjectPart, ms = 8000) => {
      const end = Date.now() + ms;
      for (;;) {
        const m = api.to(address, subjectPart);
        if (m.length) return m[m.length - 1];
        if (Date.now() > end) throw new Error(`no email to ${address} matching "${subjectPart || ''}"`);
        await wait(100);
      }
    }
  };
  return api;
}

// Signs a user up on a server that really sends email: the code is read from the message.
async function signupByEmail(fake, base, name, email, language = 'en', password = 'test-pass-12345') {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { name, email, password, language } });
  if (su.status !== 201) throw new Error('signup failed: ' + su.text);
  const mail = await fake.waitFor(email);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: fake.codeIn(mail) } });
  if (v.status !== 200) throw new Error('verify failed: ' + v.text);
  return c;
}

module.exports = { createFakeResend, signupByEmail };
