// What happens to a question from a 16-17-year-old (docs/CLAUDE-CODE-ASKERS-16-PLUS.md).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE, wait, longQuestion, longAnswer } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, adult, minor, paidMentor, paidMentorId, freeMentor, freeMentorId;

function bornAgo(years) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const signupMinor = (name, email) => signupVerified(base, name, email, 'test-pass-12345', { birthYm: bornAgo(17), parentPermission: true });
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(200);
  }
}
const row = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const ask = (c, mentorId, extra = {}) => c.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Which university should I choose for computer science?'), ...extra } });
async function payAtBank(c, booking) {
  await client(base).api(`/mock-bank/orders/${booking.providerOrderId}/complete`, { method: 'POST', body: { outcome: 'success' } });
  await c.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
  return waitFor(async () => { const b = await row(booking.id); return b.status === 'paid' ? b : null; });
}
async function makeMentor(name, email, price, niche = 'business') {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Career coach', niche, price, proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  return { c, id: (await c.api('/me')).user.id };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4792, { SWEEP_INTERVAL_SECONDS: '1', RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  adult = await signupVerified(base, 'Ana Adult', 'ana-adult@example.com');
  minor = await signupMinor('Luka Kapanadze', 'luka@example.com');
  ({ c: paidMentor, id: paidMentorId } = await makeMentor('Paid Pat', 'pat@example.com', 40));
  ({ c: freeMentor, id: freeMentorId } = await makeMentor('Free Fred', 'fred@example.com', 0));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('payments', () => {
  test('a minor asks a free mentor as normal, with no extra box', async () => {
    const r = await ask(minor, freeMentorId);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.free, true);
    const b = await row(r.booking.id);
    assert.equal(b.asker_minor, true);
    assert.equal(b.adult_payer_confirmed_at, null);
    assert.equal(b.amount, 0);
  });

  test('a paid mentor needs the adult-payer box from a minor, and nothing goes to the bank without it', async () => {
    const before_ = (await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
    const r = await ask(minor, paidMentorId);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'adult_payer_required');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, before_);
    const paid = await ask(minor, paidMentorId, { adultPayer: true });
    assert.equal(paid.status, 201, paid.text);
    assert.ok(paid.checkoutUrl);
    const b = await row(paid.booking.id);
    assert.ok(b.adult_payer_confirmed_at, 'the time they confirmed it is kept');
    assert.equal(b.asker_minor, true);
    // (the price, the fee and the mentor's share are what an adult's question has)
    assert.equal(b.amount, 4000);
    assert.equal(b.platform_fee_amount, 800);
    assert.equal(b.mentor_net_amount, 3200);
  });

  test('an adult is not asked, and the question is not marked as a minor\'s', async () => {
    const r = await ask(adult, paidMentorId);
    assert.equal(r.status, 201, r.text);
    const b = await row(r.booking.id);
    assert.equal(b.asker_minor, false);
    assert.equal(b.adult_payer_confirmed_at, null);
  });

  test('the refund after 7 days with no answer still works for a minor', async () => {
    const r = await ask(minor, paidMentorId, { adultPayer: true });
    const paid = await payAtBank(minor, r.booking);
    assert.ok(paid.paid_at);
    await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [r.booking.id]);
    const b = await waitFor(async () => { const x = await row(r.booking.id); return x.status === 'refunded' ? x : null; });
    assert.equal(b.refund_reason, 'no_answer_deadline');
    assert.equal(b.refunded_amount === null ? b.amount : b.refunded_amount, 4000);
  });
});
