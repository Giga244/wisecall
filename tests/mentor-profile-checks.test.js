// A mentor application is never sent, or reviewed, with an empty profile (docs/CLAUDE-CODE-SIGNUP-CHECKS.md #2):
//   - the ID check can be started at any time, with nothing filled in, and it never sends the application
//   - "Submit for review" refuses until the story, headline, field and price are there, and lists exactly what is missing (EN and KA)
//   - the admin's review queue lists submitted applications only (a draft, or one opened again with "Edit my application", is not
//     ready), and labels one that lacks the story, headline, field or price: "Profile incomplete: missing ..."
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, longAnswer, SAMPLE, ABOUT } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, mia, miaId;

const FORM = { roleTitle: 'Shop owner', customNiche: 'Running a small shop', niche: 'business', specialtyTags: ['retail'], yearsExperience: 5,
  story: 'I have run a small clothing shop in Kutaisi for five years and moved it online during the pandemic, with a team of three people.', sampleAnswer: longAnswer(SAMPLE) };
const queue = async () => (await admin.api('/admin/mentors?queue=needs_human')).mentors;
const statusOf = async () => (await pool.query('SELECT verification_status, application_submitted_at FROM users WHERE id = $1', [miaId])).rows[0];

before(async () => {
  await resetDatabase();
  srv = await startServer(4746, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  mia = await signupVerified(base, 'Mia Mentor', 'mia@example.com');
  assert.equal((await mia.api('/me', { method: 'PATCH', body: { becomeMentor: true } })).status, 200);
  miaId = (await mia.api('/me')).user.id;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

test('the ID check can be started with nothing filled in, and it never sends the application', async () => {
  const r = await mia.api('/verification/kyc/start', { method: 'POST', body: {} });
  assert.ok(r.status < 300, r.text);
  assert.deepEqual(await statusOf(), { verification_status: 'none', application_submitted_at: null });
  assert.equal((await queue()).length, 0);
});

test('"Submit for review" refuses until the story, headline, field and price are there, and says exactly what is missing', async () => {
  let r = await mia.api('/verification/submit', { method: 'POST' });
  assert.equal(r.error, 'incomplete');
  for (const m of ['field', 'story', 'bio', 'headline', 'price']) assert.ok(r.missing.includes(m), m);
  assert.equal((await mia.api('/verification/experience', { method: 'PUT', body: FORM })).status, 200);
  assert.equal((await mia.api('/verification/evidence', { method: 'POST', body: { kind: 'website', url: 'https://mia-shop.invalid/' } })).status, 200);
  r = await mia.api('/verification/submit', { method: 'POST' });
  assert.deepEqual(r.missing, ['headline', 'bio', 'price'], 'the headline (Profile tab), "შენ შესახებ" (the story under 150 is not enough) and the price (Mentor tab) as well');
  assert.equal((await mia.api('/me', { method: 'PATCH', body: { price: 25 } })).status, 200);
  assert.deepEqual((await mia.api('/verification/submit', { method: 'POST' })).missing, ['headline', 'bio']);
  assert.equal((await mia.api('/verification/experience', { method: 'PUT', body: { about: ABOUT } })).status, 200);
  assert.deepEqual((await mia.api('/verification/submit', { method: 'POST' })).missing, ['headline']);
  assert.equal((await statusOf()).verification_status, 'none', 'still not sent');
  assert.equal((await mia.api('/me', { method: 'PATCH', body: { headline: 'Running a small clothing shop' } })).status, 200);
  assert.equal((await mia.api('/verification/submit', { method: 'POST' })).status, 200);
  assert.equal((await statusOf()).verification_status, 'pending');
  // (in English and Georgian, with a way to the tab where it is filled in)
  const en = json('public/i18n/en.json');
  const ka = json('public/i18n/ka.json');
  for (const k of ['ap.missing.headline', 'ap.missing.headlineLink', 'ap.missing.story', 'ap.missing.bio', 'ap.missing.field', 'ap.missing.price']) {
    assert.ok(en[k] && ka[k] && en[k] !== ka[k], k);
  }
  // (the application page names each missing thing with a link to its step: the headline is step 1)
  assert.match(fs.readFileSync(path.join(ROOT, 'public/js/apply.js'), 'utf8'), /const STEP_OF = \{ headline: 0,/);
});

test('the review queue: submitted applications only; one without a story or headline is labelled "Profile incomplete"', async () => {
  let mine = (await queue()).find((m) => m.id === miaId);
  assert.ok(mine, 'a submitted application is in the queue');
  assert.deepEqual(mine.verification.profileGaps, []);
  // (an application sent before all of these were required: the same row without a story and a headline)
  await pool.query('UPDATE users SET story = NULL, headline = NULL WHERE id = $1', [miaId]);
  mine = (await queue()).find((m) => m.id === miaId);
  assert.deepEqual(mine.verification.profileGaps, ['story', 'headline']);
  const en = json('public/i18n/admin-en.json');
  const ka = json('public/i18n/admin-ka.json');
  assert.equal(en['admin.mv.incomplete'].replace('{missing}', ['story', 'headline'].map((g) => en['admin.mv.gap.' + g]).join(', ')), 'Profile incomplete: missing story, headline');
  for (const k of ['admin.mv.incomplete', 'admin.mv.gap.story', 'admin.mv.gap.headline', 'admin.mv.gap.field', 'admin.mv.gap.price']) assert.ok(ka[k] && ka[k] !== en[k], k);
  assert.match(fs.readFileSync(path.join(ROOT, 'public/js/admin-mentors.js'), 'utf8'), /v\.profileGaps && v\.profileGaps\.length \? `<p class="mv-incomplete" role="note">/);
  // "Edit my application": still 'pending' but a draft again, so out of the queue (still listed with all pending mentors)
  await pool.query(`UPDATE users SET story = $2, headline = 'Running a small clothing shop' WHERE id = $1`, [miaId, FORM.story]);
  assert.equal((await mia.api('/verification/edit', { method: 'POST' })).status, 200);
  assert.deepEqual(await statusOf(), { verification_status: 'pending', application_submitted_at: null });
  assert.equal((await queue()).find((m) => m.id === miaId), undefined, 'a draft is not in the review queue');
  assert.ok((await admin.api('/admin/mentors?status=pending')).mentors.some((m) => m.id === miaId));
});
