// The whole journey of a NEW mentor, start to finish, through the real API only (no database shortcuts
// except moving the clock): one in Medicine (regulated: licence and a copy of it; an interview because the admin asks for one) and one in
// Design (identity, the Experience form and one piece of evidence; a work email as an optional badge). Probation is left at its real
// default of five answers. No AI key is set here, so every application goes to a person (the AI review has its own tests).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, bookAndPay, rate, SAMPLE, wait } = require('./helpers');
const { longAnswer } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');

const didit = createFakeDidit();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker;

const GOOD_IBAN = 'GE29NB0000000101904917';
const webhook = (w) => fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: w.headers, body: w.body });
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('license scan '.repeat(30)), Buffer.from('\n%%EOF')]);
const step = (v, name) => v.requirements.find((r) => r.step === name) || (v.optional || []).find((r) => r.step === name);
const decide = (id, name, decision, reason) => admin.api(`/admin/mentors/${id}/steps/${name}`, { method: 'POST', body: { decision, reason } });
const listed = async (id) => (await client(base).api('/experts')).experts.find((e) => e.id === id);
const passIdCheck = async (mentor, fullName) => {
  const s = (await mentor.api('/verification/kyc/start', { method: 'POST' })).url.split('/').pop();
  assert.equal((await webhook(didit.webhook(s, 'Approved', didit.approvedDecision({ fullName, dateOfBirth: '1988-03-04', country: 'GEO' })))).status, 200);
};
const analysed = async (id) => {
  for (let i = 0; i < 100; i++) {
    const r = (await pool.query(`SELECT * FROM verification_reviews WHERE user_id = $1 AND status <> 'running' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    if (r) return r;
    await wait(100);
  }
  throw new Error('no analysis');
};
async function apply(c, form, evidenceUrl) {
  assert.equal((await c.api('/verification/experience', { method: 'PUT', body: form })).status, 200);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: evidenceUrl } })).status, 200);
}

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
  test('signs up, applies with the licence and a copy of it, and is not visible anywhere yet', async () => {
    doc = await signupVerified(base, 'Levan Kiknadze', 'levan@example.com');
    assert.equal((await doc.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 40 } })).status, 200);
    id = (await doc.api('/me')).user.id;
    await apply(doc, {
      roleTitle: 'Cardiologist', niche: 'medicine', specialtyTags: ['heart health'], yearsExperience: 14,
      story: 'I trained in Tbilisi and have worked as a cardiologist for fourteen years, the last six running a clinic for patients after heart surgery.',
      sampleAnswer: longAnswer(SAMPLE)
    }, 'https://levan-clinic.invalid/team');
    assert.equal((await doc.api('/verification/license', { method: 'POST', body: { number: 'MD-77-2291', issuingBody: 'Ministry of Health of Georgia', holderName: 'Levan Kiknadze', validUntil: new Date(Date.now() + 700 * 86400000).toISOString().slice(0, 10) } })).status, 200);
    const up = await doc.api('/verification/documents/license_document', { method: 'POST', body: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'license.pdf' } });
    assert.equal(up.status, 201, up.text);
    assert.equal((await doc.api('/verification/submit', { method: 'POST' })).status, 200);
    assert.equal(await listed(id), undefined);
    const v = await doc.api('/verification');
    assert.equal(v.level, 'regulated');
    assert.deepEqual(v.requirements.map((x) => x.step), ['email', 'id_kyc', 'age', 'name_match', 'experience', 'license', 'license_document']);
    assert.equal(step(v, 'email').status, 'passed');
    assert.equal(step(v, 'license').status, 'pending');
    assert.equal(v.application.stage, 'waiting_identity');
    assert.equal(v.ready, false);
  });

  test('ID check: the provider decides; age and name are worked out automatically; then the analysis runs', async () => {
    await passIdCheck(doc, 'Levan Kiknadze');
    const review = await analysed(id);
    assert.equal(review.outcome, 'needs_human');
    assert.ok(review.reasons.some((r) => r.code === 'regulated_niche'));
    assert.equal(review.ai_error, 'not_configured');
    const v = await doc.api('/verification');
    assert.equal(step(v, 'id_kyc').status, 'passed');
    assert.equal(step(v, 'age').status, 'passed');
    assert.equal(step(v, 'name_match').status, 'passed');
    assert.equal(v.application.stage, 'with_team');
  });

  test('the licence and its copy wait for a person; an interview only because the admin asks for one', async () => {
    const early = await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' });
    assert.equal(early.error, 'steps_incomplete');
    assert.deepEqual(early.missing, ['license', 'license_document']);
    assert.equal(await listed(id), undefined);
    for (const [name, why] of [['license', 'Found in the Ministry register'], ['license_document', 'The scan matches the register']]) {
      assert.equal((await decide(id, name, 'passed', why)).status, 200, name);
    }
    assert.equal((await admin.api(`/admin/mentors/${id}/interview/request`, { method: 'POST', body: { reason: 'A short call before approving a doctor' } })).status, 200);
    assert.deepEqual((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).missing, ['video_interview'], 'the interview has not happened yet');

    const slot = (await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: new Date(Date.now() + 48 * 3600000).toISOString() } })).slots[0];
    assert.equal((await doc.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } })).status, 200);
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'https://meet.example.com/wisecall-levan' } })).status, 200);
    await pool.query(`UPDATE interview_slots SET starts_at = now() - interval '20 minutes' WHERE id = $1`, [slot.id]);
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'passed', reason: 'Identity confirmed on the call', notes: 'Calm and precise' } })).status, 200);
    const v = await doc.api('/verification');
    assert.equal(v.ready, true);
    assert.ok(v.requirements.every((r) => r.status === (r.step === 'experience' ? 'pending' : 'passed')), 'the Experience step is accepted by the approval itself');
  });

  test('approved but without payout details: still hidden; then listed with the right badges', async () => {
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).status, 200);
    assert.equal(await listed(id), undefined, 'a mentor we cannot pay is not listed');
    assert.equal((await doc.api('/me/payout', { method: 'PUT', body: { name: 'Levan Kiknadze', iban: GOOD_IBAN } })).status, 200);
    const e = await listed(id);
    assert.ok(e, 'listed');
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['experience', 'id', 'interview', 'license']);
  });

  test('the first answer is held, then released, and only then does the buyer see it', async () => {
    const b = await bookAndPay(base, seeker, id, 'What are the warning signs of a heart problem?');
    const a = await doc.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Chest pain, shortness of breath and dizziness all need a doctor.') } });
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
  test('needs identity, the Experience form and one piece of evidence of any kind; no licence and no interview', async () => {
    des = await signupVerified(base, 'Nino Beridze', 'nino@example.com');
    assert.equal((await des.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } })).status, 200);
    id = (await des.api('/me')).user.id;
    await apply(des, {
      roleTitle: 'Product designer', niche: 'design', specialtyTags: ['mobile apps', 'onboarding'], yearsExperience: 8,
      story: 'I taught myself design while working in a bank, then spent eight years designing mobile apps for startups in Tbilisi and Berlin.',
      sampleAnswer: longAnswer('Start with the one screen people see first and make it do one thing well.')
    }, 'https://nino-design.invalid/work');
    const v = await des.api('/verification');
    assert.equal(v.level, 'standard');
    assert.deepEqual(v.requirements.map((x) => x.step), ['email', 'id_kyc', 'age', 'name_match', 'experience']);
    assert.deepEqual(v.application.missing, []);
    assert.equal((await des.api('/verification/license', { method: 'POST', body: { number: 'X-1234', issuingBody: 'Nobody', validUntil: '2030-01-01' } })).error, 'not_required');
    assert.equal((await des.api('/verification/interview')).required, false);
    assert.equal((await des.api('/verification/submit', { method: 'POST' })).status, 200);
  });

  test('a name that does not match the ID is never a rejection: it waits for the mentor or an admin', async () => {
    await passIdCheck(des, 'Someone Completely Different');
    const review = await analysed(id);
    assert.equal(review.outcome, 'needs_human');
    assert.ok(review.reasons.some((r) => r.code === 'names_differ'));
    const v = await des.api('/verification');
    assert.equal(step(v, 'id_kyc').status, 'passed');
    assert.equal(step(v, 'name_match').status, 'pending', 'held for an admin');
    assert.equal(v.status, 'pending', 'not rejected');
    const d = await admin.api(`/admin/mentors/${id}/verification`);
    assert.ok(d.flags.some((f) => f.kind === 'name_mismatch'), 'flagged');
    assert.doesNotMatch(JSON.stringify(v), /Completely Different/, 'the mentor is not shown the ID name');
  });

  test('after the admin accepts the name, the approval completes it; a confirmed work email adds a badge', async () => {
    // A payout account in another name only holds payouts (its own flag); it does not stop the application.
    assert.equal((await des.api('/me/payout', { method: 'PUT', body: { name: 'Nino Beridze', iban: GOOD_IBAN } })).status, 200);
    const flags = (await admin.api(`/admin/mentors/${id}/verification`)).flags.map((f) => f.kind);
    assert.ok(flags.includes('payout_name_mismatch'));
    assert.equal((await decide(id, 'name_match', 'passed', 'Legal name differs from the professional name; documents checked')).status, 200);
    const start = await des.api('/verification/work-email', { method: 'POST', body: { email: 'nino@studio.example' } });
    assert.equal((await des.api('/verification/work-email/verify', { method: 'POST', body: { code: start.devCode } })).status, 200);
    assert.equal((await des.api('/verification')).ready, true);

    assert.equal(await listed(id), undefined, 'not before the final approval');
    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).status, 200);
    const e = await listed(id);
    assert.ok(e);
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['experience', 'id', 'workEmail']);
  });

  test('buyers can report the mentor, and an admin can suspend them at once', async () => {
    assert.equal((await seeker.api(`/experts/${id}/report`, { method: 'POST', body: { reason: 'misleading', details: 'The advice was wrong' } })).status, 201);
    assert.equal((await admin.api(`/admin/mentors/${id}/suspend`, { method: 'POST', body: { reason: 'Verified concerns from a buyer' } })).status, 200);
    assert.equal(await listed(id), undefined);
    assert.equal((await des.api('/verification')).status, 'suspended');
  });
});
