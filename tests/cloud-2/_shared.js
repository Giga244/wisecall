// Shared setup for the REVIEW-2 tests (docs/REVIEW-2.md). Not a test file itself: run the suite with
//   node --test --test-concurrency=1 tests/cloud-2/*.test.js
// It reuses tests/helpers.js and tests/cloud/_shared.js and only adds the steps these tests repeat: a paid and answered question, a
// published live session with paid tickets, and raw requests that leave out the CSRF header.
const assert = require('node:assert/strict');
const { client, signupVerified, bookAndPay, longAnswer, wait } = require('../helpers');
const { BASE_ENV, pool, waitFor, marketplace } = require('../cloud/_shared');

const sql = async (q, p) => (await pool.query(q, p)).rows;

async function until(fn, message, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${message}`);
    await wait(150);
  }
}

// A question paid at the fake bank (PAYMENT_PROVIDER=mock) and answered by the mentor. -> booking id
async function answered(ctx, question, asker = ctx.seeker) {
  const b = await bookAndPay(ctx.base, asker, ctx.mentorId, question);
  assert.equal(b.status, 'paid', JSON.stringify(b));
  const r = await ctx.mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is what I would do in your place, step by step.') } });
  assert.equal(r.status, 200, r.text);
  return b.id;
}

// ---- Live sessions (LIVE_PROVIDER=fake) ---------------------------------------------------------------------------------------------
const day = (d) => new Date(Date.now() + d * 86400000 + 4 * 3600000).toISOString().slice(0, 10);
const draft = (over = {}) => ({
  title: 'Review session about careers in tech', description: 'An hour of answers about first jobs, interviews and growing in the field, for anyone starting out.',
  learnPoints: ['How to prepare', 'What to ask'], niche: 'tech', kind: 'qa', language: 'en', date: day(3), time: '19:00', durationMin: 60, price: 20,
  maxSeats: 30, minSeats: 1, ...over
});
async function published(ctx, over = {}) {
  await ctx.admin.api(`/admin/live/hosts/${ctx.mentorId}`, { method: 'POST' }); // (allowed to host without waiting for an answer)
  const c = await ctx.mentor.api('/live', { method: 'POST', body: draft(over) });
  assert.equal(c.status, 201, c.text);
  const p = await ctx.mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
  assert.equal(p.status, 200, p.text);
  if (p.session.status === 'review') assert.equal((await ctx.admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
  return (await sql('SELECT * FROM live_sessions WHERE id = $1', [c.session.id]))[0];
}
const orderOf = (checkoutUrl) => new URL(checkoutUrl).searchParams.get('order');
const bankPays = (base, checkoutUrl) => client(base).api(`/mock-bank/orders/${orderOf(checkoutUrl)}/complete`, { method: 'POST', body: { outcome: 'success' } });
async function buyAndPay(ctx, buyer, sessionId, body = {}) {
  const r = await buyer.api(`/live/${sessionId}/tickets`, { method: 'POST', body });
  assert.equal(r.status, 201, r.text);
  await bankPays(ctx.base, r.checkoutUrl);
  await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status === 'paid', 'ticket paid');
  return r.ticket.id;
}
// The room opens 10 minutes before the start: move the start a few minutes ahead.
const openRoom = (sessionId, minutes = 5) => pool.query('UPDATE live_sessions SET starts_at = now() + make_interval(mins => $2) WHERE id = $1', [sessionId, minutes]);

// A request signed in as `c` but WITHOUT the X-Requested-With header the site's own pages send (what a forged cross-site form sends).
function forged(base, c, path, { method = 'POST', body = {}, headers = {} } = {}) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie: c.cookie(), ...headers }, body: JSON.stringify(body), redirect: 'manual' });
}

module.exports = { BASE_ENV, pool, sql, until, waitFor, marketplace, client, signupVerified, answered, day, draft, published, orderOf, bankPays, buyAndPay, openRoom, forged, wait };
