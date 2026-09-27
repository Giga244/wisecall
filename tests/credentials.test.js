// Professional credentials: licence details, private documents, the optional work email, and evidence (a portfolio, a company code).
// A Medicine mentor (regulated niche), a Business mentor and a Design mentor (standard niche) are used.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, SAMPLE, wait } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, doctor, doctorId, designer, designerId, boss;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('SECRET-LICENCE-SCAN-CONTENT '.repeat(20)), Buffer.from('\n%%EOF')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF-SECRET-DIPLOMA '.repeat(20))]);
const inYears = (n) => new Date(Date.now() + n * 365 * 86400000).toISOString().slice(0, 10);
const LICENSE = { number: 'MD-4471-2291', issuingBody: 'Ministry of Health of Georgia', holderName: 'Dr. Levan Kiknadze', validUntil: inYears(2) };

const upload = (who, step, body, { name = 'scan.pdf', type = 'application/pdf' } = {}) =>
  who.api(`/verification/documents/${step}`, { method: 'POST', body, headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(name) } });
const stepRow = async (id, step) => (await pool.query('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [id, step])).rows[0];

async function mentorOf(name, email, niche, roleTitle) {
  const c = await signupVerified(base, name, email);
  const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle, niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  return { c, id: (await c.api('/me')).user.id };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4579, { SWEEP_INTERVAL_SECONDS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  const d = await mentorOf('Levan Kiknadze', 'levan@example.com', 'medicine', 'Cardiologist');
  doctor = d.c; doctorId = d.id;
  const g = await mentorOf('Nino Beridze', 'nino@example.com', 'design', 'Designer');
  designer = g.c; designerId = g.id;
  boss = (await mentorOf('Tamar Gelashvili', 'tamar@example.com', 'business', 'Founder')).c;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('licence details (regulated niches only)', () => {
  test('a Medicine mentor submits a licence; the number is encrypted and only its ending is shown back', async () => {
    const r = await doctor.api('/verification/license', { method: 'POST', body: LICENSE });
    assert.equal(r.status, 200, r.text);
    const row = await stepRow(doctorId, 'license');
    assert.equal(row.status, 'pending');
    assert.equal(row.evidence.numberEnding, '2291');
    assert.doesNotMatch(JSON.stringify(row.evidence), /MD-4471/);

    const raw = (await pool.query('SELECT * FROM mentor_credentials WHERE user_id = $1', [doctorId])).rows[0];
    assert.match(raw.license_number_enc, /^v1:/);
    assert.doesNotMatch(JSON.stringify(raw), /MD-4471/);

    const own = await doctor.api('/verification');
    assert.equal(own.inputs.license.numberEnding, '2291');
    assert.doesNotMatch(own.text, /MD-4471/, 'the mentor never gets the full number back');
  });

  test('admins see the full number, the issuing body and the official registry links to check it against', async () => {
    const d = await admin.api(`/admin/mentors/${doctorId}/verification`);
    assert.equal(d.credentials.licenseNumber, 'MD-4471-2291');
    assert.equal(d.credentials.issuingBody, LICENSE.issuingBody);
    assert.equal(d.credentials.validUntil, LICENSE.validUntil);
    assert.ok(d.registries.length >= 1);
    assert.ok(d.registries.every((x) => /^https?:\/\//.test(x.url)));
  });

  test('bad input is refused: short number, missing body, past or far-future expiry, wrong niche', async () => {
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, number: 'A' } })).error, 'invalid_license_number');
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, number: '<script>1' } })).error, 'invalid_license_number');
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, issuingBody: '' } })).error, 'invalid_issuing_body');
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, validUntil: '2020-01-01' } })).error, 'invalid_valid_until');
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, validUntil: inYears(40) } })).error, 'invalid_valid_until');
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { ...LICENSE, validUntil: 'soon' } })).error, 'invalid_valid_until');
    assert.equal((await designer.api('/verification/license', { method: 'POST', body: LICENSE })).error, 'not_required');
    assert.equal((await seeker.api('/verification/license', { method: 'POST', body: LICENSE })).error, 'not_a_mentor');
    assert.equal((await client(base).api('/verification/license', { method: 'POST', body: LICENSE })).status, 401);
  });

  test('a passed licence stops counting once its date has gone by', async () => {
    const pass = await admin.api(`/admin/mentors/${doctorId}/steps/license`, { method: 'POST', body: { decision: 'passed', reason: 'Found in the Ministry register' } });
    assert.equal(pass.status, 200, pass.text);
    const row = await stepRow(doctorId, 'license');
    assert.equal(row.status, 'passed');
    assert.equal(new Date(row.expires_at).toISOString().slice(0, 10), LICENSE.validUntil);
    const req = (await doctor.api('/verification')).requirements.find((r) => r.step === 'license');
    assert.equal(req.status, 'passed');

    await pool.query(`UPDATE verification_steps SET expires_at = now() - interval '1 day' WHERE user_id = $1 AND step = 'license'`, [doctorId]);
    assert.equal((await doctor.api('/verification')).requirements.find((r) => r.step === 'license').status, 'failed', 'expired licence no longer counts');
    await pool.query(`UPDATE verification_steps SET expires_at = NULL, status = 'pending' WHERE user_id = $1 AND step = 'license'`, [doctorId]);
  });
});

describe('private documents', () => {
  let docId;

  test('a PDF is accepted, stored encrypted in the database and marks the step as waiting', async () => {
    const r = await upload(doctor, 'license_document', PDF);
    assert.equal(r.status, 201, r.text);
    docId = r.id;
    assert.equal((await stepRow(doctorId, 'license_document')).status, 'pending');

    const raw = (await pool.query('SELECT * FROM verification_documents WHERE id = $1', [docId])).rows[0];
    assert.equal(raw.mime, 'application/pdf');
    assert.equal(raw.size, PDF.length);
    assert.equal(raw.delete_after, null, 'no deletion date until a decision is made');
    assert.ok(!raw.data_enc.includes(Buffer.from('SECRET-LICENCE-SCAN-CONTENT')), 'stored bytes are ciphertext');
    assert.ok(!raw.data_enc.includes(Buffer.from('%PDF-')));
  });

  test('the type is judged by the file itself, not by the name or header', async () => {
    assert.equal((await upload(doctor, 'license_document', Buffer.from('MZ this is an exe'), { name: 'licence.pdf' })).error, 'unsupported_file_type');
    assert.equal((await upload(doctor, 'license_document', Buffer.from('<html><script>1</script>'), { name: 'a.jpg', type: 'image/jpeg' })).error, 'unsupported_file_type');
    assert.equal((await upload(doctor, 'license_document', Buffer.alloc(0))).error, 'empty_file');
  });

  test('files over 10 MB are refused', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10, 1)]);
    const r = await upload(doctor, 'license_document', big);
    assert.equal(r.status, 413);
    assert.equal(r.error, 'file_too_large');
  });

  test('only the steps a niche asks for accept documents (a diploma, as evidence, is open to everyone)', async () => {
    assert.equal((await upload(designer, 'license_document', PDF)).error, 'not_required', 'a licence document is for regulated niches');
    assert.equal((await upload(doctor, 'name_match', PDF)).error, 'unknown_step');
    assert.equal((await upload(seeker, 'diploma', JPEG, { type: 'image/jpeg' })).error, 'not_a_mentor');
    assert.equal((await upload(client(base), 'diploma', JPEG, { type: 'image/jpeg' })).status, 401);
  });

  test('no more than three files per step', async () => {
    assert.equal((await upload(doctor, 'license_document', PDF)).status, 201);
    assert.equal((await upload(doctor, 'license_document', PDF)).status, 201);
    const r = await upload(doctor, 'license_document', PDF);
    assert.equal(r.status, 409);
    assert.equal(r.error, 'too_many_files');
  });

  test('only admins can download; every download is written to the audit log', async () => {
    assert.equal((await doctor.api(`/admin/documents/${docId}`)).error, 'not_admin', 'not even the owner');
    assert.equal((await seeker.api(`/admin/documents/${docId}`)).error, 'not_admin');
    assert.equal((await client(base).api(`/admin/documents/${docId}`)).status, 401);

    const res = await admin.raw(`/api/admin/documents/${docId}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-disposition'), /^attachment/);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF), 'the exact file comes back');

    const log = (await pool.query(`SELECT * FROM verification_audit WHERE mentor_id = $1 AND action = 'document_viewed'`, [doctorId])).rows;
    assert.equal(log.length, 1);
    assert.equal(log[0].actor_label, 'qa-admin@example.com');
    assert.equal((await admin.api('/admin/documents/not-an-id')).status, 404);
  });

  test('files are never reachable as static content and never appear in the mentor\'s own or public data', async () => {
    assert.equal((await client(base)(`/uploads/${docId}`)).status, 404);
    const own = await doctor.api('/verification');
    assert.equal(own.inputs.documents.length, 3);
    assert.doesNotMatch(own.text, /SECRET-LICENCE|data_enc/);
    assert.doesNotMatch((await client(base).api('/experts')).text, /license_document|SECRET/);
  });

  test('a mentor can delete their own file, and withdraw the step when none are left', async () => {
    const list = (await doctor.api('/verification')).inputs.documents;
    assert.equal((await seeker.api(`/verification/documents/${list[0].id}`, { method: 'DELETE' })).error, 'not_a_mentor');
    assert.equal((await designer.api(`/verification/documents/${list[0].id}`, { method: 'DELETE' })).error, 'not_found', 'not someone else\'s file');
    for (const d of list) assert.equal((await doctor.api(`/verification/documents/${d.id}`, { method: 'DELETE' })).status, 200);
    assert.equal(await stepRow(doctorId, 'license_document'), undefined, 'an empty waiting step is withdrawn');
    assert.equal((await doctor.api(`/verification/documents/${list[0].id}`, { method: 'DELETE' })).error, 'not_found');
  });

  test('after a decision the files are kept for 90 days, then deleted by the background job', async () => {
    assert.equal((await upload(doctor, 'license_document', PDF)).status, 201);
    const ok = await admin.api(`/admin/mentors/${doctorId}/steps/license_document`, { method: 'POST', body: { decision: 'passed', reason: 'Scan matches the register' } });
    assert.equal(ok.status, 200, ok.text);

    const row = (await pool.query('SELECT * FROM verification_documents WHERE user_id = $1', [doctorId])).rows[0];
    assert.ok(row.decided_at);
    const days = (new Date(row.delete_after) - new Date(row.decided_at)) / 86400000;
    assert.ok(Math.abs(days - 90) < 0.01, `deletion is scheduled 90 days out (got ${days})`);

    await pool.query('UPDATE verification_documents SET delete_after = now() - interval \'1 minute\' WHERE id = $1', [row.id]);
    for (let i = 0; i < 40; i++) {
      if (!(await pool.query('SELECT 1 FROM verification_documents WHERE id = $1', [row.id])).rowCount) break;
      await wait(250);
    }
    assert.equal((await pool.query('SELECT 1 FROM verification_documents WHERE id = $1', [row.id])).rowCount, 0, 'purged');
    const log = (await pool.query(`SELECT * FROM verification_audit WHERE mentor_id = $1 AND action = 'documents_purged'`, [doctorId])).rows;
    assert.equal(log.length, 1);
    assert.equal((await stepRow(doctorId, 'license_document')).status, 'passed', 'the decision itself stays');
  });
});

describe('work email', () => {
  test('free mailbox providers are refused, and so are malformed addresses', async () => {
    for (const email of ['nino@gmail.com', 'nino@Yahoo.com', 'nino@mail.ru', 'nino@outlook.com', 'nino@mail.ge', 'nino@sub.gmail.com']) {
      assert.equal((await designer.api('/verification/work-email', { method: 'POST', body: { email } })).error, 'free_email_domain', email);
    }
    assert.equal((await designer.api('/verification/work-email', { method: 'POST', body: { email: 'nope' } })).error, 'invalid_email');
    assert.equal((await stepRow(designerId, 'work_email')), undefined, 'nothing was recorded');
  });

  test('a company address gets a 6-digit code; only the right code passes the step', async () => {
    const start = await designer.api('/verification/work-email', { method: 'POST', body: { email: 'nino@studio.example' } });
    assert.equal(start.status, 200, start.text);
    assert.match(start.devCode, /^\d{6}$/, 'development shows the code because email is off');
    assert.equal((await stepRow(designerId, 'work_email')).status, 'pending');

    const stored = (await pool.query('SELECT work_email_code_hash FROM users WHERE id = $1', [designerId])).rows[0].work_email_code_hash;
    assert.notEqual(stored, start.devCode);
    assert.match(stored, /^\$2[aby]\$/, 'the code is stored hashed');

    const wrong = start.devCode === '000000' ? '111111' : '000000';
    assert.equal((await designer.api('/verification/work-email/verify', { method: 'POST', body: { code: wrong } })).error, 'invalid_code');
    assert.equal((await stepRow(designerId, 'work_email')).status, 'pending');

    assert.equal((await designer.api('/verification/work-email/verify', { method: 'POST', body: { code: start.devCode } })).status, 200);
    const row = await stepRow(designerId, 'work_email');
    assert.equal(row.status, 'passed');
    assert.equal(row.evidence.domain, 'studio.example');
    assert.equal((await designer.api('/verification/work-email/verify', { method: 'POST', body: { code: start.devCode } })).error, 'no_pending_code', 'a code works once');

    const own = await designer.api('/verification');
    assert.equal(own.inputs.workEmailDomain, 'studio.example');
    assert.doesNotMatch(own.text, /nino@studio/, 'only the domain is echoed');
  });

  test('an expired code is refused', async () => {
    const start = await designer.api('/verification/work-email', { method: 'POST', body: { email: 'nino@other.example' } });
    await pool.query(`UPDATE users SET work_email_code_expires_at = now() - interval '1 minute' WHERE id = $1`, [designerId]);
    assert.equal((await designer.api('/verification/work-email/verify', { method: 'POST', body: { code: start.devCode } })).error, 'expired');
  });

  test('a work email is optional in every niche: it only adds a badge', async () => {
    const r = await doctor.api('/verification/work-email', { method: 'POST', body: { email: 'levan@clinic.example' } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await doctor.api('/verification')).requirements.some((x) => x.step === 'work_email'), false, 'never required');
  });

  test('a confirmed work email also counts as evidence (verified automatically; the address itself is not shown)', async () => {
    const ev = (await pool.query(`SELECT * FROM mentor_evidence WHERE user_id = $1 AND kind = 'work_email'`, [designerId])).rows;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].check_status, 'ok');
    assert.equal(ev[0].auto_verified, true);
    assert.equal(ev[0].check_result.domain, 'studio.example');
  });
});

describe('evidence: a portfolio link, a company code', () => {
  test('any mentor can add a portfolio link as evidence; only web addresses are accepted', async () => {
    assert.equal((await designer.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'javascript:alert(1)' } })).error, 'invalid_url');
    assert.equal((await designer.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'not a url' } })).error, 'invalid_url');
    const r = await designer.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'https://behance.net/nino' } });
    assert.equal(r.status, 200, r.text);
    const row = (await pool.query(`SELECT * FROM mentor_evidence WHERE user_id = $1 AND kind = 'portfolio'`, [designerId])).rows[0];
    assert.equal(row.url, 'https://behance.net/nino');
    assert.equal(row.check_status, 'unchecked', 'links are checked when the application is submitted');
    assert.equal((await doctor.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'https://behance.net/x' } })).status, 200, 'a doctor can add one too');
  });

  test('a Business mentor gives a company code (9 or 11 digits); the admin gets a direct link to the Public Registry', async () => {
    assert.equal((await boss.api('/verification/evidence', { method: 'POST', body: { kind: 'company', registryId: '12345' } })).error, 'invalid_company_id');
    assert.equal((await boss.api('/verification/evidence', { method: 'POST', body: { kind: 'company', registryId: '20481-2222' } })).error, 'invalid_company_id');
    assert.equal((await boss.api('/verification/evidence', { method: 'POST', body: { kind: 'company', registryId: '404 123 456' } })).status, 200);
    const bossId = (await boss.api('/me')).user.id;
    const d = await admin.api(`/admin/mentors/${bossId}/verification`);
    const company = d.evidence.find((e) => e.kind === 'company');
    assert.equal(company.registryId, '404123456');
    assert.equal(company.checkStatus, 'admin_check');
    assert.ok(company.registry.some((r) => /reestri|napr/.test(r.url)), 'links to the Public Registry (never scraped)');
  });
});

describe('the whole picture for each niche', () => {
  test('Design: identity and experience; no licence, no interview; the work email and diploma are optional badges', async () => {
    const own = await designer.api('/verification');
    assert.equal(own.level, 'standard');
    assert.equal(own.regulated, false);
    assert.deepEqual(own.requirements.map((r) => r.step), ['email', 'id_kyc', 'age', 'name_match', 'experience']);
    assert.deepEqual(own.optional.map((o) => o.step), ['work_email', 'diploma']);
    assert.equal(own.optional.find((o) => o.step === 'work_email').status, 'pending', 'the work email was changed and must be confirmed again');
    assert.equal(own.ready, false, 'the ID check and the application are still open');
  });

  test('Medicine: the licence and a copy of it are required (no public register we could confirm); an interview only if asked', async () => {
    const own = await doctor.api('/verification');
    assert.equal(own.level, 'regulated');
    assert.equal(own.regulated, true);
    const names = own.requirements.map((r) => r.step);
    assert.ok(['license', 'license_document'].every((s) => names.includes(s)));
    assert.ok(!names.includes('video_interview'));
    assert.equal(own.ready, false);
  });

  test('the admin cannot give final approval while anything is missing', async () => {
    const r = await admin.api(`/admin/mentors/${doctorId}/approve`, { method: 'POST' });
    assert.equal(r.status, 409);
    await pool.query(`UPDATE users SET verification_status = 'pending' WHERE id = $1`, [doctorId]);
    const again = await admin.api(`/admin/mentors/${doctorId}/approve`, { method: 'POST' });
    assert.equal(again.error, 'steps_incomplete');
    assert.ok(again.missing.includes('id_kyc') && again.missing.includes('experience'));
  });
});
