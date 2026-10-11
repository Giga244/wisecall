// REVIEW-2: money after a dispute, against the fake TBC bank of tests/fakeBank.js (TBC returns money with a "cancel" request for an
// amount, and has no idempotency key). Never more back than was paid, never the same return twice:
//   - a full refund after a partial one asks only for what is left (REVIEW-2 #2)
//   - a partial refund whose answer from the bank was lost is not sent a second time (REVIEW-2 #3)
//   - two admins deciding the same dispute at once, or a refund pressed twice, reach the bank once
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createFakeBank } = require('../fakeBank');
const { longQuestion } = require('../helpers');
const { pool, sql, marketplace } = require('./_shared');

const fake = createFakeBank();
// A proxy in front of the fake bank that can lose the bank's answer to one "cancel" (the money went back; the server never heard).
let proxy, proxyUrl, loseNextCancel = false, dropNextCancel = false;
let ctx;

before(async () => {
  await fake.start();
  proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    // (the request never reaches the bank, and the answer is a timeout: the server cannot know that nothing was returned)
    if (dropNextCancel && req.method === 'POST' && /\/cancel$/.test(req.url)) {
      dropNextCancel = false;
      res.writeHead(504, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'gateway timeout' }));
    }
    const headers = { ...req.headers };
    for (const h of ['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding']) delete headers[h];
    const r = await fetch(fake.url + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const text = await r.text();
    if (loseNextCancel && req.method === 'POST' && /\/cancel$/.test(req.url) && r.ok) {
      loseNextCancel = false;
      res.writeHead(504, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'gateway timeout' }));
    }
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
    res.end(text);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  ctx = await marketplace(4852, {
    SWEEP_INTERVAL_SECONDS: '1', PAYMENT_PROVIDER: 'tbc', TBC_API_KEY: fake.TBC_KEY, TBC_CLIENT_ID: fake.TBC_ID, TBC_CLIENT_SECRET: fake.TBC_SECRET, TBC_API_URL: proxyUrl
  }); // price 25 GEL = 2500 tetri
});
after(async () => { if (ctx) ctx.srv.proc.kill(); await fake.stop(); proxy.close(); await pool.end(); });

const cancels = (payId) => fake.state.calls.filter((c) => c.method === 'POST' && c.path === `/v1/tpay/payments/${payId}/cancel`);
const callback = (payId) => fetch(`${ctx.base}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ PaymentId: payId }) });

// A question paid at TBC, answered, and reported by the asker. -> { bookingId, payId, disputeId }
async function disputed(question) {
  const r = await ctx.seeker.api('/bookings', { method: 'POST', body: { mentorId: ctx.mentorId, question: longQuestion(question) } });
  assert.equal(r.status, 201, r.text);
  const payId = r.booking.providerOrderId;
  fake.tbcSet(payId, 'Succeeded');
  assert.equal((await callback(payId)).status, 200);
  assert.equal((await sql('SELECT status FROM bookings WHERE id = $1', [r.booking.id]))[0].status, 'paid');
  const a = await ctx.mentor.api(`/bookings/${r.booking.id}/answer`, { method: 'POST', body: { answer: require('../helpers').longAnswer('My answer, with the steps I would take.') } });
  assert.equal(a.status, 200, a.text);
  const d = await ctx.seeker.api(`/bookings/${r.booking.id}/dispute`, { method: 'POST', body: { reason: 'not_an_answer', details: 'It does not answer what I asked.' } });
  assert.equal(d.status, 201, d.text);
  const disputeId = (await sql('SELECT id FROM disputes WHERE booking_id = $1', [r.booking.id]))[0].id;
  return { bookingId: r.booking.id, payId, disputeId };
}
const resolve = (disputeId, body) => ctx.admin.api(`/admin/disputes/${disputeId}/resolve`, { method: 'POST', body });

describe('never more back than was paid', () => {
  test('a partial refund of the whole price (or more) is refused before the bank is asked', async () => {
    const { disputeId, payId } = await disputed('How do I plan the first year of a data team in a small company?');
    assert.equal((await resolve(disputeId, { outcome: 'partial_refund', amount: 2500, note: 'All of it' })).error, 'invalid_amount');
    assert.equal((await resolve(disputeId, { outcome: 'partial_refund', amount: 9999, note: 'More than all of it' })).error, 'invalid_amount');
    assert.equal(cancels(payId).length, 0);
  });

  test('a full refund after a partial one asks the bank only for what is left', async () => {
    const { bookingId, payId, disputeId } = await disputed('How do I choose between two job offers with different salaries?');
    const r = await resolve(disputeId, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(cancels(payId).map((c) => c.body), [{ amount: 10 }]);
    // (TBC allows several returns up to the amount paid: the fake bank is told the payment can still be returned)
    fake.tbcSet(payId, 'Succeeded');
    const full = await ctx.admin.api(`/admin/bookings/${bookingId}/refund`, { method: 'POST' });
    assert.equal(full.status, 200, full.text);
    const sent = cancels(payId).map((c) => c.body.amount);
    assert.deepEqual(sent, [10, 15], `asked the bank for ${sent.join(' + ')} GEL back on a 25 GEL payment`);
  });
});

describe('never the same return twice', () => {
  test('two admins deciding the same dispute at once: one decision, one request to the bank', async () => {
    const { disputeId, payId } = await disputed('How do I explain a gap year on my CV to a recruiter?');
    const both = await Promise.all([1, 2].map(() => resolve(disputeId, { outcome: 'partial_refund', amount: 500, note: 'A small part was off topic.' })));
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
    assert.equal(cancels(payId).length, 1);
  });

  test('a refund pressed twice reaches the bank once', async () => {
    const { bookingId, payId } = await disputed('What should I learn first to become a backend developer?');
    assert.equal((await ctx.admin.api(`/admin/bookings/${bookingId}/refund`, { method: 'POST' })).status, 200);
    assert.equal((await ctx.admin.api(`/admin/bookings/${bookingId}/refund`, { method: 'POST' })).status, 200);
    assert.equal(cancels(payId).length, 1);
  });

  test('a partial refund whose answer from the bank was lost is not sent again', async () => {
    const { payId, disputeId, bookingId } = await disputed('How do I ask my manager for a promotion without sounding pushy?');
    loseNextCancel = true;
    const first = await resolve(disputeId, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    assert.equal(cancels(payId).length, 1, 'the bank did return 10 GEL, but its answer was lost');
    // (the fix: before anything else the server asks the bank what it returned, sees the 10 GEL and records the decision; it never sends
    // the request again)
    assert.equal(first.status, 200, first.text);
    // An admin who decides again (the bank would still let the payment be returned) is told it is decided.
    fake.tbcSet(payId, 'Succeeded');
    const again = await resolve(disputeId, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    assert.equal(again.status, 409, again.text);
    const returned = cancels(payId).reduce((s, c) => s + c.body.amount, 0);
    assert.equal(returned, 10, `the bank was asked to return ${returned} GEL for a 10 GEL decision (second answer: ${again.status})`);
    assert.ok((await sql('SELECT refunded_amount FROM bookings WHERE id = $1', [bookingId]))[0].refunded_amount <= 1000);
  });

  test('when the bank cannot say, nothing is sent again until it can: the refund waits, the payout waits, the sweep settles it', async () => {
    const { payId, disputeId, bookingId } = await disputed('How do I plan my first month as a team lead?');
    dropNextCancel = true;
    const first = await resolve(disputeId, { outcome: 'partial_refund', amount: 800, note: 'Part of the answer missed the point.' });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.dispute ? first.dispute.refundPending : first.refundPending, true, 'the decision stands; the refund waits for the bank');
    const [b] = await sql('SELECT partial_refund_amount, refunded_amount FROM bookings WHERE id = $1', [bookingId]);
    assert.deepEqual([b.partial_refund_amount, b.refunded_amount || 0], [800, 0]);
    // Nothing more can be sent for this question meanwhile: not a full refund, not another decision.
    assert.equal((await ctx.admin.api(`/admin/bookings/${bookingId}/refund`, { method: 'POST' })).status, 409);
    assert.equal(cancels(payId).length, 0);
    // 15 minutes later the bank still shows nothing returned: the claim is released and the dispute opens again for the admin.
    await pool.query(`UPDATE bookings SET partial_refund_started_at = now() - interval '16 minutes' WHERE id = $1`, [bookingId]);
    for (let i = 0; i < 60 && (await sql('SELECT partial_refund_amount FROM bookings WHERE id = $1', [bookingId]))[0].partial_refund_amount; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await sql('SELECT partial_refund_amount FROM bookings WHERE id = $1', [bookingId]))[0].partial_refund_amount, null);
    assert.equal((await sql('SELECT status FROM disputes WHERE id = $1', [disputeId]))[0].status, 'open');
    assert.equal(cancels(payId).length, 0, 'and it was never sent twice');
  });
});
