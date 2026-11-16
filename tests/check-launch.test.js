// `npm run check:launch`: proves it reports a good setup as ready, names every kind of mistake, talks to the
// real provider code (against fake banks / Didit / Resend), never prints a secret, and sets the exit code.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resetDatabase } = require('./helpers');
const { createFakeBank } = require('./fakeBank');
const { createFakeDidit } = require('./fakeDidit');
const { createFakeResend } = require('./fakeResend');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-launch.js');
const SESSION_SECRET = 's3ssion-'.repeat(6);
const DATA_KEY = 'd4ta-key-'.repeat(5);

let bank, didit, resend;
before(async () => {
  await resetDatabase();
  bank = createFakeBank();
  didit = createFakeDidit();
  resend = createFakeResend();
  await Promise.all([bank.start(), didit.start(), resend.start()]);
});
after(async () => { await Promise.all([bank.stop(), didit.stop(), resend.stop()]); });

// Every setting the check reads, so nothing leaks in from the machine running the tests.
const BLANK = Object.fromEntries(['NODE_ENV', 'PUBLIC_URL', 'APP_URL', 'DATABASE_URL', 'SESSION_SECRET', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'PAYMENT_PROVIDER', 'BOG_CLIENT_ID', 'BOG_CLIENT_SECRET',
  'BOG_API_URL', 'BOG_AUTH_URL', 'TBC_API_KEY', 'TBC_CLIENT_ID', 'TBC_CLIENT_SECRET', 'TBC_API_URL', 'KYC_PROVIDER', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_API_URL',
  'EMAIL_PROVIDER', 'RESEND_API_KEY', 'RESEND_API_URL', 'POSTMARK_TOKEN', 'POSTMARK_API_URL', 'EMAIL_LOG_FILE', 'EMAIL_FROM', 'SUPPORT_EMAIL', 'ADMIN_EMAILS', 'ADMIN_EMAIL', 'LAUNCH_MODE'].map((k) => [k, '']));

const goodEnv = () => ({
  NODE_ENV: 'production', PUBLIC_URL: 'https://wisecall.example', DATABASE_URL: process.env.TEST_DATABASE_URL, SESSION_SECRET, DATA_ENCRYPTION_KEY: DATA_KEY,
  PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: bank.BOG_ID, BOG_CLIENT_SECRET: bank.BOG_SECRET, BOG_API_URL: bank.url, BOG_AUTH_URL: `${bank.url}/bog-oauth/token`,
  KYC_PROVIDER: 'didit', DIDIT_API_KEY: didit.API_KEY, DIDIT_WORKFLOW_ID: didit.WORKFLOW, DIDIT_WEBHOOK_SECRET: didit.SECRET, DIDIT_API_URL: didit.url,
  EMAIL_PROVIDER: 'resend', RESEND_API_KEY: resend.key, RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: 'support@wisecall-team.ge',
  ADMIN_EMAILS: 'owner@wisecall.example', LAUNCH_MODE: 'live'
});

// Runs the real command, in an empty folder so no local .env file is read.
function check(overrides = {}, args = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: os.tmpdir(), env: { ...process.env, ...BLANK, ...goodEnv(), ...overrides } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}
const line = (out, text) => out.split('\n').find((l) => l.includes(text)) || '';

describe('a correct production setup', () => {
  test('passes every check, with a ✅ per line, and exits 0', async () => {
    const r = await check();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /READY: every check passed/);
    assert.doesNotMatch(r.out, /❌|⚠/);
    for (const text of ['NODE_ENV is "production"', 'Development mode (devMode) is off', 'SESSION_SECRET is set', 'PUBLIC_URL is https://wisecall.example', 'No fake (mock) provider is active',
      'Bank of Georgia answers', 'Didit answers', 'Resend answers', 'SUPPORT_EMAIL is support@wisecall-team.ge', 'LAUNCH_MODE is "live"', 'Admin accounts need two-step verification']) {
      assert.match(line(r.out, text), /^ {2}✅/, `${text}\n${r.out}`);
    }
    assert.match(r.out, /migrations? applied|reachable/);
  });

  test('asks the real bank for a token, Didit about a session and Resend about domains', async () => {
    const tokens = bank.state.tokenRequests, calls = didit.calls.length;
    await check();
    assert.equal(bank.state.tokenRequests, tokens + 1);
    assert.ok(didit.calls.length > calls);
    assert.equal(didit.sessions.size, 0, 'the normal check never opens an ID-check session');
  });

  test('never prints a secret', async () => {
    const r = await check();
    for (const secret of [SESSION_SECRET, DATA_KEY, bank.BOG_SECRET, didit.API_KEY, didit.SECRET, resend.key, process.env.TEST_DATABASE_URL]) {
      assert.ok(!r.out.includes(secret), `the output contains ${secret.slice(0, 6)}…`);
    }
  });

  test('TBC Bank is checked through its own token endpoint', async () => {
    const r = await check({ PAYMENT_PROVIDER: 'tbc', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: bank.TBC_KEY, TBC_CLIENT_ID: bank.TBC_ID, TBC_CLIENT_SECRET: bank.TBC_SECRET, TBC_API_URL: bank.url });
    assert.equal(r.code, 0, r.out);
    assert.match(line(r.out, 'TBC Bank answers'), /^ {2}✅/);
  });

  test('--deep also opens one unused Didit session to prove the workflow id', async () => {
    const before = didit.sessions.size;
    const r = await check({}, ['--deep']);
    assert.equal(r.code, 0, r.out);
    assert.equal(didit.sessions.size, before + 1);
    assert.match(r.out, /workflow id/);
    const bad = await check({ DIDIT_WORKFLOW_ID: 'not-my-workflow' }, ['--deep']);
    assert.equal(bad.code, 1);
    assert.match(line(bad.out, 'Didit answers'), /^ {2}❌.*400/);
  });
});

describe('a development setup is refused, with every reason listed', () => {
  test('nothing set: every kind of mistake gets a ❌, live checks are skipped, exit code 1', async () => {
    const r = await check(Object.fromEntries(Object.keys(BLANK).map((k) => [k, ''])));
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT READY: \d+ things? to fix/);
    for (const text of ['NODE_ENV is "production"', 'Development mode (devMode) is off', 'SESSION_SECRET is at least 32', 'DATA_ENCRYPTION_KEY is at least 32', 'PUBLIC_URL is your https:// address',
      'ADMIN_EMAILS is set', 'EMAIL_FROM is set', 'DATABASE_URL is set', 'Payments use a real bank', 'ID checks use Didit', 'No fake (mock) provider is active']) {
      assert.match(line(r.out, text), /^ {2}❌/, `${text}\n${r.out}`);
    }
    assert.match(line(r.out, 'answers'), /^ {2}➖/, 'nothing is contacted with no keys');
    assert.match(line(r.out, 'SUPPORT_EMAIL is set'), /^ {2}⚠️/, 'a missing public address is a warning, not a blocker');
  });

  test('the fake bank, the fake ID check and the email log are each named', async () => {
    const r = await check({ NODE_ENV: '', PAYMENT_PROVIDER: 'mock', KYC_PROVIDER: 'mock', EMAIL_PROVIDER: 'log' });
    assert.equal(r.code, 1);
    assert.match(r.out, /❌ Payments use a real bank — PAYMENT_PROVIDER=mock/);
    assert.match(r.out, /❌ ID checks use Didit — KYC_PROVIDER=mock/);
    assert.match(r.out, /❌ Email goes through a real provider — EMAIL_PROVIDER=log/);
    assert.match(r.out, /❌ Development mode \(devMode\) is off/);
    assert.match(r.out, /❌ No fake \(mock\) provider is active/);
  });
});

describe('each setting is judged on its own', () => {
  const bad = [
    ['SESSION_SECRET shorter than 32 characters', { SESSION_SECRET: 'x'.repeat(31) }, /❌ SESSION_SECRET is at least 32 characters — it is 31/],
    ['DATA_ENCRYPTION_KEY shorter than 32 characters', { DATA_ENCRYPTION_KEY: 'x'.repeat(20) }, /❌ DATA_ENCRYPTION_KEY is at least 32 characters/],
    ['a PUBLIC_URL that is not https', { PUBLIC_URL: 'http://wisecall.example' }, /❌ PUBLIC_URL is your https:\/\/ address — http:\/\/wisecall\.example is not https/],
    ['a PUBLIC_URL on this computer', { PUBLIC_URL: 'https://localhost:4242' }, /❌ PUBLIC_URL is your real address/],
    ['a missing bank secret', { BOG_CLIENT_SECRET: '' }, /❌ Payment keys for BOG are set — missing: BOG_CLIENT_SECRET/],
    ['a missing Didit webhook secret', { DIDIT_WEBHOOK_SECRET: '' }, /❌ Didit keys are set — missing: DIDIT_WEBHOOK_SECRET/],
    ['a missing Resend key', { RESEND_API_KEY: '' }, /❌ Resend API key is set/],
    ['Resend\'s test sender', { EMAIL_FROM: 'onboarding@resend.dev' }, /❌ EMAIL_FROM is on your own domain/],
    ['an unknown LAUNCH_MODE', { LAUNCH_MODE: 'soon' }, /❌ LAUNCH_MODE is "prelaunch" or "live"/]
  ];
  for (const [name, env, pattern] of bad) {
    test(`${name} is a ❌ and exit code 1`, async () => {
      const r = await check(env);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, pattern);
    });
  }

  test('a placeholder SUPPORT_EMAIL (support@wisecall.example, example.com, a .test address) blocks: the live site would show no address', async () => {
    for (const address of ['support@wisecall.example', 'help@example.com', 'support@wisecall.test']) {
      const r = await check({ SUPPORT_EMAIL: address });
      assert.notEqual(r.code, 0, address);
      assert.match(line(r.out, 'SUPPORT_EMAIL is your real support address'), /^ {2}❌/, r.out);
      assert.match(r.out, new RegExp(`${address.replace(/\./g, '\\.')} is a placeholder`));
    }
    const config = require('../server/config');
    for (const real of ['support@wisecall.ge', 'help@wisecall.ge', 'team@testing.ge', 'a@example.ge']) assert.equal(config.isPlaceholderEmail(real), false, real);
  });

  test('a personal mailbox as SUPPORT_EMAIL, and prelaunch mode, are warnings that do not block', async () => {
    const r = await check({ SUPPORT_EMAIL: 'someone@gmail.com', LAUNCH_MODE: 'prelaunch' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠️ +SUPPORT_EMAIL is a role address on your own domain/);
    assert.match(r.out, /⚠️ +LAUNCH_MODE is "live" — it is "prelaunch"/);
    assert.match(r.out, /READY, with 2 warnings/);
  });
});

describe('providers that are configured but not answering correctly', () => {
  test('wrong bank credentials are a ❌ with the bank\'s reason', async () => {
    const r = await check({ BOG_CLIENT_SECRET: 'wrong-secret' });
    assert.equal(r.code, 1);
    assert.match(line(r.out, 'Bank of Georgia answers'), /^ {2}❌.*401/);
  });

  test('wrong TBC key, wrong Didit key', async () => {
    const t = await check({ PAYMENT_PROVIDER: 'tbc', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: 'wrong', TBC_CLIENT_ID: bank.TBC_ID, TBC_CLIENT_SECRET: bank.TBC_SECRET, TBC_API_URL: bank.url });
    assert.match(line(t.out, 'TBC Bank answers'), /^ {2}❌.*401/);
    const d = await check({ DIDIT_API_KEY: 'wrong-key' });
    assert.equal(d.code, 1);
    assert.match(line(d.out, 'Didit answers'), /^ {2}❌.*rejected the API key/);
  });

  test('a provider that is down is a ❌ (not a crash)', async () => {
    const r = await check({ BOG_AUTH_URL: 'http://127.0.0.1:9/token', DIDIT_API_URL: 'http://127.0.0.1:9', RESEND_API_URL: 'http://127.0.0.1:9/emails' });
    assert.equal(r.code, 1);
    for (const text of ['Bank of Georgia answers', 'Didit answers', 'Resend answers']) assert.match(line(r.out, text), /^ {2}❌.*network error/, text);
  });

  test('Resend: a wrong key, an unverified domain and an unknown domain are each explained', async () => {
    const wrong = await check({ RESEND_API_KEY: 're_wrong' });
    assert.match(line(wrong.out, 'Resend answers'), /^ {2}❌.*rejected the API key/);

    resend.domains = [{ name: 'wisecall.example', status: 'pending' }];
    const pending = await check();
    assert.equal(pending.code, 1);
    assert.match(line(pending.out, 'Resend answers'), /^ {2}❌.*"pending", not verified/);

    resend.domains = [{ name: 'other.example', status: 'verified' }];
    const unknown = await check();
    assert.match(line(unknown.out, 'Resend answers'), /^ {2}❌.*not one of its domains/);
    resend.domains = [{ name: 'wisecall.example', status: 'verified' }];
  });

  test('Resend: a sending-only key works but the domain cannot be checked, so it is a ⚠ that does not block', async () => {
    resend.restricted = true;
    try {
      const r = await check();
      assert.equal(r.code, 0, r.out);
      assert.match(line(r.out, 'Resend answers'), /^ {2}⚠️.*sending-only key.*resend\.com\/domains/);
    } finally { resend.restricted = false; }
  });

  test('an unreachable database is a ❌', async () => {
    const r = await check({ DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:9/none' });
    assert.equal(r.code, 1);
    assert.match(line(r.out, 'database'), /^ {2}❌.*cannot connect/);
  });
});

describe('going online in prelaunch, before the bank and Didit keys exist', () => {
  const noKeys = { PAYMENT_PROVIDER: '', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', KYC_PROVIDER: '', DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: '' };

  test('prelaunch: the missing keys are ⚠️ warnings, not ❌ failures, and the check passes', async () => {
    const r = await check({ LAUNCH_MODE: 'prelaunch', ...noKeys });
    assert.equal(r.code, 0, r.out);
    assert.match(line(r.out, 'Payments use a real bank'), /^ {2}⚠️ .*PAYMENT_PROVIDER is not set.*Fine while the site is in prelaunch.*before LAUNCH_MODE=live/);
    assert.match(line(r.out, 'ID checks use Didit'), /^ {2}⚠️ .*KYC_PROVIDER is not set.*ID checks open soon/);
    assert.match(line(r.out, 'answers and accepts your keys'), /^ {2}➖ .*no bank keys yet \(fine in prelaunch\)/);
    assert.match(line(r.out, 'Didit answers'), /^ {2}➖ .*no Didit keys yet \(fine in prelaunch\)/);
    assert.doesNotMatch(r.out, /❌/);
    assert.match(r.out, /READY, with \d+ warnings/);
  });

  test('prelaunch with only some of the keys: still warnings', async () => {
    const r = await check({ LAUNCH_MODE: 'prelaunch', BOG_CLIENT_SECRET: '', DIDIT_WEBHOOK_SECRET: '' });
    assert.equal(r.code, 0, r.out);
    assert.match(line(r.out, 'Payment keys for BOG are set'), /^ {2}⚠️ .*missing: BOG_CLIENT_SECRET/);
    assert.match(line(r.out, 'Didit keys are set'), /^ {2}⚠️ .*missing: DIDIT_WEBHOOK_SECRET/);
  });

  test('live: the same missing keys are ❌ and block the launch', async () => {
    const r = await check({ LAUNCH_MODE: 'live', ...noKeys });
    assert.equal(r.code, 1, r.out);
    assert.match(line(r.out, 'Payments use a real bank'), /^ {2}❌ .*LAUNCH_MODE=live needs it/);
    assert.match(line(r.out, 'ID checks use Didit'), /^ {2}❌ /);
    assert.match(r.out, /NOT READY/);
  });

  test('the fake bank is a ❌ even in prelaunch', async () => {
    const r = await check({ LAUNCH_MODE: 'prelaunch', PAYMENT_PROVIDER: 'mock' });
    assert.equal(r.code, 1, r.out);
    assert.match(line(r.out, 'Payments use a real bank'), /^ {2}❌ .*fake bank/);
  });
});

describe('admin two-step verification', () => {
  test('is checked (a ✅ with how long a verified session lasts), and switching it off is a ❌ that blocks the launch', async () => {
    const ok = await check();
    assert.match(line(ok.out, 'Admin accounts need two-step verification'), /^ {2}✅.*12 hours/);
    const off = await check({ ADMIN_2FA: 'off' });
    assert.notEqual(off.code, 0, off.out);
    assert.match(off.out, /ADMIN_2FA=off/);
  });
});

describe('a missing SUPPORT_EMAIL', () => {
  test('is a clear warning that does not block, and says what the site does without it', async () => {
    const r = await check({ SUPPORT_EMAIL: '' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠️ +SUPPORT_EMAIL is set — it is empty, so no public contact address appears in the footer, Terms, Privacy Policy or emails, and the contact page shows only the form/);
    assert.match(r.out, /READY, with 1 warning/);
  });
});

// These run last: they need the tables, which the tests above do not (an empty database is fine for them).
describe('the launch mode against the mentors that can be booked', () => {
  const { spawnSync } = require('child_process');
  const { Pool } = require('pg');
  before(() => {
    const m = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js')], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8' });
    assert.equal(m.status, 0, m.stderr);
  });

  test('empty LAUNCH_MODE with nobody listed: a warning that the site is in prelaunch, and it opens by itself', async () => {
    const r = await check({ LAUNCH_MODE: '' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠️ +Launch mode is automatic — 0 listed mentors, so the site is in prelaunch/);
    assert.match(r.out, /opens by itself when the first mentor is listed/);
  });

  test('LAUNCH_MODE=live with nobody listed is a warning too', async () => {
    const r = await check({ LAUNCH_MODE: 'live' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠️ +LAUNCH_MODE is "live" and there is somebody to book — no mentor is listed yet/);
  });

  test('once a mentor is listed, automatic means live and the warnings go away', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query(`INSERT INTO users (name, email, password_hash, role, niche, role_title, price, verification_status, payout_iban_enc, email_verified)
                      VALUES ('Listed Mentor', 'listed@example.com', 'x', 'mentor', 'business', 'Founder', 20, 'verified', 'enc', true)`);
    await pool.end();
    const auto = await check({ LAUNCH_MODE: '' });
    assert.equal(auto.code, 0, auto.out);
    assert.match(auto.out, /✅ Launch mode is automatic — 1 listed mentor, so the site is live/);
    const live = await check({ LAUNCH_MODE: 'live' });
    assert.doesNotMatch(live.out, /somebody to book/);
    assert.match(live.out, /READY: every check passed/);
  });
});