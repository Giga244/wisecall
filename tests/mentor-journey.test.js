// The whole journey of a NEW mentor, start to finish, through the real API only (no database shortcuts
// except moving the clock): one in Medicine (regulated: license, document, video interview) and one in
// Design (standard: work email, portfolio). Probation is left at its real default of five answers.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, bookAndPay, rate, SAMPLE } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');

const didit = createFakeDidit();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker;

const GOOD_IBAN = 'GE29NB0000000101904917';
const webhook = (w) => fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: w.headers, body: w.body });
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('license scan '.repeat(30)), Buffer.from('\n%%EOF')]);
const step = (v, name) => {
  for (const r of v.requirements) {
    if (r.step === name) return r;
    if (r.options) { const o = r.options.find((x) => x.step === name); if (o) return o; }
  }
  return undefined;
};
const decide = (id, name, decision, reason) => admin.api(`/admin/mentors/${id}/steps/${name}`, { method: 'POST', body: { decision, reason } });
const listed = async (id) => (await client(base).api('/experts')).experts.find((e) => e.id === id);
const passIdCheck = async (mentor, fullName) => {
  const s = (await mentor.api('/verification/kyc/start', { method: 'POST' })).url.split('/').pop();
  assert.equal((await webhook(didit.webhook(s, 'Approved', didit.approvedDecision({ fullName, dateOfBirth: '1988-03-04', country: 'GEO' })))).status, 200);
};

before(async () => {
  await didit.start();
  await resetDatabase();
  srv = await startServer(4585, {
    PROBATION_ANSWERS: '', KYC_PROVIDER: 'didit', DIDIT_API_KEY: didit.API_KEY, DIDIT_WORKFLOW_ID: didit.WORKFLOW, DIDIT_WEBHOOK_SECRET: didit.SECRET, DIDIT_API_URL: didit.url
  });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'sam@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await didit.stop(); await pool.end(); });

describe('a new Medicine mentor (regulated)', () => {
  let doc, id;
  test('signs up, applies, and is not visible anywhere yet', async () => {
    doc = await signupVerified(base, 'Levan Kiknadze', 'levan@example.com');
    const r = await doc.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist, 14 yrs', niche: 'medicine', price: 40, proofUrl: 'https://linkedin.com/in/levan', sampleAnswer: SAMPLE } });
    assert.equal(r.status, 200, r.text);
    id = (await doc.api('/me')).user.id;
    assert.equal(await listed(id), undefined);
    const v = await doc.api('/verification');
    assert.equal(v.level, 'regulated');
    assert.deepEqual(v.requirements.map((x) => x.step), ['email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link', 'license', 'license_document', 'video_interview']);
    assert.equal(step(v, 'email').status, 'passed');
    assert.equal(step(v, 'license').status, 'todo');
    assert.equal(v.ready, false);
  });

  test('ID check: the provider decides, the name is matched automatically', async () => {
    await passIdCheck(doc, 'Levan Kiknadze');
    const v = await doc.api('/verification');
    assert.equal(step(v, 'id_kyc').status, 'passed');
    assert.equal(step(v, 'name_match').status, 'passed');
  });

  test('license, document and a video interview are all required, and each waits for a person', async () => {
    assert.equal((await doc.api('/verification/license', { method: 'POST', body: { number: 'MD-77-2291', issuingBody: 'Ministry of Health of Georgia', holderName: 'Levan Kiknadze', validUntil: new Date(Date.now() + 700 * 86400000).toISOString().slice(0, 10) } })).status, 200);
    const up = await doc.api('/verification/documents/license_document', { method: 'POST', body: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'license.pdf' } });
    assert.equal(up.status, 201, up.text);

    const slot = (await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: new Date(Date.now() + 48 * 3600000).toISOString() } })).slots[0];
    assert.equal((await doc.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } })).status, 200);
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'https://meet.example.com/wisecall-levan' } })).status, 200);

    // Nothing is approved yet: the admin still has to look at everything, and cannot approve early.
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).error, 'steps_incomplete');
    assert.equal(await listed(id), undefined);

    for (const [name, why] of [['sample_answer', 'Clear and safe advice'], ['proof_link', 'The LinkedIn profile matches'], ['license', 'Found in the Ministry register'], ['license_document', 'The scan matches the register']]) {
      assert.equal((await decide(id, name, 'passed', why)).status, 200, name);
    }
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).error, 'steps_incomplete', 'the interview has not happened yet');

    await pool.query(`UPDATE interview_slots SET starts_at = now() - interval '20 minutes' WHERE id = $1`, [slot.id]);
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'passed', reason: 'Identity confirmed on the call', notes: 'Calm and precise' } })).status, 200);
    const v = await doc.api('/verification');
    assert.equal(v.ready, true);
    assert.ok(v.requirements.every((r) => r.status === 'passed'));
  });

  test('approved but without payout details: still hidden; then listed with the right badges', async () => {
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).status, 200);
    assert.equal(await listed(id), undefined, 'a mentor we cannot pay is not listed');
    assert.equal((await doc.api('/me/payout', { method: 'PUT', body: { name: 'Levan Kiknadze', iban: GOOD_IBAN } })).status, 200);
    const e = await listed(id);
    assert.ok(e, 'listed');
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['id', 'interview', 'license']);
  });

  test('the first answer is held, then released, and only then does the buyer see it', async () => {
    const b = await bookAndPay(base, seeker, id, 'What are the warning signs of a heart problem?');
    const a = await doc.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: 'Chest pain, shortness of breath and dizziness all need a doctor.' } });
    assert.equal(a.booking.answerHeld, true);
    assert.equal((await seeker.api(`/bookings/${b.id}`)).booking.answer, null);
    assert.equal((await admin.api(`/admin/answers/${b.id}/approve`, { method: 'POST' })).status, 200);
    assert.match((await seeker.api(`/bookings/${b.id}`)).booking.answer, /Chest pain/);
    assert.equal((await rate(seeker, b.id, 5, { review: 'Clear.' })).status, 201);
    const earnings = await doc.api('/me/earnings');
    assert.equal(earnings.items.length, 1);
  });
});

describe('a new Design mentor (standard)', () => {
  let des, id;
  test('needs a verified work email, a diploma or a portfolio, but no license and no interview', async () => {
    des = await signupVerified(base, 'Nino Beridze', 'nino@example.com');
    assert.equal((await des.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Product designer', niche: 'design', price: 20, proofUrl: 'https://dribbble.com/nino', sampleAnswer: SAMPLE } })).status, 200);
    id = (await des.api('/me')).user.id;
    const v = await des.api('/verification');
    assert.equal(v.level, 'standard');
    assert.deepEqual(v.requirements.map((x) => x.step || 'anyOf'), ['email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link', 'anyOf']);
    assert.equal((await des.api('/verification/license', { method: 'POST', body: { number: 'X-1234', issuingBody: 'Nobody', validUntil: '2030-01-01' } })).error, 'not_required');
    assert.equal((await des.api('/verification/interview')).required, false);
  });

  test('a name that does not match the ID is never approved automatically', async () => {
    await passIdCheck(des, 'Someone Completely Different');
    const v = await des.api('/verification');
    assert.equal(step(v, 'id_kyc').status, 'passed');
    assert.equal(step(v, 'name_match').status, 'pending', 'held for an admin');
    const d = await admin.api(`/admin/mentors/${id}/verification`);
    assert.ok(d.flags.some((f) => f.kind === 'name_mismatch'), 'flagged');
    assert.doesNotMatch(JSON.stringify(v), /Completely Different/, 'the mentor is not shown the ID name');
  });

  test('after the admin accepts the name, a work email code and admin review complete it', async () => {
    // The payout account is added first: every new name has to be checked before an admin accepts them together.
    assert.equal((await des.api('/me/payout', { method: 'PUT', body: { name: 'Nino Beridze', iban: GOOD_IBAN } })).status, 200);
    assert.equal((await decide(id, 'name_match', 'passed', 'Legal name differs from the professional name; documents checked')).status, 200);
    const start = await des.api('/verification/work-email', { method: 'POST', body: { email: 'nino@studio.example' } });
    assert.equal((await des.api('/verification/work-email/verify', { method: 'POST', body: { code: start.devCode } })).status, 200);
    for (const [name, why] of [['sample_answer', 'Useful and honest'], ['proof_link', 'Real profile']]) assert.equal((await decide(id, name, 'passed', why)).status, 200);
    assert.equal((await des.api('/verification')).ready, true);

    assert.equal(await listed(id), undefined, 'not before the final approval');
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).status, 200);
    const e = await listed(id);
    assert.ok(e);
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['id', 'workEmail']);
  });

  test('buyers can report the mentor, and an admin can suspend them at once', async () => {
    assert.equal((await seeker.api(`/experts/${id}/report`, { method: 'POST', body: { reason: 'misleading', details: 'The advice was wrong' } })).status, 201);
    assert.equal((await admin.api(`/admin/mentors/${id}/suspend`, { method: 'POST', body: { reason: 'Verified concerns from a buyer' } })).status, 200);
    assert.equal(await listed(id), undefined);
    assert.equal((await des.api('/verification')).status, 'suspended');
  });
});
