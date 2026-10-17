// End-to-end payment tests. The real server runs with PAYMENT_PROVIDER=bog (then tbc) and talks to
// a fake bank (tests/fakeBank.js) that follows the banks' documented APIs, including RSA-signed
// BOG callbacks. Nothing here touches a real bank.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE, wait } = require('./helpers');
const { longAnswer, longQuestion } = require('./helpers');
const { createFakeBank } = require('./fakeBank');

const fake = createFakeBank();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(250);
  }
}

before(async () => { await fake.start(); });
after(async () => { await fake.stop(); await pool.end(); });

// Shared setup for both banks: an admin, a seeker, an approved mentor priced at 25 GEL.
async function setup(port, env) {
  await resetDatabase();
  const srv = await startServer(port, { SWEEP_INTERVAL_SECONDS: '1', ANSWER_DEADLINE_DAYS: '7', ...env });
  const base = srv.base;
  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  const mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/drmentor', sampleAnswer: SAMPLE } });
  const me = (await mentor.api('/me')).user;
  const mentorId = me.id, mentorUsername = me.username;
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
  return { srv, base, admin, seeker, mentor, mentorId, mentorUsername };
}

const row = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const refundCalls = (orderId) => fake.state.calls.filter((c) => /refund|cancel/.test(c.path) && c.path.includes(orderId));

// ---------------------------------------------------------------- Bank of Georgia
describe('Bank of Georgia (BOG)', () => {
  let ctx, base, admin, seeker, mentor, mentorId, mentorUsername;
  const callback = (payload) => fetch(`${base}/api/payments/callback`, { method: 'POST', headers: payload.headers, body: payload.body });
  const create = async (question = 'How do I choose a specialty?') => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(question) } });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r;
  };
  const view = async (id) => (await seeker.api(`/bookings/${id}`)).booking;
  // The buyer pays at the bank and the bank calls back, exactly as in real life.
  const payAtBank = async (r) => {
    fake.bogSet(r.booking.providerOrderId, 'completed');
    assert.equal((await callback(fake.bogCallback(r.booking.providerOrderId))).status, 200);
    return view(r.booking.id);
  };

  before(async () => {
    ctx = await setup(4561, {
      PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: fake.BOG_ID, BOG_CLIENT_SECRET: fake.BOG_SECRET,
      BOG_API_URL: fake.url, BOG_AUTH_URL: `${fake.url}/bog-oauth/token`,
      BOG_CALLBACK_PUBLIC_KEY: fake.publicKeyPem.replace(/\n/g, '\\n')
    });
    ({ base, admin, seeker, mentor, mentorId, mentorUsername } = ctx);
  });
  after(() => { if (ctx) ctx.srv.proc.kill(); });

  describe('starting a payment', () => {
    test('sends BOG a correct order in GEL and leaves the booking unpaid', async () => {
      const r = await create();
      const b = r.booking;
      assert.equal(b.status, 'pending_payment');
      assert.equal(b.provider, 'bog');
      assert.equal(b.currency, 'gel');
      assert.equal(b.amount, 2500);
      assert.match(b.providerOrderId, /^bog-order-/);
      assert.equal(r.checkoutUrl, `${fake.url}/pay/${b.providerOrderId}`, 'buyer is sent to the bank page');

      const req = fake.state.bog.get(b.providerOrderId).request;
      assert.equal(req.callback_url, `${base}/api/payments/callback`);
      assert.equal(req.purchase_units.total_amount, 25);
      assert.equal(req.purchase_units.currency, 'GEL');
      assert.equal(req.purchase_units.basket[0].unit_price, 25);
      assert.equal(req.external_order_id, b.id);
      assert.equal(req.capture, 'automatic');
      assert.equal(req.ttl, 30);
      const sent = fake.state.calls.find((c) => c.method === 'POST' && c.path.endsWith('/ecommerce/orders') && c.body && c.body.external_order_id === b.id);
      assert.equal(sent.headers['accept-language'], 'en', "B6: the buyer's language chooses the payment page's language");
      assert.match(sent.headers['idempotency-key'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/, 'B7: an idempotency key per booking');
      assert.equal(req.redirect_urls.success, `${base}/u/${mentorUsername}?booking=${b.id}&status=success`);
      assert.equal(req.redirect_urls.fail, `${base}/u/${mentorUsername}?booking=${b.id}&status=fail`);
    });

    test('the access token is fetched once and reused; an expired token is replaced transparently', async () => {
      const before = fake.state.tokenRequests;
      await create('Second question, same token');
      assert.equal(fake.state.tokenRequests, before, 'token was reused');
      fake.expireTokens();
      await create('Third question after the token expired');
      assert.equal(fake.state.tokenRequests, before + 1, 'a fresh token was requested once');
    });

    test('if the bank is down the booking is closed and the buyer gets an error', async () => {
      fake.state.failOrders = true;
      const res = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('This will hit an outage') } });
      fake.state.failOrders = false;
      assert.equal(res.status, 502);
      assert.equal(res.error, 'payment_error');
      const mine = (await seeker.api('/bookings/mine')).asked;
      assert.equal(mine.find((x) => x.question === longQuestion('This will hit an outage')).status, 'expired');
    });
  });

  describe('a booking is paid only when the bank confirms it', () => {
    test('coming back from the bank (browser redirect) does not mark it paid', async () => {
      const { booking } = await create('Redirect only, no payment');
      await fetch(`${base}/u/${mentorUsername}?booking=${booking.id}&status=success`);
      const s = await seeker.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
      assert.equal(s.booking.status, 'pending_payment', 'bank says the order is only "created"');
    });

    test('forged callbacks are refused and change nothing', async () => {
      const { booking } = await create('Forged callback target');
      fake.bogSet(booking.providerOrderId, 'completed'); // even if it really were paid...
      const forged = fake.bogCallback(booking.providerOrderId, { signWith: fake.forgedKey });
      assert.equal((await callback(forged)).status, 400, 'signed with the wrong key');
      const tampered = fake.bogCallback(booking.providerOrderId, { tamper: true });
      assert.equal((await callback(tampered)).status, 400, 'body changed after signing');
      const unsigned = fake.bogCallback(booking.providerOrderId);
      delete unsigned.headers['callback-signature'];
      assert.equal((await callback(unsigned)).status, 400, 'no signature at all');
      assert.equal((await view(booking.id)).status, 'pending_payment', '...the forged callbacks did nothing');
    });

    test('a genuine callback for an unpaid order changes nothing (the bank API is asked, not the callback)', async () => {
      const { booking } = await create('Genuine callback, not paid yet');
      assert.equal((await callback(fake.bogCallback(booking.providerOrderId))).status, 200);
      assert.equal((await view(booking.id)).status, 'pending_payment');
    });

    test('a genuine callback plus a completed order at the bank marks it paid and starts the 7-day clock; replays are harmless', async () => {
      const r = await create('Pay me properly');
      const paid = await payAtBank(r);
      assert.equal(paid.status, 'paid');
      const first = await row(r.booking.id);
      const days = (new Date(first.answer_deadline) - Date.now()) / 86400000;
      assert.ok(days > 6.9 && days < 7.1, `deadline is ~7 days away (${days})`);

      assert.equal((await callback(fake.bogCallback(r.booking.providerOrderId))).status, 200);
      assert.equal((await callback(fake.bogCallback(r.booking.providerOrderId))).status, 200);
      const again = await row(r.booking.id);
      assert.equal(again.status, 'paid');
      assert.equal(again.paid_at.getTime(), first.paid_at.getTime(), 'paid_at did not move');
      assert.equal(again.answer_deadline.getTime(), first.answer_deadline.getTime(), 'deadline did not move');
    });

    test('a callback for an order we do not know is acknowledged and ignored', async () => {
      assert.equal((await callback(fake.bogCallback('bog-order-does-not-exist'))).status, 200);
    });

    test('a paid status for the wrong amount is not accepted', async () => {
      const { booking } = await create('Wrong amount at the bank');
      fake.bogSet(booking.providerOrderId, 'completed', { amount: 1 });
      const s = await seeker.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
      assert.equal(s.booking.status, 'pending_payment');
      fake.bogSet(booking.providerOrderId, 'completed', { amount: 25, currency: 'USD' });
      await wait(2100); // sync is throttled to one bank check per booking every 2 seconds
      const s2 = await seeker.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
      assert.equal(s2.booking.status, 'pending_payment', 'wrong currency is refused too');
    });
  });

  describe('failures and missed callbacks', () => {
    test('a rejected payment closes the booking, and the buyer can try again', async () => {
      const { booking } = await create('This card will be declined');
      fake.bogSet(booking.providerOrderId, 'rejected');
      assert.equal((await callback(fake.bogCallback(booking.providerOrderId))).status, 200);
      assert.equal((await view(booking.id)).status, 'expired');
      const retry = await create('Trying again with another card');
      assert.equal(retry.booking.status, 'pending_payment');
    });

    test('a payment that expired at the bank closes the booking', async () => {
      const { booking } = await create('Left at the bank page too long');
      fake.bogSet(booking.providerOrderId, 'rejected', { rejectReason: 'expiration' });
      const s = await seeker.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
      assert.equal(s.booking.status, 'expired');
    });

    test('a missed callback is caught by the background check, which asks the bank', async () => {
      const r = await create('The callback never arrived');
      fake.bogSet(r.booking.providerOrderId, 'completed');
      await pool.query(`UPDATE bookings SET created_at = now() - interval '5 minutes' WHERE id = $1`, [r.booking.id]);
      await waitFor(async () => (await view(r.booking.id)).status === 'paid');
    });

    test('an unpaid booking that outlives the bank order is closed by the background job', async () => {
      const r = await create('Abandoned at checkout');
      await pool.query(`UPDATE bookings SET created_at = now() - interval '3 hours' WHERE id = $1`, [r.booking.id]);
      await waitFor(async () => (await view(r.booking.id)).status === 'expired');
    });
  });

  describe('refunds', () => {
    test('no answer within the deadline: the buyer is refunded through the bank automatically', async () => {
      const r = await create('Nobody will answer this');
      await payAtBank(r);
      await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [r.booking.id]);
      await waitFor(async () => (await row(r.booking.id)).status === 'refund_pending');

      const calls = refundCalls(r.booking.providerOrderId);
      assert.equal(calls.length, 1, 'exactly one refund request reached the bank');
      assert.equal(calls[0].method, 'POST');
      assert.match(calls[0].headers['idempotency-key'], UUID, 'BOG idempotency key is a UUID');
      assert.equal((await row(r.booking.id)).refund_reason, 'no_answer_deadline');
      assert.equal((await view(r.booking.id)).status, 'refund_pending', 'not "refunded" until the bank confirms');

      // BOG completes the refund later; the background job notices.
      fake.bogFinishRefund(r.booking.providerOrderId);
      await pool.query(`UPDATE bookings SET refund_requested_at = now() - interval '5 minutes' WHERE id = $1`, [r.booking.id]);
      await waitFor(async () => (await view(r.booking.id)).status === 'refunded');
      const done = await row(r.booking.id);
      assert.ok(done.refunded_at);
      assert.equal(refundCalls(r.booking.providerOrderId).length, 1, 'confirming did not ask for a second refund');
    });

    test('an admin can refund an answered booking; asking twice sends one request; the bank\'s callback finishes it', async () => {
      const r = await create('Answered, then refunded by an admin');
      await payAtBank(r);
      await mentor.api(`/bookings/${r.booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is my answer.') } });

      const first = await admin.api(`/admin/bookings/${r.booking.id}/refund`, { method: 'POST' });
      assert.equal(first.booking.status, 'refund_pending');
      assert.equal(first.booking.refundReason, 'admin');
      const second = await admin.api(`/admin/bookings/${r.booking.id}/refund`, { method: 'POST' });
      assert.equal(second.booking.status, 'refund_pending');
      assert.equal(refundCalls(r.booking.providerOrderId).length, 1, 'idempotent');

      fake.bogFinishRefund(r.booking.providerOrderId);
      assert.equal((await callback(fake.bogCallback(r.booking.providerOrderId))).status, 200);
      assert.equal((await view(r.booking.id)).status, 'refunded');
    });

    test('a refund the bank rejects is kept, shown to the admin, and retried', async () => {
      const r = await create('The bank will refuse this refund once');
      await payAtBank(r);
      fake.state.rejectRefunds = true;
      const res = await admin.api(`/admin/bookings/${r.booking.id}/refund`, { method: 'POST' });
      assert.equal(res.status, 502);
      assert.equal(res.error, 'refund_failed');
      const listed = (await admin.api('/admin/bookings?status=refund_pending')).bookings.find((b) => b.id === r.booking.id);
      assert.ok(listed && listed.refundError, 'admin can see the refund problem');

      fake.state.rejectRefunds = false;
      await waitFor(async () => {
        const b = await row(r.booking.id);
        return b.status === 'refund_pending' && b.refund_error === null && b.provider_refund_id;
      });
      fake.bogFinishRefund(r.booking.providerOrderId);
      await pool.query(`UPDATE bookings SET refund_requested_at = now() - interval '5 minutes' WHERE id = $1`, [r.booking.id]);
      await waitFor(async () => (await view(r.booking.id)).status === 'refunded');
    });

    test('a booking that was never paid cannot be refunded', async () => {
      const { booking } = await create('Never paid');
      const res = await admin.api(`/admin/bookings/${booking.id}/refund`, { method: 'POST' });
      assert.equal(res.status, 409);
      assert.equal(res.error, 'not_refundable');
    });
  });
});

// ---------------------------------------------------------------- TBC
describe('TBC Bank (tpay)', () => {
  let ctx, base, admin, seeker, mentorId, mentorUsername;
  const callback = (body) => fetch(`${base}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const create = async (question = 'How do I choose a specialty?') => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(question) } });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r;
  };
  const view = async (id) => (await seeker.api(`/bookings/${id}`)).booking;

  before(async () => {
    ctx = await setup(4562, {
      PAYMENT_PROVIDER: 'tbc', TBC_API_KEY: fake.TBC_KEY, TBC_CLIENT_ID: fake.TBC_ID, TBC_CLIENT_SECRET: fake.TBC_SECRET,
      TBC_API_URL: fake.url
    });
    ({ base, admin, seeker, mentorId, mentorUsername } = ctx);
  });
  after(() => { if (ctx) ctx.srv.proc.kill(); });

  test('creates a GEL payment with the documented fields and returns the bank approval link', async () => {
    const r = await create();
    assert.equal(r.booking.provider, 'tbc');
    assert.match(r.booking.providerOrderId, /^tpay-/);
    assert.equal(r.checkoutUrl, `${fake.url}/checkout/${r.booking.providerOrderId}`);
    const req = fake.state.tbc.get(r.booking.providerOrderId).request;
    assert.deepEqual(req.amount, { currency: 'GEL', total: 25, subTotal: 25, tax: 0, shipping: 0 }); // (B2: the documented spelling)
    assert.equal(req.callbackUrl, `${base}/api/payments/callback`);
    assert.equal(req.returnurl, `${base}/u/${mentorUsername}?booking=${r.booking.id}&status=return`);
    assert.equal(req.merchantPaymentId, r.booking.id);
    assert.equal(req.expirationMinutes, 12, 'B1: capped at what TBC is known to accept');
    assert.equal(req.language, 'EN');
  });

  test('TBC callbacks are unsigned, so only the status lookup at the bank decides', async () => {
    const r = await create('Unsigned callback');
    const id = r.booking.providerOrderId;
    assert.equal((await callback({ PaymentId: id })).status, 200);
    assert.equal((await view(r.booking.id)).status, 'pending_payment', 'callback alone proves nothing');

    fake.tbcSet(id, 'Succeeded');
    assert.equal((await callback({ PaymentId: id })).status, 200);
    assert.equal((await view(r.booking.id)).status, 'paid');

    assert.equal((await callback({ PaymentId: 'tpay-unknown' })).status, 200, 'unknown payment ignored');
    assert.equal((await callback('this is not json')).status, 400);
    assert.equal((await callback({ nothing: true })).status, 400);
  });

  test('a failed payment closes the booking', async () => {
    const r = await create('Declined at TBC');
    fake.tbcSet(r.booking.providerOrderId, 'Failed');
    assert.equal((await callback({ PaymentId: r.booking.providerOrderId })).status, 200);
    assert.equal((await view(r.booking.id)).status, 'expired');
  });

  test('a refund is a cancel request for the amount and finishes when the bank reports it returned', async () => {
    const r = await create('Refund me via TBC');
    const id = r.booking.providerOrderId;
    fake.tbcSet(id, 'Succeeded');
    await callback({ PaymentId: id });
    const res = await admin.api(`/admin/bookings/${r.booking.id}/refund`, { method: 'POST' });
    assert.equal(res.booking.status, 'refund_pending');
    const call = fake.state.calls.find((c) => c.path === `/v1/tpay/payments/${id}/cancel`);
    assert.deepEqual(call.body, { amount: 25 });
    assert.equal(call.headers.apikey, fake.TBC_KEY);

    fake.tbcSet(id, 'Returned');
    await callback({ PaymentId: id });
    assert.equal((await view(r.booking.id)).status, 'refunded');
  });

  // docs/security-audit M2: TBC does not dedupe refunds, so a refund the bank is still processing is never marked failed (which would send
  // it again); only one the bank shows still paid with nothing returned is.
  test('a refund TBC is still processing is never sent again; one it shows still paid with nothing returned is', async () => {
    const r = await create('Refund me once via TBC');
    const id = r.booking.providerOrderId;
    fake.tbcSet(id, 'Succeeded');
    await callback({ PaymentId: id });
    assert.equal((await admin.api(`/admin/bookings/${r.booking.id}/refund`, { method: 'POST' })).booking.status, 'refund_pending');
    const cancels = () => fake.state.calls.filter((c) => c.path === `/v1/tpay/payments/${id}/cancel`).length;
    assert.equal(cancels(), 1);
    // (asked long ago, and the bank still says "processing": the sweep runs every second)
    await pool.query(`UPDATE bookings SET refund_requested_at = now() - interval '10 minutes' WHERE id = $1`, [r.booking.id]);
    await wait(3500);
    assert.equal((await row(r.booking.id)).refund_error, null, 'not marked failed');
    assert.equal(cancels(), 1, 'never sent twice');
    // The bank shows the payment still paid and nothing returned: then it is safe to ask again.
    fake.tbcSet(id, 'Succeeded', { returned: 0 });
    for (let i = 0; i < 40 && cancels() < 2; i++) await wait(250);
    assert.equal(cancels(), 2, 'sent again');
  });
});
