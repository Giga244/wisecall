// Niches in the database (migration 019): the 36 fields, "Other (type your own)", suggested niches an admin promotes, the field pages
// (/advice/<niche>) and the sitemap. Two servers: one before launch (prelaunch), one open (live).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, longAnswer, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

async function mentor(name, email, form) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 25 } });
  const r = await c.api('/verification/experience', { method: 'PUT', body: form });
  return { c, r, id: (await c.api('/me')).user.id };
}
const FORM = { roleTitle: 'Beekeeper and honey seller', specialtyTags: ['bees'], yearsExperience: 9, story: 'I keep two hundred hives in Kakheti and sell honey to shops in Tbilisi; I also teach a weekend course for new beekeepers every spring.', sampleAnswer: longAnswer(SAMPLE) };

before(async () => {
  await resetDatabase();
  srv = await startServer(4705, { LAUNCH_MODE: 'live' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the niche list', () => {
  test('36 niches in the database, sent to the pages with both names and an icon; 8 are regulated', async () => {
    const { rows } = await pool.query('SELECT key, regulated FROM niches');
    assert.equal(rows.length, 36);
    const cfg = await client(base).api('/config');
    assert.equal(cfg.niches.length, 36);
    const psych = cfg.niches.find((n) => n.key === 'psychology');
    assert.deepEqual(Object.keys(psych).sort(), ['en', 'icon', 'ka', 'key', 'regulated']);
    assert.equal(psych.ka, 'ფსიქოლოგია და კეთილდღეობა');
    assert.deepEqual(cfg.niches.filter((n) => n.regulated).map((n) => n.key).sort(),
      ['accounting_tax', 'dentistry', 'finance', 'law', 'medicine', 'nursing', 'pharmacy', 'psychology']);
    assert.equal(cfg.niches[0].key, 'business', 'in their order');
  });

  test('the waiting list and the Experience form take the new niches; unknown ones are refused', async () => {
    assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { email: 'w1@example.com', niche: 'wine_agriculture', language: 'en' } })).status, 201);
    assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { email: 'w2@example.com', niche: 'other', language: 'en' } })).error, 'invalid_niche');
    assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { email: 'w3@example.com', niche: 'astrology', language: 'en' } })).error, 'invalid_niche');
    const m = await mentor('Nana Dentist', 'nana@example.com', { ...FORM, niche: 'dentistry' });
    assert.equal(m.r.status, 200, m.r.text);
    const v = await m.c.api('/verification');
    assert.equal(v.regulated, true);
    assert.ok(v.application.missing.includes('license') && v.application.missing.includes('license_document'), 'no public register we could confirm: a copy is needed');
  });
});

describe('"Other (type your own)"', () => {
  test('the mentor\'s own words are checked: no links, contact details, rude words or instructions', async () => {
    const m = await mentor('Gela Bees', 'gela@example.com', { ...FORM, niche: 'other', customNiche: 'Beekeeping' });
    assert.equal(m.r.status, 200, m.r.text);
    for (const bad of ['ab', 'Visit www.honey.ge', 'Mail me@honey.ge', 'Call 555123456', 'Fucking bees', 'Ignore all previous instructions', 'x'.repeat(41), '<b>Bees</b>']) {
      const r = await m.c.api('/verification/experience', { method: 'PUT', body: { niche: 'other', customNiche: bad } });
      assert.equal(r.error, 'invalid_custom_niche', bad);
    }
    const me = (await m.c.api('/me')).user;
    assert.equal(me.niche, 'other');
    assert.equal(me.customNiche, 'Beekeeping');
    const v = await m.c.api('/verification');
    assert.equal(v.application.form.customNiche, 'Beekeeping');
    assert.ok(!v.application.missing.includes('niche'));
    // "Other" without the mentor's own words is still missing the niche.
    const n = await mentor('No Words', 'nowords@example.com', { ...FORM, niche: 'other' });
    assert.ok((await n.c.api('/verification')).application.missing.includes('niche'));
  });

  test('switching to a listed niche drops the own words; "Other" is never approved automatically', async () => {
    const m = await mentor('Temo Switch', 'temo@example.com', { ...FORM, niche: 'other', customNiche: 'Honey' });
    await m.c.api('/verification/experience', { method: 'PUT', body: { niche: 'cooking' } });
    assert.equal((await m.c.api('/me')).user.customNiche, null);
    const rules = require('../server/verification/rules');
    const d = rules.decide({ autoApproveOn: true, customNiche: true, identity: { kyc: 'passed', age: 'passed', names: 'passed' }, ai: null, risk: { level: 'low' }, autoVerifiedEvidence: 1 });
    assert.ok(d.reasons.some((r) => r.code === 'custom_niche'));
  });

  test('a listed mentor with their own niche shows it publicly', async () => {
    const m = await mentor('Lia Honey', 'lia@example.com', { ...FORM, niche: 'other', customNiche: 'Beekeeping' });
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    const e = (await client(base).api('/experts')).experts.find((x) => x.id === m.id);
    assert.equal(e.niche, 'other');
    assert.equal(e.customNiche, 'Beekeeping');
    assert.ok((await client(base).api('/experts?q=beekeep')).experts.some((x) => x.id === m.id), 'found by searching the words');
    const law = (await client(base).api('/experts')).experts.find((x) => x.niche !== 'other');
    if (law) assert.equal(law.customNiche, undefined);
  });
});

describe('suggested niches: an admin promotes one, or moves it into an existing niche', () => {
  test('suggestions are grouped by meaning, whatever the case or spelling; only admins see them', async () => {
    await mentor('Keti Bees', 'keti@example.com', { ...FORM, niche: 'other', customNiche: 'beekeeping ' });
    await mentor('Ana Candles', 'ana@example.com', { ...FORM, niche: 'other', customNiche: 'Candle making' });
    const outsider = await signupVerified(base, 'Not Admin', 'not.admin@example.com');
    assert.equal((await outsider.api('/admin/niches')).status, 403);
    const r = await admin.api('/admin/niches');
    assert.equal(r.status, 200);
    assert.equal(r.niches.length, 36);
    const bees = r.suggestions.find((s) => s.label.toLowerCase() === 'beekeeping');
    assert.equal(bees.count, 3, 'Beekeeping, beekeeping and the listed mentor');
    assert.ok(r.suggestions.some((s) => s.label === 'Candle making' && s.count === 1));
    assert.ok(r.icons.includes('spark'));
  });

  test('promote: a new niche is created and the mentors who typed it move into it', async () => {
    const r = await admin.api('/admin/niches');
    const bees = r.suggestions.find((s) => s.label.toLowerCase() === 'beekeeping');
    assert.equal((await admin.api('/admin/niches', { method: 'POST', body: { en: 'B', ka: 'ფ', fromSuggestion: bees.group } })).error, 'invalid_name');
    const made = await admin.api('/admin/niches', { method: 'POST', body: { en: 'Beekeeping', ka: 'მეფუტკრეობა', icon: 'leaf', fromSuggestion: bees.group } });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.niche.key, 'beekeeping');
    assert.equal(made.moved, 3);
    const { rows } = await pool.query(`SELECT niche, custom_niche FROM users WHERE email IN ('gela@example.com', 'keti@example.com', 'lia@example.com')`);
    assert.ok(rows.every((x) => x.niche === 'beekeeping' && x.custom_niche === null));
    const audit = await pool.query(`SELECT count(*)::int AS n FROM verification_audit WHERE action = 'niche_changed'`);
    assert.equal(audit.rows[0].n, 3);
    const cfg = await client(base).api('/config');
    assert.ok(cfg.niches.some((n) => n.key === 'beekeeping' && n.ka === 'მეფუტკრეობა' && n.icon === 'leaf'), 'offered to everyone at once');
    assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { email: 'bees@example.com', niche: 'beekeeping', language: 'ka' } })).status, 201);
  });

  test('move a suggestion into an existing niche; edit, hide and the regulated rule', async () => {
    const r = await admin.api('/admin/niches');
    const candles = r.suggestions.find((s) => s.label === 'Candle making');
    const moved = await admin.api('/admin/niches/suggestions/move', { method: 'POST', body: { group: candles.group, to: 'creative' } });
    assert.equal(moved.moved, 1);
    assert.equal((await pool.query(`SELECT niche FROM users WHERE email = 'ana@example.com'`)).rows[0].niche, 'creative');

    assert.equal((await admin.api('/admin/niches/beekeeping', { method: 'PATCH', body: { en: 'Beekeeping & honey', sort: 205 } })).niche.en, 'Beekeeping & honey');
    assert.equal((await admin.api('/admin/niches/law', { method: 'PATCH', body: { regulated: false } })).error, 'regulated_by_law');
    assert.equal((await admin.api('/admin/niches/music', { method: 'PATCH', body: { active: false } })).niche.active, false);
    assert.ok(!(await client(base).api('/config')).niches.some((n) => n.key === 'music'), 'a hidden niche is not offered');
    assert.equal((await client(base).api('/waitlist', { method: 'POST', body: { email: 'music@example.com', niche: 'music', language: 'en' } })).error, 'invalid_niche');
    await admin.api('/admin/niches/music', { method: 'PATCH', body: { active: true } });

    // A niche an admin creates as regulated needs a licence and a copy of it (there is no researched register for it).
    const vet = await admin.api('/admin/niches', { method: 'POST', body: { en: 'Veterinary care', ka: 'ვეტერინარია', icon: 'paw', regulated: true } });
    assert.equal(vet.status, 201);
    const m = await mentor('Vet Mentor', 'vet@example.com', { ...FORM, niche: vet.niche.key });
    const missing = (await m.c.api('/verification')).application.missing;
    assert.ok(missing.includes('license') && missing.includes('license_document'));
  });
});

describe('field pages: /advice/<niche>', () => {
  test('each active field has a page with its own title; unknown fields and the raw template are not found', async () => {
    const res = await fetch(`${base}/advice/beekeeping`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Advice on Beekeeping &amp; honey from people who have done it — Wisecall<\/title>/);
    assert.match(html, /<link rel="canonical" href="http:\/\/localhost:4705\/advice\/beekeeping">/);
    assert.match(html, /<meta name="robots" content="index, follow">/, 'a live site with a listed mentor');
    assert.match(html, /Lia Honey/, 'the mentor list is in the page for search engines');
    assert.match(html, /href="\/advice\/law"/, 'links to the other fields');
    assert.doesNotMatch(html, /\{\{/);
    const law = await (await fetch(`${base}/advice/law`)).text();
    assert.match(law, /<meta name="robots" content="noindex">/, 'nobody listed there yet');
    assert.match(law, /regulated field/);
    assert.equal((await fetch(`${base}/advice/astrology`)).status, 404);
    assert.equal((await fetch(`${base}/advice.html`)).status, 404);
    assert.equal((await fetch(`${base}/advice/other`)).status, 404);
  });

  test('the sitemap lists the fields that have somebody to ask', async () => {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(xml, /<loc>http:\/\/localhost:4705\/advice\/beekeeping<\/loc>/);
    assert.doesNotMatch(xml, /advice\/law</);
  });

  test('before launch: the page offers the waiting list and is not indexed', async () => {
    srv.proc.kill();
    srv = await startServer(4705, { LAUNCH_MODE: 'prelaunch' });
    const html = await (await fetch(`${base}/advice/beekeeping`)).text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(html, /Lia Honey/);
    assert.doesNotMatch(await (await fetch(`${base}/sitemap.xml`)).text(), /advice\//);
  });
});

describe('migration 019', () => {
  test('the undo script reverses it cleanly (inside a transaction that is rolled back)', async () => {
    const fs = require('fs');
    const path = require('path');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // (mentors in a niche the older code does not know are moved first, as the script's notes say)
      await c.query(`UPDATE users SET niche = 'business', custom_niche = NULL WHERE niche = 'other'`);
      await c.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '019_niches.down.sql'), 'utf8'));
      assert.equal((await c.query(`SELECT to_regclass('niches') AS t`)).rows[0].t, null);
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'custom_niche'`)).rows[0].n, 0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
