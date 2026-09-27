// "Report a problem with this answer": one report per question within the window, the payout held while it is open, and an admin's
// decision: a full refund, a partial refund split in proportion between the platform fee and the mentor's share, or no refund.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, wait } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId;

async function answered(question) {
  const b = await bookAndPay(base, asker, mentorId, question);
  const r = await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is what I would do in your place.') } });
  assert.equal(r.status, 200, r.text);
  return b.id;
}
const payout = async (bookingId) => (await pool.query('SELECT * FROM payouts WHERE booking_id = $1', [bookingId])).rows[0];
const booking = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const report = (c, id, body = { reason: 'not_an_answer', details: 'It talks about something else.' }) => c.api(`/bookings/${id}/dispute`, { method: 'POST', body });
const openDispute = async (id) => (await pool.query('SELECT * FROM disputes WHERE booking_id = $1', [id])).rows[0];
const resolve = (disputeId, body) => admin.api(`/admin/disputes/${disputeId}/resolve`, { method: 'POST', body });
const mentorRow = async () => (await admin.api('/admin/payouts')).mentors ? (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId) : null;

before(async () => {
  await resetDatabase();
  // price 30 GEL, fee 20%: the mentor's share is 24 GEL (2400 tetri)
  srv = await startServer(4710, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('reporting a problem', () => {
  test('only the asker, only once the answer can be read, only once', async () => {
    const paid = await bookAndPay(base, asker, mentorId, 'What database should a two-person startup use for a marketplace?');
    assert.equal((await report(asker, paid.id)).error, 'not_disputable', 'no answer yet');
    const id = await answered('How do I prepare for my first system design interview next month?');
    assert.equal((await report(mentor, id)).status, 403);
    assert.equal((await report(asker, id, { reason: 'because' })).error, 'invalid_reason');
    const mine = await asker.api('/bookings/mine');
    assert.ok(mine.asked.find((b) => b.id === id).disputeUntil, 'the dashboard offers it');
    assert.equal((await report(asker, id)).status, 201);
    assert.equal((await report(asker, id)).error, 'already_reported');
    const again = await asker.api('/bookings/mine');
    assert.equal(again.asked.find((b) => b.id === id).dispute.status, 'open');
    assert.equal((await mentor.api('/bookings/mine')).received.find((b) => b.id === id).dispute.status, 'open', 'the mentor sees it too');
  });

  test('after the report window has passed, nothing can be reported', async () => {
    const id = await answered('Should I learn Rust or Go first for backend work in 2026?');
    await pool.query(`UPDATE bookings SET answered_at = now() - interval '8 days' WHERE id = $1`, [id]);
    assert.equal((await report(asker, id)).error, 'window_closed');
  });
});

describe('the payout waits, then the admin decides', () => {
  test('an open report holds the payout even after its hold period; "no refund" releases it', async () => {
    const id = await answered('How can I make my API responses faster without rewriting everything?');
    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 day' WHERE booking_id = $1`, [id]);
    const before = await mentorRow();
    assert.equal((await report(asker, id)).status, 201);
    const held = await mentorRow();
    assert.equal(held.payable, before.payable - 2400, 'no longer payable while the report is open');
    assert.ok(held.holding >= 2400);

    const d = await openDispute(id);
    assert.equal((await asker.api(`/admin/disputes`)).status, 403);
    assert.equal((await resolve(d.id, { outcome: 'rejected', note: 'no' })).error, 'note_required');
    assert.equal((await resolve(d.id, { outcome: 'rejected', note: 'The answer covers the question.' })).status, 200);
    assert.equal((await mentorRow()).payable, before.payable, 'payable again');
    assert.equal((await resolve(d.id, { outcome: 'rejected', note: 'Twice.' })).error, 'already_resolved');
    const t = await asker.api(`/inbox/threads/${(await asker.api(`/inbox/booking/${id}`)).threadId}`);
    assert.ok(t.messages.some((m) => m.event === 'dispute_resolved' && m.data.outcome === 'rejected'));
  });

  test('a partial refund: the asker gets the amount back, the mentor loses their proportional part, the booking stays answered', async () => {
    const id = await answered('My team argues about code reviews all the time. How do we set better rules?');
    assert.equal((await report(asker, id, { reason: 'wrong_or_harmful' })).status, 201);
    const d = await openDispute(id);
    assert.equal((await resolve(d.id, { outcome: 'partial_refund', amount: 3000, note: 'Too much' })).error, 'invalid_amount', 'not the whole price');
    const r = await resolve(d.id, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    assert.equal(r.status, 200, r.text);
    const b = await booking(id);
    assert.equal(b.status, 'answered');
    assert.equal(b.refunded_amount, 1000);
    const p = await payout(id);
    // 10 GEL of 30 back: the mentor's part is 10 x 24/30 = 8 GEL; the platform's part is 2 GEL.
    assert.equal(p.amount, 1600);
    assert.equal(p.refunded_share, 800);
    assert.equal((await asker.api('/bookings/mine')).asked.find((x) => x.id === id).refundedAmount, 1000);
  });

  test('a partial refund after the mentor was paid becomes a debt of their part only', async () => {
    const id = await answered('How do I estimate a project when the client keeps changing their mind?');
    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 day' WHERE booking_id = $1`, [id]);
    await pool.query(`UPDATE payouts SET status = 'paid' WHERE booking_id = $1`, [id]); // (as if an admin paid it)
    assert.equal((await report(asker, id, { reason: 'off_topic' })).status, 201);
    const d = await openDispute(id);
    assert.equal((await resolve(d.id, { outcome: 'partial_refund', amount: 1500, note: 'Half of it was off topic.' })).status, 200);
    const p = await payout(id);
    assert.equal(p.debt_amount, 1200, '15 GEL back: the mentor owes 12 GEL of their 24');
    assert.ok(p.debt_flagged_at);
    const row = await mentorRow();
    assert.ok(row.debt >= 1200);
  });

  test('a full refund voids the payout', async () => {
    const id = await answered('What should I put in a first README for an open-source library?');
    assert.equal((await report(asker, id, { reason: 'rude' })).status, 201);
    const d = await openDispute(id);
    assert.equal((await resolve(d.id, { outcome: 'full_refund', note: 'The answer was rude.' })).status, 200);
    await wait(300);
    const b = await booking(id);
    assert.ok(['refunded', 'refund_pending'].includes(b.status), b.status);
    assert.equal(b.refund_reason, 'dispute');
    assert.equal((await payout(id)).status, 'void');
  });
});
