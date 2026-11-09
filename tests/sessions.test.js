// Signed-in devices (docs/AUDIT.md #3): signing out ends the session on the server, a password reset or change signs out every other
// device, "sign out other devices" works, and one device can be signed out from another.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base;
const PW = 'test-pass-12345';

before(async () => { await resetDatabase(); srv = await startServer(4712, { RATE_LIMIT_MULTIPLIER: '20' }); base = srv.base; });
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

async function device(email, ua) {
  const c = client(base);
  const r = await c.api('/auth/login', { method: 'POST', body: { email, password: PW }, headers: ua ? { 'User-Agent': ua } : undefined });
  assert.equal(r.status, 200, r.text);
  return c;
}
const signedIn = async (c) => Boolean((await c.api('/me')).user);

describe('sessions', () => {
  test('each login is a session with a device label; the list shows which one is this', async () => {
    await signupVerified(base, 'Nino Test', 'nino@example.com', PW);
    const phone = await device('nino@example.com', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
    const laptop = await device('nino@example.com', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36');
    const list = (await laptop.api('/me/sessions')).sessions;
    assert.ok(list.length >= 3);
    const current = list.find((s) => s.current);
    assert.equal(current.device, 'Chrome · Windows');
    assert.ok(list.some((s) => s.device === 'Safari · iPhone'));
    assert.ok(await signedIn(phone));
  });

  test('signing out ends that session on the server: the old cookie no longer works', async () => {
    const c = await device('nino@example.com');
    const cookie = c.getCookie('wisecall_token');
    assert.equal((await c.api('/auth/logout', { method: 'POST' })).status, 200);
    const replay = client(base);
    replay.setCookie('wisecall_token', cookie);
    assert.equal((await replay.api('/me')).user, null, 'a copied cookie is dead after sign-out');
    assert.equal((await replay.api('/bookings/mine')).status, 401);
  });

  test('one device can sign out another; "sign out other devices" keeps only this one', async () => {
    const a = await device('nino@example.com', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/130.0');
    const b = await device('nino@example.com');
    const bSid = (await b.api('/me/sessions')).sessions.find((s) => s.current).id;
    assert.equal((await a.api(`/me/sessions/${bSid}/revoke`, { method: 'POST' })).status, 200);
    assert.equal(await signedIn(b), false);
    const c = await device('nino@example.com');
    const r = await a.api('/me/sessions/logout-others', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.sessions.length, 1);
    assert.equal(await signedIn(c), false);
    assert.equal(await signedIn(a), true, 'this device stays signed in');
  });

  test('a password change in Settings signs out every other device, and keeps this one', async () => {
    const other = await device('nino@example.com');
    const me = await device('nino@example.com');
    assert.equal((await me.api('/me/password', { method: 'POST', body: { currentPassword: PW, newPassword: 'another-pass-67890' } })).status, 200);
    assert.equal(await signedIn(other), false);
    assert.equal(await signedIn(me), true);
    assert.equal((await me.api('/me/password', { method: 'POST', body: { currentPassword: 'another-pass-67890', newPassword: PW } })).status, 200);
  });

  test('a login cookie from before sessions existed keeps working until the password changes; one without a session made later never works', async () => {
    const jwt = require('jsonwebtoken');
    const me = (await (await signupVerified(base, 'Old Cookie', 'old@example.com', PW)).api('/me')).user;
    const old = client(base);
    const before = Date.parse('2026-09-20T10:00:00Z') / 1000; // (sessions exist since 2026-09-28: docs/REVIEW-2.md #1)
    old.setCookie('wisecall_token', jwt.sign({ id: me.id, email: me.email, iat: before }, 'test-secret-that-is-long-enough-1234567890'));
    assert.equal(await signedIn(old), true);
    const recent = client(base);
    recent.setCookie('wisecall_token', jwt.sign({ id: me.id, email: me.email }, 'test-secret-that-is-long-enough-1234567890'));
    assert.equal(await signedIn(recent), false);
    const f = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'old@example.com' } });
    const token = new URL(f.resetUrl).searchParams.get('token');
    assert.equal((await client(base).api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'reset-pass-24680' } })).status, 200);
    assert.equal(await signedIn(old), false);
  });
});
