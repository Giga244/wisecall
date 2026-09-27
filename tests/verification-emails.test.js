// The mentor is emailed at every status change of their application, in their own language, with
// the reason and what is still missing. Resend and Didit are both replaced by fakes.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, SAMPLE, wait } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');
const { createFakeDidit } = require('./fakeDidit');

const resend = createFakeResend();
const didit = createFakeDidit();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, doctor, doctorId, designer, designerId;

async function mentorOf(name, email, niche, language) {
  const c = await signupByEmail(resend, base, name, email, language);
  const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  return { c, id: (await c.api('/me')).user.id };
}
const decide = (id, step, decision, reason) => admin.api(`/admin/mentors/${id}/steps/${step}`, { method: 'POST', body: { decision, reason } });
const text = (mail) => mail.body.text;

before(async () => {
  await resend.start();
  await didit.start();
  await resetDatabase();
  srv = await startServer(4581, {
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: '',
    KYC_PROVIDER: 'didit', DIDIT_API_KEY: didit.API_KEY, DIDIT_WORKFLOW_ID: didit.WORKFLOW, DIDIT_WEBHOOK_SECRET: didit.SECRET, DIDIT_API_URL: didit.url
  });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  const d = await mentorOf('Levan Kiknadze', 'levan@example.com', 'medicine', 'ka');
  doctor = d.c; doctorId = d.id;
  const g = await mentorOf('Nino Beridze', 'nino@example.com', 'design', 'en');
  designer = g.c; designerId = g.id;
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await didit.stop(); await pool.end(); });

describe('an admin decision on a step', () => {
  test('a rejected step emails the reason and everything that is still missing (Design, English)', async () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    assert.equal((await designer.api('/verification/documents/diploma', { method: 'POST', body: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'diploma.pdf' } })).status, 201);
    const before = resend.to('nino@example.com', 'update').length;
    assert.equal((await decide(designerId, 'diploma', 'failed', 'The scan is too blurry to read')).status, 200);
    const mail = await resend.waitFor('nino@example.com', 'update');
    assert.equal(resend.to('nino@example.com', 'update').length, before + 1);
    assert.match(text(mail), /couldn't approve this yet: Diploma or certificate/);
    assert.match(text(mail), /The scan is too blurry to read/);
    assert.match(text(mail), /ID and selfie check \(not started\)/);
    assert.match(text(mail), /Age 18\+ \(not started\)/);
    assert.match(text(mail), /Your experience \(not started\)/);
    assert.doesNotMatch(text(mail), /At least one of/, 'rules v2 has no either-or steps');
    assert.match(mail.body.html, /settings\.html\?tab=verification/);
  });

  test('an approved step says so, with what is still needed', async () => {
    const already = resend.to('nino@example.com', 'update').length;
    assert.equal((await decide(designerId, 'diploma', 'passed', 'A clearer scan was checked')).status, 200);
    const mail = await resend.waitForNew('nino@example.com', 'update', already);
    assert.match(text(mail), /Approved: Diploma or certificate/);
    assert.match(text(mail), /ID and selfie check/);
  });

  test('a Georgian mentor gets Georgian, including the step names', async () => {
    await doctor.api('/verification/license', { method: 'POST', body: { number: 'MD-1234-5678', issuingBody: 'Ministry of Health', holderName: 'Levan Kiknadze', validUntil: new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10) } });
    assert.equal((await decide(doctorId, 'license', 'failed', 'ვერ ვიპოვეთ რეესტრში')).status, 200);
    const mail = await resend.waitForNew('levan@example.com', 'განაცხადის', 0);
    assert.match(text(mail), /ლიცენზია ან რეგისტრაცია/);
    assert.match(text(mail), /ვერ ვიპოვეთ რეესტრში/);
    assert.match(text(mail), /18\+ ასაკი \(არ დაწყებულა\)/);
    assert.doesNotMatch(text(mail), /MD-1234-5678/, 'the licence number is never in an email');
  });

  test('a decision that fails validation sends nothing', async () => {
    const n = resend.sent.length;
    assert.equal((await decide(doctorId, 'license', 'passed', '')).error, 'reason_required');
    assert.equal((await decide(doctorId, 'id_kyc', 'passed', 'I saw the ID')).error, 'not_manual');
    await wait(300);
    assert.equal(resend.sent.length, n);
  });
});

describe('the ID check result', () => {
  test('an approved ID check emails the mentor; a declined one says what to do next', async () => {
    const start = await doctor.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(start.status, 200, start.text);
    const session = start.url.split('/').pop();
    const w = didit.webhook(session, 'Declined', { id_verifications: [{ status: 'Declined' }] });
    const before = resend.to('levan@example.com', 'განაცხადის').length;
    assert.equal((await fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: w.headers, body: w.body })).status, 200);
    const declined = await resend.waitForNew('levan@example.com', 'განაცხადის', before);
    assert.match(text(declined), /ჯერ ვერ დავამტკიცეთ: პირადობის და სელფის შემოწმება/);
    assert.match(text(declined), /პირადობის შემოწმება ვერ დამტკიცდა/, 'the reason is in Georgian too');
    assert.doesNotMatch(text(declined), /ID check was not approved/);

    const n = resend.to('levan@example.com', 'განაცხადის').length;
    const session2 = (await doctor.api('/verification/kyc/start', { method: 'POST' })).url.split('/').pop();
    const ok = didit.webhook(session2, 'Approved', didit.approvedDecision({ fullName: 'Levan Kiknadze', dateOfBirth: '1985-01-01', country: 'GEO' }));
    assert.equal((await fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: ok.headers, body: ok.body })).status, 200);
    for (let i = 0; i < 40 && resend.to('levan@example.com', 'განაცხადის').length === n; i++) await wait(100);
    const approved = resend.to('levan@example.com', 'განაცხადის').pop();
    assert.match(text(approved), /დამტკიცდა: პირადობის და სელფის შემოწმება/);

    // a retry of the same webhook must not send a second email
    const again = resend.to('levan@example.com', 'განაცხადის').length;
    await fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: ok.headers, body: ok.body });
    await wait(300);
    assert.equal(resend.to('levan@example.com', 'განაცხადის').length, again);
  });
});
