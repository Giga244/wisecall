// Mentors edit their details and price; an admin changes a price (docs/CLAUDE-CODE-MENTOR-EDIT.md, docs/PLAN-MENTOR-EDIT.md): the admin's change
// needs a reason, is logged and emailed; questions already asked keep their price; free details save at once; a field change of an approved mentor
// waits for an admin (the live profile stays as it was), and a licensed field needs its licence; the ID check's name and birth date are not editable.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, addPayoutDetails, approveMentor, bookAndPay, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const resend = createFakeResend();
let srv, base, admin, seeker;

async function makeMentor(name, email, price, { approve = true, language = 'ka' } = {}) {
  const c = await signupByEmail(resend, base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Career coach', niche: 'business', price, language, proofUrl: 'https://linkedin.com/in/' + email.split('@')[0], sampleAnswer: SAMPLE } });
  if (approve) { await approveMentor(admin, c); if (price > 0) await addPayoutDetails(c); }
  return { c, id: (await c.api('/me')).user.id };
}
const listed = async (id) => (await client(base).api('/experts')).experts.find((e) => e.id === id);
const userRow = async (id) => (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];

before(async () => {
  await resetDatabase();
  await resend.start();
  srv = await startServer(4811, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', RATE_LIMIT_MULTIPLIER: '30' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupByEmail(resend, base, 'Sam Seeker', 'seeker@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('the admin changes a price', () => {
  let m;
  before(async () => { m = await makeMentor('Nino Price', 'nino-price@example.com', 40); });

  test('a reason is required, the limits are the mentor\'s, and the same price is refused', async () => {
    const url = `/admin/mentors/${m.id}/price`;
    assert.equal((await admin.api(url, { method: 'POST', body: { price: 25 } })).error, 'reason_required');
    assert.equal((await admin.api(url, { method: 'POST', body: { price: 25, reason: '  ' } })).error, 'reason_required');
    for (const price of [3, 2001, -1, '', 'x', 2.5]) assert.equal((await admin.api(url, { method: 'POST', body: { price, reason: 'მენტორმა ითხოვა მეილით, 02.11' } })).error, 'invalid_price', String(price));
    assert.equal((await admin.api(url, { method: 'POST', body: { price: 40, reason: 'მენტორმა ითხოვა მეილით, 02.11' } })).error, 'same_price');
    assert.equal((await userRow(m.id)).price, 40);
    // (and only an admin)
    assert.equal((await m.c.api(url, { method: 'POST', body: { price: 25, reason: 'I want a lower price' } })).status, 403);
  });

  test('questions already asked keep their price; the change is logged with the admin, both prices and the reason, and the mentor is emailed', async () => {
    const booking = await bookAndPay(base, seeker, m.id, 'How do I prepare a business plan for a small bakery in Kutaisi?');
    const r = await admin.api(`/admin/mentors/${m.id}/price`, { method: 'POST', body: { price: 25, reason: 'მენტორმა ითხოვა მეილით, 02.11' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.price, 25);
    assert.equal((await userRow(m.id)).price, 25);
    assert.equal(Number((await pool.query('SELECT amount FROM bookings WHERE id = $1', [booking.id || booking])).rows[0].amount), 4000, 'the question asked before keeps 40 ₾ (in tetri)');
    const log = (await pool.query('SELECT * FROM price_changes WHERE user_id = $1 ORDER BY created_at DESC', [m.id])).rows[0];
    assert.equal(log.old_price, 40);
    assert.equal(log.new_price, 25);
    assert.equal(log.source, 'admin');
    assert.equal(log.by_label, 'qa-admin@example.com');
    assert.equal(log.reason, 'მენტორმა ითხოვა მეილით, 02.11');
    assert.ok(log.created_at);
    const mail = await resend.waitFor('nino-price@example.com', 'ფასი');
    assert.match(mail.body.html, /თქვენი ფასი შეიცვალა: 40 ₾ → 25 ₾\. თუ ეს თქვენ არ გითხოვიათ, მოგვწერეთ\./);
    // (the history on the admin's mentor page)
    const detail = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.deepEqual(detail.priceHistory.map((h) => [h.from, h.to, h.source]).slice(0, 1), [[40, 25, 'admin']]);
    assert.equal(detail.priceHistory[0].reason, 'მენტორმა ითხოვა მეილით, 02.11');
  });

  test('0 is always allowed: Browse shows the mentor as free, and the email says "უფასოდ"', async () => {
    const already = resend.to('nino-price@example.com', 'ფასი').length;
    const r = await admin.api(`/admin/mentors/${m.id}/price`, { method: 'POST', body: { price: 0, reason: 'მენტორმა ითხოვა მეილით, 02.11' } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await listed(m.id)).price, 0);
    const mail = await resend.waitForNew('nino-price@example.com', 'ფასი', already);
    assert.match(mail.body.html, /25 ₾ → უფასოდ/);
  });

  test('a free mentor without payout details who is given a price stays in Browse: a bank account is asked for only at a withdrawal', async () => {
    const f = await makeMentor('Free Fiona', 'fiona-price@example.com', 0);
    assert.ok(await listed(f.id));
    const r = await admin.api(`/admin/mentors/${f.id}/price`, { method: 'POST', body: { price: 20, reason: 'Asked by phone, 02.11' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.payoutNeeded, undefined);
    assert.ok(await listed(f.id), 'still listed, with the price');
  });
});

describe('the mentor changes their own price', () => {
  test('free and paid again; each change is in the same history, which the mentor sees without the admin\'s address', async () => {
    const m = await makeMentor('Dato Own', 'dato-own@example.com', 30);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { price: 0 } })).user.price, 0);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { price: 30 } })).user.price, 30);
    const rows = (await pool.query(`SELECT old_price, new_price, source FROM price_changes WHERE user_id = $1 AND source = 'mentor' ORDER BY created_at`, [m.id])).rows;
    assert.deepEqual(rows.slice(-2).map((x) => [x.old_price, x.new_price]), [[30, 0], [0, 30]]);
    await admin.api(`/admin/mentors/${m.id}/price`, { method: 'POST', body: { price: 35, reason: 'Asked by email, 02.11' } });
    const mine = await m.c.api('/me/details');
    assert.equal(mine.price, 35);
    assert.deepEqual(mine.priceHistory.slice(0, 3).map((h) => [h.from, h.to, h.source]), [[30, 35, 'admin'], [0, 30, 'mentor'], [30, 0, 'mentor']]);
    assert.ok(!JSON.stringify(mine).includes('qa-admin@example.com'));
  });
});

describe('"My details"', () => {
  let m;
  before(async () => { m = await makeMentor('Ana Details', 'ana-details@example.com', 20); });

  test('specializations, current role, university, country and years save at once for an approved mentor, who stays listed', async () => {
    const r = await m.c.api('/me/details', { method: 'PUT', body: { specialtyTags: ['Startups', 'Pitch decks'], currentRole: 'Founder at a bakery', university: 'Tbilisi State University', country: 'ge', yearsExperience: 9 } });
    assert.equal(r.status, 200, r.text);
    const u = await userRow(m.id);
    assert.deepEqual(u.specialty_tags, ['Startups', 'Pitch decks']);
    assert.equal(u.current_work, 'Founder at a bakery');
    assert.equal(u.university, 'Tbilisi State University');
    assert.equal(u.country, 'ge');
    assert.equal(u.years_experience, 9);
    assert.equal(u.verification_status, 'verified');
    assert.ok(await listed(m.id));
  });

  test('the same checks as everywhere: no links or addresses, and nothing else comes in through it', async () => {
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { currentRole: 'see www.example.com' } })).error, 'invalid_current_role');
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { specialtyTags: ['mail me@x.com'] } })).error, 'invalid_tags');
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { yearsExperience: 300 } })).error, 'invalid_years');
    await m.c.api('/me/details', { method: 'PUT', body: { niche: 'law', fieldId: 'law', verificationStatus: 'none', price: 1 } });
    const u = await userRow(m.id);
    assert.equal(u.niche, 'business');
    assert.equal(u.price, 20);
  });

  test('the name and birth date from the ID check are shown, never changed here', async () => {
    const d = await m.c.api('/me/details');
    assert.equal(d.status, 200);
    assert.ok('identity' in d);
    await m.c.api('/me/details', { method: 'PUT', body: { verifiedName: 'Someone Else', dateOfBirth: '2010-01-01' } });
    const kyc = (await pool.query('SELECT count(*)::int AS n FROM kyc_sessions WHERE user_id = $1', [m.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    assert.equal(kyc, 0, 'no ID check was started or changed');
    assert.equal((await userRow(m.id)).birth_ym, (await userRow(m.id)).birth_ym);
  });
});

describe('a field change of an approved mentor waits for an admin', () => {
  let m;
  before(async () => { m = await makeMentor('Gio Fields', 'gio-fields@example.com', 20, { language: 'en' }); });

  test('it goes to the queue, and the live profile stays as it was until it is approved', async () => {
    const r = await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'it', extraFields: ['biz'], directions: ['it.backend'] } });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.change && r.change.id);
    const u = await userRow(m.id);
    assert.equal(u.field_id, 'biz');
    assert.equal(u.niche, 'business');
    assert.equal((await listed(m.id)).niche || u.niche, 'business');
    const q = await admin.api('/admin/changes');
    const mine = q.changes.find((c) => c.mentor.id === m.id);
    assert.ok(mine);
    assert.equal(mine.proposed.fieldId, 'it');
    assert.equal(mine.current.fieldId, 'biz');
    assert.deepEqual(mine.missing, []);
    const ok = await admin.api(`/admin/changes/${mine.id}/approve`, { method: 'POST', body: {} });
    assert.equal(ok.status, 200, ok.text);
    const after = await userRow(m.id);
    assert.equal(after.field_id, 'it');
    assert.equal(after.niche, 'tech');
    assert.equal(after.verification_status, 'verified');
    await resend.waitFor('gio-fields@example.com', 'approved');
  });

  test('rejected: the profile stays as it was and the mentor is emailed with the reason', async () => {
    const r = await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'art', extraFields: [], directions: ['art.illustration'] } });
    const res = await admin.api(`/admin/changes/${r.change.id}/reject`, { method: 'POST', body: { reason: 'Your proof is about software' } });
    assert.equal(res.status, 200, res.text);
    assert.equal((await userRow(m.id)).field_id, 'it');
    const mail = await resend.waitFor('gio-fields@example.com', 'not approved');
    assert.match(mail.body.html, /Your proof is about software/);
  });

  test('into a licensed field: approving is refused until that field\'s licence step has passed, and the licence can be sent for it', async () => {
    const r = await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'law', extraFields: [], directions: ['law.civil'] } });
    assert.equal(r.status, 200, r.text);
    const q = (await admin.api('/admin/changes')).changes.find((c) => c.id === r.change.id);
    assert.ok(q.missing.includes('license'));
    assert.equal(q.regulated, true);
    const refused = await admin.api(`/admin/changes/${r.change.id}/approve`, { method: 'POST', body: {} });
    assert.equal(refused.status, 409);
    assert.equal(refused.error, 'licence_missing');
    assert.equal((await userRow(m.id)).niche, 'tech', 'still the old field');
    // (the licence for the new field is accepted, and checked as at sign-up)
    const lic = await m.c.api('/verification/license', { method: 'POST', body: { number: 'GE-12345', issuingBody: 'Georgian Bar Association', holderName: 'Gio Fields', validUntil: '2030-12-31' } });
    assert.equal(lic.status, 200, lic.text);
    for (const step of q.missing) {
      await pool.query(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test', now())
        ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed', decided_at = now()`, [m.id, step]);
    }
    const ok = await admin.api(`/admin/changes/${r.change.id}/approve`, { method: 'POST', body: {} });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await userRow(m.id)).niche, 'law');
  });

  test('new proof after approval is added unchecked and goes to the queue', async () => {
    // (the apply form's own endpoint stays locked after sending; "My details" has its own)
    assert.equal((await m.c.api('/verification/evidence', { method: 'POST', body: { url: 'https://github.com/gio-fields' } })).error, 'application_locked');
    const r = await m.c.api('/me/evidence', { method: 'POST', body: { url: 'https://github.com/gio-fields' } });
    assert.equal(r.status, 200, r.text);
    const q = (await admin.api('/admin/changes')).changes.find((c) => c.mentor.id === m.id && c.kind === 'evidence');
    assert.ok(q);
    assert.equal(q.evidence.url, 'https://github.com/gio-fields');
    assert.equal((await admin.api(`/admin/changes/${q.id}/approve`, { method: 'POST', body: {} })).status, 200);
    assert.equal((await pool.query('SELECT check_status FROM mentor_evidence WHERE id = $1', [q.evidenceId])).rows[0].check_status, 'ok');
  });
});

describe('an application sent and not decided yet', () => {
  test('changes are saved, and the admin sees the latest version marked as updated, with what changed', async () => {
    const m = await makeMentor('Lika Pending', 'lika-pending@example.com', 15, { approve: false });
    await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() WHERE id = $1`, [m.id]);
    const r = await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'edu', extraFields: [], directions: ['edu.ielts'] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.change, null);
    assert.equal((await userRow(m.id)).field_id, 'edu');
    await m.c.api('/me/details', { method: 'PUT', body: { university: 'Ilia State University' } });
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.ok(d.applicationChanges && d.applicationChanges.at);
    assert.ok(d.applicationChanges.fields.includes('fieldId'));
    assert.ok(d.applicationChanges.fields.includes('university'));
  });
});

// docs/CLAUDE-CODE-NEW-CATEGORIES.md: at least 1 direction and at most 5, the same on the page (public/js/field-picker.js) and here.
describe('directions: 1 to 5', () => {
  let m;
  before(async () => { m = await makeMentor('Nika Directions', 'nika-directions@example.com', 20, { approve: false }); });
  const save = (directions) => m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'it', extraFields: [], directions } });

  test('0 is refused, 1 and 5 are accepted, 6 is refused', async () => {
    const none = await save([]);
    assert.equal(none.status, 400, none.text);
    assert.equal(none.error, 'too_few_directions');
    assert.equal((await save(['it.backend'])).status, 200);
    assert.deepEqual((await userRow(m.id)).directions, ['it.backend']);
    const five = ['it.frontend', 'it.backend', 'it.fullstack', 'it.mobile', 'it.ai'];
    assert.equal((await save(five)).status, 200);
    assert.equal((await userRow(m.id)).directions.length, 5);
    const six = await save([...five, 'it.data']);
    assert.equal(six.status, 400, six.text);
    assert.equal(six.error, 'too_many_directions');
    const categories = require('../server/categories');
    assert.deepEqual([categories.LIMITS.directionsMin, categories.LIMITS.directions], [1, 5]);
  });

  test('a mentor with none keeps their profile; only saving the field asks for one, and sending an application needs one', async () => {
    await pool.query("UPDATE users SET directions = '{}' WHERE id = $1", [m.id]);
    // (other details still save)
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { university: 'Tbilisi State University' } })).status, 200);
    assert.equal((await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'it', extraFields: [] } })).error, 'too_few_directions', 'nothing new chosen: still asked');
    const experience = require('../server/verification/experience');
    const { getUserById } = require('../server/models');
    await assert.rejects(experience.submit(await getUserById(m.id)), (e) => e.code === 'incomplete' && e.missing.includes('directions'));
  });
});
