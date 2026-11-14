// Categories that fit Georgian professionals (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 3): a main category and up to two
// extra ones (browse, the filters, search and the field pages use them all); the closest categories as chips from the mentor's own words,
// in Georgian and English (30 real phrases below); clearer Georgian names; "I mainly teach or research" / "I mainly work in practice";
// a regulated field as an extra category only for an academic, with the limits said exactly, and never approved automatically.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const dict = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8'));
const PROFESSOR = 'განათლების ფსიქოლოგია, ფსიქოლოგიის ისტორია, პედაგოგი';
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4782, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  await require('../server/niches').load();
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

async function mentor(name, email) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } });
  return { c, id: (await c.api('/me')).user.id };
}
// (straight to the server, without the test client's "first direction" step: these tests read the niche layer as it is set; tests/helpers.js)
const put = (m, body) => m.c('/api/verification/experience', { method: 'PUT', body });
const row = async (id) => (await pool.query('SELECT niche, extra_niches, practice_kind FROM users WHERE id = $1', [id])).rows[0];

describe('the closest categories from the mentor\'s own words', () => {
  // [words, the first choice (the one picked for them), other categories that must be among the three]
  const PHRASES = [
    [PROFESSOR, 'psychology', ['teaching']],
    ['პროგრამისტი', 'tech', []],
    ['IT პროექტების მენეჯმენტი', null, ['tech']],
    ['კიბერუსაფრთხოება', 'cybersecurity', []],
    ['ექიმი კარდიოლოგი', 'medicine', []],
    ['კლინიკის მენეჯმენტი', null, ['medicine', 'business']],
    ['იურისტი', 'law', []],
    ['საერთაშორისო სამართალი', null, ['law']],
    ['ბუღალტერი', 'accounting_tax', []],
    ['გადასახადები მცირე ბიზნესისთვის', null, ['accounting_tax', 'business']],
    ['SMM და ბრენდინგი', 'marketing', []],
    ['ციფრული მარკეტინგი', 'marketing', []],
    ['არქიტექტორი', 'architecture', []],
    ['ინტერიერის დიზაინი', 'design', []],
    ['ტურიზმი და სასტუმრო ბიზნესი', 'tourism', ['business']],
    ['ბანკში საკრედიტო ანალიტიკოსი', null, ['finance']],
    ['ინვესტიციები', null, ['finance']],
    ['ჟურნალისტი', 'writing', []],
    ['მედია და კომუნიკაცია', 'content_creation', []],
    ['სწავლა საზღვარგარეთ, გრანტები', 'study_abroad', []],
    ['სტიპენდიები გერმანიაში', 'study_abroad', []],
    ['ღვინის დაყენება', 'wine_agriculture', []],
    ['აგრობიზნესი', 'wine_agriculture', ['business']],
    ['მათემატიკის მასწავლებელი', null, ['teaching', 'science']],
    ['Associate professor of economics', 'business', ['teaching']],
    ['Software engineer', 'tech', ['engineering']],
    ['Clinical psychologist', 'psychology', []],
    ['მშობლობა და ბავშვის აღზრდა', 'parenting', []],
    ['ფიტნეს ტრენერი', 'fitness', []],
    ['ფოტოგრაფია და ვიდეო მონტაჟი', 'film_photo', []]
  ];

  test('30 real phrases: the right first choice, and the categories that must be offered', () => {
    const { suggestFields } = require('../server/fieldSuggest');
    assert.equal(PHRASES.length, 30);
    for (const [words, first, among] of PHRASES) {
      const got = suggestFields(3, words);
      assert.ok(got.length >= 1 && got.length <= 3, `${words}: ${got}`);
      if (first) assert.equal(got[0], first, `${words}: ${got}`);
      for (const k of among) assert.ok(got.includes(k), `${words}: ${got} should include ${k}`);
    }
  });

  test('a regulated category is picked by itself only when the words name the profession', () => {
    const { suggestField, suggestFields } = require('../server/fieldSuggest');
    assert.notEqual(suggestField('Personal finance'), 'finance');
    assert.ok(suggestFields(3, 'Personal finance').includes('finance'), 'but it is offered');
    assert.notEqual(suggestField('საერთაშორისო სამართალი'), 'law');
    assert.equal(suggestField('it is a hobby'), null, '"it" is a word, "IT" is the field');
  });

  test('/api/niches/suggest returns up to three choices, the suggestion first', async () => {
    const r = await client(base).api('/niches/suggest?q=' + encodeURIComponent(PROFESSOR));
    assert.equal(r.niche, 'psychology');
    assert.equal(r.choices[0].key, 'psychology');
    assert.equal(r.choices[0].regulated, true);
    assert.ok(r.choices.some((c) => c.key === 'teaching'));
    assert.ok(r.choices.length <= 3);
  });
});

describe('a main category and up to two extra ones', () => {
  let prof, med;
  before(async () => {
    prof = await mentor('Nana Professor', 'nana-prof@example.com');
    med = await mentor('Levan Lawyer', 'levan-law@example.com');
  });

  test('a regulated extra category only for someone who mainly teaches or researches', async () => {
    let r = await put(prof, { customNiche: PROFESSOR, niche: 'teaching', extraNiches: ['psychology'] });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'extra_regulated');
    assert.equal(r.field, 'extraNiches');
    r = await put(prof, { customNiche: PROFESSOR, niche: 'teaching', extraNiches: ['psychology'], practiceKind: 'practitioner' });
    assert.equal(r.error, 'extra_regulated');
    r = await put(prof, { customNiche: PROFESSOR, roleTitle: 'Associate professor', niche: 'teaching', extraNiches: ['psychology', 'science'], practiceKind: 'academic' });
    assert.equal(r.status, 200, r.text);
    // (her words name psychology, but she keeps Teaching as the main one: psychology is among hers, and still reviewed by a person)
    assert.deepEqual(await row(prof.id), { niche: 'teaching', extra_niches: ['psychology', 'science'], practice_kind: 'academic' });
  });

  test('never the main one again, never more than two, only real categories', async () => {
    assert.equal((await put(med, { niche: 'business', extraNiches: ['tech', 'design', 'marketing'] })).error, 'too_many_niches');
    assert.equal((await put(med, { niche: 'business', extraNiches: ['nonsense'] })).error, 'invalid_niche');
    assert.equal((await put(med, { niche: 'business', extraNiches: ['other'] })).error, 'invalid_niche');
    assert.equal((await put(med, { customNiche: 'Startups', niche: 'business', extraNiches: ['business', 'tech', 'tech'] })).status, 200);
    assert.deepEqual((await row(med.id)).extra_niches, ['tech']);
    assert.equal((await put(med, { niche: 'tech' })).status, 200);
    assert.deepEqual((await row(med.id)).extra_niches, [], 'the new main one is dropped from the extra ones');
    assert.equal((await put(med, { practiceKind: 'everything' })).error, 'invalid_field');
  });

  test('a regulated extra category: the application waits for a person, never approved automatically', () => {
    const { anyRegulated } = require('../server/verification/experience');
    assert.equal(anyRegulated({ niche: 'teaching', extraNiches: ['psychology'] }), true);
    assert.equal(anyRegulated({ niche: 'teaching', extraNiches: ['science'] }), false);
    const src = fs.readFileSync(path.join(ROOT, 'server/verification/analysis.js'), 'utf8');
    assert.match(src, /regulated: experience\.anyRegulated\(user\)/);
  });

  test('browse, the filters, search and the field pages use every category; the profile has the main one first and the tag', async () => {
    await approveMentor(admin, prof.c);
    await addPayoutDetails(prof.c, undefined, 'Nana Professor');
    const names = async (q) => (await client(base).api('/experts' + q)).experts.map((e) => e.name);
    assert.deepEqual(await names('?niche=teaching'), ['Nana Professor']);
    assert.deepEqual(await names('?niche=psychology'), ['Nana Professor']);
    assert.deepEqual(await names('?niche=science'), ['Nana Professor']);
    assert.deepEqual(await names('?q=' + encodeURIComponent('Science')), ['Nana Professor'], 'an extra category\'s name is searched too');
    const { expert } = await client(base).api(`/experts/${prof.id}`);
    assert.equal(expert.niche, 'teaching');
    assert.deepEqual(expert.extraNiches, ['psychology', 'science']);
    assert.equal(expert.practiceKind, 'academic');
    const page = await fetch(`${base}/advice/psychology`).then((r) => r.text());
    assert.match(page, /Nana Professor/);
  });

  test('admin → Niches counts the extra categories next to the main ones', async () => {
    const r = await admin.api('/admin/niches');
    const psych = r.niches.find((n) => n.key === 'psychology');
    assert.equal(psych.extra, 1);
    assert.equal(r.niches.find((n) => n.key === 'teaching').mentors >= 1, true);
  });
});

describe('the words on the page', () => {
  test('clearer Georgian names, in the dictionary and in the database', async () => {
    const ka = dict('ka');
    const want = { tech: 'IT სფერო', teaching: 'განათლება და სწავლება', creative: 'ხელოვნება და ხელნაკეთობა', writing: 'წერა და ჟურნალისტიკა',
      parenting: 'მშობლობა და ბავშვის აღზრდა', science: 'მეცნიერება და კვლევა', sports_coaching: 'სპორტი და მწვრთნელობა', data_ai: 'მონაცემთა ანალიზი და ხელოვნური ინტელექტი', psychology: 'ფსიქოლოგია' };
    const { rows } = await pool.query('SELECT key, name_ka FROM niches WHERE key = ANY($1)', [Object.keys(want)]);
    for (const [k, v] of Object.entries(want)) {
      assert.equal(ka['niche.' + k], v, k);
      assert.equal(rows.find((r) => r.key === k).name_ka, v, k);
    }
  });

  test('the academic limit says exactly what may and may not be given, in both languages', () => {
    const en = dict('en');
    const ka = dict('ka');
    assert.match(en['apply.f.academicLimit'], /academic, career and study advice without a practising licence/);
    assert.match(en['apply.f.academicLimit'], /not give clinical, legal or financial advice about a specific person's case/);
    assert.match(ka['apply.f.academicLimit'], /აკადემიური, კარიერული და სწავლასთან დაკავშირებული რჩევა/);
    assert.match(ka['apply.f.academicLimit'], /კლინიკური, იურიდიული ან ფინანსური რჩევის/);
    assert.equal(ka['apply.f.kind.academic'], 'ძირითადად ვასწავლი / ვიკვლევ');
    assert.equal(ka['apply.f.kind.practitioner'], 'ძირითადად პრაქტიკაში ვმუშაობ');
    assert.equal(ka['profile.kind.academic'], 'ლექტორი');
    assert.equal(ka['profile.kind.practitioner'], 'პრაქტიკოსი');
  });
});
