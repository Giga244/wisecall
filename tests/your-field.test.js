// "Your field" (PART 2): every mentor writes their field in their own words next to the closest category or "Other"; the words show on
// cards and profiles, search finds them (and the specialty tags and the category), regulated professions stay regulated whatever the
// category, and an admin can change the field (and decide that words only look like a licensed profession).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');
const { regulatedCategoryIn, categoryFor } = require('../server/fieldRules');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

async function mentor(name, email) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } });
  return { c, id: (await c.api('/me')).user.id };
}
const put = (m, body) => m.c.api('/verification/experience', { method: 'PUT', body });
const nicheOf = async (id) => (await pool.query('SELECT niche, custom_niche, field_override FROM users WHERE id = $1', [id])).rows[0];

before(async () => {
  await resetDatabase();
  srv = await startServer(4721, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the words', () => {
  test('regulated professions are found in English and Georgian, whole words only', () => {
    assert.equal(regulatedCategoryIn('Family doctor'), 'medicine');
    assert.equal(regulatedCategoryIn('ექიმი-პედიატრი'), 'medicine');
    assert.equal(regulatedCategoryIn('Tax lawyer for startups'), 'law');
    assert.equal(regulatedCategoryIn('ადვოკატი'), 'law');
    assert.equal(regulatedCategoryIn('იურისტი'), 'law');
    assert.equal(regulatedCategoryIn('Independent financial adviser'), 'finance');
    assert.equal(regulatedCategoryIn('Dentist'), 'dentistry');
    assert.equal(regulatedCategoryIn('Crypto trading'), null);
    assert.equal(regulatedCategoryIn('Nail artist'), null);
    assert.equal(regulatedCategoryIn('Doctorate advice'), null, 'a whole word, not the start of another');
    assert.deepEqual(categoryFor({ niche: 'business', field: 'Family doctor' }), { niche: 'medicine', forced: 'medicine' });
    assert.deepEqual(categoryFor({ niche: 'medicine', field: 'Family doctor' }), { niche: 'medicine', forced: null });
    assert.deepEqual(categoryFor({ niche: 'writing', field: 'Doctor Who fan fiction', overridden: true }), { niche: 'writing', forced: null });
  });
});

describe('the application form', () => {
  test('"Your field" is required, 3 to 60 characters, and checked like any public text', async () => {
    const m = await mentor('Nia Nails', 'nia@example.com');
    const app = async () => (await m.c.api('/verification')).application;
    await put(m, { roleTitle: 'Nail artist and salon owner', niche: 'creative' });
    assert.ok((await app()).missing.includes('field'), 'missing until written');
    for (const bad of ['ab', 'x'.repeat(61), 'www.nails.ge', 'call 599123456', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'fucking nails']) {
      const r = await put(m, { customNiche: bad });
      assert.equal(r.status, 400, bad);
      assert.equal(r.error, 'invalid_custom_niche', bad);
    }
    const long = 'Gel nails, nail art and running a small beauty salon in Tbilisi'.slice(0, 60);
    assert.equal((await put(m, { customNiche: long })).status, 200, 'up to 60 characters are kept');
    assert.equal((await nicheOf(m.id)).custom_niche, long);
    assert.equal((await put(m, { customNiche: 'Nail artist' })).status, 200);
    const a = await app();
    assert.ok(!a.missing.includes('field'));
    assert.equal(a.form.customNiche, 'Nail artist');
    assert.equal((await nicheOf(m.id)).niche, 'creative', 'the category chosen stays');
  });

  test('a field or title that names a licensed profession moves the category to the regulated one, and the page says why', async () => {
    const m = await mentor('Levan Lawyer', 'levan@example.com');
    await put(m, { roleTitle: 'Helping small shops', niche: 'business', customNiche: 'ადვოკატი მცირე ბიზნესისთვის' });
    assert.equal((await nicheOf(m.id)).niche, 'law');
    const v = await m.c.api('/verification');
    assert.equal(v.application.form.regulatedByWords, true);
    assert.ok(v.requirements.some((r) => r.step === 'license'), 'a licence is now required');
    const f = await mentor('Fatima Finance', 'fatima@example.com');
    await put(f, { roleTitle: 'Independent financial adviser', niche: 'other', customNiche: 'Saving for a flat' });
    assert.equal((await nicheOf(f.id)).niche, 'finance', 'the title counts too');
    const plain = await mentor('Crypto Carl', 'carl@example.com');
    await put(plain, { roleTitle: 'Trader', niche: 'other', customNiche: 'Crypto trading' });
    assert.equal((await nicheOf(plain.id)).niche, 'other', 'nothing regulated: "Other" stays');
  });
});

describe('what others see, and search', () => {
  let listed;
  before(async () => {
    listed = await mentor('Gio Germany', 'gio@example.com');
    await put(listed, { roleTitle: 'Student advisor', niche: 'study_abroad', customNiche: 'Study in Germany', specialtyTags: ['DAAD scholarships', 'visa'] });
    await approveMentor(admin, listed.c);
    await addPayoutDetails(listed.c, undefined, 'Gio Germany');
    const other = await mentor('Bea Bees', 'bea@example.com');
    await put(other, { roleTitle: 'Beekeeper', niche: 'other', customNiche: 'Beekeeping' });
    await approveMentor(admin, other.c);
    await addPayoutDetails(other.c, undefined, 'Bea Bees');
  });

  test('the field shows on the card and the profile, for every category', async () => {
    const { experts } = await client(base).api('/experts');
    assert.equal(experts.find((e) => e.name === 'Gio Germany').customNiche, 'Study in Germany');
    const { expert } = await client(base).api(`/experts/${listed.id}`);
    assert.equal(expert.customNiche, 'Study in Germany');
    assert.equal(expert.niche, 'study_abroad');
  });

  test('search finds the field, a specialty tag, and the category (in English or Georgian)', async () => {
    const find = async (q) => (await client(base).api(`/experts?q=${encodeURIComponent(q)}`)).experts.map((e) => e.name);
    assert.deepEqual(await find('germany'), ['Gio Germany']);
    assert.deepEqual(await find('DAAD'), ['Gio Germany']);
    assert.deepEqual(await find('Studying abroad'), ['Gio Germany']);
    assert.deepEqual(await find('საზღვარგარეთ'), ['Gio Germany']);
    assert.deepEqual(await find('beekeeping'), ['Bea Bees']);
    assert.deepEqual(await find('%'), [], 'a wildcard is only a character');
  });

  test('"Other" is a filter of its own', async () => {
    const { experts } = await client(base).api('/experts?niche=other');
    assert.deepEqual(experts.map((e) => e.name), ['Bea Bees']);
  });
});

describe('the admin', () => {
  test('changes the field and category; words that only look regulated need "not a licensed profession", and it is logged', async () => {
    const m = await mentor('Dora Writer', 'dora@example.com');
    await put(m, { roleTitle: 'Writer', niche: 'writing', customNiche: 'Doctor Who fan fiction' });
    assert.equal((await nicheOf(m.id)).niche, 'medicine', 'the words decided first');
    assert.equal((await m.c.api(`/admin/mentors/${m.id}/field`, { method: 'POST', body: { text: 'x', niche: 'writing' } })).status, 403, 'admins only');
    const refused = await admin.api(`/admin/mentors/${m.id}/field`, { method: 'POST', body: { text: 'Doctor Who fan fiction', niche: 'writing' } });
    assert.equal(refused.status, 409);
    assert.equal(refused.error, 'regulated_words');
    assert.equal(refused.category, 'medicine');
    const ok = await admin.api(`/admin/mentors/${m.id}/field`, { method: 'POST', body: { text: 'Doctor Who fan fiction', niche: 'writing', notRegulated: true } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await nicheOf(m.id), { niche: 'writing', custom_niche: 'Doctor Who fan fiction', field_override: true });
    const audit = (await pool.query(`SELECT reason FROM verification_audit WHERE mentor_id = $1 AND action = 'niche_changed'`, [m.id])).rows;
    assert.match(audit[0].reason, /not a licensed profession/);
    // Other edits by the mentor keep the decision; new words are checked again.
    await put(m, { yearsExperience: 4 });
    assert.equal((await nicheOf(m.id)).niche, 'writing');
    await put(m, { customNiche: 'Doctor Who scripts' });
    assert.deepEqual(await nicheOf(m.id), { niche: 'medicine', custom_niche: 'Doctor Who scripts', field_override: false });
  });

  test('an approved mentor is not moved into a category whose licence they have not passed', async () => {
    const m = await mentor('Tako Tech', 'tako@example.com');
    await put(m, { roleTitle: 'Backend engineer', niche: 'tech', customNiche: 'Backend engineering' });
    await approveMentor(admin, m.c);
    const r = await admin.api(`/admin/mentors/${m.id}/field`, { method: 'POST', body: { text: 'Backend engineering', niche: 'law' } });
    assert.equal(r.status, 409);
    assert.equal(r.error, 'licence_missing');
    assert.equal((await nicheOf(m.id)).niche, 'tech');
    assert.equal((await admin.api(`/admin/mentors/${m.id}/field`, { method: 'POST', body: { text: 'Backend and cloud engineering', niche: 'data_ai' } })).status, 200);
  });
});
