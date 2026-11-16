// A lawyer needs only their bar number. Membership of the Georgian Bar Association has no document and no end date: there is a member
// number, and the association's public register says whether it is in force. So:
//   - in a field whose register is public (law, accounting) the number and who issued it are enough: no end date is asked, nothing has
//     to be uploaded, and nothing has to be linked (the number is the proof; an admin looks it up in the register)
//   - a date that IS given is always checked (a real day, not past, within 15 years)
//   - any other licence takes a date or the mentor's own "No expiry"; a diploma never needed one
//   - a second licence or jurisdiction ("New York State Bar") is optional: who issued it, and its number if there is one
//   - an application that was half filled in before this simply goes on: nothing in it is touched
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, wait } = require('./helpers');
const rules = require('../server/verification/rules');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const inYears = (n) => new Date(Date.now() + n * 365 * 86400000).toISOString().slice(0, 10);
const STORY = 'I have practised law for nineteen years. I started as a junior associate drafting contracts for small companies, moved on to disputes between shareholders, and for the last ten years I have led the corporate practice of a firm in Tbilisi. I advise founders on how to set a company up, how to bring an investor in without losing control, and what to do when partners fall out. I also teach contract law to final-year students.';
const SAMPLE_ANSWER = 'Before you sign with an investor, read three clauses twice: who decides what, what happens when one of you wants to leave, and what happens if the company is sold. Most disputes I see come from one of those three being left vague because everyone was friendly on the day.';

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); }
}
const stepRow = async (id, step) => (await pool.query('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [id, step])).rows[0];
const userRow = async (id) => (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
const credRow = async (id) => (await pool.query('SELECT * FROM mentor_credentials WHERE user_id = $1', [id])).rows[0];

// A mentor whose application is filled in up to the proof step: the field, the story, the sample answer and the price; no link, no
// document, no licence.
async function applicant(name, email, niche, over = {}) {
  const c = await signupVerified(base, name, email);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 40, headline: `${name}, mentor` } })).status, 200);
  const r = await c.api('/verification/experience', {
    method: 'PUT',
    body: { roleTitle: 'Senior practitioner', customNiche: 'My own field', niche, specialtyTags: ['contracts', 'disputes'], yearsExperience: 19, story: STORY, sampleAnswer: SAMPLE_ANSWER, ...over }
  });
  assert.equal(r.status, 200, r.text);
  return { c, id: (await c.api('/me')).user.id, name };
}
const licence = (m, body) => m.c.api('/verification/license', { method: 'POST', body: { number: 'GBA 004512', issuingBody: 'Georgian Bar Association', holderName: m.name, ...body } });
const missing = async (m) => (await m.c.api('/verification')).application.missing;

before(async () => {
  await resetDatabase();
  srv = await startServer(4894, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('a lawyer: the bar number is enough', () => {
  let m;
  before(async () => { m = await applicant('Davit Advocate', 'davit-advocate@example.com', 'law'); });

  test('the page is told the register is public, and only the licence itself is required (never a document)', async () => {
    const v = await m.c.api('/verification');
    assert.equal(v.regulated, true);
    // (the one body that admits advocates: the page fills "who issued it" in with it, in its language)
    assert.deepEqual(v.licence, { publicRegister: true, credential: 'licence', issuer: { ka: 'საქართველოს ადვოკატთა ასოციაცია', en: 'Georgian Bar Association' } });
    assert.deepEqual(rules.requiredFor('law').filter((s) => /^license/.test(s)), ['license']);
    assert.ok(!v.requirements.some((r) => r.step === 'license_document'), 'no upload is asked of a lawyer');
    // before the number is given: the licence is asked for (and, like everyone, some proof)
    const before = v.application.missing;
    assert.ok(before.includes('license'));
    assert.ok(before.includes('evidence'));
    const early = await m.c.api('/verification/submit', { method: 'POST' });
    assert.equal(early.error, 'incomplete');
  });

  test('the number and who issued it, with no end date and nothing uploaded or linked: accepted, and nothing is missing', async () => {
    const r = await licence(m, { validUntil: '', noExpiry: true });
    assert.equal(r.status, 200, r.text);
    const v = await m.c.api('/verification');
    assert.deepEqual(v.application.missing, [], 'the number is the proof: no link, no document, no date');
    assert.equal(v.application.evidence.length, 0);
    assert.equal(v.inputs.license.validUntil, null);
    assert.equal(v.inputs.license.numberEnding, '4512');
    assert.equal(v.inputs.license.issuingBody, 'Georgian Bar Association');
    assert.equal(v.inputs.license.second, null);
    assert.equal(v.inputs.documents.length, 0);
    const step = await stepRow(m.id, 'license');
    assert.equal(step.status, 'pending');
    assert.equal(step.evidence.noExpiry, true);
    assert.equal(step.evidence.validUntil, null);
    assert.doesNotMatch(JSON.stringify(step.evidence), /004512/, 'never the whole number in the step');
    const raw = await credRow(m.id);
    assert.equal(raw.valid_until, null);
    assert.match(raw.license_number_enc, /^v1:/);
  });

  test('the same without the "No expiry" tick: in a field with a public register an empty date is simply fine', async () => {
    const other = await applicant('Nino Notary', 'nino-notary@example.com', 'law');
    const r = await licence(other, {}); // (no validUntil key at all, as an older page sends nothing)
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(await missing(other), []);
  });

  test('an end date that IS given is still checked: past, too far, or not a date are refused; a real one is kept', async () => {
    assert.equal((await licence(m, { validUntil: '2020-01-01' })).error, 'invalid_valid_until');
    assert.equal((await licence(m, { validUntil: inYears(40) })).error, 'invalid_valid_until');
    assert.equal((await licence(m, { validUntil: 'soon' })).error, 'invalid_valid_until');
    assert.equal((await licence(m, { validUntil: '2031-02-30' })).error, 'invalid_valid_until');
    // ("No expiry" never excuses a date that was written)
    assert.equal((await licence(m, { validUntil: '2020-01-01', noExpiry: true })).error, 'invalid_valid_until');
    assert.equal((await m.c.api('/verification')).inputs.license.validUntil, null, 'a refused save changes nothing');
    const until = inYears(3);
    assert.equal((await licence(m, { validUntil: until })).status, 200);
    assert.equal((await m.c.api('/verification')).inputs.license.validUntil, until);
    assert.equal((await stepRow(m.id, 'license')).evidence.noExpiry, false);
    // and back to none
    assert.equal((await licence(m, { validUntil: '', noExpiry: true })).status, 200);
    assert.equal((await m.c.api('/verification')).inputs.license.validUntil, null);
  });

  test('the number and the issuing body are still required (an empty name is the account\'s own name)', async () => {
    assert.equal((await licence(m, { number: '' })).error, 'invalid_license_number');
    assert.equal((await licence(m, { number: 'A' })).error, 'invalid_license_number');
    assert.equal((await licence(m, { issuingBody: '' })).error, 'invalid_issuing_body');
    assert.equal((await licence(m, { holderName: 'A' })).error, 'invalid_holder_name');
    assert.equal((await licence(m, { holderName: '' })).status, 200);
    assert.equal((await m.c.api('/verification')).inputs.license.holderName, m.name);
  });

  test('sent for review and approved: the admin sees the number, the register link and "no end date"; the passed licence never runs out', async () => {
    assert.equal((await m.c.api('/verification/submit', { method: 'POST' })).status, 200);
    const k = await m.c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(k.status, 200, k.text);
    await client(base).api(`/mock-kyc/sessions/${k.url.split('session=')[1]}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: m.name, dateOfBirth: '1980-05-01' } });
    await waitFor(async () => { const s = await stepRow(m.id, 'age'); return s && s.status === 'passed'; });

    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.credentials.licenseNumber, 'GBA 004512');
    assert.equal(d.credentials.issuingBody, 'Georgian Bar Association');
    assert.equal(d.credentials.validUntil, null);
    assert.ok(d.registries.some((r) => /gba\.ge/.test(r.url)), 'the register to look the number up in');
    assert.equal((await admin.api(`/admin/mentors/${m.id}/steps/license`, { method: 'POST', body: { decision: 'passed', reason: 'Found in the Bar Association members registry' } })).status, 200);
    assert.equal((await stepRow(m.id, 'license')).expires_at, null);
    const ok = await admin.api(`/admin/mentors/${m.id}/approve`, { method: 'POST' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await userRow(m.id)).verification_status, 'verified');
  });
});

describe('a second licence or jurisdiction is optional', () => {
  let m;
  before(async () => { m = await applicant('Giorgi Counsel', 'giorgi-counsel@example.com', 'law'); });

  test('left out, or left empty: there is none', async () => {
    assert.equal((await licence(m, {})).status, 200);
    assert.equal((await m.c.api('/verification')).inputs.license.second, null);
    assert.equal((await licence(m, { second: { issuingBody: '  ', number: '' } })).status, 200);
    assert.equal((await m.c.api('/verification')).inputs.license.second, null);
    assert.equal((await credRow(m.id)).second_body, null);
  });

  test('who issued it is enough: no number, no date, no document', async () => {
    const r = await licence(m, { noExpiry: true, second: { issuingBody: 'New York State Bar', number: '' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await m.c.api('/verification')).inputs.license.second, { issuingBody: 'New York State Bar', numberEnding: null });
    assert.deepEqual(await missing(m), []);
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.deepEqual(d.credentials.second, { issuingBody: 'New York State Bar', licenseNumber: null });
  });

  test('with its number: the admin reads the whole number, the mentor only its ending, the database only the encrypted one', async () => {
    const r = await licence(m, { noExpiry: true, second: { issuingBody: 'New York State Bar', number: 'NY 5123987' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await m.c.api('/verification')).inputs.license.second, { issuingBody: 'New York State Bar', numberEnding: '3987' });
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.deepEqual(d.credentials.second, { issuingBody: 'New York State Bar', licenseNumber: 'NY 5123987' });
    assert.equal(d.credentials.licenseNumber, 'GBA 004512', 'the first licence is what it was');
    const raw = await credRow(m.id);
    assert.match(raw.second_number_enc, /^v1:/);
    assert.doesNotMatch(JSON.stringify(raw), /5123987/);
    const step = await stepRow(m.id, 'license');
    assert.deepEqual(step.evidence.second, { issuingBody: 'New York State Bar', numberEnding: '3987' });
    assert.doesNotMatch(JSON.stringify(step.evidence), /5123987/);
  });

  test('a number with nobody who issued it, or a number that is not one, is refused, and says which', async () => {
    const a = await licence(m, { second: { issuingBody: '', number: 'NY 5123987' } });
    assert.equal(a.status, 400);
    assert.equal(a.error, 'invalid_second_body');
    assert.equal((await licence(m, { second: { issuingBody: 'N', number: '' } })).error, 'invalid_second_body');
    assert.equal((await licence(m, { second: { issuingBody: 'New York State Bar', number: '<b>1' } })).error, 'invalid_second_number');
    assert.equal((await licence(m, { second: { issuingBody: 'New York State Bar', number: 'A' } })).error, 'invalid_second_number');
    // (a refused save changes nothing)
    assert.deepEqual((await m.c.api('/verification')).inputs.license.second, { issuingBody: 'New York State Bar', numberEnding: '3987' });
  });
});

describe('every regulated field: a date is never forced where a licence has none', () => {
  const REG = rules.REGULATED;
  test('the fields are the ones this test knows (a new regulated field must be looked at here)', () => {
    assert.deepEqual(Object.keys(REG).sort(), ['accounting_tax', 'allied_health', 'aviation', 'dentistry', 'finance', 'law', 'maritime', 'medicine', 'nursing', 'nutrition', 'pharmacy', 'psychology', 'veterinary']);
    assert.deepEqual(Object.keys(REG).filter((k) => REG[k].publicRegister).sort(), ['accounting_tax', 'law']);
    assert.deepEqual(Object.keys(REG).filter((k) => REG[k].credential === 'diploma').sort(), ['allied_health', 'nursing', 'nutrition', 'psychology', 'veterinary']);
    // a single known issuer only where there is one (law); every issuer is named in both languages
    assert.deepEqual(Object.keys(REG).filter((k) => REG[k].issuer), ['law']);
    for (const k of Object.keys(REG).filter((x) => REG[x].issuer)) assert.ok(REG[k].issuer.ka && REG[k].issuer.en, k);
  });

  test('a field without a single issuer gives the page none, so nothing is filled in for the mentor', async () => {
    const m = await applicant('Mentor issuer check', 'reg-issuer-check@example.com', 'medicine');
    assert.equal((await m.c.api('/verification')).licence.issuer, null);
  });

  for (const niche of Object.keys(REG)) {
    const kind = REG[niche];
    const what = kind.credential === 'diploma' ? 'a diploma: no date needed' : kind.publicRegister ? 'a public register: no date needed, no document' : 'a licence: a date or "No expiry", and its document';
    test(`${niche}: ${what}`, async () => {
      const m = await applicant(`Mentor ${niche.replace(/_/g, ' ')}`, `reg-${niche.replace(/_/g, '-')}@example.com`, niche);
      const bare = await licence(m, { validUntil: '' });
      if (kind.credential === 'diploma' || kind.publicRegister) {
        assert.equal(bare.status, 200, `${niche}: ${bare.text}`);
      } else {
        assert.equal(bare.error, 'invalid_valid_until', `${niche}: an empty date with no "No expiry" is asked about`);
        // (only the mentor's own tick counts: true, never a word)
        assert.equal((await licence(m, { validUntil: '', noExpiry: 'yes' })).error, 'invalid_valid_until');
        const none = await licence(m, { validUntil: '', noExpiry: true });
        assert.equal(none.status, 200, `${niche}: ${none.text}`);
        assert.equal((await stepRow(m.id, 'license')).evidence.noExpiry, true, 'the admin is told the mentor said so');
      }
      assert.equal((await m.c.api('/verification')).inputs.license.validUntil, null);
      // a given date is checked everywhere
      assert.equal((await licence(m, { validUntil: '2019-06-30', noExpiry: true })).error, 'invalid_valid_until');
      assert.equal((await licence(m, { validUntil: inYears(2) })).status, 200);
      // what is still asked: the document where there is no public register; a link or a document as proof everywhere but there
      const miss = await missing(m);
      assert.equal(miss.includes('license'), false);
      assert.equal(miss.includes('license_document'), !kind.publicRegister, `${niche}: document`);
      assert.equal(miss.includes('evidence'), !kind.publicRegister, `${niche}: proof`);
    });
  }

  test('a field that is not regulated has no licence at all', async () => {
    const m = await applicant('Dea Designer', 'dea-designer@example.com', 'design');
    assert.equal((await licence(m, { noExpiry: true })).error, 'not_required');
    assert.deepEqual(await missing(m), ['evidence']);
  });
});

describe('a half-finished application simply goes on', () => {
  test('a lawyer who stopped at the licence: nothing he wrote is touched, and the number alone finishes the step', async () => {
    const m = await applicant('Levan Senior', 'levan-senior@example.com', 'law', { specialtyTags: ['corporate law', 'M&A', 'arbitration'], university: 'Tbilisi State University', currentRole: 'Partner, law firm' });
    const before = await userRow(m.id);
    const formBefore = (await m.c.api('/verification')).application.form;
    assert.deepEqual((await m.c.api('/verification')).application.missing.sort(), ['evidence', 'license']);

    assert.equal((await licence(m, { number: '1234', noExpiry: true, second: { issuingBody: 'New York State Bar' } })).status, 200);

    const after = await userRow(m.id);
    for (const k of Object.keys(before)) {
      if (k === 'updated_at') continue;
      assert.deepEqual(after[k], before[k], `users.${k} is what it was`);
    }
    const v = await m.c.api('/verification');
    assert.deepEqual(v.application.form, formBefore);
    assert.deepEqual(v.application.missing, []);
    assert.equal(v.application.locked, false);
    assert.equal((await m.c.api('/verification/submit', { method: 'POST' })).status, 200);
  });

  test('a lawyer who gave a date before (the old form asked for one) keeps it, and it still counts', async () => {
    const m = await applicant('Tamar Earlier', 'tamar-earlier@example.com', 'law');
    await m.c.api('/verification/evidence', { method: 'POST', body: { kind: 'website', url: 'https://tamar-earlier.invalid/' } });
    const until = inYears(5);
    assert.equal((await licence(m, { validUntil: until })).status, 200);
    const v = await m.c.api('/verification');
    assert.equal(v.inputs.license.validUntil, until);
    assert.equal(v.application.evidence.length, 1);
    assert.deepEqual(v.application.missing, []);
  });
});

describe('the pages and the words', () => {
  const dict = (l) => JSON.parse(read(`public/i18n/${l}.json`));
  test('"ვადა არ აქვს" / "No expiry", the second licence and their messages exist in both languages', () => {
    assert.equal(dict('ka')['vt.lic.noExpiry'], 'ვადა არ აქვს');
    assert.equal(dict('en')['vt.lic.noExpiry'], 'No expiry');
    for (const l of ['ka', 'en']) {
      const d = dict(l);
      for (const k of ['vt.lic.second', 'vt.lic.second.body', 'vt.lic.second.bodyHint', 'vt.lic.second.number', 'vt.lic.second.line', 'vt.lic.err.secondBody', 'vt.lic.err.secondNumber',
        'vt.lic.bodyHint.law', 'vt.lic.bodyHint.accounting_tax', 'ap.lic.register', 'apply.proof.leadRegister', 'apply.proof.optional', 'vt.lic.need.number', 'vt.lic.need.number.dip', 'vt.lic.need.body', 'vt.lic.need.holder', 'vt.lic.need.holder.dip', 'apply.err.licenceDoc', 'apply.err.licenceDoc.dip']) assert.ok(d[k], `${l} ${k}`);
      assert.match(d['vt.lic.second.bodyHint'], /New York State Bar/);
      assert.match(d['vt.lic.err.until'], l === 'ka' ? /ვადა არ აქვს/ : /No expiry/, 'the date message names the way out');
      const a = JSON.parse(read(`public/i18n/admin-${l}.json`));
      for (const k of ['admin.mv.noExpiry', 'admin.mv.second']) assert.ok(a[k], `admin ${l} ${k}`);
    }
  });

  test('the three licence forms have the "No expiry" box; none of them requires a date in the page', () => {
    const apply = read('public/js/apply.js');
    assert.match(apply, /id="apLicNoExpiry" name="noExpiry" type="checkbox"/);
    assert.match(apply, /name="secondBody"/);
    assert.match(apply, /name="secondNumber"/);
    assert.doesNotMatch(apply, /!val\('holderName'\) \|\| !val\('validUntil'\)/, 'the date is not one of the boxes that must be filled');
    assert.match(apply, /noExpiry: none, second: \{/);
    const sv = read('public/js/settings-verification.js');
    assert.match(sv, /name="noExpiry"/);
    assert.doesNotMatch(sv, /name="validUntil"[^>]*required/);
    const sd = read('public/js/settings-details.js');
    assert.match(sd, /id="dLicNoExpiry"/);
    assert.match(read('public/js/admin-mentors.js'), /admin\.mv\.noExpiry/);
    assert.match(read('public/js/admin-mentors.js'), /c\.second/);
  });

  test('the columns of the second licence come with their way back', () => {
    assert.match(read('migrations/069_second_licence.sql'), /ADD COLUMN IF NOT EXISTS second_body/);
    assert.match(read('migrations/down/069_second_licence.down.sql'), /DROP COLUMN IF EXISTS second_body/);
  });
});
