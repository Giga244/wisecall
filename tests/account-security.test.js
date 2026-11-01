// Sign-up confirms 18+; passwords found in data breaches are refused (Have I Been Pwned is faked here: only the first 5 characters of
// the SHA-1 are sent); and two-step verification, optional for every account, adds a code after the password at sign-in.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client } = require('./helpers');
const totp = require('../server/totp');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const BREACHED = 'password-from-a-breach-1';
const sha = (p) => crypto.createHash('sha1').update(p).digest('hex').toUpperCase();
const asked = [];
let fake, srv, base;

before(async () => {
  // The fake "range" API: it answers with the breached password's suffix (and some padding) for its prefix.
  fake = http.createServer((req, res) => {
    const prefix = req.url.split('/').pop();
    asked.push(prefix);
    if (prefix === 'DOWN0') { res.writeHead(500); return res.end(); }
    const lines = ['0000000000000000000000000000000000A:0'];
    if (prefix === sha(BREACHED).slice(0, 5)) lines.push(`${sha(BREACHED).slice(5)}:4213`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(lines.join('\r\n'));
  });
  await new Promise((r) => fake.listen(0, r));
  await resetDatabase();
  srv = await startServer(4714, { RATE_LIMIT_MULTIPLIER: '20', HIBP_CHECK: 'on', HIBP_API_URL: `http://localhost:${fake.address().port}/range/` });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); fake.close(); await pool.end(); });

describe('signing up', () => {
  test('the 18+ box is required, and recorded', async () => {
    const c = client(base);
    const r = await c.api('/auth/signup', { method: 'POST', body: { name: 'Young Person', email: 'young@example.com', password: 'fine-password-123' } });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'birth_required');
    const ok = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Adult Person', email: 'adult@example.com', password: 'fine-password-123' } });
    assert.equal(ok.status, 201);
    assert.ok((await pool.query(`SELECT adult_confirmed_at FROM users WHERE email = 'adult@example.com'`)).rows[0].adult_confirmed_at);
  });

  test('a password from a data breach is refused; only a 5-character prefix of its hash leaves the server', async () => {
    const r = await client(base).api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Breached', email: 'breached@example.com', password: BREACHED } });
    assert.equal(r.error, 'password_breached');
    assert.ok(asked.includes(sha(BREACHED).slice(0, 5)));
    assert.ok(asked.every((p) => p.length === 5), 'never the whole hash, never the password');
  });

  test('the same check applies to a password change', async () => {
    const c = await signupVerified(base, 'Changer', 'changer@example.com', 'old-password-123');
    assert.equal((await c.api('/me/password', { method: 'POST', body: { currentPassword: 'old-password-123', newPassword: BREACHED } })).error, 'password_breached');
    assert.equal((await c.api('/me/password', { method: 'POST', body: { currentPassword: 'old-password-123', newPassword: 'new-password-456' } })).status, 200);
  });
});

describe('two-step verification for everyone', () => {
  let c, secret, recovery;

  test('turning it on: a QR code and key, the first code confirms it, recovery codes once', async () => {
    c = await signupVerified(base, 'Nino Twostep', 'nino@example.com', 'nino-password-123');
    assert.equal((await c.api('/me/2fa')).enabled, false);
    const s = await c.api('/me/2fa/setup', { method: 'POST' });
    assert.equal(s.status, 201);
    assert.match(s.qr, /^<svg/);
    secret = s.key.replace(/ /g, '');
    assert.equal((await c.api('/me/2fa/enable', { method: 'POST', body: { code: '000000' } })).error, 'invalid_code');
    const on = await c.api('/me/2fa/enable', { method: 'POST', body: { code: totp.code(secret) } });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.recoveryCodes.length, 8);
    recovery = on.recoveryCodes;
    assert.equal((await c.api('/me/2fa')).enabled, true);
  });

  test('signing in now asks for the code after the password: no session until then', async () => {
    const d = client(base);
    const r = await d.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'nino-password-123' } });
    assert.equal(r.status, 200);
    assert.equal(r.twoFactorRequired, true);
    assert.equal((await d.api('/me')).user, null);
    assert.equal((await d.api('/auth/login/second-step', { method: 'POST', body: { code: '123456' } })).error, 'invalid_code');
    // (a code works once: wait for the next 30-second step)
    await new Promise((res) => setTimeout(res, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const ok = await d.api('/auth/login/second-step', { method: 'POST', body: { code: totp.code(secret) } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await d.api('/me')).user.email, 'nino@example.com');
  });

  test('a recovery code works once instead of the app; the step cannot be skipped', async () => {
    const d = client(base);
    await d.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'nino-password-123' } });
    assert.equal((await d.api('/auth/login/second-step', { method: 'POST', body: { recoveryCode: recovery[0] } })).status, 200);
    const e = client(base);
    await e.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'nino-password-123' } });
    assert.equal((await e.api('/auth/login/second-step', { method: 'POST', body: { recoveryCode: recovery[0] } })).status, 400, 'used already');
    assert.equal((await client(base).api('/auth/login/second-step', { method: 'POST', body: { code: '123456' } })).error, 'sign_in_again', 'no password step, no code step');
  });

  test('turning it off needs the password', async () => {
    assert.equal((await c.api('/me/2fa/disable', { method: 'POST', body: { password: 'wrong' } })).error, 'wrong_password');
    assert.equal((await c.api('/me/2fa/disable', { method: 'POST', body: { password: 'nino-password-123' } })).status, 200);
    const d = client(base);
    const r = await d.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'nino-password-123' } });
    assert.ok(!r.twoFactorRequired);
    assert.ok((await d.api('/me')).user);
  });
});
