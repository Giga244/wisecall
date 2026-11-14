// The 29 fields, chips, specializations and the one search box (docs/CLAUDE-CODE-CATEGORIES.md, docs/PLAN-CATEGORIES.md).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, SAMPLE, longQuestion } = require('./helpers');
const categories = require('../server/categories');
const search = require('../server/categorySearch');
const { REGULATED } = require('../server/verification/registries');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

describe('the list', () => {
  test('29 fields (13 added by docs/CLAUDE-CODE-NEW-CATEGORIES.md), with stable ids, KA and EN names, and "Other" in every field; "Services & Other" last', () => {
    assert.equal(categories.FIELDS.length, 29);
    assert.equal(categories.FIELDS[categories.FIELDS.length - 1].id, 'svc');
    const ids = new Set();
    for (const f of categories.FIELD.values()) {
      assert.ok(f.ka && f.en && f.icon && f.niche, f.id);
      assert.ok(f.chips.some((c) => c.other), `${f.id}: Other`);
      for (const c of f.chips) {
        assert.match(c.id, new RegExp(`^${f.id}\\.[a-z0-9_]+$`));
        assert.ok(c.ka && c.en, c.id);
        assert.ok(!ids.has(c.id), `${c.id} twice`);
        ids.add(c.id);
      }
    }
    assert.ok(categories.isChip('med.cardiology') && categories.isChip('edu.ielts') && categories.isChip('abroad.germany'));
    assert.equal(categories.FIELD.get('med').chips.filter((c) => !c.other).length, 22);
  });

  test('every field and chip counts as a niche that exists, and licensed work stays licensed', () => {
    const migrations = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8')).join('\n');
    for (const x of [...categories.FIELD.values(), ...categories.CHIP.values()]) {
      if (x.niche === 'other') continue;
      assert.ok(migrations.includes(`'${x.niche}'`), `${x.id} -> ${x.niche}`);
    }
    // (all of medicine, law and psychology's clinical chips count as a regulated niche)
    const licensed = (n) => Boolean(REGULATED[n]) && !REGULATED[n].note;
    for (const c of categories.FIELD.get('med').chips) assert.ok(licensed(c.niche), `${c.id} -> ${c.niche}`);
    // (vets and nutritionists: their own licence type, still regulated)
    assert.equal(categories.CHIP.get('med.veterinary').niche, 'veterinary');
    assert.equal(categories.CHIP.get('med.nutrition').niche, 'nutrition');
    for (const n of ['veterinary', 'nutrition']) assert.equal(REGULATED[n].credential, 'diploma', n);
    for (const c of categories.FIELD.get('law').chips) assert.equal(c.niche, 'law', c.id);
    for (const id of ['psy.clinical', 'psy.child', 'psy.organizational', 'psy.therapy_study']) assert.equal(categories.CHIP.get(id).niche, 'psychology', id);
    for (const id of ['fin.accounting', 'fin.tax', 'fin.acca']) assert.equal(categories.CHIP.get(id).niche, 'accounting_tax', id);
    assert.equal(categories.CHIP.get('sport.medicine').niche, 'medicine');
    assert.equal(categories.CHIP.get('eng.architecture').niche, 'architecture');
  });

  test('every old category names a field and chip that exist', () => {
    for (const [niche, [fieldId, chip]] of Object.entries(categories.FROM_NICHE)) {
      assert.ok(categories.isField(fieldId), niche);
      if (chip) { assert.ok(categories.isChip(chip), niche); assert.equal(categories.fieldOfChip(chip), fieldId, niche); }
    }
  });

  test('a regulated chip decides the niche, whatever else is chosen', () => {
    assert.equal(categories.nicheFor('fin', ['fin.economics']), 'business');
    assert.equal(categories.nicheFor('fin', ['fin.economics', 'fin.investments']), 'finance');
    assert.equal(categories.nicheFor('sport', ['sport.fitness', 'sport.medicine']), 'medicine');
    assert.equal(categories.nicheFor('med', ['med.dentistry']), 'dentistry');
    assert.equal(categories.nicheFor('med', []), 'medicine');
    assert.equal(categories.nicheFor('it', ['biz.hr']), 'tech', 'a chip of another field does not count');
  });

  test('specializations: trimmed, duplicates merged in any case, at most 5 of 30 characters, no links', () => {
    assert.deepEqual(categories.cleanSpecializations(' React , react,  საოჯახო   სამართალი '), ['React', 'საოჯახო სამართალი']);
    assert.equal(categories.cleanSpecializations('a,b,c,d,e,f'), null);
    assert.equal(categories.cleanSpecializations('x'.repeat(31)), null);
    assert.deepEqual(categories.cleanSpecializations('კ'.repeat(30)), ['კ'.repeat(30)], 'letters, not bytes');
    assert.equal(categories.cleanSpecializations('https://x.ge'), null);
  });
});

describe('finding words in the list', () => {
  const chips = (q) => search.matchCatalog(q).chips;
  test('Georgian, English, part of a word, and Georgian in Latin letters', () => {
    assert.ok(chips('სტომატ').includes('med.dentistry'));
    assert.ok(chips('IELTS').includes('edu.ielts'));
    assert.ok(chips('ielts').includes('edu.ielts'));
    assert.ok(chips('react').includes('it.frontend'));
    assert.ok(chips('გერმანია').includes('abroad.germany'));
    assert.ok(search.matchCatalog('გერმანია').countries.includes('de'));
    assert.ok(search.matchCatalog('germany').countries.includes('de'));
    assert.ok(chips('stomat').includes('med.dentistry'));
    assert.ok(chips('cardiology').includes('med.cardiology'));
  });
  test('typos in longer words, not in short ones', () => {
    assert.ok(chips('კარდილოგია').includes('med.cardiology'));
    assert.ok(chips('cardiolgy').includes('med.cardiology'));
    assert.ok(chips('stomatologi').includes('med.dentistry'));
    assert.ok(chips('dermatolgy').includes('med.dermatology'));
    assert.deepEqual(chips('sqt').filter((c) => c === 'edu.sat'), [], 'three letters must match exactly');
    assert.deepEqual(search.matchCatalog('xyzzyq'), { fields: [], chips: [], countries: [] });
  });
  test('a university by any of its names', () => {
    const u = { university: 'თბილისის სახელმწიფო უნივერსიტეტი' };
    assert.ok(search.mentorMatches('თსუ', u));
    assert.ok(search.mentorMatches('TSU', u));
    assert.ok(search.mentorMatches('თბილისის სახელმწიფო', u));
    assert.ok(search.mentorMatches('თსუ', { university: 'თსუ, მედიცინის ფაკულტეტი' }));
    assert.ok(!search.mentorMatches('სტუ', u));
  });
  test('a specialization, also with a typo', () => {
    const u = { specialtyTags: ['კარდიოქირურგია', 'React'] };
    assert.ok(search.mentorMatches('react', u));
    assert.ok(search.mentorMatches('კარდიოქირურგა', u));
    assert.ok(!search.mentorMatches('vue', u));
  });
});

describe('on the running site', () => {
  async function mentor(name, email, body, price = 20) {
    const c = await signupVerified(base, name, email);
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Expert', price, proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
    const r = await c.api('/verification/experience', { method: 'PUT', body: { customNiche: name, yearsExperience: 4, ...body } });
    assert.equal(r.status, 200, r.text);
    await approveMentor(admin, c);
    if (price) await addPayoutDetails(c);
    return { c, id: (await c.api('/me')).user.id };
  }
  const experts = async (qs) => (await client(base).api('/experts?' + qs)).experts.map((e) => e.name);
  let dentist, coder;
  before(async () => {
    await resetDatabase();
    srv = await startServer(4795, { RATE_LIMIT_MULTIPLIER: '50', PLAUSIBLE_DOMAIN: '' });
    base = srv.base;
    admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    dentist = await mentor('Dali Dentist', 'dali@example.com', { fieldId: 'med', directions: ['med.dentistry'], specialtyTags: ['იმპლანტოლოგია'], university: 'თბილისის სახელმწიფო სამედიცინო უნივერსიტეტი', country: 'ge', currentRole: 'რეზიდენტი, სტომატოლოგია', yearsExperience: 8, practiceKind: 'practitioner' });
    coder = await mentor('Coco Coder', 'coco@example.com', { fieldId: 'it', extraFields: ['abroad'], directions: ['it.frontend', 'abroad.germany'], specialtyTags: ['React'], university: 'თსუ', country: 'de', yearsExperience: 2 }, 0);
  });
  after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

  const pick = (c, body) => c.api('/verification/experience', { method: 'PUT', body });
  describe('a mentor picks', () => {
    let m;
    before(async () => {
      m = await signupVerified(base, 'Picky Mentor', 'picky@example.com');
      await m.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    });
    test('a main field, up to 2 more, up to 5 chips in them, tags and experience; the limits hold', async () => {
      const ok = await pick(m, { customNiche: 'Marketing and HR', fieldId: 'biz', extraFields: ['media', 'it'], directions: ['biz.marketing', 'biz.hr', 'media.pr', 'it.product', 'biz.other'], directionOther: { biz: 'ბრენდინგი' },
        specialtyTags: ['SEO', 'seo', 'Ads'], university: 'ბთუ', country: 'ge', currentRole: 'Head of marketing' });
      assert.equal(ok.status, 200, ok.text);
      const { rows: [r] } = await pool.query(`SELECT * FROM users WHERE email = 'picky@example.com'`);
      assert.equal(r.field_id, 'biz');
      assert.deepEqual(r.extra_fields, ['media', 'it']);
      assert.equal(r.directions.length, 5);
      assert.deepEqual(r.direction_other, { biz: 'ბრენდინგი' });
      assert.deepEqual(r.specialty_tags, ['SEO', 'Ads'], 'merged');
      assert.equal(r.university, 'ბთუ');
      assert.equal(r.country, 'ge');
      assert.equal(r.current_work, 'Head of marketing');
      assert.equal(r.niche, 'marketing', 'the niche follows the first chip');

      const err = async (body) => (await pick(m, body)).error;
      assert.equal(await err({ fieldId: 'nope' }), 'invalid_field_id');
      assert.equal(await err({ extraFields: ['it', 'law', 'sci'] }), 'too_many_fields');
      assert.equal(await err({ directions: ['biz.hr', 'biz.sales', 'biz.projects', 'biz.logistics', 'biz.startups', 'biz.consulting'] }), 'too_many_directions');
      assert.equal(await err({ directions: ['biz.nope'] }), 'invalid_direction');
      assert.equal(await err({ specialtyTags: 'a,b,c,d,e,f' }), 'invalid_tags');
      assert.equal(await err({ specialtyTags: 'x'.repeat(31) }), 'invalid_tags');
      assert.equal(await err({ country: 'mars' }), 'invalid_country');
      assert.equal(await err({ university: 'https://example.org' }), 'invalid_university');
      assert.equal(await err({ directionOther: { biz: 'www.example.org' } }), 'invalid_custom_niche');
    });
    test('a chip of a field not chosen is dropped', async () => {
      const r = await pick(m, { fieldId: 'biz', extraFields: [], directions: ['biz.hr', 'law.family'] });
      assert.equal(r.status, 200, r.text);
      const { rows: [u] } = await pool.query(`SELECT directions, extra_niches FROM users WHERE email = 'picky@example.com'`);
      assert.deepEqual(u.directions, ['biz.hr']);
      assert.deepEqual(u.extra_niches, []);
    });
    test('licensed work stays licensed: a regulated chip asks for the licence; the words still move a non-regulated choice', async () => {
      const r = await pick(m, { customNiche: 'Teeth', fieldId: 'med', extraFields: [], directions: ['med.dentistry'] });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.user.niche, 'dentistry');
      assert.ok((await m.api('/verification')).regulated, 'the licence step applies');
      const forced = await pick(m, { customNiche: 'Cardiologist', fieldId: 'biz', directions: [] });
      assert.equal(forced.status, 200, forced.text);
      assert.equal(forced.user.niche, 'medicine', 'the word check still runs');
      assert.equal(forced.user.fieldId, 'med', 'and students find them there');
      assert.ok(forced.user.extraFields.includes('biz'));
    });
    test('a vet and a nutritionist: their own category, still regulated, and the admin accepts their own document (no end date), not a doctor\'s licence', async () => {
      for (const [chip, niche, words] of [['med.veterinary', 'veterinary', 'ვეტერინარი ექიმი'], ['med.nutrition', 'nutrition', 'ექიმი-დიეტოლოგი']]) {
        const c = await signupVerified(base, `Own Licence ${niche}`, `own-${niche}@example.com`);
        await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
        const r = await pick(c, { customNiche: words, fieldId: 'med', directions: [chip] });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.user.niche, niche, 'the words do not move it to medicine');
        const v = await c.api('/verification');
        assert.ok(v.regulated, 'never approved automatically');
        // their own diploma, certificate or licence, with no end date needed (a doctor's state certificate needs one)
        const lic = await c.api('/verification/license', { method: 'POST', body: { number: 'VET-12345', issuingBody: 'Agricultural University of Georgia' } });
        assert.equal(lic.status, 200, lic.text);
        const id = (await c.api('/me')).user.id;
        const ok = await admin.api(`/admin/mentors/${id}/steps/license`, { method: 'POST', body: { decision: 'passed', reason: 'Diploma checked by hand' } });
        assert.equal(ok.status, 200, ok.text);
        assert.equal((await pool.query(`SELECT status FROM verification_steps WHERE user_id = $1 AND step = 'license'`, [id])).rows[0].status, 'passed');
      }
      // (a doctor still needs the end date of their state certificate)
      const doc = await signupVerified(base, 'Real Doctor', 'real-doctor@example.com');
      await doc.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
      await pick(doc, { customNiche: 'Cardiologist', fieldId: 'med', directions: ['med.cardiology'] });
      assert.notEqual((await doc.api('/verification/license', { method: 'POST', body: { number: 'MD-12345', issuingBody: 'RAMA' } })).status, 200);
    });
    test('a regulated extra field is refused unless they mainly teach, as before', async () => {
      const r = await pick(m, { customNiche: 'Coaching', fieldId: 'biz', extraFields: ['law'], directions: [] });
      assert.equal(r.error, 'extra_regulated');
      const a = await pick(m, { customNiche: 'Coaching', fieldId: 'biz', extraFields: ['law'], directions: [], practiceKind: 'academic' });
      assert.equal(a.status, 200, a.text);
      assert.deepEqual(a.user.extraNiches, ['law']);
      await pick(m, { fieldId: 'biz', extraFields: [], directions: [], practiceKind: null });
    });
    test('the old way of saving a category still works, and the field follows it', async () => {
      const c = await signupVerified(base, 'Old Page', 'old-page@example.com');
      await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
      const r = await pick(c, { customNiche: 'Accounting help', niche: 'accounting_tax' });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.user.fieldId, 'fin');
      assert.deepEqual(r.user.directions, ['fin.accounting']);
    });
  });

  describe('a student finds', () => {
    test('by Georgian, English, a typo, a university and a country', async () => {
      assert.deepEqual(await experts('q=' + encodeURIComponent('სტომატ')), ['Dali Dentist']);
      assert.deepEqual(await experts('q=dentistry'), ['Dali Dentist']);
      assert.deepEqual(await experts('q=' + encodeURIComponent('სტომატოლოგა')), ['Dali Dentist'], 'a typo');
      assert.deepEqual(await experts('q=react'), ['Coco Coder']);
      assert.deepEqual(await experts('q=' + encodeURIComponent('გერმანია')), ['Coco Coder'], 'the country and the chip');
      assert.deepEqual(await experts('q=' + encodeURIComponent('თსუ')), ['Coco Coder'], 'თსუ is not the medical university');
      assert.deepEqual(await experts('q=TSU'), ['Coco Coder']);
      assert.deepEqual(await experts('q=' + encodeURIComponent('თსსუ')), ['Dali Dentist']);
      assert.deepEqual(await experts('q=' + encodeURIComponent('იმპლანტოლოგია')), ['Dali Dentist'], 'a specialization');
      assert.deepEqual(await experts('q=Dali'), ['Dali Dentist'], 'names still work');
      assert.deepEqual(await experts('q=zzzzzz'), []);
    });
    test('by the filters, all optional', async () => {
      assert.deepEqual(await experts('field=med'), ['Dali Dentist']);
      assert.deepEqual(await experts('field=abroad'), ['Coco Coder'], 'an extra field counts');
      assert.deepEqual(await experts('chip=abroad.germany'), ['Coco Coder']);
      assert.deepEqual(await experts('price=free'), ['Coco Coder']);
      assert.deepEqual(await experts('price=paid'), ['Dali Dentist']);
      assert.deepEqual(await experts('country=ge'), ['Dali Dentist']);
      assert.deepEqual(await experts('years=6-10'), ['Dali Dentist']);
      assert.deepEqual(await experts('years=1-2'), ['Coco Coder']);
      assert.deepEqual(await experts('field=med&country=de'), []);
      assert.equal((await experts('field=nope')).length, 2, 'an unknown value is ignored');
    });
    test('counts: only what has mentors has a count, the keywords stay on the server, and an empty field is 0', async () => {
      const c = await client(base).api('/categories');
      const f = (id) => c.fields.find((x) => x.id === id);
      assert.equal(f('med').count, 1);
      assert.equal(f('abroad').count, 1);
      assert.equal(f('sport').count, 0);
      assert.equal(f('med').chips.find((x) => x.id === 'med.dentistry').count, 1);
      assert.equal(f('med').chips.find((x) => x.id === 'med.surgery').count, 0);
      assert.doesNotMatch(JSON.stringify(c), /keywords|kbili|კბილი/);
      const s = await client(base).api('/categories/search?q=' + encodeURIComponent('სტომატ'));
      assert.deepEqual(s.chips.map((x) => [x.id, x.count]), [['med.dentistry', 1]]);
    });
    test('the empty field\'s notify list: one email for that field, told when a mentor there is listed', async () => {
      const r = await client(base).api('/waitlist', { method: 'POST', body: { over16: true, email: 'wait-sport@example.com', niche: 'sport', language: 'ka' } });
      assert.equal(r.status, 201, r.text);
      assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { over16: true, email: 'wait-x@example.com', niche: 'nope' } })).error, 'invalid_niche');
      const row = async () => (await pool.query(`SELECT niche, notified_at FROM waitlist WHERE email = 'wait-sport@example.com'`)).rows[0];
      assert.equal((await row()).niche, 'sport');
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      const { rows } = await pool.query(`SELECT 1 FROM waitlist WHERE notified_at IS NULL AND niche = ANY($1::text[])`, [['sport']]);
      assert.equal(rows.length, 1);
    });
  });

  describe('a question', () => {
    test('keeps the chip it was asked in; anything else is not kept; the admins see the demand', async () => {
      const asker = await signupVerified(base, 'Asker Ana', 'asker-ana@example.com');
      const q = await asker.api('/bookings', { method: 'POST', body: { mentorId: coder.id, question: longQuestion('How do I start with React before university?'), directionId: 'it.frontend' } });
      assert.equal(q.status, 201, q.text);
      assert.equal((await pool.query('SELECT direction_id FROM bookings WHERE id = $1', [q.booking.id])).rows[0].direction_id, 'it.frontend');
      const bad = await asker.api('/bookings', { method: 'POST', body: { mentorId: dentist.id, question: longQuestion('Which dental faculty should I choose in Tbilisi?'), directionId: 'nope' } });
      assert.equal(bad.status, 201, bad.text);
      assert.equal((await pool.query('SELECT direction_id FROM bookings WHERE id = $1', [bad.booking.id])).rows[0].direction_id, null);
      const d = await admin.api('/admin/categories');
      assert.deepEqual(d.questions.find((x) => x.id === 'it.frontend'), { id: 'it.frontend', n: 1 });
      assert.equal((await asker.api('/admin/categories')).status, 403);
    });
  });

  describe('existing mentors', () => {
    test('are mapped without losing anything, and who cannot be mapped is shown to the admins and stays listed', async () => {
      const add = async (name, email, niche, extra = [], words = null, tags = []) => {
        const c = await signupVerified(base, name, email);
        await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Expert', price: 0, proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
        await c.api('/verification/experience', { method: 'PUT', body: { customNiche: words || 'Old words', yearsExperience: 6, specialtyTags: tags } });
        await approveMentor(admin, c);
        // (as it was before this change: the old columns only)
        await pool.query(`UPDATE users SET niche = $2, extra_niches = $3, field_id = NULL, extra_fields = '{}', directions = '{}', custom_niche = $4, verification_status = 'verified' WHERE email = $1`, [email, niche, extra, words]);
      };
      await add('Old Dentist', 'old-dentist@example.com', 'dentistry', ['teaching'], 'კბილები', ['a', 'b']);
      await add('Old Hr', 'old-hr@example.com', 'careers_hr', [], 'კარიერა');
      await add('Old Bees', 'old-bees@example.com', 'other', [], 'ვენახის მოვლა');
      await add('Old Odd', 'old-odd@example.com', 'other', [], 'qqqq wwww');
      const before_ = (await pool.query(`SELECT email, niche, extra_niches, custom_niche, specialty_tags, verification_status FROM users WHERE email LIKE 'old-%' ORDER BY email`)).rows;

      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      const again = await startServer(4796, { RATE_LIMIT_MULTIPLIER: '50' }); // (the mapping runs at start)
      try {
        const row = async (email) => (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
        const d = await row('old-dentist@example.com');
        assert.equal(d.field_id, 'med');
        assert.deepEqual(d.directions, ['med.dentistry']);
        assert.deepEqual(d.extra_fields, ['edu']);
        const h = await row('old-hr@example.com');
        assert.equal(h.field_id, 'biz');
        assert.deepEqual(h.directions, ['biz.hr']);
        assert.equal((await row('old-bees@example.com')).field_id, 'svc', 'from their own words');
        assert.equal((await row('old-odd@example.com')).field_id, null);
        // nothing else changed
        assert.deepEqual((await pool.query(`SELECT email, niche, extra_niches, custom_niche, specialty_tags, verification_status FROM users WHERE email LIKE 'old-%' ORDER BY email`)).rows, before_);
        // the admins see who could not be mapped; they stay listed and findable
        const a2 = client(again.base);
        await a2.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: 'test-pass-12345' } });
        const list = (await a2.api('/admin/categories')).unmapped.map((m) => m.email);
        assert.deepEqual(list.filter((e) => e.startsWith('old-')), ['old-odd@example.com']);
        const shown = (await client(again.base).api('/experts')).experts.map((e) => e.name);
        assert.ok(shown.includes('Old Odd'));
        assert.deepEqual((await client(again.base).api('/experts?q=qqqq')).experts.map((e) => e.name), ['Old Odd']);
      } finally { again.proc.kill(); }
    });
  });
});

// docs/CLAUDE-CODE-NEW-CATEGORIES.md: 14 categories in KA and EN. Politics & IR and Veterinary already were niches; the others are new.
describe('the new categories', () => {
  const NEW = { econ: 'economics', social: 'social_sciences', hum: 'humanities', avia: 'aviation', sea: 'maritime', vet: 'veterinary', public: 'public_service',
    security: 'security_defense', logistics: 'logistics', beauty: 'beauty', fashion: 'fashion', perform: 'performing_arts', allied: 'allied_health' };
  test('each is a field with Georgian and English names, its own niche, a few directions and "Other"; Politics & IR is the field it already was', () => {
    for (const [id, niche] of Object.entries(NEW)) {
      const f = categories.FIELD.get(id);
      assert.ok(f, id);
      assert.equal(f.niche, niche, id);
      assert.match(f.ka, /[ა-ჰ]/, `${id} in Georgian`);
      assert.match(f.en, /[A-Za-z]/, `${id} in English`);
      assert.ok(f.chips.filter((c) => !c.other).length >= 5, `${id}: directions`);
      assert.ok(f.chips[f.chips.length - 1].other, `${id}: "Other" last`);
    }
    assert.equal(categories.FIELD.get('pol').ka, 'პოლიტიკა და საერთაშორისო ურთიერთობები');
    assert.equal(categories.FIELD.get('econ').ka, 'ეკონომიკა');
    assert.equal(categories.FIELD.get('allied').en, 'Allied Health');
  });

  test('aviation, maritime and allied health are regulated, with the same licence check as the others; veterinary still is', () => {
    for (const n of ['aviation', 'maritime', 'allied_health', 'veterinary']) {
      assert.ok(REGULATED[n], n);
      assert.equal(REGULATED[n].publicRegister, false, `${n}: a person checks the document`);
    }
    assert.equal(REGULATED.allied_health.credential, 'diploma');
    assert.equal(categories.nicheFor('avia', ['avia.pilot']), 'aviation');
    assert.equal(categories.nicheFor('sea', []), 'maritime');
    assert.equal(categories.nicheFor('allied', ['allied.physio']), 'allied_health');
    // (the work in these fields that is not licensed counts as it did before)
    assert.equal(categories.nicheFor('avia', ['avia.airport']), 'business');
    assert.equal(categories.nicheFor('sea', ['sea.port']), 'logistics');
  });

  test('a direction that moved to a new field is no longer offered where it was, but stays valid with the niche it had (nobody\'s rules change)', () => {
    assert.equal(Object.keys(categories.MOVED).length, 18);
    for (const [old, now] of Object.entries(categories.MOVED)) {
      assert.ok(categories.isChip(old), `${old} stays valid`);
      assert.ok(categories.isChip(now), `${now} exists`);
      assert.equal(categories.CHIP.get(old).moved, now, old);
    }
    assert.equal(categories.CHIP.get('eng.aviation').niche, 'engineering', 'an engineer who chose aviation stays an engineer');
    assert.equal(categories.CHIP.get('med.physio').niche, 'medicine');
    assert.equal(categories.CHIP.get('svc.military').niche, 'other');
    const client = categories.forClient();
    const med = client.fields.find((f) => f.id === 'med');
    assert.equal(med.chips.find((c) => c.id === 'med.veterinary').moved, 'vet.pets', 'the pages know to leave it out of the choices');
    assert.equal(client.fields.length, 29);
    const apply = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'apply.js'), 'utf8');
    assert.match(apply, /x\.chips\.filter\(\(c\) => !c\.moved \|\| pick\.directions\.includes\(c\.id\)\)/);
    assert.match(apply, /data-pick-search/, 'the apply form has a box to find a field among 29');
  });
});
