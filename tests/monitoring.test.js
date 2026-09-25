// After approval: low ratings are flagged, licenses are watched (reminder, then off the site when they
// expire), and an admin can suspend a mentor at once (hidden, open questions refunded).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, addPayoutDetails, approveMentor, bookAndPay, rate, wait, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker;

async function listedMentor(name, email, niche = 'design') {
  const c = await signupByEmail(resend, base, name, email);
  const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  await addPayoutDetails(c);
  return { c, id: await approveMentor(admin, c) };
}
const openFlags = async (id, kind) => (await pool.query(`SELECT * FROM mentor_flags WHERE mentor_id = $1 AND kind = $2 AND status = 'open'`, [id, kind])).rows;
const status = async (id) => (await pool.query('SELECT verification_status FROM users WHERE id = $1', [id])).rows[0].verification_status;
const listed = async (id) => (await client(base).api('/experts')).experts.some((e) => e.id === id);
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); }
}
// A buyer asks, the mentor answers, the buyer rates it.
async function rated(mentor, mentorId, stars, n) {
  const b = await bookAndPay(base, seeker, mentorId, `Question number ${n} about my work?`);
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: 'A thorough answer to that question.' } })).status, 200);
  assert.equal((await rate(seeker, b.id, stars)).status, 201);
}

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4584, {
    SWEEP_INTERVAL_SECONDS: '1',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: ''
  });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupByEmail(resend, base, 'Sam Seeker', 'sam@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('low ratings', () => {
  test('an average under 3.5 after five reviews is flagged; four reviews are not enough', async () => {
    const m = await listedMentor('Low Rated', 'low@example.com');
    for (const [i, stars] of [4, 3, 3, 3].entries()) await rated(m.c, m.id, stars, i + 1);
    assert.equal((await openFlags(m.id, 'low_rating')).length, 0, 'four reviews: too early');
    await rated(m.c, m.id, 4, 5); // 4,3,3,3,4 -> 3.4
    const flag = (await openFlags(m.id, 'low_rating'))[0];
    assert.ok(flag, 'flagged');
    assert.equal(Number(flag.detail.average), 3.4);
    assert.equal(flag.detail.reviews, 5);
    await resend.waitFor('qa-admin@example.com', 'low rating');
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.ok(d.flags.some((f) => f.kind === 'low_rating'), 'the admin sees it in the mentor review');
  });

  test('a good average is not flagged, and neither is exactly 3.5', async () => {
    const good = await listedMentor('Well Rated', 'good@example.com');
    for (let i = 1; i <= 5; i++) await rated(good.c, good.id, 5, i);
    assert.equal((await openFlags(good.id, 'low_rating')).length, 0);
    const edge = await listedMentor('Edge Case', 'edge@example.com');
    for (const [i, stars] of [4, 3, 4, 3, 4, 3].entries()) await rated(edge.c, edge.id, stars, i + 1); // 3.5
    assert.equal((await openFlags(edge.id, 'low_rating')).length, 0, '3.5 is not below 3.5');
  });
});

describe('license watch', () => {
  let doctor, doctorId;
  const licenseExpiry = (sql) => pool.query(`UPDATE verification_steps SET expires_at = ${sql} WHERE user_id = $1 AND step = 'license'`, [doctorId]);

  before(async () => {
    const d = await listedMentor('Levan Kiknadze', 'levan@example.com', 'medicine');
    doctor = d.c; doctorId = d.id;
  });

  test('30 days before expiry the admin is reminded once, and closing the flag does not bring it back', async () => {
    await licenseExpiry(`now() + interval '10 days'`);
    const flag = await waitFor(async () => (await openFlags(doctorId, 'license_expiring'))[0]);
    assert.ok(flag.detail.expiresAt);
    const mail = await resend.waitFor('qa-admin@example.com', 'expires soon');
    assert.match(mail.body.text, /levan@example\.com/);
    assert.equal(await status(doctorId), 'verified', 'still listed');

    await wait(2500);
    assert.equal(resend.to('qa-admin@example.com', 'expires soon').length, 1, 'one reminder only');
    await pool.query(`UPDATE mentor_flags SET status = 'resolved' WHERE id = $1`, [flag.id]);
    await wait(2500);
    assert.equal((await openFlags(doctorId, 'license_expiring')).length, 0, 'not reopened for the same expiry date');
  });

  test('a license further than 30 days away raises nothing', async () => {
    const far = await listedMentor('Far Away', 'far@example.com', 'law');
    await pool.query(`UPDATE verification_steps SET expires_at = now() + interval '200 days' WHERE user_id = $1 AND step = 'license'`, [far.id]);
    await wait(2500);
    assert.equal((await openFlags(far.id, 'license_expiring')).length, 0);
    assert.ok(await listed(far.id));
  });

  test('when it expires the mentor leaves Browse experts and is told what to do', async () => {
    assert.ok(await listed(doctorId));
    await licenseExpiry(`now() - interval '1 hour'`);
    await waitFor(async () => (await status(doctorId)) === 'pending');
    assert.equal(await listed(doctorId), false, 'off the site');
    assert.equal((await client(base).api(`/experts/${doctorId}`)).status, 404);
    assert.equal((await openFlags(doctorId, 'license_expired')).length, 1);

    const mail = await resend.waitFor('levan@example.com', 'update on your Wisecall application');
    assert.match(mail.body.text, /Your license has expired/);
    assert.match(mail.body.text, /License or registration/);
    await resend.waitFor('qa-admin@example.com', 'license expired');
    const log = (await admin.api(`/admin/mentors/${doctorId}/verification`)).audit.find((a) => a.action === 'delisted');
    assert.equal(log.reason, 'license expired');
    assert.equal(log.by, 'system');
    assert.equal((await admin.api(`/admin/mentors/${doctorId}/approve`, { method: 'POST' })).error, 'steps_incomplete', 'cannot be approved with an expired license');
  });

  test('a renewed license, once approved, closes the warnings and the mentor can be approved again', async () => {
    const until = new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10);
    assert.equal((await doctor.api('/verification/license', { method: 'POST', body: { number: 'MD-NEW-2027', issuingBody: 'Ministry of Health', holderName: 'Levan Kiknadze', validUntil: until } })).status, 200);
    assert.equal((await admin.api(`/admin/mentors/${doctorId}/steps/license`, { method: 'POST', body: { decision: 'passed', reason: 'Renewed license found in the register' } })).status, 200);
    assert.equal((await openFlags(doctorId, 'license_expired')).length, 0);
    assert.equal((await admin.api(`/admin/mentors/${doctorId}/approve`, { method: 'POST' })).status, 200);
    assert.ok(await listed(doctorId), 'back on the site');
    await wait(2500);
    assert.equal(await status(doctorId), 'verified', 'the new date is in the future, so the sweep leaves it alone');
  });
});

describe('suspension', () => {
  let mentor, mentorId, done, waiting;

  before(async () => {
    const m = await listedMentor('Nino Beridze', 'nino@example.com');
    mentor = m.c; mentorId = m.id;
    done = await bookAndPay(base, seeker, mentorId, 'A question that was already answered?');
    assert.equal((await mentor.api(`/bookings/${done.id}/answer`, { method: 'POST', body: { answer: 'Here is the answer you needed.' } })).status, 200);
    waiting = await bookAndPay(base, seeker, mentorId, 'A question still waiting for an answer?');
  });

  test('only admins can suspend, and a written reason is required', async () => {
    assert.equal((await mentor.api(`/admin/mentors/${mentorId}/suspend`, { method: 'POST', body: { reason: 'Because' } })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/suspend`, { method: 'POST', body: { reason: '' } })).error, 'reason_required');
    assert.equal(await status(mentorId), 'verified');
  });

  test('suspending hides the mentor at once, refunds the waiting question and tells everyone', async () => {
    assert.ok(await listed(mentorId));
    const r = await admin.api(`/admin/mentors/${mentorId}/suspend`, { method: 'POST', body: { reason: 'Two buyers reported fake credentials' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.total, 1);
    assert.equal(r.refunded, 1);

    assert.equal(await status(mentorId), 'suspended');
    assert.equal(await listed(mentorId), false, 'hidden from search');
    assert.equal((await client(base).api(`/experts/${mentorId}`)).status, 404);
    assert.equal((await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Can I still ask you something?' } })).error, 'mentor_not_found');

    const w = (await pool.query('SELECT * FROM bookings WHERE id = $1', [waiting.id])).rows[0];
    assert.ok(['refund_pending', 'refunded'].includes(w.status), `the waiting question is refunded (${w.status})`);
    assert.equal(w.refund_reason, 'mentor_suspended');
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id = $1', [done.id])).rows[0].status, 'answered', 'an answered question stays answered');

    const toMentor = await resend.waitFor('nino@example.com', 'suspended');
    assert.match(toMentor.body.text, /Two buyers reported fake credentials/);
    const toBuyer = await resend.waitFor('sam@example.com', 'refunded');
    assert.match(toBuyer.body.text, /suspended/);
    const log = (await admin.api(`/admin/mentors/${mentorId}/verification`)).audit.find((a) => a.action === 'suspended');
    assert.equal(log.by, 'qa-admin@example.com');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/suspend`, { method: 'POST', body: { reason: 'Again please' } })).error, 'invalid_state');
  });

  test('the mentor sees the suspension and cannot answer; their payouts are held for an admin', async () => {
    const own = await mentor.api('/verification');
    assert.equal(own.status, 'suspended');
    assert.match(own.note, /fake credentials/);
    assert.equal((await mentor.api(`/bookings/${done.id}/answer`, { method: 'POST', body: { answer: 'An edited answer after suspension.' } })).error, 'suspended');

    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 day' WHERE mentor_id = $1`, [mentorId]);
    const row = (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
    assert.equal(row.suspended, true);
    const csv = await admin.raw('/api/admin/payouts.csv').then((r) => r.text());
    assert.doesNotMatch(csv, /nino@example\.com/, 'left out of the bank transfer file');
    const pay = await admin.api(`/admin/payouts/${mentorId}/pay`, { method: 'POST', body: { amount: row.net, reference: 'TR-1' } });
    assert.equal(pay.error, 'mentor_suspended');
  });

  test('reinstating needs a reason and puts the mentor back to "pending"; approval brings them back', async () => {
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/reinstate`, { method: 'POST', body: { reason: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/reinstate`, { method: 'POST', body: { reason: 'Reports were unfounded' } })).status, 200);
    assert.equal(await status(mentorId), 'pending');
    assert.equal(await listed(mentorId), false, 'not listed until approved again');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/reinstate`, { method: 'POST', body: { reason: 'Twice' } })).error, 'invalid_state');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/approve`, { method: 'POST' })).status, 200);
    assert.ok(await listed(mentorId));
    const actions = (await admin.api(`/admin/mentors/${mentorId}/verification`)).audit.map((a) => a.action);
    for (const a of ['suspended', 'reinstated', 'approved']) assert.ok(actions.includes(a), `${a} is logged`);
  });
});
