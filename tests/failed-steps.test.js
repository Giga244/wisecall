// An approved mentor whose required verification step fails later is never shown as verified or listed (docs/AUDIT.md #8), whoever
// fails it: the ID provider, the carry-over at start-up, the name check, an admin. They go to "needs attention", leave Browse experts, are
// emailed the reason in their language, and it is logged. An age failure is final for that ID; only an admin can re-run the ID check.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, SAMPLE, longQuestion, wait } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const ENV = () => ({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>' });
let srv, base, admin, seeker;

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); }
}
const statusOf = async (id) => (await pool.query('SELECT verification_status FROM users WHERE id = $1', [id])).rows[0].verification_status;
const stepOf = async (id, step) => (await pool.query('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [id, step])).rows[0];
const auditOf = async (id) => (await pool.query('SELECT * FROM verification_audit WHERE mentor_id = $1 ORDER BY created_at', [id])).rows;
const openFlag = async (id, kind) => (await pool.query(`SELECT * FROM mentor_flags WHERE mentor_id = $1 AND kind = $2 AND status = 'open'`, [id, kind])).rows[0];

async function listed(id) {
  const one = await client(base).api(`/experts/${id}`);
  const all = await client(base).api('/experts');
  return { profile: one.status === 200, inList: all.experts.some((e) => e.id === id) };
}

// A mentor who took the (mock) ID check as an adult, was approved and saved payout details: listed.
async function listedMentor(name, email, language = 'en') {
  const c = await signupByEmail(resend, base, name, email, language);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } })).status, 200);
  const id = (await c.api('/me')).user.id;
  const r = await c.api('/verification/kyc/start', { method: 'POST' });
  assert.equal(r.status, 200, r.text);
  const sid = r.url.split('session=')[1];
  await client(base).api(`/mock-kyc/sessions/${sid}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: name, dateOfBirth: '1990-05-01' } });
  await waitFor(async () => { const s = await stepOf(id, 'age'); return s && s.status === 'passed'; });
  await approveMentor(admin, c);
  await addPayoutDetails(c, undefined, name);
  assert.deepEqual(await listed(id), { profile: true, inList: true });
  return { c, id, sid };
}

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4706, ENV());
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupByEmail(resend, base, 'Sam Seeker', 'seeker@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('a required step fails after approval', () => {
  let nika;

  test('the ID provider later reports under 18: needs attention, off the site, emailed, logged, flagged', async () => {
    nika = await listedMentor('Nika Listed', 'nika@example.com');
    const mails = resend.to('nika@example.com', 'update').length;
    // The provider sends a corrected result for the same session (its webhook): now under 18.
    await client(base).api(`/mock-kyc/sessions/${nika.sid}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: 'Nika Listed', dateOfBirth: '2012-03-04' } });
    await waitFor(async () => (await statusOf(nika.id)) === 'pending');

    assert.equal((await stepOf(nika.id, 'age')).status, 'failed');
    assert.deepEqual(await listed(nika.id), { profile: false, inList: false });
    const b = await seeker.api('/bookings', { method: 'POST', body: { mentorId: nika.id, question: longQuestion('Can I still book this mentor?') } });
    assert.equal(b.status, 404);

    const delisted = (await auditOf(nika.id)).filter((a) => a.action === 'delisted');
    assert.equal(delisted.length, 1);
    assert.equal(delisted[0].step, 'age');
    assert.equal(delisted[0].actor_label, 'kyc-provider');
    assert.ok(await openFlag(nika.id, 'required_step_failed'));

    const mail = await resend.waitForNew('nika@example.com', 'update', mails);
    assert.match(mail.body.text, /under 18/);
    assert.match(mail.body.text, /hidden from Browse experts/);
    assert.equal(resend.to('nika@example.com', 'update').length, mails + 1, 'one email, not one per change');
  });

  test('Settings: the banner, the progress bar and the steps all say "needs attention", never "verified"', async () => {
    const me = (await nika.c.api('/me')).user;
    assert.equal(me.verificationState, 'needs_attention');
    assert.equal(me.isListedMentor, false);
    const v = await nika.c.api('/verification');
    assert.equal(v.state, 'needs_attention');
    assert.equal(v.listed, false);
    assert.equal(v.application.stage, 'needs_attention');
    assert.equal(v.requirements.find((r) => r.step === 'age').status, 'failed');
  });

  test('an age failure is final for that ID: the mentor cannot take the ID check again', async () => {
    const r = await nika.c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(r.status, 409);
    assert.equal(r.error, 'age_final');
  });

  test('the admin filter "approved, but a step failed" finds them', async () => {
    const r = await admin.api('/admin/mentors?status=failed_step');
    assert.equal(r.status, 200);
    assert.ok(r.mentors.some((m) => m.id === nika.id));
    assert.ok(!r.mentors.some((m) => m.id === seeker.id));
  });

  test('admins only: "re-run ID check" (reason required, logged) opens the ID check again when the age still fails', async () => {
    assert.equal((await nika.c.api(`/admin/mentors/${nika.id}/kyc/rerun`, { method: 'POST', body: { reason: 'I would like to try again' } })).status, 403);
    assert.equal((await admin.api(`/admin/mentors/${nika.id}/kyc/rerun`, { method: 'POST', body: {} })).status, 400);
    const r = await admin.api(`/admin/mentors/${nika.id}/kyc/rerun`, { method: 'POST', body: { reason: 'The mentor says the date was read wrongly' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.outcome, 'reopened');
    const actions = (await auditOf(nika.id)).map((a) => a.action);
    assert.ok(actions.includes('id_check_rerun') && actions.includes('id_check_reopened'));
    // The mentor takes it again; a correct date passes the age, and the application waits for a person (never re-approved by itself).
    const s = await nika.c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(s.status, 200, s.text);
    await client(base).api(`/mock-kyc/sessions/${s.url.split('session=')[1]}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: 'Nika Listed', dateOfBirth: '1990-05-01' } });
    await waitFor(async () => { const a = await stepOf(nika.id, 'age'); return a && a.status === 'passed'; });
    assert.equal(await statusOf(nika.id), 'pending');
    assert.equal((await nika.c.api('/me')).user.verificationState, 'in_review');
    assert.equal((await admin.api(`/admin/mentors/${nika.id}/approve`, { method: 'POST' })).status, 200);
    assert.deepEqual(await listed(nika.id), { profile: true, inList: true });
  });

  test('a listed mentor who changes their name away from the ID leaves the site and is told (in Georgian)', async () => {
    const m = await listedMentor('Tamar Beridze', 'tamar@example.com', 'ka');
    const mails = resend.to('tamar@example.com', 'სიახლე').length;
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { name: 'Keti Kapanadze' } })).status, 200);
    await waitFor(async () => (await statusOf(m.id)) === 'pending');
    assert.deepEqual(await listed(m.id), { profile: false, inList: false });
    const mail = await resend.waitForNew('tamar@example.com', 'სიახლე', mails);
    assert.match(mail.body.text, /ექსპერტების სიაში დამალულია/);
    assert.match(mail.body.text, /აღარ ემთხვევა/);
  });

  test('an admin failing a required step sends exactly one email', async () => {
    const m = await listedMentor('Giorgi Listed', 'giorgi@example.com');
    const mails = resend.to('giorgi@example.com', 'update').length;
    const r = await admin.api(`/admin/mentors/${m.id}/steps/age`, { method: 'POST', body: { decision: 'failed', reason: 'The ID photo shows a different person' } });
    assert.equal(r.status, 200, r.text);
    const mail = await resend.waitForNew('giorgi@example.com', 'update', mails);
    assert.match(mail.body.text, /different person/);
    await wait(500);
    assert.equal(resend.to('giorgi@example.com', 'update').length, mails + 1);
    assert.equal((await auditOf(m.id)).filter((a) => a.action === 'delisted')[0].actor_label, 'qa-admin@example.com');
  });
});

describe('carry-over: an approval never outlives a failed required step', () => {
  test('a mentor still marked verified with a failed step is hidden at once, and delisted, emailed and logged at the next start', async () => {
    const m = await listedMentor('Levan Legacy', 'levan@example.com', 'ka');
    // The live bug: approved under rules v1, and the age step computed later failed without delisting.
    await pool.query(`UPDATE verification_steps SET status = 'failed', reason = 'Under 18 according to the ID', decided_by = NULL, decided_at = now() WHERE user_id = $1 AND step = 'age'`, [m.id]);
    assert.equal(await statusOf(m.id), 'verified');
    // Hidden straight away (the rule is part of listableSql / isListable), and Settings already says so.
    assert.deepEqual(await listed(m.id), { profile: false, inList: false });
    assert.equal((await m.c.api('/me')).user.verificationState, 'needs_attention');
    assert.equal((await m.c.api('/verification')).state, 'needs_attention');

    const mails = resend.to('levan@example.com', 'სიახლე').length;
    const second = await startServer(4707, ENV()); // a restart: the carry-over runs at start-up
    try {
      await waitFor(async () => (await statusOf(m.id)) === 'pending', 15000);
      const row = (await auditOf(m.id)).find((a) => a.action === 'delisted');
      assert.equal(row.step, 'age');
      assert.equal(row.actor_label, 'system');
      assert.ok(await openFlag(m.id, 'required_step_failed'));
      const mail = await resend.waitForNew('levan@example.com', 'სიახლე', mails);
      assert.match(mail.body.text, /18 წლამდე/);
    } finally { second.proc.kill(); }
  });
});
