// Flitt (server/pay/flitt.js, docs/BANK-GOLIVE.md): payments, refunds and IBAN payouts against a fake Flitt (tests/fakeFlitt.js) that
// checks every signature. The signature itself (Flitt's own example); callbacks believed only with a correct signature and only from Flitt's
// addresses, and even then the order's status is read from Flitt before a question counts as paid; a partial refund whose answer was lost is
// never returned twice (reverse_id); payouts with an admin's code every time, to the IBAN whose holder matches the verified ID, within the
// daily limit, "sending" until Flitt confirms, "failed" (money available again) when it refuses, and never paid twice.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, longQuestion, longAnswer, ageAnswer, SAMPLE } = require('./helpers');
const totp = require('../server/totp');
const { createFakeFlitt, signature } = require('./fakeFlitt');

process.env.WISECALL_NO_EXIT = '1';
const { encrypt } = require('../server/cryptoBox');

const fake = createFakeFlitt();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
const PASSWORD = 'test-pass-12345';
let srv, base, admin, adminSecret, mentor, mentorId, seeker;

// A valid Georgian IBAN for a 16-digit account (Flitt's test accounts end in 0001 approved, 0002 declined, 0003 processing).
function iban(account16, bank = 'TB') {
  const digits = (s) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const rest = BigInt(digits(`${bank}${account16}GE00`)) % 97n;
  return `GE${String(98n - rest).padStart(2, '0')}${bank}${account16}`;
}
const ENV = () => ({
  PAYMENT_PROVIDER: 'flitt', FLITT_MERCHANT_ID: String(fake.MERCHANT_ID), FLITT_SECRET_KEY: fake.SECRET, FLITT_PAYOUT_SECRET_KEY: fake.PAYOUT_SECRET,
  FLITT_API_URL: fake.url, FLITT_CALLBACK_IPS: '127.0.0.1,::1', PAYOUT_METHOD: 'flitt_iban', PAYOUT_DAILY_LIMIT_GEL: '100', PAYOUT_MIN_GEL: '1',
  RATE_LIMIT_MULTIPLIER: '20', SWEEP_INTERVAL_SECONDS: '1'
});
const callback = (b, body) => fetch(`http://127.0.0.1:${new URL(b).port}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function freshCode() { await pool.query('UPDATE admin_two_factor SET last_step = 0 WHERE user_id = (SELECT id FROM users WHERE email = $1)', ['qa-admin@example.com']); return totp.code(adminSecret); }

// A question asked and paid at the fake Flitt (the buyer pays on Flitt's page, Flitt calls back). -> { booking, orderId }
async function paidQuestion(text) {
  const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(text) } });
  assert.equal(r.status, 201, r.text);
  const orderId = r.booking.providerOrderId;
  fake.pay(orderId, 'approved');
  assert.equal((await callback(base, fake.callbackFor(orderId))).status, 200);
  assert.equal((await sql('SELECT status FROM bookings WHERE id = $1', [r.booking.id]))[0].status, 'paid');
  return { booking: r.booking, orderId };
}
// The mentor's payout details, and the verified name on their ID (what the payout name must match).
async function payoutTo(account16, holder = 'Mika Host') {
  await pool.query(`UPDATE users SET payout_hold_until = NULL WHERE id = $1`, [mentorId]);
  const r = await mentor.api('/me/payout', { method: 'PUT', body: { name: holder, iban: iban(account16), currentPassword: PASSWORD } });
  assert.equal(r.status, 200, r.text);
  await pool.query(`UPDATE users SET payout_hold_until = NULL WHERE id = $1`, [mentorId]);
  await pool.query(`UPDATE mentor_flags SET status = 'resolved' WHERE mentor_id = $1`, [mentorId]);
}
// An answered question whose payout is available now, and a withdrawal request for it. -> the request id
async function requestedPayout(text) {
  const { booking } = await paidQuestion(text);
  assert.equal((await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is what I would do.') } })).status, 200);
  await ageAnswer(booking.id, 30);
  await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE booking_id = $1`, [booking.id]);
  const w = await mentor.api('/me/withdrawals', { method: 'POST', body: { currentPassword: PASSWORD } });
  assert.equal(w.status, 201, w.text);
  return w.request.id;
}

before(async () => {
  await fake.start();
  await resetDatabase();
  srv = await startServer(4767, ENV());
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const s = await admin.api('/admin/2fa/setup', { method: 'POST', body: {} });
  adminSecret = s.secret;
  assert.equal((await admin.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(adminSecret) } })).status, 200);
  mentor = await signupVerified(base, 'Mika Host', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Software engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await pool.query(`INSERT INTO kyc_sessions (user_id, provider, provider_session_id, status, verified_name_enc, country, decided_at)
                    VALUES ($1, 'mock', 'flitt-test', 'approved', $2, 'GEO', now())`, [mentorId, encrypt('Mika Host')]);
  await payoutTo('0000000000000001');
  seeker = await signupVerified(base, 'Sam Seeker', 'sam@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await fake.stop(); await pool.end(); });

describe('the signature', () => {
  test('Flitt\'s own example: the secret, then the non-empty values in the order of their names, joined with "|", SHA-1', () => {
    const params = { server_callback_url: 'http://myshop/callback/', order_id: 'TestOrder2', currency: 'GEL', merchant_id: 1549901, order_desc: 'Test payment', amount: 1000, empty: '' };
    const expected = crypto.createHash('sha1').update('test|1000|GEL|1549901|Test payment|TestOrder2|http://myshop/callback/').digest('hex');
    assert.equal(signature(params, 'test'), expected);
    // (the server's implementation is the same; the fake checks every request it is sent with its own)
    const flitt = require('../server/pay/flitt');
    assert.equal(flitt.signature(params, 'test'), expected);
    assert.equal(flitt.signature({ ...params, signature: 'x', response_signature_string: 'y' }, 'test'), expected);
  });
});

describe('payments', () => {
  test('the buyer is sent to Flitt\'s page; a signed callback from Flitt, confirmed by the status request, makes the question paid', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('How do I plan my first year as a backend developer?') } });
    assert.equal(r.status, 201, r.text);
    assert.match(r.checkoutUrl, /^https:\/\/pay\.flitt\.example\//);
    const order = fake.state.orders.get(r.booking.providerOrderId);
    assert.equal(order.amount, 2500);
    assert.equal(order.request.currency, 'GEL');
    assert.match(order.request.response_url, /\/api\/payments\/flitt\/return\?next=/);
    assert.match(order.request.server_callback_url, /\/api\/payments\/callback$/);
    // A forged callback (wrong signature) is refused; a genuine one about an order Flitt still calls "created" changes nothing.
    assert.equal((await callback(base, fake.callbackFor(r.booking.providerOrderId, { tamper: true }))).status, 400);
    const early = { ...fake.callbackFor(r.booking.providerOrderId), order_status: 'approved' };
    early.signature = signature(early, fake.SECRET);
    assert.equal((await callback(base, early)).status, 200);
    assert.equal((await sql('SELECT status FROM bookings WHERE id = $1', [r.booking.id]))[0].status, 'pending_payment', 'only Flitt\'s status counts');
    fake.pay(r.booking.providerOrderId, 'approved');
    assert.equal((await callback(base, fake.callbackFor(r.booking.providerOrderId))).status, 200);
    assert.equal((await sql('SELECT status FROM bookings WHERE id = $1', [r.booking.id]))[0].status, 'paid');
  });

  test('a callback from an address that is not Flitt\'s is refused, even when signed', async () => {
    const other = await startServer(4768, { ...ENV(), FLITT_CALLBACK_IPS: '203.0.113.9' });
    try {
      const { orderId } = await paidQuestion('How do I choose between two offers with different salaries?');
      assert.equal((await callback(other.base, fake.callbackFor(orderId))).status, 400);
    } finally { other.proc.kill(); }
  });

  test('the return from Flitt\'s page goes back to this site only', async () => {
    const back = await fetch(`${base}/api/payments/flitt/return?next=${encodeURIComponent(`${base}/u/x?booking=1&status=return`)}`, { method: 'POST', redirect: 'manual' });
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), `${base}/u/x?booking=1&status=return`);
    const away = await fetch(`${base}/api/payments/flitt/return?next=${encodeURIComponent('https://evil.example/')}`, { method: 'POST', redirect: 'manual' });
    assert.equal(away.headers.get('location'), `${base}/dashboard.html`);
  });
});

describe('refunds', () => {
  test('a partial refund whose answer was lost is never returned twice (the bank is asked; the same reverse_id again changes nothing)', async () => {
    const { booking, orderId } = await paidQuestion('How do I ask my manager for a promotion without sounding pushy?');
    assert.equal((await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('My answer.') } })).status, 200);
    assert.equal((await seeker.api(`/bookings/${booking.id}/dispute`, { method: 'POST', body: { reason: 'not_an_answer', details: 'It does not answer.' } })).status, 201);
    const [d] = await sql('SELECT id FROM disputes WHERE booking_id = $1', [booking.id]);
    fake.state.loseNextReverseAnswer = true;
    const r = await admin.api(`/admin/disputes/${d.id}/resolve`, { method: 'POST', body: { outcome: 'partial_refund', amount: 1000, note: 'Part of it missed the point.' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(fake.state.orders.get(orderId).reversed, 1000);
    assert.equal((await sql('SELECT refunded_amount FROM bookings WHERE id = $1', [booking.id]))[0].refunded_amount, 1000);
    // The full refund of what is left: only 15 GEL more, under its own reverse_id; pressed twice, still once.
    assert.equal((await admin.api(`/admin/bookings/${booking.id}/refund`, { method: 'POST' })).status, 200);
    assert.equal((await admin.api(`/admin/bookings/${booking.id}/refund`, { method: 'POST' })).status, 200);
    assert.equal(fake.state.orders.get(orderId).reversed, 2500, 'never more than was paid');
    const reverses = fake.state.calls.filter((c) => c.path === '/api/reverse/order_id' && c.request.order_id === orderId);
    assert.ok(new Set(reverses.map((c) => c.request.reverse_id)).size === 2);
  });
});

describe('payouts (PAYOUT_METHOD=flitt_iban)', () => {
  test('a wrong code sends nothing; the right one sends the money to the verified holder\'s IBAN, and the request is paid once Flitt confirms', async () => {
    const id = await requestedPayout('What should I learn first to become a backend developer at a startup?');
    const wrong = await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: '000000' } });
    assert.equal(wrong.status, 403);
    assert.equal(fake.state.payouts.size, 0);
    const r = await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.request.status, 'paid');
    const p = fake.state.payouts.get(`payout-${id}`);
    assert.equal(p.iban, iban('0000000000000001'));
    assert.equal(p.name, 'Mika Host');
    assert.equal(p.request.currency, 'GEL');
    assert.equal(p.amount, (await sql('SELECT amount FROM payout_batches WHERE id = $1', [id]))[0].amount);
    const [b] = await sql('SELECT status, reference FROM payout_batches WHERE id = $1', [id]);
    assert.deepEqual([b.status, b.reference], ['paid', `flitt:${p.payment_id}`]);
    // (sending it again changes nothing: it is not open any more)
    assert.equal((await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } })).status, 409);
  });

  test('Flitt refuses: the request fails with the reason and the money is available to the mentor again', async () => {
    await payoutTo('0000000000000002');
    const id = await requestedPayout('How do I prepare for my first technical interview next month?');
    const r = await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.request.status, 'failed');
    assert.ok((await mentor.api('/me/balance')).balance.available > 0, 'available again');
    await payoutTo('0000000000000001');
  });

  test('no answer from Flitt: the request stays "sending"; it is sent again with the same order id only when Flitt never got it, and paid once', async () => {
    const id = await requestedPayout('How do I explain a gap year on my CV to a recruiter at a bank?');
    fake.state.payoutDown = true;
    const r = await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.request.status, 'sending');
    fake.state.payoutDown = false;
    await pool.query(`UPDATE payout_batches SET send_started_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    await admin.api(`/admin/withdrawals/${id}/sync`, { method: 'POST' }); // (Flitt does not know it: sent again, same id)
    const done = await admin.api(`/admin/withdrawals/${id}/sync`, { method: 'POST' });
    assert.equal(done.request.status, 'paid');
    assert.equal(fake.state.calls.filter((c) => c.path === '/api/ibancredit' && c.request.order_id === `payout-${id}`).length, 2, 'asked twice');
    assert.equal([...fake.state.payouts.keys()].filter((k) => k === `payout-${id}`).length, 1, 'paid once');
  });

  test('the payout name must match the verified ID, and a day never sends more than PAYOUT_DAILY_LIMIT_GEL', async () => {
    await payoutTo('0000000000000001', 'Somebody Else');
    const id = await requestedPayout('Should I take a course before applying for my first developer job?');
    assert.equal((await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } })).error, 'name_mismatch');
    await payoutTo('0000000000000001');
    // (100 GEL a day in this test; 25 GEL questions: 20 GEL a payout after the fee, several sent today already)
    await pool.query(`UPDATE payout_batches SET amount = 9000 WHERE id = $1`, [id]);
    const r = await admin.api(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code: await freshCode() } });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.error, 'daily_limit');
  });
});
