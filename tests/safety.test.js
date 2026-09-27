// Safety before and after payment: a question that sounds like an emergency is never sent to the bank (help text instead, logged
// for admins, the text encrypted), and a mentor can decline a paid question, which refunds the asker in full with the reason.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, bookAndPay, longAnswer, longQuestion, SAMPLE, wait } = require('./helpers');
const safety = require('../server/safety');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId;

before(async () => {
  await resetDatabase();
  srv = await startServer(4709, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('emergencies are never paid for', () => {
  test('the patterns catch first-person emergencies (EN and KA), not topics', () => {
    assert.deepEqual(safety.checkEmergency('I want to kill myself and I do not know who to talk to'), ['self_harm']);
    assert.deepEqual(safety.checkEmergency('მინდა მოვკვდე, აღარ ვიცი რა ვქნა ამ ყველაფრით'), ['self_harm']);
    assert.deepEqual(safety.checkEmergency('I cannot breathe and my chest hurts, what should I do?'), ['medical_emergency']);
    assert.deepEqual(safety.checkEmergency('My husband beats me every week, where can I go?'), ['abuse']);
    assert.deepEqual(safety.checkEmergency('He is going to kill me if I leave the house tonight'), ['violence']);
    for (const topic of ['How do I support a friend who seems depressed through a hard year?', 'What are the legal steps for a client who is a victim of domestic violence?',
      'How do I kill a process in Linux that will not stop?', 'The photo shoot went badly, how do I fix the lighting?']) {
      assert.deepEqual(safety.checkEmergency(topic), [], topic);
    }
  });

  test('an emergency question gets help (422 emergency), no booking, no bank; the admins see it with the text encrypted at rest', async () => {
    const r = await asker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('I want to end my life, nothing helps anymore.') } });
    assert.equal(r.status, 422);
    assert.equal(r.error, 'emergency');
    assert.deepEqual(r.categories, ['self_harm']);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, 0, 'nothing was created, nobody went to the bank');
    const row = (await pool.query('SELECT * FROM safety_events')).rows[0];
    assert.ok(row);
    assert.doesNotMatch(row.excerpt_enc, /end my life/, 'encrypted at rest');
    const list = await admin.api('/admin/safety');
    assert.match(list.events[0].text, /end my life/);
    assert.equal(list.events[0].user.email, 'ana@example.com');
    assert.equal((await asker.api('/admin/safety')).status, 403);
    assert.equal((await admin.api(`/admin/safety/${row.id}/review`, { method: 'POST', body: { note: 'Checked, emailed support resources' } })).status, 200);
    assert.equal((await admin.api('/admin/safety')).events.length, 0, 'reviewed ones leave the open list');
  });

  test('an ordinary question still goes to the bank', async () => {
    const b = await bookAndPay(base, asker, mentorId, 'How do I choose between Postgres and MySQL for a new product?');
    assert.equal(b.status, 'paid');
  });
});

describe('a mentor declines a question', () => {
  let booking;
  before(async () => { booking = await bookAndPay(base, asker, mentorId, 'Can you review my plan to move our servers to another provider?'); });

  test('only the mentor, with a known reason', async () => {
    assert.equal((await asker.api(`/bookings/${booking.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } })).status, 403);
    assert.equal((await mentor.api(`/bookings/${booking.id}/decline`, { method: 'POST', body: { reason: 'bored' } })).error, 'invalid_reason');
  });

  test('declining refunds the asker in full at once, with the reason; the thread says so and the mentor cannot answer after', async () => {
    const r = await mentor.api(`/bookings/${booking.id}/decline`, { method: 'POST', body: { reason: 'not_qualified', note: 'Not my area' } });
    assert.equal(r.status, 200, r.text);
    const row = (await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id])).rows[0];
    assert.equal(row.decline_reason, 'not_qualified');
    assert.ok(['refunded', 'refund_pending'].includes(row.status), row.status);
    assert.equal(row.refund_reason, 'declined_not_qualified');
    const mine = await asker.api('/bookings/mine');
    assert.equal(mine.asked.find((b) => b.id === booking.id).refundReason, 'declined_not_qualified');
    const threadId = (await asker.api(`/inbox/booking/${booking.id}`)).threadId;
    await wait(200);
    const t = await asker.api(`/inbox/threads/${threadId}`);
    assert.ok(t.messages.some((m) => m.event === 'declined' && m.data.reason === 'not_qualified'));
    assert.ok(!JSON.stringify(t).includes('Not my area'), "the mentor's note is for the team only");
    const ans = await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Too late now.') } });
    assert.notEqual(ans.status, 200);
    assert.equal((await mentor.api(`/bookings/${booking.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } })).error, 'not_declinable');
  });

  test('an answered question cannot be declined', async () => {
    const b = await bookAndPay(base, asker, mentorId, 'What should I learn first as a junior backend developer?');
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Learn one language well, then SQL.') } });
    assert.equal((await mentor.api(`/bookings/${b.id}/decline`, { method: 'POST', body: { reason: 'against_rules' } })).error, 'already_answered');
  });
});
