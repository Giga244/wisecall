const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const Stripe = require('stripe');
const { resetDatabase, startServer, signupVerified, SAMPLE } = require('./helpers');
const { createFakeStripe } = require('./fakeStripe');

const SECRET = 'whsec_test_secret';
const fake = createFakeStripe();
const signer = Stripe('sk_test_signer');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, mentor, mentorId;
let evtCounter = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(300);
  }
}

function signedEvent(type, object, id = `evt_test_${++evtCounter}`) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  return { id, payload, header: signer.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}
const postEvent = (e, header = e.header) => fetch(base + '/api/webhook/stripe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: e.payload
});

async function approveMentor(name, email) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Doctor', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/' + name.replace(/\W/g, ''), sampleAnswer: SAMPLE } });
  const id = (await c.api('/me')).user.id;
  const ok = await admin.api(`/admin/mentors/${id}/review`, { method: 'POST', body: { approve: true, checks: { identity: true, credential: true, sample: true } } });
  assert.equal(ok.mentor.verificationStatus, 'verified');
  return { client: c, id };
}

// Creates a booking and completes payment through a signed webhook. Returns ids for assertions.
async function paidBooking(question = 'How do I choose a specialty?') {
  const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question } });
  assert.equal(r.status, 201, JSON.stringify(r));
  const session = fake.completeSession(r.booking.stripeSessionId);
  const res = await postEvent(signedEvent('checkout.session.completed', session));
  assert.equal(res.status, 200);
  const booking = (await seeker.api(`/bookings/${r.booking.id}`)).booking;
  assert.equal(booking.status, 'paid');
  return { id: r.booking.id, session, booking };
}
const row = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];

before(async () => {
  await resetDatabase();
  const fakePort = await fake.start();
  srv = await startServer(4561, {
    STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake', STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_API_HOST: 'localhost', STRIPE_API_PORT: String(fakePort), SWEEP_INTERVAL_SECONDS: '1', ANSWER_DEADLINE_DAYS: '7'
  });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
});
after(async () => {
  if (srv) srv.proc.kill();
  await fake.stop();
  await pool.end();
});

describe('mentor payouts gate', () => {
  test('an approved mentor is hidden and cannot be booked until payouts are connected', async () => {
    ({ client: mentor, id: mentorId } = await approveMentor('Dr Payout', 'mentor@example.com'));
    assert.equal((await seeker.api('/experts')).experts.length, 0);
    const b = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Can I pay a mentor without payouts?' } });
    assert.equal(b.status, 404);
  });

  test('onboarding is refused for applicants who are not approved yet', async () => {
    const pending = await signupVerified(base, 'Pending Person', 'pending@example.com');
    await pending.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'X', niche: 'tech', price: 10, proofUrl: 'https://linkedin.com/in/p', sampleAnswer: SAMPLE } });
    assert.equal((await pending.api('/connect/onboard', { method: 'POST' })).error, 'not_verified');
  });

  test('onboarding creates an account; the mentor appears only once Stripe says payouts are active', async () => {
    const o = await mentor.api('/connect/onboard', { method: 'POST' });
    assert.match(o.url, /^https:\/\/connect\.stripe\.test/);
    assert.equal((await mentor.api('/connect/status')).payoutsReady, false);
    assert.equal((await seeker.api('/experts')).experts.length, 0);

    fake.state.accountReady = true;
    assert.equal((await mentor.api('/connect/status')).payoutsReady, true);
    assert.equal((await seeker.api('/experts')).experts.length, 1);
  });

  test('account.updated webhook switches payouts off and on', async () => {
    const acct = (await mentor.api('/me')).user.stripeAccountId;
    await postEvent(signedEvent('account.updated', { id: acct, payouts_enabled: false, capabilities: { transfers: 'inactive' } }));
    assert.equal((await seeker.api('/experts')).experts.length, 0);
    await postEvent(signedEvent('account.updated', { id: acct, payouts_enabled: true, capabilities: { transfers: 'active' } }));
    assert.equal((await seeker.api('/experts')).experts.length, 1);
  });
});

describe('paying for a question', () => {
  let booking;

  test('booking starts a Checkout Session and stays unpaid; the success redirect alone changes nothing', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'What is the best way to prepare?' } });
    assert.equal(r.status, 201);
    assert.match(r.checkoutUrl, /checkout\.stripe\.test/);
    assert.equal(r.booking.status, 'pending_payment');
    assert.equal(r.booking.platformFeeAmount, 500);
    booking = r.booking;
    fake.completeSession(booking.stripeSessionId);
    await fetch(`${base}/expert.html?id=${mentorId}&booking=${booking.id}&status=success`);
    assert.equal((await seeker.api(`/bookings/${booking.id}`)).booking.status, 'pending_payment');
  });

  test('a webhook with a bad signature is rejected and changes nothing', async () => {
    const e = signedEvent('checkout.session.completed', fake.state.sessions[booking.stripeSessionId]);
    const res = await postEvent(e, 't=1,v1=deadbeef');
    assert.equal(res.status, 400);
    assert.equal((await seeker.api(`/bookings/${booking.id}`)).booking.status, 'pending_payment');
  });

  test('a signed webhook marks it paid and starts the 7-day answer clock; replays are ignored', async () => {
    const e = signedEvent('checkout.session.completed', fake.state.sessions[booking.stripeSessionId]);
    assert.equal((await postEvent(e)).status, 200);
    const b = (await seeker.api(`/bookings/${booking.id}`)).booking;
    assert.equal(b.status, 'paid');
    const days = (new Date(b.answerDeadline) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1, `deadline ${days} days away`);
    assert.equal((await postEvent(e)).status, 200);
    assert.equal(Number((await pool.query('SELECT count(*) FROM stripe_events WHERE id = $1', [e.id])).rows[0].count), 1);
  });

  test('a payment for the wrong amount is never accepted', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Tampered amount question?' } });
    const session = { ...fake.completeSession(r.booking.stripeSessionId), amount_total: 100 };
    await postEvent(signedEvent('checkout.session.completed', session));
    assert.equal((await seeker.api(`/bookings/${r.booking.id}`)).booking.status, 'pending_payment');
  });

  test('answering pays the mentor 80%: a transfer tied to the buyer\'s charge, sent once', async () => {
    const a = await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: 'Shadow in different specialties first.' } });
    assert.equal(a.booking.status, 'answered');
    assert.ok(a.booking.transferredAt, 'transfer recorded');
    const t = fake.calls('POST', '/v1/transfers').filter((c) => c.body.metadata && c.body.metadata.bookingId === booking.id);
    assert.equal(t.length, 1);
    assert.equal(t[0].body.amount, '2000');
    assert.match(t[0].body.source_transaction, /^ch_for_pi_/);
    assert.equal(t[0].key, `transfer-${booking.id}`);
    // Editing the answer later must not pay twice.
    await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: 'Edited answer text.' } });
    assert.equal(fake.calls('POST', '/v1/transfers').filter((c) => c.body.metadata && c.body.metadata.bookingId === booking.id).length, 1);
  });
});

describe('when things go wrong', () => {
  test('a failed payout is recorded, the answer is kept, and it is retried automatically', async () => {
    fake.state.failTransfers = true;
    const { id } = await paidBooking('Will my payout be retried?');
    const a = await mentor.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer: 'Yes, it will be retried.' } });
    assert.equal(a.booking.status, 'answered');
    assert.equal(a.booking.stripeTransferId, null);
    assert.match(a.booking.transferError, /Simulated transfer failure/);

    fake.state.failTransfers = false;
    const done = await waitFor(async () => { const r = await row(id); return r.stripe_transfer_id ? r : null; });
    assert.equal(done.transfer_error, null);
  });

  test('a mentor who never answers: the buyer is refunded automatically and nothing is paid out', async () => {
    const { id } = await paidBooking('Will this be auto-refunded?');
    await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 hour' WHERE id = $1`, [id]);
    const r = await waitFor(async () => { const x = await row(id); return x.status === 'refunded' ? x : null; });
    assert.equal(r.refund_reason, 'no_answer_deadline');
    const refunds = fake.calls('POST', '/v1/refunds').filter((c) => c.body.metadata && c.body.metadata.bookingId === id);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].key, `refund-${id}`);
    assert.ok(refunds[0].body.payment_intent);
    assert.equal(fake.calls('POST', '/v1/transfers').filter((c) => c.body.metadata && c.body.metadata.bookingId === id).length, 0);
    assert.equal((await mentor.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer: 'too late' } })).error, 'not_paid');
  });

  test('a mentor is reminded before the deadline (once)', async () => {
    const { id } = await paidBooking('Reminder question please?');
    await pool.query(`UPDATE bookings SET answer_deadline = now() + interval '24 hours' WHERE id = $1`, [id]);
    const r = await waitFor(async () => { const x = await row(id); return x.reminder_sent_at ? x : null; });
    assert.equal(r.status, 'paid');
  });

  test('an abandoned checkout expires and can never be paid afterwards', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Abandoned checkout question?' } });
    const session = fake.expireSession(r.booking.stripeSessionId);
    await postEvent(signedEvent('checkout.session.expired', session));
    assert.equal((await seeker.api(`/bookings/${r.booking.id}`)).booking.status, 'expired');
    await postEvent(signedEvent('checkout.session.completed', { ...session, payment_status: 'paid', payment_intent: 'pi_late' }));
    assert.equal((await seeker.api(`/bookings/${r.booking.id}`)).booking.status, 'expired');
  });

  test('a missed webhook is caught by the background check (asks Stripe, not the browser)', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Missed webhook question?' } });
    fake.completeSession(r.booking.stripeSessionId);
    await pool.query(`UPDATE bookings SET created_at = now() - interval '50 minutes' WHERE id = $1`, [r.booking.id]);
    const b = await waitFor(async () => { const x = await row(r.booking.id); return x.status === 'paid' ? x : null; });
    assert.ok(b.stripe_payment_intent_id);
  });

  test('an unpaid booking that Stripe says expired is closed by the background check', async () => {
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: 'Expired session question?' } });
    fake.expireSession(r.booking.stripeSessionId);
    await pool.query(`UPDATE bookings SET created_at = now() - interval '50 minutes' WHERE id = $1`, [r.booking.id]);
    await waitFor(async () => (await row(r.booking.id)).status === 'expired');
  });

  test('a refund made in the Stripe dashboard is mirrored', async () => {
    const { id, booking } = await paidBooking('Dashboard refund question?');
    const pi = (await row(id)).stripe_payment_intent_id;
    await postEvent(signedEvent('charge.refunded', { id: 'ch_x', refunded: true, payment_intent: pi }));
    const r = await row(id);
    assert.equal(r.status, 'refunded');
    assert.equal(r.refund_reason, 'refunded_in_stripe');
  });
});
