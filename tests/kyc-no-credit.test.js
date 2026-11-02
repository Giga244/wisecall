// Didit with no balance: when Didit refuses to open an ID check because the credit ran out (or billing failed), the server logs
// kyc_no_credit, answers the mentor with kyc_no_credit (shown as "temporarily unavailable, we will write to you"), keeps the attempt in the
// verification log and emails the admins "Didit balance is empty", at most every 6 hours. Any other refusal is still kyc_error.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, SAMPLE, wait } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');

const fake = createFakeDidit();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const OUTBOX = path.join(os.tmpdir(), `wisecall-kyc-no-credit-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const balanceMails = () => outbox().filter((m) => m.to === 'qa-admin@example.com' && m.subject === 'Didit balance is empty');
let srv, mentor, other, mentorId;

// (with emails on, the sign-up code comes by email, not in the answer)
async function signup(name, email) {
  const c = client(srv.base);
  const from = outbox().length;
  assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name, email, password: 'test-pass-12345' } })).status, 201);
  let mail;
  for (let i = 0; i < 40 && !mail; i++) { mail = outbox().slice(from).find((m) => m.to === email); if (!mail) await wait(100); }
  const code = mail.subject.match(/(\d{6})/)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
const asMentor = async (name, email) => {
  const c = await signup(name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, proofUrl: `https://dribbble.com/${name.split(' ')[0].toLowerCase()}`, sampleAnswer: SAMPLE } });
  return c;
};
const noCreditRows = async () => (await pool.query(`SELECT * FROM verification_audit WHERE action = 'kyc_no_credit' ORDER BY created_at`)).rows;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await fake.start();
  await resetDatabase();
  srv = await startServer(4673, {
    KYC_PROVIDER: 'didit', DIDIT_API_KEY: fake.API_KEY, DIDIT_WORKFLOW_ID: fake.WORKFLOW, DIDIT_WEBHOOK_SECRET: fake.SECRET, DIDIT_API_URL: fake.url,
    EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', RATE_LIMIT_MULTIPLIER: '20'
  });
  await signup('QA Admin', 'qa-admin@example.com');
  mentor = await asMentor('Nino Beridze', 'nino-nc@example.com');
  other = await asMentor('Dato Kapanadze', 'dato-nc@example.com');
  mentorId = (await mentor.api('/me')).user.id;
});
after(async () => { if (srv) srv.proc.kill(); await fake.stop(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('Didit refuses because the balance is empty', () => {
  test('402: the mentor gets kyc_no_credit, the log says kyc_no_credit, the admin is emailed once', async () => {
    fake.options.refuse = { status: 402, body: { detail: 'Insufficient credits. Please top up your balance.' } };
    const r = await mentor.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(r.status, 503);
    assert.equal(r.error, 'kyc_no_credit');
    assert.match(srv.logs(), /\[kyc\] kyc_no_credit: /);
    for (let i = 0; i < 40 && !balanceMails().length; i++) await wait(100);
    const mails = balanceMails();
    assert.equal(mails.length, 1);
    assert.match(mails[0].html, /balance is empty/);
    const rows = await noCreditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mentor_id, mentorId);
    assert.equal(rows[0].step, 'id_kyc');
    // (nothing was opened: no session saved, the step not marked started)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM kyc_sessions')).rows[0].n, 0);
  });

  test('more attempts, from anyone, within 6 hours: each one logged, no second email', async () => {
    fake.options.refuse = { status: 403, body: { detail: 'Payment required: your organization has no credit left' } };
    assert.equal((await other.api('/verification/kyc/start', { method: 'POST' })).error, 'kyc_no_credit');
    assert.equal((await mentor.api('/verification/kyc/start', { method: 'POST', body: { qr: true } })).error, 'kyc_no_credit');
    await wait(500);
    assert.equal(balanceMails().length, 1);
    assert.equal((await noCreditRows()).length, 3);
  });

  test('after 6 hours the admins are emailed again', async () => {
    await pool.query(`UPDATE verification_audit SET created_at = created_at - interval '7 hours' WHERE action = 'kyc_no_credit'`);
    fake.options.refuse = { status: 402, body: { detail: 'Insufficient credits' } };
    assert.equal((await mentor.api('/verification/kyc/start', { method: 'POST' })).error, 'kyc_no_credit');
    for (let i = 0; i < 40 && balanceMails().length < 2; i++) await wait(100);
    assert.equal(balanceMails().length, 2);
  });

  test('other refusals stay kyc_error (a wrong key, Didit down), with no balance email', async () => {
    const before = balanceMails().length;
    fake.options.refuse = { status: 500, body: { detail: 'internal error' } };
    assert.equal((await mentor.api('/verification/kyc/start', { method: 'POST' })).error, 'kyc_error');
    fake.options.refuse = { status: 403, body: { detail: 'You do not have permission to perform this action.' } };
    assert.equal((await mentor.api('/verification/kyc/start', { method: 'POST' })).error, 'kyc_error');
    await wait(500);
    assert.equal(balanceMails().length, before);
  });

  test('once topped up, the check starts as usual', async () => {
    fake.options.refuse = null;
    const r = await mentor.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(r.status, 200, r.text);
    assert.match(r.url, /\/verify\//);
  });
});

describe('the words the mentor reads', () => {
  test('Georgian and English texts, and every place that starts the check knows kyc_no_credit', () => {
    const root = path.join(__dirname, '..');
    const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
    assert.equal(JSON.parse(read('public/i18n/ka.json'))['idcard.err.noCredit'], 'პირადობის შემოწმება დროებით მიუწვდომელია, მალე ჩაირთვება. ჩვენ მოგწერთ.');
    assert.match(JSON.parse(read('public/i18n/en.json'))['idcard.err.noCredit'], /temporarily unavailable/);
    for (const f of ['public/js/id-card.js', 'public/js/apply.js', 'public/js/settings-verification.js']) assert.match(read(f), /kyc_no_credit: 'idcard\.err\.noCredit'/, f);
  });
});
