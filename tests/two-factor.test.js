// Two-step verification for admins (an authenticator app + recovery codes): nothing of the admin panel works, for a password alone, until the
// second step has been passed in this session.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified } = require('./helpers');
const totp = require('../server/totp');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const SECRET = 'test-secret-that-is-long-enough-1234567890'; // (the session secret tests/helpers.js gives every server)
const EMAIL = 'qa-admin@example.com';
let srv, base, admin, adminId, plain, setup;
const extra = [];

// Every admin route (from the route files, like tests/admin-access.test.js): none of them may work without the second step.
function adminRoutes() {
  const found = [];
  const scan = (file, prefix, only) => {
    for (const m of fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'([^\n]*)/g)) {
      if (only && !m[2].startsWith(only)) continue;
      found.push({ method: m[1].toUpperCase(), path: prefix + m[2], line: m[0] });
    }
  };
  scan('server/routes/admin.js', '/api/admin');
  scan('server/routes/adminVerification.js', '/api/admin');
  scan('server/routes/ratings.js', '/api', '/admin/');
  scan('server/routes/adminDev.js', '/api/admin/dev');
  return found;
}
const UUID = '00000000-0000-4000-8000-000000000000';
const withParams = (p) => p.replace(/:(?:mentorId|id)\b/g, UUID).replace(/:step\b/, 'id_kyc');

// A fresh sign-in with the password (which is NOT a verified admin session).
async function passwordLogin(email = EMAIL) {
  const c = client(base);
  assert.equal((await c.api('/auth/login', { method: 'POST', body: { email, password: 'test-pass-12345' } })).status, 200);
  return c;
}
const twoFactorRow = async () => (await pool.query('SELECT * FROM admin_two_factor WHERE user_id = $1', [adminId])).rows[0];
// A code that is valid now and has not been used: the next 30-second step (one step ahead is accepted), after freeing the steps used so far.
async function freshCode(secret) { await pool.query('UPDATE admin_two_factor SET last_step = 0 WHERE user_id = $1', [adminId]); return totp.code(secret); }
async function enroll(c) {
  const s = await c.api('/admin/2fa/setup', { method: 'POST', body: {} });
  assert.equal(s.status, 201, s.text);
  const e = await c.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(s.secret) } });
  assert.equal(e.status, 200, e.text);
  return { secret: s.secret, recoveryCodes: e.recoveryCodes };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4619, { ADMIN_2FA: 'required', RATE_LIMIT_MULTIPLIER: '20' }); // (many sign-ins from one address; the limit itself is checked at the end)
  base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', EMAIL);
  plain = await signupVerified(base, 'Plain Person', 'plain@example.com');
  adminId = (await admin.api('/me')).user.id;
});
after(async () => { [srv, ...extra].forEach((s) => s && s.proc.kill()); await pool.end(); });

describe('before it is set up: a password is not enough for anything', () => {
  test('every admin route says "set up two-step verification first" to an admin, and the plain "not admin" to everybody else', async () => {
    const routes = adminRoutes();
    assert.ok(routes.length >= 30);
    for (const r of routes) {
      const url = withParams(r.path);
      const opts = r.method === 'GET' ? {} : { method: r.method, body: {} };
      const asAdmin = await admin(url, opts);
      assert.equal(asAdmin.status, 403, `${r.method} ${url}`);
      assert.deepEqual(JSON.parse(asAdmin.text), { error: 'two_factor_setup_required' }, `${r.method} ${url}`);
      assert.deepEqual(JSON.parse((await plain(url, opts)).text), { error: 'not_admin' }, `${r.method} ${url}`);
    }
  });

  test('the status route, before anything is set up (and only for an admin)', async () => {
    assert.deepEqual(await admin.api('/admin/2fa/status').then(({ required, enabled, verified, recoveryLeft, devCode }) => ({ required, enabled, verified, recoveryLeft, devCode })), { required: true, enabled: false, verified: false, recoveryLeft: 0, devCode: undefined });
    assert.equal((await client(base).api('/admin/2fa/status')).status, 401);
    assert.equal((await plain.api('/admin/2fa/status')).error, 'not_admin');
    for (const p of ['setup', 'enable', 'verify']) assert.equal((await plain.api(`/admin/2fa/${p}`, { method: 'POST', body: { code: '123456' } })).status, 403, p);
    assert.equal((await plain.api('/admin/2fa/recovery-codes', { method: 'POST', body: {} })).status, 403);
  });

  test('the admin page is the two-step page, and only its own script and small dictionary are sent; the panel\'s files are not', async () => {
    const page = await admin('/admin.html');
    assert.equal(page.status, 200);
    assert.match(page.text, /admin-2fa\.js/);
    assert.match(page.text, /wisecall-i18n-extra" content="admin2fa"/);
    for (const leak of [/adminTabs/, /adminLaunchNote/, /admin-mentors\.js/, /js\/admin\.js/, /LAUNCH_MODE/, /Mentor applications/]) assert.doesNotMatch(page.text, leak, String(leak));
    assert.equal((await admin('/js/admin-2fa.js')).status, 200);
    const dict = JSON.parse((await admin('/i18n/admin2fa-en.json')).text);
    assert.equal(dict['admin.tf.title'], 'Two-step verification');
    for (const p of ['/js/admin.js', '/js/admin-mentors.js', '/js/admin-queue.js', '/i18n/admin-en.json', '/i18n/admin-ka.json']) assert.equal((await admin(p)).status, 403, `${p} waits for the second step`);
    // nobody else gets the two-step files either, and the page itself is not served under its own name
    for (const who of [client(base), plain]) for (const p of ['/js/admin-2fa.js', '/i18n/admin2fa-en.json', '/i18n/admin2fa-ka.json']) assert.equal((await who(p)).status, 403, p);
    assert.equal((await client(base)('/admin-2fa.html', { headers: { Accept: 'text/html' } })).status, 404);
    assert.equal((await admin('/admin-2fa.html', { headers: { Accept: 'text/html' } })).status, 404);
  });
});

describe('setting it up', () => {
  test('the set-up gives a secret, a key to type, a QR code and the address in it; the secret is kept encrypted', async () => {
    const r = await admin.api('/admin/2fa/setup', { method: 'POST', body: {} });
    assert.equal(r.status, 201, r.text);
    setup = r;
    assert.match(r.secret, /^[A-Z2-7]{32}$/);
    assert.equal(r.key.replace(/ /g, ''), r.secret);
    assert.match(r.key, /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    assert.equal(r.otpauthUrl, `otpauth://totp/Wisecall:${encodeURIComponent(EMAIL)}?secret=${r.secret}&issuer=Wisecall&algorithm=SHA1&digits=6&period=30`);
    assert.match(r.qr, /^<svg [^>]*viewBox=/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.devCode, totp.code(r.secret), 'development only: the code the app would show now');
    const row = await twoFactorRow();
    assert.equal(row.enabled_at, null, 'not on yet');
    assert.match(row.secret_enc, /^v1:/);
    assert.ok(!row.secret_enc.includes(r.secret), 'never stored as it is');
    assert.equal((await admin.api('/admin/2fa/status')).enabled, false);
  });

  test('asking again before it is on gives a NEW secret (the old one stops working); a wrong or missing code turns nothing on', async () => {
    const again = await admin.api('/admin/2fa/setup', { method: 'POST', body: {} });
    assert.notEqual(again.secret, setup.secret);
    assert.equal((await admin.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(setup.secret) } })).error, 'invalid_code', 'the first secret is gone');
    for (const body of [{ code: '000000' }, { code: '12345' }, { code: 123456 }, {}, { code: null }]) {
      const r = await admin.api('/admin/2fa/enable', { method: 'POST', body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.error, 'invalid_code');
    }
    assert.equal((await twoFactorRow()).enabled_at, null);
    // still not a verified session
    assert.equal((await admin.api('/admin/mentors')).error, 'two_factor_setup_required');
    setup = again;
  });

  test('the first right code turns it on, signs this session in, and returns 8 recovery codes once (only their hashes are kept)', async () => {
    const r = await admin.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(setup.secret) } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.recoveryCodes.length, 8);
    assert.equal(new Set(r.recoveryCodes).size, 8);
    for (const c of r.recoveryCodes) assert.match(c, /^[0-9a-f]{5}-[0-9a-f]{5}$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const row = await twoFactorRow();
    assert.ok(row.enabled_at);
    assert.equal(row.recovery_hashes.length, 8);
    for (const c of r.recoveryCodes) assert.ok(!row.recovery_hashes.includes(c) && !JSON.stringify(row).includes(c), 'no recovery code is stored');
    setup.recoveryCodes = r.recoveryCodes;
    assert.equal((await admin.api('/admin/mentors')).status, 200, 'this session is a verified admin session now');
    assert.equal((await admin.api('/admin/2fa/status')).verified, true);
    assert.equal((await admin.api('/admin/2fa/status')).recoveryLeft, 8);
  });

  test('once it is on it cannot be set up again from here: a password alone cannot swap the app (not even a verified session)', async () => {
    for (const who of [admin, await passwordLogin()]) {
      const r = await who.api('/admin/2fa/setup', { method: 'POST', body: {} });
      assert.equal(r.status, 409);
      assert.equal(r.error, 'already_enabled');
    }
    assert.equal((await admin.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(setup.secret) } })).error, 'already_enabled');
  });
});

describe('signing in as an admin afterwards', () => {
  test('a password sign-in is not a verified admin session: every admin route asks for the code', async () => {
    const c = await passwordLogin();
    assert.deepEqual(JSON.parse((await c('/api/admin/mentors')).text), { error: 'two_factor_required' });
    assert.equal((await c('/js/admin.js')).status, 403);
    const st = await c.api('/admin/2fa/status');
    assert.deepEqual([st.enabled, st.verified, st.recoveryLeft], [true, false, 8]);
    assert.ok(totp.verify(setup.secret, st.devCode, { afterStep: (await twoFactorRow()).last_step }), 'development only: a code that would be accepted right now (a step already used is skipped)');
    assert.match((await c('/admin.html')).text, /admin-2fa\.js/);
  });

  test('a code from the app opens everything: the panel page, its scripts, its dictionaries, the routes', async () => {
    const c = await passwordLogin();
    const r = await c.api('/admin/2fa/verify', { method: 'POST', body: { code: await freshCode(setup.secret) } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.usedRecovery, false);
    assert.equal((await c.api('/admin/mentors')).status, 200);
    assert.match((await c('/admin.html')).text, /id="adminTabs"/);
    for (const p of ['/js/admin.js', '/js/admin-mentors.js', '/i18n/admin-en.json', '/i18n/admin-ka.json']) assert.equal((await c(p)).status, 200, p);
  });

  test('a wrong code, a malformed one, and the same code twice are all refused', async () => {
    const c = await passwordLogin();
    for (const body of [{ code: '000000' }, { code: '12345' }, { code: 'abcdef' }, {}, { code: 123456 }, { code: ['123456'] }]) {
      const r = await c.api('/admin/2fa/verify', { method: 'POST', body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.error, 'invalid_code');
    }
    assert.equal((await c.api('/admin/mentors')).error, 'two_factor_required', 'nothing was unlocked');
    await pool.query('UPDATE admin_two_factor SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [adminId]);

    const code = await freshCode(setup.secret);
    assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { code } })).status, 200);
    const other = await passwordLogin();
    const replay = await other.api('/admin/2fa/verify', { method: 'POST', body: { code } });
    assert.equal(replay.status, 400, 'a code works once, even for the right person');
    assert.equal((await other.api('/admin/mentors')).error, 'two_factor_required');
  });

  test('the same code sent twice at the same moment is accepted once', async () => {
    const [a, b] = [await passwordLogin(), await passwordLogin()];
    const code = await freshCode(setup.secret);
    const [r1, r2] = await Promise.all([a.api('/admin/2fa/verify', { method: 'POST', body: { code } }), b.api('/admin/2fa/verify', { method: 'POST', body: { code } })]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 400]);
  });

  test('five wrong codes in a row lock it for five minutes (even the right code is refused), then it works again', async () => {
    await pool.query('UPDATE admin_two_factor SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [adminId]);
    const c = await passwordLogin();
    for (let i = 0; i < 5; i++) assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { code: '000000' } })).status, 400, `wrong code ${i + 1}`);
    const locked = await c.api('/admin/2fa/verify', { method: 'POST', body: { code: await freshCode(setup.secret) } });
    assert.equal(locked.status, 429);
    assert.equal(locked.error, 'locked');
    assert.ok(locked.retryAfter > 200 && locked.retryAfter <= 300, String(locked.retryAfter));
    assert.equal(locked.headers.get('retry-after'), String(locked.retryAfter));
    assert.equal((await c.api('/admin/mentors')).error, 'two_factor_required');
    assert.ok((await twoFactorRow()).locked_until, 'recorded');
    await pool.query(`UPDATE admin_two_factor SET locked_until = now() - interval '1 second' WHERE user_id = $1`, [adminId]);
    assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { code: await freshCode(setup.secret) } })).status, 200);
  });
});

describe('recovery codes', () => {
  test('one works once (however it is typed), and is used up; a recovery code is not a code from the app, and a code from the app is not a recovery code', async () => {
    const [first, second] = setup.recoveryCodes;
    const c = await passwordLogin();
    assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { code: first } })).status, 400, 'not a code from the app');
    assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: totp.code(setup.secret) } })).status, 400, 'nor the other way round');
    assert.equal((await c.api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: 'aaaaa-bbbbb' } })).status, 400);
    const r = await c.api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: `  ${first.toUpperCase().replace('-', ' ')} ` } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.usedRecovery, true);
    assert.equal(r.recoveryLeft, 7);
    assert.equal((await c.api('/admin/mentors')).status, 200);
    assert.equal((await (await passwordLogin()).api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: first } })).status, 400, 'used up');
    assert.equal((await twoFactorRow()).recovery_hashes.length, 7);
    assert.equal((await (await passwordLogin()).api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: second } })).status, 200);
  });

  test('new ones need a verified session, replace all the old ones, and are shown once', async () => {
    assert.equal((await (await passwordLogin()).api('/admin/2fa/recovery-codes', { method: 'POST', body: {} })).error, 'two_factor_required');
    const r = await admin.api('/admin/2fa/recovery-codes', { method: 'POST', body: {} });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.recoveryCodes.length, 8);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (const old of setup.recoveryCodes.slice(0, 3)) {
      await pool.query('UPDATE admin_two_factor SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [adminId]); // (wrong codes count toward the lock)
      assert.equal((await (await passwordLogin()).api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: old } })).status, 400, 'an old code is dead');
    }
    await pool.query('UPDATE admin_two_factor SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [adminId]);
    assert.equal((await (await passwordLogin()).api('/admin/2fa/verify', { method: 'POST', body: { recoveryCode: r.recoveryCodes[0] } })).status, 200);
  });
});

describe('how long a verified session lasts', () => {
  // (the admin's real session, signed again with other claims: only a token that names a live session is ever a session)
  const sessionOf = (c) => { const { sid, sv } = jwt.decode(c.getCookie('wisecall_token')); return { sid, sv }; };
  let session = {};
  before(async () => { session = sessionOf(await passwordLogin()); });
  const cookieFor = (claims) => ({ cookie: `wisecall_token=${jwt.sign({ id: adminId, email: EMAIL, ...session, ...claims }, SECRET, { expiresIn: '30d' })}` });
  const call = async (headers) => (await fetch(`${base}/api/admin/mentors`, { headers: { 'X-Requested-With': 'wisecall', ...headers } })).status;

  test('12 hours: a session verified just now works, one verified 13 hours ago asks for the code, and a time in the future is not believed', async () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(await call(cookieFor({ mfaAt: now })), 200);
    assert.equal(await call(cookieFor({ mfaAt: now - 11 * 3600 })), 200);
    assert.equal(await call(cookieFor({ mfaAt: now - 13 * 3600 })), 403);
    assert.equal(await call(cookieFor({ mfaAt: now + 3600 })), 403);
    for (const bad of [undefined, null, 'yesterday', {}, 0, -1]) assert.equal(await call(cookieFor({ mfaAt: bad })), 403, String(bad));
    assert.equal(await call(cookieFor({})), 403);
  });

  test('a cookie made for someone who is not an admin does not become one by carrying the claim', async () => {
    const plainId = (await plain.api('/me')).user.id;
    const own = sessionOf(await passwordLogin('plain@example.com')); // (their own real session)
    const forged = { cookie: `wisecall_token=${jwt.sign({ id: plainId, email: 'plain@example.com', ...own, mfaAt: Math.floor(Date.now() / 1000) }, SECRET, { expiresIn: '1d' })}` };
    assert.equal(await call(forged), 403);
    assert.equal((await fetch(`${base}/admin.html`, { headers: forged, redirect: 'manual' })).status, 403);
  });
});

describe('the rest of the world', () => {
  test('the script for a lost phone removes it for one person, who can then set it up again', async () => {
    const before = await twoFactorRow();
    assert.ok(before.enabled_at);
    const run = (email) => spawnSync('node', ['scripts/reset-admin-2fa.js', email], { cwd: ROOT, env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, ADMIN_EMAILS: EMAIL }, encoding: 'utf8' });
    assert.match(run('nobody@example.com').stderr, /No account has the address/);
    const out = run(EMAIL);
    assert.match(out.stdout, /Two-step verification was removed for qa-admin@example.com/, out.stderr);
    assert.equal(await twoFactorRow(), undefined);
    assert.equal((await (await passwordLogin()).api('/admin/2fa/status')).enabled, false);
    const c = await passwordLogin();
    assert.equal((await c.api('/admin/2fa/setup', { method: 'POST', body: {} })).status, 201, 'set up again');
    assert.match(run(EMAIL).stdout, /removed/);
    assert.match(run(EMAIL).stdout, /had no two-step verification/);
  });

  test('ADMIN_2FA=off (for tests only) lets a password through, says so, and is refused in production', async () => {
    const s = await startServer(4644, { ADMIN_2FA: 'off', ADMIN_EMAILS: 'off-admin@example.com' }); extra.push(s);
    const c = await signupVerified(s.base, 'Off Admin', 'off-admin@example.com');
    assert.equal((await c.api('/admin/mentors')).status, 200);
    const st = await c.api('/admin/2fa/status');
    assert.deepEqual([st.required, st.verified], [false, true]);
    assert.match(s.logs(), /ADMIN 2FA IS OFF/);

    const prod = spawnSync('node', ['server/index.js'], {
      cwd: ROOT, encoding: 'utf8', timeout: 20000,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4645', DATABASE_URL: process.env.TEST_DATABASE_URL, SESSION_SECRET: SECRET, PUBLIC_URL: 'https://wisecall.example', RESEND_API_KEY: 're_fake',
        EMAIL_FROM: 'Wisecall <hi@wisecall.example>', ADMIN_EMAILS: 'boss@wisecall.example', PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'id', BOG_CLIENT_SECRET: 'secret', DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345',
        JWT_SECRET: '', APP_URL: '', KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'key_for_test', DIDIT_WORKFLOW_ID: 'workflow_for_test', DIDIT_WEBHOOK_SECRET: 'whsec_for_test', ADMIN_2FA: 'off'
      }
    });
    assert.equal(prod.status, 1);
    assert.match(prod.stderr, /ADMIN_2FA=off is not allowed in production/);
  });

  test('the two-step page texts exist in English and Georgian, the panel says what to do when a session runs out, and there is a dev-only helper', () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin2fa-en.json'), 'utf8')), ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin2fa-ka.json'), 'utf8'));
    assert.deepEqual(Object.keys(en), Object.keys(ka));
    assert.ok(Object.keys(en).length >= 25);
    for (const k of Object.keys(en)) { assert.match(ka[k], /[ა-ჿ]/, k); assert.notEqual(ka[k], en[k], k); }
    for (const k of ['{minutes}', '{code}']) assert.ok(Object.values(en).some((v) => v.includes(k)) && Object.values(ka).some((v) => v.includes(k)), k);
    const panel = { en: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin-en.json'), 'utf8')), ka: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin-ka.json'), 'utf8')) };
    assert.ok(panel.en['admin.tf.expired'] && /[ა-ჿ]/.test(panel.ka['admin.tf.expired']));
    const js = fs.readFileSync(path.join(ROOT, 'public/js/admin-2fa.js'), 'utf8');
    for (const needle of ["api('setup', 'POST')", "api('enable', 'POST'", "api('verify', 'POST'", 'devBox', 'admin.tf.dev', 'tfDevFill', 'autocomplete="one-time-code"', 'admin.tf.saved', 'tfSaved']) assert.ok(js.includes(needle), needle);
    assert.match(fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8'), /two_factor_required/);
    const index = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
    for (const route of ['verify', 'enable', 'setup']) assert.ok(index.includes('app.use(\'/api/admin/2fa/' + route + '\', rateLimit('), 'the ' + route + ' route is rate limited');
  });
});
