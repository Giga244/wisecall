// /apply.html step 1 on every device (docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md): the years are read from what was typed ("25 წელი" -> 25), each
// field says what it needs under itself, the server's refusals name the field; the category follows the mentor's words (an educational
// psychologist is not "Other"); and psychology (and nursing), where no licence exists, asks for a diploma or certificate, never a licence.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const dict = (l) => JSON.parse(read(`public/i18n/${l}.json`));
const HER_FIELD = 'განათლების ფსიქოლოგია, ფსიქოლოგიის ისტორია, პედაგოგი';

describe('the years, as the page reads them', () => {
  // (the page's own function, run as it is)
  const src = read('public/js/apply.js');
  const body = src.slice(src.indexOf('  function yearsOf(raw) {'), src.indexOf('  }', src.indexOf('  function yearsOf(raw) {')) + 3);
  const yearsOf = new Function('v', `${body}; return yearsOf;`)({ limits: { yearsMax: 70 } });
  test('the first whole number in what was typed; nothing, no number, or more than 70 say so', () => {
    assert.deepEqual(yearsOf('25'), { n: 25 });
    assert.deepEqual(yearsOf('25 წელი'), { n: 25 });
    assert.deepEqual(yearsOf(' 25+ '), { n: 25 });
    assert.deepEqual(yearsOf('25 years'), { n: 25 });
    assert.deepEqual(yearsOf('0'), { n: 0 });
    assert.deepEqual(yearsOf('70'), { n: 70 });
    assert.deepEqual(yearsOf(''), { empty: true });
    assert.deepEqual(yearsOf('   '), { empty: true });
    assert.deepEqual(yearsOf('abc'), { error: 'nan' });
    assert.deepEqual(yearsOf('ოცდაათი'), { error: 'nan' });
    assert.deepEqual(yearsOf('71'), { error: 'max' });
  });
  test('the years are chosen from a list (0 to 70), never typed: the same on every phone and keyboard', () => {
    assert.match(src, /<select id="apYears" name="yearsExperience"/);
    assert.match(src, /Array\.from\(\{ length: v\.limits\.yearsMax \+ 1 \}/);
    assert.doesNotMatch(src, /id="apYears"[^>]*type="number"/);
    for (const k of ['headline', 'field', 'niche', 'years']) assert.match(src, new RegExp(`data-error-for="${k}"`), k);
  });
  test('the messages, in English and Georgian', () => {
    assert.equal(dict('ka')['apply.err.years'], 'ჩაწერე მხოლოდ რიცხვი, მაგ. 25'); // (informal, like every Georgian text: tests/i18n.test.js)
    for (const l of ['en', 'ka']) {
      const d = dict(l);
      for (const k of ['apply.err.headline', 'apply.err.field', 'apply.err.category', 'apply.err.years', 'apply.err.yearsEmpty', 'apply.err.yearsMax', 'apply.err.network', 'apply.f.years.choose', 'apply.f.psychAcademic']) assert.ok(d[k], `${l} ${k}`);
      assert.match(d['apply.err.yearsMax'].replace(/\{max\}/g, '70'), /70/);
    }
  });
});

describe('the server', () => {
  let srv, c;
  before(async () => {
    await resetDatabase();
    srv = await startServer(4778);
    c = await signupVerified(srv.base, 'Nana Professor', 'nana-professor@example.com');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  });
  after(() => { if (srv) srv.proc.kill(); });

  test('an educational psychologist who teaches is psychology or teaching, never "Other" (with the categories from the database)', async () => {
    await require('../server/niches').load();
    const { suggestField } = require('../server/fieldSuggest');
    assert.equal(suggestField(HER_FIELD), 'psychology');
    assert.equal(suggestField(`${HER_FIELD}…`), 'psychology');
    for (const [words, want] of [['პედაგოგი', 'teaching'], ['პედაგოგიკა', 'teaching'], ['განათლება', 'teaching'], ['ფსიქოლოგია', 'psychology'], ['ფსიქოლოგი', 'psychology']]) {
      assert.equal(suggestField(words), want, words);
    }
    for (const words of ['განათლების ფსიქოლოგია', 'ფსიქოლოგიის ისტორია', 'educational psychology', 'history of psychology']) {
      assert.ok(['psychology', 'teaching', 'science'].includes(suggestField(words)), words);
    }
  });

  test('her words saved with no category chosen: the server picks psychology, not "Other"', async () => {
    assert.equal((await c.api('/verification/experience', { method: 'PUT', body: { customNiche: HER_FIELD, niche: null, yearsExperience: 25 } })).status, 200);
    const v = await c.api('/verification');
    assert.equal(v.niche, 'psychology');
    assert.equal(v.application.form.yearsExperience, 25);
  });

  test('a refused save names its field, and the log says which code (never who, never what they wrote)', async () => {
    const r = await c.api('/verification/experience', { method: 'PUT', body: { yearsExperience: 71 } });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'invalid_years');
    assert.equal(r.field, 'yearsExperience');
    const bad = await c.api('/verification/experience', { method: 'PUT', body: { niche: 'not-a-field' } });
    assert.equal(bad.error, 'invalid_niche');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const logs = srv.logs();
    assert.match(logs, /\[verification\] refused PUT \/api\/verification\/experience invalid_years \(yearsExperience\)/);
    assert.match(logs, /\[verification\] refused PUT \/api\/verification\/experience invalid_niche/);
    assert.doesNotMatch(logs.split('\n').filter((l) => l.includes('[verification] refused')).join('\n'), /nana|example\.com|ფსიქოლოგ/i);
  });

  test('psychology: a diploma or certificate (no licence), with no end date needed; a licence elsewhere still needs one', async () => {
    const v = await c.api('/verification');
    assert.equal(v.regulated, true);
    assert.deepEqual(v.licence, { publicRegister: false, credential: 'diploma' });
    const cfg = await c.api('/config');
    const psych = cfg.niches.find((n) => n.key === 'psychology');
    assert.equal(psych.credential, 'diploma');
    assert.equal(psych.ka, 'ფსიქოლოგია', 'the Georgian name is "ფსიქოლოგია" (migration 046)');
    assert.equal(cfg.niches.find((n) => n.key === 'medicine').credential, undefined);
    const r = await c.api('/verification/license', { method: 'POST', body: { number: 'TSU-2004-118', issuingBody: 'Tbilisi State University', holderName: 'Nana Professor', validUntil: '' } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await c.api('/verification')).inputs.license.validUntil, null);
    // a doctor: a licence, with its end date
    const doc = await signupVerified(srv.base, 'Giorgi Doctor', 'giorgi-doctor@example.com');
    await doc.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    await doc.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Cardiology', niche: 'medicine', yearsExperience: 12 } });
    assert.equal((await doc.api('/verification')).licence.credential, 'licence');
    assert.equal((await doc.api('/verification/license', { method: 'POST', body: { number: 'MD-12345', issuingBody: 'Ministry of Health', holderName: 'Giorgi Doctor', validUntil: '' } })).error, 'invalid_valid_until');
  });
});

describe('the words for a diploma', () => {
  test('a psychology applicant reads "diploma or certificate", never "licence" (English and Georgian)', () => {
    const KEYS = ['ap.lic.title', 'ap.lic.help', 'vt.lic.number', 'vt.lic.body', 'vt.lic.bodyHint', 'vt.lic.holder', 'vt.lic.until', 'vt.lic.save', 'vt.lic.submitted', 'ap.lic.docHelp',
      'apply.f.licenceNote', 'apply.check.licence', 'apply.err.licence', 'ap.missing.license', 'ap.missing.license_document'];
    for (const [l, never, says] of [['en', /licen[cs]e/i, /diploma or certificate/i], ['ka', /ლიცენზ/, /დიპლომ/]]) {
      const d = dict(l);
      for (const k of KEYS) {
        assert.ok(d[`${k}.dip`], `${l} ${k}.dip`);
        assert.doesNotMatch(d[`${k}.dip`], never, `${l} ${k}.dip`);
      }
      assert.match(d['ap.lic.title.dip'], says);
    }
    assert.equal(dict('ka')['niche.psychology'], 'ფსიქოლოგია');
    // the page uses them wherever the field has no licence
    const src = read('public/js/apply.js');
    assert.match(src, /const lic = \(key\) => \(dip\(\) \? t\(key \+ '\.dip'\) : t\(key\)\);/);
    for (const k of ['ap.lic.title', 'vt.lic.number', 'vt.lic.body', 'vt.lic.holder', 'vt.lic.until', 'vt.lic.save', 'ap.lic.docHelp', 'apply.err.licence']) assert.ok(src.includes(`lic('${k}')`), k);
  });
});
