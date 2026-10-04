// What the API sends (PART 8): every response to an asker or a mentor carries only what the page needs. Never another person's email,
// IBAN or account id, never the bank's or the moderation's internals (refund errors, refund ids, held-until times, flags). One test per
// route: the dashboard, one question, answering, the inbox (threads, one conversation, notifications), reporting a problem, receipts,
// statements, the data export, and the admin overview and support inbox (admins only, and the overview only counts).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, rate, ageAnswer, SAMPLE, GOOD_IBAN } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId, askerId, booking;

// Every key and every string anywhere in a JSON answer.
function walk(value, keys = new Set(), strings = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, strings));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); walk(v, keys, strings); }
  else if (typeof value === 'string') strings.push(value);
  return { keys, strings };
}
const INTERNAL = ['refundError', 'providerRefundId', 'reminderSentAt', 'answerFlaggedAt', 'answerHeldUntil', 'partialRefundStartedAt', 'refundRequestedAt',
  'answerReview', 'passwordHash', 'payoutIbanEnc', 'resetTokenHash', 'emailVerifyCodeHash', 'refund_error', 'provider_refund_id', 'password_hash'];
const IBAN = /GE\d{2}\s?[A-Z]{2}(\s?\d){16}/;
function clean(body, { viewerId, otherEmail, otherId, allowOrderId = false, label }) {
  const { keys, strings } = walk(body);
  for (const k of INTERNAL) assert.ok(!keys.has(k), `${label}: no ${k}`);
  if (!allowOrderId) assert.ok(!keys.has('providerOrderId'), `${label}: no providerOrderId`);
  assert.ok(!strings.some((s) => IBAN.test(s)), `${label}: no IBAN`);
  if (otherEmail) assert.ok(!strings.some((s) => s.toLowerCase().includes(otherEmail)), `${label}: not the other person's email`);
  if (otherId) assert.ok(!strings.includes(otherId) || label.startsWith('asker'), `${label}: not the other person's account id`);
  assert.ok(viewerId !== undefined);
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4735, { RATE_LIMIT_MULTIPLIER: '30', PROBATION_ANSWERS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, GOOD_IBAN, 'Mika Mentor');
  askerId = (await asker.api('/me')).user.id;
  booking = await bookAndPay(base, asker, mentorId, 'How should I prepare for my first engineering interview next month?');
  // (a refund error and a flag the bank and the moderation keep for themselves)
  await pool.query(`UPDATE bookings SET refund_error = 'bank said: internal code 77', answer_flagged_at = now() WHERE id = $1`, [booking.id]);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the asker and the mentor', () => {
  test('answering, and one question, show no internals; the mentor does not get the asker\'s account id', async () => {
    const answered = await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Practise out loud, and prepare three stories.') } });
    assert.equal(answered.status, 200);
    assert.equal(answered.booking.answerHeld, true, 'the first answer is checked first');
    clean(answered, { viewerId: mentorId, otherEmail: 'ana@example.com', otherId: askerId, label: 'mentor: answer' });
    assert.equal(answered.booking.seekerId, undefined);
    const forAsker = await asker.api(`/bookings/${booking.id}`);
    clean(forAsker, { viewerId: askerId, otherEmail: 'mika@example.com', label: 'asker: one question' });
    const forMentor = await mentor.api(`/bookings/${booking.id}`);
    clean(forMentor, { viewerId: mentorId, otherEmail: 'ana@example.com', otherId: askerId, label: 'mentor: one question' });
    assert.equal(forMentor.booking.seekerId, undefined);
    assert.equal((await admin.api(`/admin/answers/${booking.id}/approve`, { method: 'POST' })).status, 200);
  });

  test('the dashboard lists', async () => {
    const a = await asker.api('/bookings/mine');
    clean(a, { viewerId: askerId, otherEmail: 'mika@example.com', label: 'asker: dashboard' });
    assert.equal(a.asked[0].mentorId, mentorId, '(the mentor\'s public id, for "report this mentor")');
    const m = await mentor.api('/bookings/mine');
    clean(m, { viewerId: mentorId, otherEmail: 'ana@example.com', otherId: askerId, label: 'mentor: dashboard' });
    assert.equal(m.received[0].seekerId, undefined);
  });

  test('the inbox: the list, one conversation and the notifications', async () => {
    for (const [who, other, otherId, label] of [[asker, 'mika@example.com', null, 'asker'], [mentor, 'ana@example.com', askerId, 'mentor']]) {
      const list = await who.api('/inbox');
      clean(list, { viewerId: 'x', otherEmail: other, otherId, label: `${label}: inbox` });
      const thread = list.threads.find((t) => t.bookingId === booking.id);
      assert.ok(thread);
      clean(await who.api(`/inbox/threads/${thread.id}`), { viewerId: 'x', otherEmail: other, otherId, label: `${label}: conversation` });
      clean(await who.api('/inbox/notifications'), { viewerId: 'x', otherEmail: other, otherId, label: `${label}: notifications` });
    }
  });

  test('reporting a problem returns only the report', async () => {
    await ageAnswer(booking.id, 1);
    const r = await asker.api(`/bookings/${booking.id}/dispute`, { method: 'POST', body: { reason: 'off_topic', details: 'It did not answer my question.' } });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.dispute).sort(), ['createdAt', 'details', 'id', 'note', 'outcome', 'reason', 'refundAmount', 'resolvedAt', 'status']);
  });

  test('receipts are the asker\'s alone; statements are a list of months', async () => {
    const { rows: [rc] } = await pool.query('SELECT r.id FROM receipts r WHERE r.booking_id = $1 LIMIT 1', [booking.id]);
    assert.ok(rc, 'a receipt for the payment');
    assert.equal((await asker.raw(`/api/receipts/${rc.id}.pdf`)).status, 200);
    assert.equal((await mentor.raw(`/api/receipts/${rc.id}.pdf`)).status, 404, 'not the mentor');
    assert.equal((await client(base).raw(`/api/receipts/${rc.id}.pdf`)).status, 401);
    const s = await mentor.api('/me/statements');
    assert.deepEqual(Object.keys(s).filter((k) => !['status', 'headers', 'text'].includes(k)), ['months']); // (the test client adds status, headers, text)
    clean(s, { viewerId: mentorId, otherEmail: 'ana@example.com', otherId: askerId, label: 'mentor: statements' });
  });

  test('the data export: my own data, other people only by their public name, my IBAN only by its last 4', async () => {
    await rate(asker, booking.id, 5);
    for (const [who, other, label] of [[asker, 'mika@example.com', 'asker'], [mentor, 'ana@example.com', 'mentor']]) {
      const res = await who.raw('/api/me/export');
      assert.equal(res.status, 200);
      const data = JSON.parse(await res.text());
      clean(data, { viewerId: 'x', otherEmail: other, label: `${label}: export` });
      assert.ok('publicAnswers' in data && 'mentorRequests' in data, `${label}: the export includes public answers and requests`);
    }
    const m = JSON.parse(await (await mentor.raw('/api/me/export')).text());
    assert.equal(m.payoutDetails.ibanEndsWith, GOOD_IBAN.replace(/\s/g, '').slice(-4));
    const a = JSON.parse(await (await asker.raw('/api/me/export')).text());
    assert.ok(!JSON.stringify(a).includes('bank said'), 'no refund error from the bank');
  });
});

describe('admins', () => {
  test('the overview is counts only, and only admins get it or the support inbox', async () => {
    assert.equal((await asker.api('/admin/overview')).status, 403);
    assert.equal((await asker.api('/admin/support')).status, 403);
    const o = await admin.api('/admin/overview');
    assert.equal(o.status, 200);
    const { strings } = walk(o);
    assert.ok(!strings.some((s) => s.includes('@')), 'no emails');
    assert.ok(!strings.some((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)), 'no ids');
  });
});
