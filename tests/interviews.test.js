// Video interviews for regulated niches: admin slots, mentor booking, meeting link, results, cancellation.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const fake = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, doctor, doctorId, lawyer, lawyerId, designer;

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const passKyc = (id) => pool.query(
  `INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, 'id_kyc', 'passed', 'test setup', now())
   ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [id]);
const stepRow = async (id, step) => (await pool.query('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [id, step])).rows[0];
const slotRow = async (id) => (await pool.query('SELECT * FROM interview_slots WHERE id = $1', [id])).rows[0];
async function newSlot(hours) {
  const r = await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: inHours(hours) } });
  assert.equal(r.status, 201, r.text);
  return r.slots[0];
}
async function mentorOf(name, email, niche, language) {
  const c = await signupByEmail(fake, base, name, email, language);
  const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  return { c, id: (await c.api('/me')).user.id };
}

before(async () => {
  await fake.start();
  await resetDatabase();
  srv = await startServer(4580, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: fake.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: '' });
  base = srv.base;
  admin = await signupByEmail(fake, base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupByEmail(fake, base, 'Sam Seeker', 'seeker@example.com');
  const d = await mentorOf('Levan Kiknadze', 'levan@example.com', 'medicine', 'ka');
  doctor = d.c; doctorId = d.id;
  const l = await mentorOf('Giorgi Law', 'giorgi@example.com', 'law', 'en');
  lawyer = l.c; lawyerId = l.id;
  designer = (await mentorOf('Nino Design', 'nino@example.com', 'design', 'en')).c;
});
after(async () => { if (srv) srv.proc.kill(); await fake.stop(); await pool.end(); });

describe('publishing slots', () => {
  test('only admins can publish, and only sensible times are accepted', async () => {
    assert.equal((await seeker.api('/admin/interviews', { method: 'POST', body: { startsAt: inHours(72) } })).error, 'not_admin');
    assert.equal((await doctor.api('/admin/interviews')).error, 'not_admin');
    assert.equal((await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: inHours(-2) } })).error, 'invalid_slot');
    assert.equal((await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: 'tomorrow' } })).error, 'invalid_slot');
    assert.equal((await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: inHours(24 * 400) } })).error, 'invalid_slot');
    assert.equal((await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: inHours(72), minutes: 1 } })).error, 'invalid_slot');
    assert.equal((await admin.api('/admin/interviews', { method: 'POST', body: {} })).error, 'invalid_slot');
  });

  test('several slots can be added at once and an open slot can be deleted', async () => {
    const r = await admin.api('/admin/interviews', { method: 'POST', body: { startsAt: [inHours(200), inHours(201)] } });
    assert.equal(r.status, 201);
    assert.equal(r.slots.length, 2);
    assert.equal((await admin.api(`/admin/interviews/${r.slots[0].id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await admin.api(`/admin/interviews/${r.slots[0].id}`, { method: 'DELETE' })).error, 'not_found');
    assert.equal((await admin.api(`/admin/interviews/${r.slots[1].id}`, { method: 'DELETE' })).status, 200);
  });
});

describe('booking', () => {
  let slot, other;

  test('only niches that require an interview can book one', async () => {
    slot = await newSlot(72);
    assert.equal((await designer.api('/verification/interview')).required, false);
    assert.equal((await designer.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } })).error, 'not_required');
    assert.equal((await seeker.api('/verification/interview')).error, 'not_a_mentor');
  });

  test('the ID check must be passed first', async () => {
    const o = await doctor.api('/verification/interview');
    assert.equal(o.required, true);
    assert.equal(o.canBook, false);
    assert.equal(o.blocked, 'id_check_first');
    assert.equal((await doctor.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } })).error, 'id_check_first');
    await passKyc(doctorId);
    await passKyc(lawyerId);
    assert.equal((await doctor.api('/verification/interview')).canBook, true);
  });

  test('slots that start too soon are not offered or bookable', async () => {
    const soon = await newSlot(3);
    const list = (await doctor.api('/verification/interview')).slots.map((s) => s.id);
    assert.ok(list.includes(slot.id));
    assert.ok(!list.includes(soon.id), 'less than 12 hours ahead');
    assert.equal((await doctor.api('/verification/interview/book', { method: 'POST', body: { slotId: soon.id } })).error, 'slot_unavailable');
    assert.equal((await doctor.api('/verification/interview/book', { method: 'POST', body: { slotId: 'nope' } })).error, 'slot_unavailable');
    await admin.api(`/admin/interviews/${soon.id}`, { method: 'DELETE' });
  });

  test('booking takes the slot, waits for the admin, and tells both sides', async () => {
    const r = await doctor.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await slotRow(slot.id)).status, 'booked');
    const step = await stepRow(doctorId, 'video_interview');
    assert.equal(step.status, 'pending');

    const o = await doctor.api('/verification/interview');
    assert.equal(o.booking.id, slot.id);
    assert.equal(o.booking.meetingLink, null);
    assert.equal(o.canBook, false, 'one booking at a time');
    assert.ok(!o.slots.some((s) => s.id === slot.id));

    const toMentor = await fake.waitFor('levan@example.com', 'ინტერვიუ');
    assert.match(toMentor.body.html, /UTC/, 'the time zone is spelled out');
    const toAdmin = await fake.waitFor('qa-admin@example.com', 'video interview');
    assert.match(toAdmin.body.html, /levan@example\.com/);
    assert.equal((await doctor.api('/verification/interview/book', { method: 'POST', body: { slotId: (await newSlot(96)).id } })).error, 'already_booked');
  });

  test('a taken slot cannot be booked by someone else, even at the same moment', async () => {
    assert.equal((await lawyer.api('/verification/interview/book', { method: 'POST', body: { slotId: slot.id } })).error, 'slot_unavailable');
    const fresh = await newSlot(120);
    other = fresh;
    const l2 = await mentorOf('Second Lawyer', 'second@example.com', 'law', 'en');
    await passKyc(l2.id);
    const results = await Promise.all([
      lawyer.api('/verification/interview/book', { method: 'POST', body: { slotId: fresh.id } }),
      l2.c.api('/verification/interview/book', { method: 'POST', body: { slotId: fresh.id } })
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).error, 'slot_unavailable');
  });
});

describe('meeting link, result and audit trail', () => {
  let slot;
  before(async () => { slot = (await doctor.api('/verification/interview')).booking; });

  test('only a real https link is accepted; the mentor gets it by email and in Settings', async () => {
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'javascript:alert(1)' } })).error, 'invalid_link');
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'http://insecure.example/x' } })).error, 'invalid_link');
    assert.equal((await doctor.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'https://meet.example.com/abc-defg' } })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/link`, { method: 'POST', body: { link: 'https://meet.example.com/abc-defg' } })).status, 200);

    assert.equal((await doctor.api('/verification/interview')).booking.meetingLink, 'https://meet.example.com/abc-defg');
    const mail = await fake.waitFor('levan@example.com', 'ბმული');
    assert.match(mail.body.html, /https:\/\/meet\.example\.com\/abc-defg/);
    assert.match(mail.body.html, /[ა-ჿ]/, 'in Georgian for a Georgian mentor');
  });

  test('a result cannot be recorded before the interview, and needs a reason', async () => {
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'passed', reason: 'Went well' } })).error, 'not_started');
    await pool.query(`UPDATE interview_slots SET starts_at = now() - interval '30 minutes' WHERE id = $1`, [slot.id]);
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'passed', reason: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'maybe', reason: 'Went well' } })).error, 'invalid_decision');
    assert.equal((await stepRow(doctorId, 'video_interview')).status, 'pending');
  });

  test('passing the interview passes the step; private notes stay with the admins', async () => {
    const r = await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'passed', reason: 'Clear, licensed, identity confirmed', notes: 'Nervous but honest. PRIVATE-NOTE' } });
    assert.equal(r.status, 200, r.text);
    const step = await stepRow(doctorId, 'video_interview');
    assert.equal(step.status, 'passed');
    assert.equal(step.reason, 'Clear, licensed, identity confirmed');
    const row = await slotRow(slot.id);
    assert.equal(row.status, 'completed');
    assert.equal(row.result, 'passed');

    const own = await doctor.api('/verification/interview');
    assert.equal(own.result.result, 'passed');
    assert.doesNotMatch(own.text, /PRIVATE-NOTE/);
    assert.doesNotMatch((await doctor.api('/verification')).text, /PRIVATE-NOTE/);
    const listed = (await admin.api('/admin/interviews')).slots.find((s) => s.id === slot.id);
    assert.equal(listed.notes, 'Nervous but honest. PRIVATE-NOTE');
    assert.equal((await admin.api(`/admin/interviews/${slot.id}/result`, { method: 'POST', body: { result: 'failed', reason: 'Changed my mind' } })).error, 'not_found', 'a finished interview cannot be re-decided here');
  });

  test('everything is in the mentor\'s audit log', async () => {
    const d = await admin.api(`/admin/mentors/${doctorId}/verification`);
    const actions = d.audit.map((a) => a.action);
    for (const a of ['interview_booked', 'interview_link_sent', 'step_passed']) assert.ok(actions.includes(a), `${a} is logged`);
    const passed = d.audit.find((a) => a.action === 'step_passed' && a.step === 'video_interview');
    assert.equal(passed.by, 'qa-admin@example.com');
    assert.ok(d.requirements.find((r) => r.step === 'video_interview'));
  });

  test('a failed interview lets the mentor book another one', async () => {
    const s = await newSlot(150);
    let mine = (await lawyer.api('/verification/interview')).booking || null;
    if (!mine) { // the other mentor won the same-moment race above (either may), so take a slot of our own
      const own = await newSlot(140);
      assert.equal((await lawyer.api('/verification/interview/book', { method: 'POST', body: { slotId: own.id } })).status, 200);
      mine = (await lawyer.api('/verification/interview')).booking || null;
    }
    assert.ok(mine, 'the lawyer holds a booking');
    await pool.query(`UPDATE interview_slots SET starts_at = now() - interval '5 minutes' WHERE id = $1`, [mine.id]);
    assert.equal((await admin.api(`/admin/interviews/${mine.id}/result`, { method: 'POST', body: { result: 'failed', reason: 'Could not confirm the licence holder' } })).status, 200);
    assert.equal((await stepRow(lawyerId, 'video_interview')).status, 'failed');
    const o = await lawyer.api('/verification/interview');
    assert.equal(o.result.result, 'failed');
    assert.equal(o.canBook, true);
    assert.equal((await lawyer.api('/verification/interview/book', { method: 'POST', body: { slotId: s.id } })).status, 200);
    assert.equal((await stepRow(lawyerId, 'video_interview')).status, 'pending');
  });
});

describe('cancelling', () => {
  test('a mentor can give a slot back well ahead of time; it opens again and the step is withdrawn', async () => {
    const s = await newSlot(300);
    const m = await mentorOf('Third Doctor', 'third@example.com', 'medicine', 'en');
    await passKyc(m.id);
    assert.equal((await m.c.api('/verification/interview/book', { method: 'POST', body: { slotId: s.id } })).status, 200);
    assert.equal((await m.c.api('/verification/interview/cancel', { method: 'POST' })).status, 200);
    assert.equal((await slotRow(s.id)).status, 'open');
    assert.equal((await slotRow(s.id)).booked_by, null);
    assert.equal(await stepRow(m.id, 'video_interview'), undefined);
    assert.equal((await m.c.api('/verification/interview/cancel', { method: 'POST' })).error, 'not_found');

    assert.equal((await m.c.api('/verification/interview/book', { method: 'POST', body: { slotId: s.id } })).status, 200);
    await pool.query(`UPDATE interview_slots SET starts_at = now() + interval '2 hours' WHERE id = $1`, [s.id]);
    assert.equal((await m.c.api('/verification/interview/cancel', { method: 'POST' })).error, 'too_late');
  });

  test('an admin can cancel a booked interview with a reason; the mentor is told', async () => {
    const s = await newSlot(310);
    const m = await mentorOf('Fourth Doctor', 'fourth@example.com', 'medicine', 'en');
    await passKyc(m.id);
    assert.equal((await m.c.api('/verification/interview/book', { method: 'POST', body: { slotId: s.id } })).status, 200);
    assert.equal((await admin.api(`/admin/interviews/${s.id}/cancel`, { method: 'POST', body: { reason: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/interviews/${s.id}/cancel`, { method: 'POST', body: { reason: 'The interviewer is unwell' } })).status, 200);
    assert.equal((await slotRow(s.id)).status, 'cancelled');
    assert.equal(await stepRow(m.id, 'video_interview'), undefined);
    const mail = await fake.waitFor('fourth@example.com', 'cancelled');
    assert.match(mail.body.html, /The interviewer is unwell/);
    assert.equal((await m.c.api('/verification/interview')).canBook, true);
    assert.equal((await admin.api(`/admin/interviews/${s.id}`, { method: 'DELETE' })).error, 'not_found', 'only open slots can be deleted');
  });
});
