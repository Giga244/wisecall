// Emails must arrive (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 1): the code email is plain (the code in the subject, no
// pictures, a text part, a link to the code page, replies to support); an unconfirmed address can be corrected on the code screen and a
// new code goes there; the provider's delivery results arrive through a signed webhook and are kept per person for the admins.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const { resetDatabase, startServer, client } = require('./helpers');
const { createFakeResend } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const SECRET_BYTES = crypto.randomBytes(24);
const SECRET = 'whsec_' + SECRET_BYTES.toString('base64');
let srv, base;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4780, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecallge.ge>',
    SUPPORT_EMAIL: 'support@wisecallge.ge', RESEND_WEBHOOK_SECRET: SECRET });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

const statusOf = async (email) => (await pool.query('SELECT email_status FROM users WHERE lower(email) = $1', [email])).rows[0].email_status;
async function signup(name, email, language = 'ka') {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345', language } });
  assert.equal(su.status, 201, su.text);
  return { c, mail: await resend.waitFor(email) };
}

describe('the code email', () => {
  test('the code in a plain subject, no pictures, a text part, the code page, replies to support', async () => {
    const { mail } = await signup('Nino Beridze', 'nino@live.example');
    const code = resend.codeIn(mail);
    assert.match(code, /^\d{6}$/);
    assert.equal(mail.body.subject, `Wisecall – შენი კოდი: ${code}`);
    assert.equal(mail.body.from, 'Wisecall <hello@wisecallge.ge>');
    assert.equal(mail.body.reply_to, 'support@wisecallge.ge');
    assert.doesNotMatch(mail.body.html, /<img/i, 'no pictures');
    assert.match(mail.body.text, new RegExp(code));
    assert.match(mail.body.text, /\/verify-email\.html/);
    assert.equal(await statusOf('nino@live.example'), 'sent');
    const en = await signup('Ana Smith', 'ana@outlook.example', 'en');
    assert.equal(en.mail.body.subject, `Wisecall – your code: ${resend.codeIn(en.mail)}`);
  });
});

describe('a typo in the address', () => {
  test('an unconfirmed address is corrected and a new code goes there; the old one no longer works', async () => {
    const { c, mail } = await signup('Giorgi Typo', 'giorgi@hotmial.example');
    const oldCode = resend.codeIn(mail);
    const r = await c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'Giorgi@Hotmail.example' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.user.email, 'giorgi@hotmail.example');
    const fresh = await resend.waitFor('giorgi@hotmail.example');
    assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: oldCode } })).error, 'invalid_code');
    assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: resend.codeIn(fresh) } })).user.emailVerified, true);
    // confirmed: the address no longer changes here
    assert.equal((await c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'other@example.com' } })).error, 'already_verified');
  });

  test('an address another account has, a bad address and the same address are refused', async () => {
    const { c } = await signup('Lela Taken', 'lela@example.com');
    assert.equal((await c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'nino@live.example' } })).error, 'email_taken');
    assert.equal((await c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'not-an-address' } })).error, 'invalid_email');
    assert.equal((await c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'lela@example.com' } })).error, 'same_email');
    assert.equal((await client(base).api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'x@example.com' } })).status, 401);
  });
});

describe('delivery results (Resend webhook)', () => {
  const sign = (id, ts, body, secret = SECRET_BYTES) => `v1,${crypto.createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64')}`;
  async function hook(event, { secret, ts = Math.floor(Date.now() / 1000), id = 'msg_' + crypto.randomBytes(6).toString('hex') } = {}) {
    const body = JSON.stringify(event);
    return fetch(`${base}/api/email/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(id, ts, body, secret) }, body });
  }

  test('a signed "delivered" or "bounced" is kept per person; "sent" never hides a provider\'s answer', async () => {
    assert.equal((await hook({ type: 'email.delivered', data: { to: ['NINO@live.example'] } })).status, 200);
    assert.equal(await statusOf('nino@live.example'), 'delivered');
    assert.equal((await hook({ type: 'email.sent', data: { to: ['nino@live.example'] } })).status, 200);
    assert.equal(await statusOf('nino@live.example'), 'delivered');
    assert.equal((await hook({ type: 'email.bounced', data: { to: ['ana@outlook.example'] } })).status, 200);
    assert.equal(await statusOf('ana@outlook.example'), 'bounced');
  });

  test('a wrong signature or an old timestamp is refused, and changes nothing', async () => {
    assert.equal((await hook({ type: 'email.bounced', data: { to: ['nino@live.example'] } }, { secret: crypto.randomBytes(24) })).status, 401);
    assert.equal((await hook({ type: 'email.bounced', data: { to: ['nino@live.example'] } }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
    assert.equal((await fetch(`${base}/api/email/webhook`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(await statusOf('nino@live.example'), 'delivered');
  });

  test('admin sees the last email per applicant', async () => {
    const { mail } = await signup('QA Admin', 'qa-admin@example.com', 'en');
    const admin = client(base);
    await admin.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: 'test-pass-12345' } });
    await admin.api('/auth/verify-email', { method: 'POST', body: { code: resend.codeIn(mail) } });
    const { c } = await signup('Mentor Applicant', 'applicant@example.com');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    await hook({ type: 'email.bounced', data: { to: ['applicant@example.com'] } });
    const list = await admin.api('/admin/mentors');
    const m = (list.mentors || []).find((x) => x.email === 'applicant@example.com');
    assert.ok(m, JSON.stringify(list).slice(0, 300));
    assert.equal(m.emailStatus, 'bounced');
  });
});
