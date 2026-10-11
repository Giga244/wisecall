// REVIEW-2: two-step verification for every account. The short-lived "second step" cookie, given out after the password, must never
// work as a session (REVIEW-2 #1); five wrong codes lock the step; turning the step on signs out the other devices (REVIEW-2 #11).
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startServer, signupVerified, client } = require('../helpers');
const totp = require('../../server/totp');
const { BASE_ENV, pool, sql } = require('./_shared');

const PASSWORD = 'tara-password-12345';
let srv, base;

before(async () => {
  await resetDatabase();
  srv = await startServer(4851, { ...BASE_ENV });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

async function withTwoFactor(name, email) {
  const c = await signupVerified(base, name, email, PASSWORD);
  const s = await c.api('/me/2fa/setup', { method: 'POST' });
  assert.equal(s.status, 201, s.text);
  const secret = s.key.replace(/ /g, '');
  const on = await c.api('/me/2fa/enable', { method: 'POST', body: { code: totp.code(secret) } });
  assert.equal(on.status, 200, on.text);
  return { c, secret };
}
// Someone who knows the password (the case two-step verification is for) signs in: they get the "second step" cookie, nothing more.
async function passwordOnly(email) {
  const d = client(base);
  const r = await d.api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(r.twoFactorRequired, true, r.text);
  assert.equal((await d.api('/me')).user, null, 'no session yet');
  const pending = d.getCookie('wisecall_2fa');
  assert.ok(pending, 'the second-step cookie was set');
  return pending;
}

describe('the second step cannot be skipped', () => {
  test('the "second step" cookie, copied into the sign-in cookie, does not sign anybody in', async () => {
    await withTwoFactor('Tara Twostep', 'tara@example.com');
    const pending = await passwordOnly('tara@example.com');
    const attacker = client(base);
    attacker.setCookie('wisecall_token', pending);
    const me = await attacker.api('/me');
    assert.equal(me.user, null, `the pending cookie worked as a session for ${me.user && me.user.email}`);
    // (with it, the password alone would also turn the step off for good)
    const off = await attacker.api('/me/2fa/disable', { method: 'POST', body: { password: PASSWORD } });
    assert.equal(off.status, 401, 'turning two-step verification off without the code');
    assert.equal((await sql('SELECT count(*)::int AS n FROM admin_two_factor t JOIN users u ON u.id = t.user_id WHERE u.email = $1 AND t.enabled_at IS NOT NULL', ['tara@example.com']))[0].n, 1);
  });

  test('without the password step, the code step answers "sign in again"; a made-up cookie is refused', async () => {
    const c = client(base);
    assert.equal((await c.api('/auth/login/second-step', { method: 'POST', body: { code: '123456' } })).error, 'sign_in_again');
    c.setCookie('wisecall_2fa', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IngifQ.bad');
    assert.equal((await c.api('/auth/login/second-step', { method: 'POST', body: { code: '123456' } })).error, 'sign_in_again');
  });

  test('five wrong codes lock the step: then even the right code waits', async () => {
    const { secret } = await withTwoFactor('Lena Lock', 'lena@example.com');
    const d = client(base);
    await d.api('/auth/login', { method: 'POST', body: { email: 'lena@example.com', password: PASSWORD } });
    for (let i = 0; i < 5; i++) assert.equal((await d.api('/auth/login/second-step', { method: 'POST', body: { code: '000000' } })).error, 'invalid_code');
    const r = await d.api('/auth/login/second-step', { method: 'POST', body: { code: totp.code(secret) } });
    assert.equal(r.status, 429, r.text);
    assert.equal((await d.api('/me')).user, null);
  });

  test('a code in another script (same length, more bytes) is refused, not an error', async () => {
    const { c } = await withTwoFactor('Ira Unicode', 'ira@example.com');
    const r = await c.api('/me/2fa/recovery-codes', { method: 'POST', body: { code: '١٢٣٤٥٦' } });
    assert.equal(r.status, 400, r.text);
  });
});

describe('turning the step on and off', () => {
  test('turning it on signs out the other devices that only passed the password', async () => {
    const c = await signupVerified(base, 'Nika Devices', 'nika@example.com', PASSWORD);
    const other = client(base);
    assert.equal((await other.api('/auth/login', { method: 'POST', body: { email: 'nika@example.com', password: PASSWORD } })).status, 200);
    assert.ok((await other.api('/me')).user, 'signed in on the second device');
    const s = await c.api('/me/2fa/setup', { method: 'POST' });
    assert.equal((await c.api('/me/2fa/enable', { method: 'POST', body: { code: totp.code(s.key.replace(/ /g, '')) } })).status, 200);
    assert.ok((await c.api('/me')).user, 'the device that turned it on stays signed in');
    assert.equal((await other.api('/me')).user, null, 'the other device must pass the new step');
  });

  test('another account cannot turn my step off (it only ever acts on the signed-in account)', async () => {
    await withTwoFactor('Owner Two', 'owner2@example.com');
    const eve = await signupVerified(base, 'Eve Other', 'eve2@example.com', PASSWORD);
    assert.equal((await eve.api('/me/2fa/disable', { method: 'POST', body: { password: PASSWORD } })).status, 200, '(Eve has none: nothing to turn off)');
    assert.equal((await sql('SELECT count(*)::int AS n FROM admin_two_factor t JOIN users u ON u.id = t.user_id WHERE u.email = $1', ['owner2@example.com']))[0].n, 1);
  });
});
