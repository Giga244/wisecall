// Mentor balance and withdrawals (PART 5), on the payout ledger: the 100 ₾ threshold, one request even when asked five times at once,
// a refund during a request, a debt deducted from the next withdrawal, a rejection returning the money, the admin's payment with its
// reference, the CSV for a bulk transfer, and what blocks a withdrawal.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PASSWORD = 'test-pass-12345';
let srv, base, admin, asker, mentor, mentorId, n = 0;

// A paid, answered question whose earnings (48 GEL of a 60 GEL price) are available now. Returns the booking id.
async function earned() {
  n += 1;
  const b = await bookAndPay(base, asker, mentorId, `Question ${n}: how should I plan my first months in a new job?`);
  assert.equal(b.status, 'paid');
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`Answer ${n}.`) } })).status, 200);
  await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE booking_id = $1`, [b.id]);
  return b.id;
}
const balance = async () => (await mentor.api('/me/balance'));
const withdraw = (password = PASSWORD) => mentor.api('/me/withdrawals', { method: 'POST', body: { currentPassword: password } });
const openRequests = async () => (await pool.query(`SELECT * FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentorId])).rows;

before(async () => {
  await resetDatabase();
  srv = await startServer(4725, { RATE_LIMIT_MULTIPLIER: '20', PAYOUT_MIN_GEL: '100' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 60, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('asking for the money', () => {
  test('under 100 ₾ nothing can be withdrawn; from 100 ₾ the whole available amount, and five requests at once make one', async () => {
    await earned();
    await earned();
    let b = await balance();
    assert.equal(b.balance.available, 9600);
    assert.equal(b.canWithdraw, false);
    assert.ok(b.blockers.includes('below_minimum'));
    assert.equal(b.minimum, 10000);
    const low = await withdraw();
    assert.equal(low.status, 409);
    assert.equal(low.error, 'below_minimum');

    await earned();
    b = await balance();
    assert.equal(b.canWithdraw, true);
    assert.equal(b.withdrawAmount, 14400);
    assert.equal((await withdraw('')).error, 'password_required');
    assert.equal((await withdraw('not-my-password')).error, 'wrong_password');
    // (an amount sent by the page is ignored)
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => mentor.api('/me/withdrawals', { method: 'POST', body: { currentPassword: PASSWORD, amount: 999999 } })));
    assert.equal(answers.filter((r) => r.status === 201).length, 1, 'one new request');
    assert.ok(answers.every((r) => r.status === 201 || r.status === 200));
    assert.equal(new Set(answers.map((r) => r.request.id)).size, 1, 'everybody got the same request');
    const open = await openRequests();
    assert.equal(open.length, 1);
    assert.equal(open[0].amount, 14400);
    b = await balance();
    assert.deepEqual([b.balance.available, b.balance.requested], [0, 14400]);
    assert.ok(b.blockers.includes('request_open'));
    assert.equal(b.history[0].status, 'requested');
    const rows = (await pool.query(`SELECT count(*)::int AS n FROM payouts WHERE batch_id = $1 AND status = 'pending'`, [open[0].id])).rows[0].n;
    assert.equal(rows, 3, 'the three payouts are locked into the request');
  });

  test('a refund of a question in the request takes it out; when nothing is left, the request closes', async () => {
    const [req] = await openRequests();
    const ids = (await pool.query(`SELECT booking_id FROM payouts WHERE batch_id = $1 ORDER BY created_at`, [req.id])).rows.map((r) => r.booking_id);
    assert.equal((await admin.api(`/admin/bookings/${ids[0]}/refund`, { method: 'POST' })).status, 200);
    assert.equal((await openRequests())[0].amount, 9600, 'computed again');
    for (const id of ids.slice(1)) assert.equal((await admin.api(`/admin/bookings/${id}/refund`, { method: 'POST' })).status, 200);
    assert.equal((await openRequests()).length, 0);
    const closed = (await pool.query(`SELECT * FROM payout_batches WHERE id = $1`, [req.id])).rows[0];
    assert.equal(closed.status, 'rejected');
    assert.match(closed.reject_reason, /refund/);
    const b = await balance();
    assert.deepEqual([b.balance.available, b.balance.requested], [0, 0]);
  });
});

describe('the admin', () => {
  test('a rejection needs a reason and returns the money; a payment needs the reference and the amount the admin saw', async () => {
    for (let i = 0; i < 3; i++) await earned();
    assert.equal((await withdraw()).status, 201);
    let [req] = await openRequests();
    assert.equal((await mentor.api('/admin/withdrawals')).status, 403, 'admins only');
    const q = await admin.api('/admin/withdrawals');
    assert.equal(q.queue.length, 1);
    assert.match(q.queue[0].iban, /^GE29 NB00/, 'the full IBAN, for the transfer');
    assert.ok(q.overview.mentorMoneyHeld >= 14400);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM verification_audit WHERE mentor_id = $1 AND action = 'iban_viewed'`, [mentorId])).rows[0].n, 1, 'the view is logged');

    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/reject`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/reject`, { method: 'POST', body: { reason: 'The bank returned the transfer.' } })).status, 200);
    let b = await balance();
    assert.equal(b.balance.available, 14400, 'available again');
    assert.equal(b.history[0].status, 'rejected');
    assert.equal(b.history[0].reason, 'The bank returned the transfer.');

    assert.equal((await withdraw()).status, 201);
    [req] = await openRequests();
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: '', amount: 14400 } })).error, 'reference_required');
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: 'TR-77', amount: 9999 } })).error, 'amount_changed');
    assert.equal((await admin.api(`/admin/payouts/${mentorId}/pay`, { method: 'POST', body: { amount: 0, reference: 'X' } })).error, 'request_open', 'paid through the request, not around it');
    const paid = await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: 'TR-77', amount: 14400 } });
    assert.equal(paid.status, 200);
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: 'TR-77', amount: 14400 } })).error, 'not_open', 'twice is refused');
    b = await balance();
    assert.equal(b.balance.paidOut, 14400);
    assert.equal(b.history[0].status, 'paid');
    assert.equal(b.history[0].reference, 'TR-77');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payouts WHERE batch_id = $1 AND status = 'paid'`, [req.id])).rows[0].n, 3);
  });

  test('money owed back for a refund after payment is deducted from the next withdrawal (and comes back if it is rejected)', async () => {
    const { rows: [paidOne] } = await pool.query(`SELECT booking_id, amount FROM payouts WHERE mentor_id = $1 AND status = 'paid' LIMIT 1`, [mentorId]);
    assert.equal((await admin.api(`/admin/bookings/${paidOne.booking_id}/refund`, { method: 'POST' })).status, 200);
    let b = await balance();
    assert.equal(b.balance.owedBack, 4800);
    for (let i = 0; i < 3; i++) await earned();
    b = await balance();
    assert.equal(b.withdrawAmount, 14400 - 4800);
    assert.equal((await withdraw()).status, 201);
    let [req] = await openRequests();
    assert.equal(req.amount, 9600);
    assert.equal(req.debt_deducted, 4800);
    assert.equal((await balance()).balance.owedBack, 0, 'the debt is settled by this request');
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/reject`, { method: 'POST', body: { reason: 'Checking the account holder.' } })).status, 200);
    assert.equal((await balance()).balance.owedBack, 4800, 'owed again');
    assert.equal((await withdraw()).status, 201);
    [req] = await openRequests();
    assert.equal((await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: 'TR-78', amount: 9600 } })).status, 200);
    b = await balance();
    assert.equal(b.balance.owedBack, 0);
    assert.equal(b.balance.paidOut, 14400 + 9600);
  });

  test('a CSV of the open requests for one bulk transfer, then one reference for every exported request', async () => {
    for (let i = 0; i < 3; i++) await earned();
    assert.equal((await withdraw()).status, 201);
    const res = await admin.raw('/api/admin/withdrawals.csv');
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /GE29NB0000000101904917/);
    assert.match(csv, /144\.00,GEL/);
    const r = await admin.api('/admin/withdrawals/pay-exported', { method: 'POST', body: { reference: 'BULK-1' } });
    assert.equal(r.paid, 1);
    assert.deepEqual(r.changed, []);
    assert.equal((await openRequests()).length, 0);
  });
});

describe('what blocks a withdrawal', () => {
  test('an open flag, a suspension and missing payout details block it; closing the mentor account waives the minimum', async () => {
    await earned(); // 48 GEL: under the minimum
    await pool.query(`INSERT INTO mentor_flags (mentor_id, kind, status, detail) VALUES ($1, 'reports', 'open', '{}')`, [mentorId]);
    assert.ok((await balance()).blockers.includes('open_flags'));
    assert.equal((await withdraw()).error, 'open_flags');
    await pool.query(`UPDATE mentor_flags SET status = 'resolved' WHERE mentor_id = $1`, [mentorId]);
    assert.equal((await withdraw()).error, 'below_minimum');
    // Stopping being a mentor: any amount above zero.
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: false } })).status, 200);
    const b = await balance();
    assert.equal(b.closing, true);
    assert.equal(b.canWithdraw, true);
    const w = await withdraw();
    assert.equal(w.status, 201);
    assert.equal(w.request.amount, 4800);
    // (closing the account waits until that transfer is made: it needs the bank details)
    assert.ok((await mentor.api('/me/delete/check')).items.includes('money_to_pay_out'));
    // (a seeker never sees anything: no payouts at all)
    const plain = await client(base).api('/me/balance');
    assert.equal(plain.status, 401);
  });
});
