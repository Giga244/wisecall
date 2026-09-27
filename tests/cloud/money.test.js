// Money edge cases (docs/AUDIT.md): callbacks that arrive twice or late, refunds whose answer was lost, an answer racing a refund, an answer
// after the deadline, and the platform fee for every price. The bank is the fake BOG/TBC bank of tests/fakeBank.js; nothing real is called.
// Tests marked { todo: 'AUDIT #n' } show a problem that exists today: they are expected to fail until the finding is fixed.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { client, bookAndPay, longQuestion, longAnswer } = require('../helpers');
const { createFakeBank } = require('../fakeBank');
const { pool, waitFor, bookingRow, payoutRow, marketplace } = require('./_shared');

const fake = createFakeBank();
before(async () => { await fake.start(); });
after(async () => { await fake.stop(); await pool.end(); });

const bogEnv = () => ({
  PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: fake.BOG_ID, BOG_CLIENT_SECRET: fake.BOG_SECRET,
  BOG_API_URL: fake.url, BOG_AUTH_URL: `${fake.url}/bog-oauth/token`,
  BOG_CALLBACK_PUBLIC_KEY: fake.publicKeyPem.replace(/\n/g, '\\n'),
  SWEEP_INTERVAL_SECONDS: '1', PAYMENT_TTL_MINUTES: '30'
});

describe('bank callbacks and refunds (BOG)', () => {
  let ctx;
  const callback = (orderId) => { const p = fake.bogCallback(orderId); return fetch(`${ctx.base}/api/payments/callback`, { method: 'POST', headers: p.headers, body: p.body }); };
  const create = async (q = 'How should I plan my first data engineering project?') => {
    const r = await ctx.seeker.api('/bookings', { method: 'POST', body: { mentorId: ctx.mentorId, question: longQuestion(q) } });
    assert.equal(r.status, 201, r.text);
    return r.booking;
  };
  const payAtBank = async (b) => {
    fake.bogSet(b.providerOrderId, 'completed');
    assert.equal((await callback(b.providerOrderId)).status, 200);
    return waitFor(async () => { const row = await bookingRow(b.id); return row.status === 'paid' ? row : null; });
  };

  before(async () => { ctx = await marketplace(4801, bogEnv()); });
  after(() => { if (ctx) ctx.srv.proc.kill(); });

  test('the same callback twice (and five at once) marks the booking paid exactly once', async () => {
    const b = await create();
    fake.bogSet(b.providerOrderId, 'completed');
    assert.equal((await callback(b.providerOrderId)).status, 200);
    const first = await waitFor(async () => { const row = await bookingRow(b.id); return row.status === 'paid' ? row : null; });
    assert.ok(first, 'booking should be paid');
    const statuses = await Promise.all([1, 2, 3, 4, 5].map(() => callback(b.providerOrderId).then((r) => r.status)));
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    const again = await bookingRow(b.id);
    assert.equal(again.status, 'paid');
    assert.equal(new Date(again.paid_at).getTime(), new Date(first.paid_at).getTime(), 'paid_at must not move');
    assert.equal(new Date(again.answer_deadline).getTime(), new Date(first.answer_deadline).getTime(), 'the deadline must not move');
  });

  test('a paid status for the wrong amount is never accepted', async () => {
    const b = await create();
    fake.bogSet(b.providerOrderId, 'completed', { amount: 1 });
    await callback(b.providerOrderId);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await bookingRow(b.id)).status, 'pending_payment');
  });

  test('a late "paid" from the bank on a booking the sweep already expired is not lost (booking paid, or refunded at once)', { todo: 'AUDIT #4' }, async () => {
    const b = await create();
    // The bank order is still open, but the booking is older than PAYMENT_TTL_MINUTES + 10, so the sweep closes it.
    await pool.query(`UPDATE bookings SET created_at = now() - interval '2 hours' WHERE id = $1`, [b.id]);
    const expired = await waitFor(async () => ((await bookingRow(b.id)).status === 'expired' ? true : null));
    assert.ok(expired, 'the sweep should have expired the booking');
    // Then the buyer's payment completes after all (3-D Secure, a slow bank) and the bank calls back.
    fake.bogSet(b.providerOrderId, 'completed');
    assert.equal((await callback(b.providerOrderId)).status, 200);
    const handled = await waitFor(async () => {
      const row = await bookingRow(b.id);
      const refundAsked = fake.state.calls.some((c) => c.path.includes(`/refund/${b.providerOrderId}`));
      return row.status === 'paid' || refundAsked || ['refund_pending', 'refunded'].includes(row.status);
    }, 6000);
    assert.ok(handled, 'money taken for an expired booking must be recorded or returned');
  });

  test('a refund the bank rejected is retried by the sweep with the same idempotency key, and completes', async () => {
    const b = await payAtBank(await create());
    assert.ok(b);
    fake.state.rejectRefunds = true;
    const r = await ctx.admin.api(`/admin/bookings/${b.id}/refund`, { method: 'POST' });
    assert.equal(r.status, 502);
    assert.ok((await bookingRow(b.id)).refund_error, 'the error is recorded');
    fake.state.rejectRefunds = false;
    const accepted = await waitFor(async () => (fake.state.bog.get(b.provider_order_id).status === 'refund_requested' ? true : null));
    assert.ok(accepted, 'the sweep should have asked again');
    fake.bogFinishRefund(b.provider_order_id);
    // (the sweep asks about an accepted refund once it is a minute old: make it look older instead of waiting)
    await pool.query(`UPDATE bookings SET refund_requested_at = now() - interval '2 minutes' WHERE id = $1`, [b.id]);
    const done = await waitFor(async () => ((await bookingRow(b.id)).status === 'refunded' ? true : null));
    assert.ok(done, 'the booking should end refunded');
    const keys = fake.state.calls.filter((c) => c.path.includes(`/refund/${b.provider_order_id}`)).map((c) => c.headers['idempotency-key']);
    assert.ok(keys.length >= 2);
    assert.equal(new Set(keys).size, 1, 'every attempt must carry the same Idempotency-Key');
  });

  test('a refund whose response was lost (timeout) but that the bank carried out ends "refunded"', { todo: 'AUDIT #5' }, async () => {
    const b = await payAtBank(await create());
    assert.ok(b);
    // What a timeout leaves behind: the bank has the refund, our database only has the error of the request that timed out.
    fake.bogSet(b.provider_order_id, 'refunded');
    await pool.query(`UPDATE bookings SET status = 'refund_pending', refund_reason = 'admin', refund_requested_at = now() - interval '5 minutes',
                        refund_error = 'network error calling bank: The operation was aborted due to timeout' WHERE id = $1`, [b.id]);
    const done = await waitFor(async () => ((await bookingRow(b.id)).status === 'refunded' ? true : null), 8000);
    assert.ok(done, 'the booking should not stay refund_pending forever');
  });

  test('the payout ledger records exactly the mentor share once a question is answered', async () => {
    const b = await payAtBank(await create());
    const r = await ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is my plan for you.') } });
    assert.equal(r.status, 200, r.text);
    const p = await payoutRow(b.id);
    assert.equal(p.amount, b.mentor_net_amount);
    assert.equal(p.status, 'pending');
    assert.equal(b.platform_fee_amount + b.mentor_net_amount, b.amount);
  });

  test('an answer racing an admin refund never leaves a pending payout on a refunded booking', { todo: 'AUDIT #6 (a race: may pass on a given run)' }, async () => {
    const paid = [];
    for (let i = 0; i < 8; i++) paid.push(await payAtBank(await create(`Race question number ${i}: which database should I pick for a startup?`)));
    await Promise.all(paid.map((b) => Promise.all([
      ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`Answer ${b.id}.`) } }),
      ctx.admin.api(`/admin/bookings/${b.id}/refund`, { method: 'POST' })
    ])));
    const { rows } = await pool.query(
      `SELECT b.id FROM bookings b JOIN payouts p ON p.booking_id = b.id
        WHERE b.id = ANY($1::uuid[]) AND b.status IN ('refund_pending', 'refunded') AND p.status = 'pending'`, [paid.map((b) => b.id)]);
    assert.deepEqual(rows, [], 'a refunded booking must not keep a payable mentor share');
  });
});

describe('answering after the deadline', () => {
  let ctx;
  // The sweep runs rarely here, so the gap between the deadline and the automatic refund is visible.
  before(async () => { ctx = await marketplace(4802, { SWEEP_INTERVAL_SECONDS: '3600' }); });
  after(() => { if (ctx) ctx.srv.proc.kill(); });

  test('an answer before the deadline is accepted', async () => {
    const b = await bookAndPay(ctx.base, ctx.seeker, ctx.mentorId, 'What should I learn first as a junior engineer?');
    assert.equal(b.status, 'paid');
    const r = await ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Learn the basics well.') } });
    assert.equal(r.status, 200, r.text);
  });

  test('an answer after the deadline is refused (the buyer is owed a refund)', { todo: 'AUDIT #7' }, async () => {
    const b = await bookAndPay(ctx.base, ctx.seeker, ctx.mentorId, 'Is it too late to switch careers into software at 35?');
    assert.equal(b.status, 'paid');
    await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [b.id]);
    const r = await ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('It is never too late.') } });
    assert.ok(r.status >= 400 && r.status < 500, `expected a refusal, got ${r.status}`);
    assert.equal((await bookingRow(b.id)).answer, null);
  });

  test('a second answer is always refused and the first one is kept', async () => {
    const b = await bookAndPay(ctx.base, ctx.seeker, ctx.mentorId, 'How do I prepare for a system design interview?');
    const answers = await Promise.all([1, 2, 3].map((n) => ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`Version ${n} of my answer.`) } })));
    assert.equal(answers.filter((r) => r.status === 200).length, 1);
    assert.ok(answers.filter((r) => r.status !== 200).every((r) => r.status === 409));
    const row = await bookingRow(b.id);
    const winner = answers.find((r) => r.status === 200);
    assert.equal(row.answer, winner.booking.answer);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [b.id])).rows[0].n, 1);
  });
});

// Every whole-lari price a mentor can set (5..2000 GEL): the amount is exact in tetri, fee + mentor share always add up to the amount,
// and the fee is the configured percent rounded to the nearest tetri.
async function feeSweep(port, feePercent) {
  const ctx = await marketplace(port, { SWEEP_INTERVAL_SECONDS: '3600', PLATFORM_FEE_PERCENT: String(feePercent) });
  try {
    const cfg = await client(ctx.base).api('/config');
    assert.equal(cfg.platformFeePercent, feePercent);
    const problems = [];
    for (let price = cfg.priceMin; price <= cfg.priceMax; price++) {
      const p = await ctx.mentor.api('/me', { method: 'PATCH', body: { price } });
      if (p.status !== 200) { problems.push(`${price}: price refused (${p.status})`); continue; }
      const r = await ctx.seeker.api('/bookings', { method: 'POST', body: { mentorId: ctx.mentorId, question: longQuestion(`Price check ${price}.`) } });
      if (r.status !== 201) { problems.push(`${price}: booking ${r.status}`); continue; }
      const b = r.booking;
      const exactFee = price * 100 * feePercent / 100;
      if (b.amount !== price * 100) problems.push(`${price}: amount ${b.amount}`);
      if (!Number.isInteger(b.platformFeeAmount) || !Number.isInteger(b.mentorNetAmount)) problems.push(`${price}: not whole tetri`);
      if (b.platformFeeAmount + b.mentorNetAmount !== b.amount) problems.push(`${price}: fee + net != amount`);
      if (Math.abs(b.platformFeeAmount - exactFee) > 0.5) problems.push(`${price}: fee ${b.platformFeeAmount} vs ${exactFee}`);
      if (b.platformFeeAmount !== Math.round(exactFee)) problems.push(`${price}: fee not rounded to nearest tetri`);
    }
    await pool.query(`DELETE FROM bookings WHERE status = 'pending_payment'`); // (keep the test database small)
    return { problems, checked: cfg.priceMax - cfg.priceMin + 1, range: [cfg.priceMin, cfg.priceMax] };
  } finally { ctx.srv.proc.kill(); }
}

describe('platform fee for every price', () => {
  test('20% (the default): exact for every price from 5 to 2000 GEL', async () => {
    const r = await feeSweep(4803, 20);
    assert.deepEqual(r.range, [5, 2000]);
    assert.deepEqual(r.problems, []);
  });
  test('17.5% (a fee that needs rounding): fee rounded to the nearest tetri, never a tetri lost', { todo: 'AUDIT #18' }, async () => {
    const r = await feeSweep(4804, 17.5);
    assert.deepEqual(r.problems, []);
  });
});
