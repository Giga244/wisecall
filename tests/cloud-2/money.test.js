// REVIEW-2: money after a dispute, against the fake TBC bank of tests/fakeBank.js (TBC returns money with a "cancel" request for an
// amount, and has no idempotency key). Never more back than was paid, never the same return twice:
//   - a full refund after a partial one asks only for what is left (REVIEW-2 #2)
//   - a partial refund whose answer from the bank was lost is not sent a second time (REVIEW-2 #3)
//   - two admins deciding the same dispute at once, or a refund pressed twice, reach the bank once
// Tests marked { todo: 'REVIEW-2 #n' } show a problem that exists today: they are expected to fail until the finding is fixed.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createFakeBank } = require('../fakeBank');
const { longQuestion } = require('../helpers');
const { pool, sql, marketplace } = require('./_shared');

const fake = createFakeBank();
// A proxy in front of the fake bank that can lose the bank's answer to one "cancel" (the money went back; the server never heard).
let proxy, proxyUrl, loseNextCancel = false;
let ctx;

before(async () => {
  await fake.start();
  proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
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
    PAYMENT_PROVIDER: 'tbc', TBC_API_KEY: fake.TBC_KEY, TBC_CLIENT_ID: fake.TBC_ID, TBC_CLIENT_SECRET: fake.TBC_SECRET, TBC_API_URL: proxyUrl
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

  test('a full refund after a partial one asks the bank only for what is left', { todo: 'REVIEW-2 #2' }, async () => {
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

  test('a partial refund whose answer from the bank was lost is not sent again', { todo: 'REVIEW-2 #3' }, async () => {
    const { payId, disputeId, bookingId } = await disputed('How do I ask my manager for a promotion without sounding pushy?');
    loseNextCancel = true;
    const first = await resolve(disputeId, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    assert.notEqual(first.status, 200, 'the server did not hear back from the bank');
    assert.equal(cancels(payId).length, 1, 'but the bank did return 10 GEL');
    // The admin sees "refund failed" and decides again (the bank still lets the payment be returned).
    fake.tbcSet(payId, 'Succeeded');
    const again = await resolve(disputeId, { outcome: 'partial_refund', amount: 1000, note: 'Part of the answer missed the point.' });
    const returned = cancels(payId).reduce((s, c) => s + c.body.amount, 0);
    assert.equal(returned, 10, `the bank was asked to return ${returned} GEL for a 10 GEL decision (second answer: ${again.status})`);
    assert.ok((await sql('SELECT refunded_amount FROM bookings WHERE id = $1', [bookingId]))[0].refunded_amount <= 1000);
  });
});
