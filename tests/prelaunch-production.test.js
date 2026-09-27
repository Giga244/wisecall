// Going online before the bank and the ID-check provider are set up: in production with LAUNCH_MODE=prelaunch (or empty) the server starts
// without any bank or Didit keys, nothing can be booked or paid, mentors can apply and wait ("ID checks open soon"), and visitors can join the
// waiting list. With LAUNCH_MODE=live the strict rules stay: no start without the real keys. The fake bank and ID check never exist in production.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, SAMPLE, longQuestion, longAnswer } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const resend = createFakeResend();
const started = [];
const NO_KEYS = {
  PAYMENT_PROVIDER: '', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: '', TBC_CLIENT_ID: '', TBC_CLIENT_SECRET: '',
  KYC_PROVIDER: '', DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: ''
};
const BANK_AND_DIDIT = {
  PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'id_for_test', BOG_CLIENT_SECRET: 'secret_for_test',
  KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'key_for_test', DIDIT_WORKFLOW_ID: 'workflow_for_test', DIDIT_WEBHOOK_SECRET: 'whsec_for_test'
};
// A production server with everything a first deploy has (domain, email, secrets), and no bank or Didit keys.
const prodEnv = (extra) => ({
  NODE_ENV: 'production', PUBLIC_URL: 'https://wisecallge.ge', DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345',
  EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecallge.ge>', SUPPORT_EMAIL: 'support@wisecallge.ge',
  ...NO_KEYS, ...extra
});
// The same, started as a separate program (for the cases where it must refuse to start). Values are blanked, not left out, so the
// developer's own .env cannot fill them in.
function startFails(extra) {
  const env = {
    PATH: process.env.PATH, PORT: '4669', DATABASE_URL: process.env.TEST_DATABASE_URL, SESSION_SECRET: 'test-secret-that-is-long-enough-1234567890',
    JWT_SECRET: '', APP_URL: '', ADMIN_EMAILS: 'boss@wisecallge.ge', ADMIN_EMAIL: '', ADMIN_2FA: '', LAUNCH_MODE: '', ...prodEnv({}), RESEND_API_URL: 'http://127.0.0.1:9/emails', ...extra
  };
  return spawnSync('node', ['server/index.js'], { cwd: ROOT, encoding: 'utf8', timeout: 15000, env });
}

let pre, mentor, mentorId, seeker;

before(async () => {
  await resend.start();
  await resetDatabase();
  pre = await startServer(4661, prodEnv({ LAUNCH_MODE: 'prelaunch' }));
  started.push(pre);
});
after(async () => { started.forEach((s) => s.proc.kill()); await resend.stop(); await pool.end(); });

describe('production + LAUNCH_MODE=prelaunch, with no bank and no Didit keys', () => {
  test('the server starts, and says plainly what is closed', async () => {
    assert.equal((await fetch(`${pre.base}/healthz`)).status, 200);
    const log = pre.logs();
    assert.match(log, /Payments: OFF \(no bank keys yet\)/);
    assert.match(log, /ID check: OFF \(no Didit keys yet\)/);
    assert.match(log, /\[WARNING\] PAYMENTS ARE OFF/);
    assert.match(log, /\[WARNING\] ID CHECKS ARE OFF/);
    assert.doesNotMatch(log, /MOCK/);
    const cfg = await client(pre.base).api('/config');
    assert.equal(cfg.launchMode, 'prelaunch');
    assert.equal(cfg.idChecksOpen, false);
    assert.ok(!('devMode' in cfg));
    assert.equal(cfg.contactEmail, 'support@wisecallge.ge');
  });

  test('a mentor can sign up (code by email), fill in the application, and waits: the ID check is closed, the other steps work', async () => {
    mentor = await signupByEmail(resend, pre.base, 'Nino Mentor', 'nino@example.com');
    const r = await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 25 } });
    assert.equal(r.status, 200, r.text);
    mentorId = (await mentor.api('/me')).user.id;
    const start = await mentor.api('/verification/kyc/start', { method: 'POST', body: {} });
    assert.equal(start.status, 503);
    assert.equal(start.error, 'kyc_unavailable');
    // The rest of the application works: the Experience form, the evidence, and submitting it.
    const form = await mentor.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Product designer', niche: 'design', specialtyTags: ['apps'], yearsExperience: 7, story: 'I taught myself product design and have spent seven years designing apps for shops, banks and delivery services in Tbilisi.', sampleAnswer: longAnswer(SAMPLE) } });
    assert.equal(form.error, undefined, form.text);
    const ev = await mentor.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'https://nino-mentor.invalid/portfolio' } });
    assert.equal(ev.error, undefined, ev.text);
    const sent = await mentor.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.error, undefined, sent.text);
    const v = await mentor.api('/verification');
    assert.equal(v.error, undefined, v.text);
    assert.equal(v.status, 'pending', 'the application is waiting for review'); // (this route's own "status" field: the mentor's verification status)
    assert.equal(v.requirements.find((x) => x.step === 'id_kyc').status, 'todo');
    assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: 'Nino Mentor', iban: 'GE29NB0000000101904917' } })).status, 200);
    assert.equal((await mentor.api('/me')).user.verificationStatus, 'pending', 'waiting for review');
  });

  test('visitors can join the waiting list', async () => {
    const r = await client(pre.base).api('/waitlist', { method: 'POST', body: { email: 'waiting@example.com', niche: 'design', language: 'ka' } });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM waitlist WHERE email = 'waiting@example.com'`)).rows[0].n, 1);
  });

  test('nothing can be booked or paid, and there is no fake bank or ID check to reach', async () => {
    seeker = await signupByEmail(resend, pre.base, 'Sam Seeker', 'sam@example.com');
    const b = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Can I book before the launch?') } });
    assert.equal(b.status, 403);
    assert.equal(b.error, 'prelaunch');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, 0, 'nothing was created');
    for (const p of ['/mock-bank.html', '/mock-kyc.html', '/js/mock-bank.js', '/js/mock-kyc.js']) {
      assert.equal((await fetch(pre.base + p, { headers: { Accept: 'text/html' } })).status, 404, p);
    }
    assert.equal((await client(pre.base).api('/mock-bank/orders/mock-1/complete', { method: 'POST', body: { outcome: 'success' } })).status, 404);
    // the bank's and the ID-check provider's callback addresses refuse everything (nothing there can be genuine)
    const bank = await fetch(`${pre.base}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"order_id":"x"}' });
    assert.equal(bank.status, 400);
    const kyc = await fetch(`${pre.base}/api/kyc/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"session_id":"x","status":"Approved"}' });
    assert.equal(kyc.status, 400);
    assert.equal((await mentor.api('/me')).user.verificationStatus, 'pending');
  });
});

describe('production + LAUNCH_MODE empty (automatic) with no keys', () => {
  test('it starts, and stays in prelaunch even with a listed mentor: it never opens by itself without the bank and Didit keys', async () => {
    // make the mentor from above listable (as if they had been approved), then start an automatic-mode server
    await pool.query(`UPDATE users SET verification_status = 'verified' WHERE id = $1`, [mentorId]);
    const auto = await startServer(4662, prodEnv({ LAUNCH_MODE: '' }));
    started.push(auto);
    assert.equal((await client(auto.base).api('/config')).launchMode, 'prelaunch');
    assert.match(auto.logs(), /1 mentor\(s\) are listed, but the site stays in prelaunch/);
    const b = await (async () => { const s = client(auto.base); await s.api('/auth/login', { method: 'POST', body: { email: 'sam@example.com', password: 'test-pass-12345' } }); return s.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Is it open now?') } }); })();
    assert.equal(b.error, 'prelaunch');
    auto.proc.kill();
  });

  test('with the bank and Didit keys set, the same automatic server opens by itself (the listed mentor)', async () => {
    const withKeys = await startServer(4663, prodEnv({ LAUNCH_MODE: '', ...BANK_AND_DIDIT }));
    started.push(withKeys);
    const cfg = await client(withKeys.base).api('/config');
    assert.equal(cfg.launchMode, 'live');
    assert.equal(cfg.idChecksOpen, true);
    assert.doesNotMatch(withKeys.logs(), /PAYMENTS ARE OFF|ID CHECKS ARE OFF/);
    withKeys.proc.kill();
  });
});

describe('production + LAUNCH_MODE=live keeps the strict rules', () => {
  test('without the bank and Didit keys it refuses to start, names each missing value, and points at prelaunch', () => {
    const r = startFails({ LAUNCH_MODE: 'live' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    for (const name of ['PAYMENT_PROVIDER is required', 'KYC_PROVIDER is required']) assert.match(r.stderr, new RegExp(name));
    assert.match(r.stderr, /use LAUNCH_MODE=prelaunch until the keys are ready/);
  });

  test('each missing key is enforced on its own when live', () => {
    for (const [change, expected] of [
      [{ ...BANK_AND_DIDIT, BOG_CLIENT_SECRET: '' }, /BOG_CLIENT_SECRET is required/],
      [{ ...BANK_AND_DIDIT, PAYMENT_PROVIDER: 'tbc' }, /TBC_API_KEY is required/],
      [{ ...BANK_AND_DIDIT, DIDIT_API_KEY: '' }, /DIDIT_API_KEY is required/],
      [{ ...BANK_AND_DIDIT, DIDIT_WEBHOOK_SECRET: '' }, /DIDIT_WEBHOOK_SECRET is required/],
      [{ ...BANK_AND_DIDIT, KYC_PROVIDER: '' }, /KYC_PROVIDER is required/]
    ]) {
      const r = startFails({ LAUNCH_MODE: 'live', ...change });
      assert.equal(r.status, 1, JSON.stringify(change));
      assert.match(r.stderr, expected, JSON.stringify(change));
    }
  });

  test('with every key, live starts', async () => {
    const live = await startServer(4664, prodEnv({ LAUNCH_MODE: 'live', ...BANK_AND_DIDIT }));
    started.push(live);
    assert.equal((await client(live.base).api('/config')).launchMode, 'live');
    live.proc.kill();
  });
});

describe('the fake providers are never allowed in production, launched or not', () => {
  test('prelaunch or automatic with the fake bank or the fake ID check refuses to start', () => {
    for (const mode of ['prelaunch', '']) {
      for (const [change, expected] of [[{ PAYMENT_PROVIDER: 'mock' }, /PAYMENT_PROVIDER=mock is a fake bank/], [{ KYC_PROVIDER: 'mock' }, /KYC_PROVIDER=mock is a fake ID check/], [{ PAYMENT_PROVIDER: 'paypal' }, /PAYMENT_PROVIDER must be bog, tbc or mock/]]) {
        const r = startFails({ LAUNCH_MODE: mode, ...change });
        assert.equal(r.status, 1, `${mode || 'auto'} ${JSON.stringify(change)}`);
        assert.match(r.stderr, expected);
      }
    }
  });
});

describe('what the mentor sees, and the documents', () => {
  test('the ID-check step says "ID checks open soon" (English and Georgian) when the config says they are closed', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/settings-verification.js'), 'utf8');
    assert.match(js, /if \(!WisecallI18n\.idChecksOpen\(\)\) return/);
    assert.match(fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8'), /idChecksOpen = \(\) => loadedConfig\.idChecksOpen !== false/);
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8')), ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));
    assert.equal(en['vt.kyc.soon'], 'ID checks open soon.');
    for (const k of ['vt.kyc.soon', 'vt.kyc.soonBody']) assert.match(ka[k], /[ა-ჿ]/, k);
  });

  test('DEPLOY.md, .env.example and render.yaml use wisecallge.ge and explain going online in prelaunch', () => {
    const deploy = fs.readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const render = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    for (const text of [deploy, example]) {
      assert.match(text, /https:\/\/wisecallge\.ge/);
      assert.match(text, /hello@wisecallge\.ge/);
      assert.match(text, /support@wisecallge\.ge/);
    }
    assert.match(deploy, /## Going online first, in prelaunch/);
    assert.match(render, /key: LAUNCH_MODE\n\s+value: prelaunch/);
    assert.doesNotMatch(render, /key: (DIDIT_|BOG_|TBC_|PAYMENT_PROVIDER|KYC_PROVIDER)/, 'the blueprint does not ask for keys the first deploy does not have');
    assert.doesNotMatch(deploy + example, /wisecall\.ge\b/, 'no other spelling of the domain');
  });
});
