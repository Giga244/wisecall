// Per-account login lockout (PART 8): 10 wrong passwords for one email in 15 minutes and that email waits 5 minutes, even with the right
// password; its owner gets ONE email; an email with no account behaves the same (the answer never says whether an account exists) and
// nobody is emailed; a new password from the reset link ends the wait; emails are stored only as a keyed hash.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-lockout-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PASSWORD = 'test-pass-12345';
let srv, base;

async function waitMail(to, part) {
  for (let i = 0; i < 60; i++) { const m = outbox().filter((x) => x.to === to && (!part || x.subject.includes(part))); if (m.length) return m; await wait(100); }
  return [];
}
const login = (email, password) => client(base).api('/auth/login', { method: 'POST', body: { email, password } });

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4733, { RATE_LIMIT_MULTIPLIER: '50', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>' });
  base = srv.base;
  const c = client(base);
  assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Lela Locked', email: 'lela@example.com', password: PASSWORD, language: 'ka' } })).status, 201);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('ten wrong passwords for one account', () => {
  test('lock it for 5 minutes, even for the right password, and email its owner once', async () => {
    for (let i = 1; i <= 9; i++) assert.equal((await login('lela@example.com', `wrong-${i}`)).error, 'invalid_credentials', `try ${i}`);
    const tenth = await login('LELA@example.com', 'wrong-10');
    assert.equal(tenth.status, 429);
    assert.equal(tenth.error, 'account_locked');
    assert.ok(tenth.retryAfter > 240 && tenth.retryAfter <= 300, `waits about 5 minutes (${tenth.retryAfter})`);
    const right = await login('lela@example.com', PASSWORD);
    assert.equal(right.status, 429, 'the right password waits too');
    assert.equal(right.error, 'account_locked');
    for (let i = 0; i < 5; i++) await login('lela@example.com', 'still-wrong');
    assert.equal((await waitMail('lela@example.com', 'ცდილობს')).length, 1, 'an email, in the account\'s language');
    await wait(300);
    const warnings = outbox().filter((m) => m.to === 'lela@example.com' && /ცდილობს|sign in/.test(m.subject));
    assert.equal(warnings.length, 1, 'one email per lock');
    assert.match(warnings[0].html, /forgot-password\.html/);
    const stored = (await pool.query('SELECT email_hash FROM login_locks UNION ALL SELECT email_hash FROM login_failures')).rows;
    assert.ok(stored.length && stored.every((r) => /^[0-9a-f]{64}$/.test(r.email_hash)), 'only keyed hashes are stored');
  });

  test('after the wait the right password works, and the count starts again', async () => {
    await pool.query(`UPDATE login_locks SET locked_until = now() - interval '1 second'`);
    assert.equal((await login('lela@example.com', PASSWORD)).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM login_failures')).rows[0].n, 0);
    assert.equal((await login('lela@example.com', 'wrong-again')).error, 'invalid_credentials');
  });

  test('a new password from the reset link ends the wait at once', async () => {
    for (let i = 0; i < 10; i++) await login('lela@example.com', `wrong-${i}`);
    assert.equal((await login('lela@example.com', PASSWORD)).error, 'account_locked');
    const mail = (await waitMail('lela@example.com', 'პაროლის აღდგენა'))[0] || null;
    assert.equal(mail, null, 'no reset email was asked for yet');
    const c = client(base);
    assert.equal((await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'lela@example.com' } })).status, 200);
    const reset = (await waitMail('lela@example.com', 'პაროლის აღდგენა'))[0];
    const token = reset.html.match(/reset-password\.html\?token=([0-9a-f-]+\.[0-9a-f]+)/)[1];
    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'a-brand-new-pass-77' } })).status, 200);
    assert.equal((await login('lela@example.com', 'a-brand-new-pass-77')).status, 200);
  });
});

describe('an email with no account', () => {
  test('is locked the same way (no hint that the account does not exist), and nobody is emailed', async () => {
    for (let i = 1; i <= 9; i++) assert.equal((await login('nobody@example.com', `wrong-${i}`)).error, 'invalid_credentials');
    assert.equal((await login('nobody@example.com', 'wrong-10')).error, 'account_locked');
    await wait(300);
    assert.equal(outbox().filter((m) => m.to === 'nobody@example.com').length, 0);
    // (another account is not affected)
    assert.equal((await login('lela@example.com', 'a-brand-new-pass-77')).status, 200);
  });
});
