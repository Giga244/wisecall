// Public trust badges: earned only by checks that were really passed, dated, and never carrying
// personal data. An expired license stops showing.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, doctor, doctorId, designer, designerId;

const setStep = (id, step, status, extra = '') => pool.query(
  `INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, $3, 'test setup', now())
   ON CONFLICT (user_id, step) DO UPDATE SET status = $3, decided_at = now() ${extra}`, [id, step, status]);
const publicFor = async (id) => (await client(base).api(`/experts/${id}`)).expert;

async function listedMentor(name, email, niche) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  await addPayoutDetails(c);
  return { c, id: await approveMentor(admin, c) };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4582);
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const d = await listedMentor('Levan Kiknadze', 'levan@example.com', 'medicine');
  doctor = d.c; doctorId = d.id;
  const g = await listedMentor('Nino Beridze', 'nino@example.com', 'design');
  designer = g.c; designerId = g.id;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('trust badges', () => {
  test('a Medicine mentor shows ID, license and interview badges, each with its date', async () => {
    const e = await publicFor(doctorId);
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['id', 'interview', 'license']);
    for (const b of e.badges) assert.ok(!Number.isNaN(new Date(b.date).getTime()), `${b.key} has a date`);
  });

  test('a Design mentor shows ID and work email, and no license or interview badge', async () => {
    const e = await publicFor(designerId);
    assert.deepEqual(e.badges.map((b) => b.key).sort(), ['id', 'workEmail']);
  });

  test('the listing carries the same badges', async () => {
    const list = (await client(base).api('/experts')).experts;
    assert.deepEqual(list.find((x) => x.id === doctorId).badges.map((b) => b.key).sort(), ['id', 'interview', 'license']);
    assert.deepEqual(list.find((x) => x.id === designerId).badges.map((b) => b.key).sort(), ['id', 'workEmail']);
  });

  test('only a passed check earns a badge: pending and failed ones show nothing', async () => {
    await setStep(designerId, 'work_email', 'pending');
    assert.deepEqual((await publicFor(designerId)).badges.map((b) => b.key), ['id']);
    await setStep(designerId, 'id_kyc', 'failed');
    assert.deepEqual((await publicFor(designerId)).badges, []);
    await setStep(designerId, 'id_kyc', 'passed');
    await setStep(designerId, 'work_email', 'passed');
  });

  test('an expired license loses its badge', async () => {
    await pool.query(`UPDATE verification_steps SET expires_at = now() + interval '90 days' WHERE user_id = $1 AND step = 'license'`, [doctorId]);
    assert.ok((await publicFor(doctorId)).badges.some((b) => b.key === 'license'));
    await pool.query(`UPDATE verification_steps SET expires_at = now() - interval '1 day' WHERE user_id = $1 AND step = 'license'`, [doctorId]);
    assert.ok(!(await publicFor(doctorId)).badges.some((b) => b.key === 'license'), 'the badge is hidden after expiry');
    assert.ok((await publicFor(doctorId)).badges.some((b) => b.key === 'id'), 'other badges stay');
  });

  test('nothing personal is ever in the public data', async () => {
    await pool.query(`INSERT INTO mentor_credentials (user_id, license_number_enc, license_last4, issuing_body, holder_name, valid_until)
                      VALUES ($1, 'v1:x:y:z', '2291', 'Ministry of Health', 'Levan Kiknadze', '2030-01-01') ON CONFLICT DO NOTHING`, [doctorId]);
    const dump = JSON.stringify([(await client(base).api(`/experts/${doctorId}`)).text, (await client(base).api('/experts')).text]);
    assert.doesNotMatch(dump, /2291|Ministry of Health|license_number|workEmail":"|levan@example|1990|date_of_birth|birth/i);
    for (const b of (await publicFor(doctorId)).badges) assert.deepEqual(Object.keys(b).sort(), ['date', 'key']);
  });
});

describe('the public pages explain verification', () => {
  test('the home page has the "How we verify mentors" section and About and Privacy describe it (EN and KA)', async () => {
    const home = await fetch(`${base}/`).then((r) => r.text());
    assert.match(home, /id="verify"/);
    assert.match(home, /data-i18n="hv\.title"/);
    for (const lang of ['en', 'ka']) {
      const dict = await fetch(`${base}/i18n/${lang}.json`).then((r) => r.json());
      const privacy = dict['legal.privacy.sections'].map((s) => `${s.h} ${s.p.join(' ')}`).join(' ');
      assert.match(privacy, /Didit/, `${lang}: names the ID provider`);
      assert.match(privacy, /90/, `${lang}: says how long documents are kept`);
      assert.ok(dict['legal.about.sections'].some((s) => s.p.join(' ').length > 300), `${lang}: about explains the checks`);
      for (const k of ['badge.id', 'badge.license', 'badge.workEmail', 'badge.interview', 'badge.id.tip', 'hv.title', 'hv.5.body']) assert.ok(dict[k], `${lang} has ${k}`);
    }
  });
});
