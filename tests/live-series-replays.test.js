// Live sessions, Milestone 3: series (2-6 sessions bought in one payment for a bundle price; a seat in each; per-session share refunds as
// partial refunds of the one bank order) and opt-in replays (only the mentor recorded, nobody else can speak; ticket holders free for 30
// days, others buy a pass; the mentor can delete it and running passes are refunded; a recording of a session that did not take place
// is deleted).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, SAMPLE, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-live3-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
let srv, base, admin, mentor, mentorId, n = 0;

async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${message}`); await wait(150); }
}
async function signup(name, email) {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name, email, password: 'test-pass-12345' } });
  assert.equal(su.status, 201, su.text);
  const mail = await until(() => outbox().find((m) => m.to === email && /letter-spacing:8px/.test(m.html)), 'sign-up email');
  const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
const newBuyer = async () => { n += 1; return signup(`Buyer ${n}`, `s${n}@example.com`); };
const day = (d) => new Date(Date.now() + d * 86400000 + 4 * 3600000).toISOString().slice(0, 10);
const draft = (over = {}) => ({ title: 'A session for the series tests', description: 'A session used by the tests of series and replays, long enough to pass the checks.',
  niche: 'tech', kind: 'qa', language: 'en', date: day(3), time: '19:00', durationMin: 60, price: 20, maxSeats: 30, minSeats: 1, ...over });
async function published(over = {}) {
  const c = await mentor.api('/live', { method: 'POST', body: draft(over) });
  assert.equal(c.status, 201, c.text);
  const p = await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
  if (p.session.status === 'review') assert.equal((await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
  return (await sql('SELECT * FROM live_sessions WHERE id = $1', [c.session.id]))[0];
}
const orderOf = (u) => new URL(u).searchParams.get('order');
const bankPays = (checkoutUrl) => client(base).api(`/mock-bank/orders/${orderOf(checkoutUrl)}/complete`, { method: 'POST', body: { outcome: 'success' } });
async function payTicket(r) {
  await bankPays(r.checkoutUrl);
  await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status === 'paid', 'ticket paid');
  return r.ticket.id;
}
// The session takes place: the mentor opens the room (it goes live), stays the whole hour, and ends it.
async function goLive(s) {
  await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [s.id]);
  assert.equal((await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).role, 'mentor');
}
async function endNormally(s) {
  await pool.query(`UPDATE live_sessions SET starts_at = now() - interval '61 minutes', mentor_seconds = 3600 WHERE id = $1`, [s.id]);
  assert.equal((await mentor.api(`/live/${s.id}/end`, { method: 'POST' })).status, 200);
}

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4747, { RATE_LIMIT_MULTIPLIER: '100', SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX,
    EMAIL_FROM: 'Wisecall <hi@example.com>', LIVE_PROVIDER: 'fake' });
  base = srv.base;
  admin = await signup('QA Admin', 'qa-admin@example.com');
  mentor = await signup('Mari Mentor', 'mari@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 40, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mari Mentor');
  await admin.api(`/admin/live/hosts/${mentorId}`, { method: 'POST' });
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('series', () => {
  let a, b, c, sr, buyer, order;
  before(async () => {
    a = await published({ title: 'Series part one: the basics', date: day(3), price: 20 });
    b = await published({ title: 'Series part two: practice', date: day(4), price: 20 });
    c = await published({ title: 'Series part three: the hard parts', date: day(5), price: 30 });
  });

  test('a mentor groups 2-6 of their own published sessions, for less than they cost together', async () => {
    assert.equal((await mentor.api('/live/series', { method: 'POST', body: { title: 'Three evenings', description: 'Three sessions that build on each other.', price: 50, sessionIds: [a.id] } })).error, 'series_sessions');
    assert.equal((await mentor.api('/live/series', { method: 'POST', body: { title: 'Three evenings', description: 'Three sessions that build on each other.', price: 70, sessionIds: [a.id, b.id, c.id] } })).error, 'invalid_series_price', 'not less than 70 ₾');
    assert.equal((await mentor.api('/live/series', { method: 'POST', body: { title: 'Three evenings', description: 'Three sessions that build on each other.', price: 12, sessionIds: [a.id, b.id, c.id] } })).error, 'invalid_series_price', 'at least 5 ₾ a session');
    const other = await newBuyer();
    assert.equal((await other.api('/live/series', { method: 'POST', body: { title: 'Not mine', description: 'Somebody else trying to sell these.', price: 50, sessionIds: [a.id, b.id] } })).status, 403);
    const r = await mentor.api('/live/series', { method: 'POST', body: { title: 'Three evenings', description: 'Three sessions that build on each other.', price: 55, sessionIds: [a.id, b.id, c.id] } });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.series.status, r.series.sumPrice, r.series.saving, r.series.sessions.length], ['draft', 7000, 1500, 3]);
    assert.equal((await mentor.api('/live/series', { method: 'POST', body: { title: 'Again', description: 'The same sessions in a second series.', price: 30, sessionIds: [a.id, b.id] } })).error, 'series_session_taken');
    const p = await mentor.api(`/live/series/${r.series.id}/publish`, { method: 'POST' });
    assert.equal(p.series.status, 'published');
    sr = p.series;
    const html = await (await fetch(`${base}/live/series/${sr.slug}`)).text();
    assert.match(html, /Three evenings/);
    assert.match(html, /Series part three: the hard parts/);
  });

  test('one payment holds a seat in every session; the shares add up to the bundle price; one receipt; one email with every session', async () => {
    buyer = await newBuyer();
    const r = await buyer.api(`/live/series/${sr.id}/orders`, { method: 'POST', body: {} });
    assert.equal(r.status, 201, r.text);
    const held = await sql(`SELECT * FROM live_tickets WHERE series_order_id = $1 ORDER BY price`, [r.order.id]);
    assert.equal(held.length, 3);
    assert.equal(held.reduce((x, t) => x + t.price, 0), 5500, 'the shares add up exactly');
    assert.deepEqual(held.map((t) => t.status), ['held', 'held', 'held']);
    await bankPays(r.checkoutUrl);
    await until(async () => (await sql('SELECT status FROM live_series_orders WHERE id = $1', [r.order.id]))[0].status === 'paid', 'series paid');
    const kids = await sql(`SELECT t.*, s.title FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE series_order_id = $1 ORDER BY s.starts_at`, [r.order.id]);
    assert.deepEqual(kids.map((t) => t.status), ['paid', 'paid', 'paid']);
    assert.deepEqual(kids.map((t) => t.price), [1572, 1571, 2357], 'in proportion to 20 : 20 : 30 (the spare tetri to the largest fraction)');
    for (const t of kids) assert.equal(t.fee + t.net, t.price);
    const rc = await sql('SELECT * FROM receipts WHERE series_order_id = $1', [r.order.id]);
    assert.deepEqual(rc.map((x) => [x.kind, x.amount]), [['payment', 5500]]);
    const mail = await until(() => outbox().find((m) => m.to === `s${n}@example.com` && /Your series/.test(m.subject)), 'series email');
    assert.match(mail.text, /Series part two: practice/);
    const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
    assert.equal((await buyer.api(`/live/series/${sr.id}/orders`, { method: 'POST', body: {} })).error, 'already_have_ticket');
    assert.equal((await buyer.api(`/live/${a.id}/tickets`, { method: 'POST', body: {} })).error, 'already_have_ticket');
    order = r.order;
    const mine = await buyer.api('/live/mine');
    assert.equal(mine.tickets.filter((x) => x.series && x.series.title === 'Three evenings').length, 3);
  });

  test('when one session is full, the series cannot be bought', async () => {
    const x = await published({ title: 'Small first part', maxSeats: 2, date: day(6) });
    const y = await published({ title: 'Big second part', date: day(7) });
    const r = await mentor.api('/live/series', { method: 'POST', body: { title: 'Two more evenings', description: 'Two sessions, one of them small.', price: 30, sessionIds: [x.id, y.id] } });
    await mentor.api(`/live/series/${r.series.id}/publish`, { method: 'POST' });
    await payTicket(await (await newBuyer()).api(`/live/${x.id}/tickets`, { method: 'POST', body: {} }));
    await payTicket(await (await newBuyer()).api(`/live/${x.id}/tickets`, { method: 'POST', body: {} }));
    const late = await newBuyer();
    const no = await late.api(`/live/series/${r.series.id}/orders`, { method: 'POST', body: {} });
    assert.deepEqual([no.error, no.sessionId], ['sold_out', x.id]);
    const page = await client(base).api(`/live/series/s/${r.series.slug}`);
    assert.deepEqual([page.series.onSale, page.series.notOnSaleReason], [false, 'sold_out']);
  });

  test('a hold that is never paid frees the seats in every session', async () => {
    const z = await published({ title: 'Hold test one', date: day(8) });
    const w = await published({ title: 'Hold test two', date: day(9) });
    const r = await mentor.api('/live/series', { method: 'POST', body: { title: 'Hold series', description: 'A series whose payment is never made.', price: 30, sessionIds: [z.id, w.id] } });
    await mentor.api(`/live/series/${r.series.id}/publish`, { method: 'POST' });
    const o = await (await newBuyer()).api(`/live/series/${r.series.id}/orders`, { method: 'POST', body: {} });
    assert.equal(Number((await sql(`SELECT count(*) AS n FROM live_tickets WHERE session_id = $1 AND status = 'held'`, [z.id]))[0].n), 1);
    await pool.query(`UPDATE live_series_orders SET hold_until = now() - interval '1 minute' WHERE id = $1`, [o.order.id]);
    await pool.query(`UPDATE live_tickets SET hold_until = now() - interval '1 minute' WHERE series_order_id = $1`, [o.order.id]);
    await until(async () => (await sql('SELECT status FROM live_series_orders WHERE id = $1', [o.order.id]))[0].status === 'expired', 'order closed');
    assert.deepEqual((await sql('SELECT status FROM live_tickets WHERE series_order_id = $1', [o.order.id])).map((t) => t.status), ['expired', 'expired']);
  });

  test('a cancelled session gives back only its share (a partial refund of the one bank order); the others stay', async () => {
    assert.equal((await mentor.api(`/live/${b.id}/cancel`, { method: 'POST' })).status, 200);
    await until(async () => (await sql(`SELECT status FROM live_tickets WHERE series_order_id = $1 AND session_id = $2`, [order.id, b.id]))[0].status === 'refunded', 'share refunded');
    const kids = await sql(`SELECT session_id, status FROM live_tickets WHERE series_order_id = $1`, [order.id]);
    assert.deepEqual(kids.filter((k) => k.status === 'paid').map((k) => k.session_id).sort(), [a.id, c.id].sort());
    assert.equal((await sql('SELECT status FROM live_series_orders WHERE id = $1', [order.id]))[0].status, 'paid');
    const refunds = await sql(`SELECT r.amount FROM receipts r JOIN live_tickets t ON t.id = r.ticket_id WHERE t.series_order_id = $1 AND r.kind = 'refund'`, [order.id]);
    assert.deepEqual(refunds.map((x) => x.amount), [1571]);
  });

  test('the buyer cancels the other sessions (24 h before each) for their shares; then the payment is fully refunded', async () => {
    const kids = await sql(`SELECT id FROM live_tickets WHERE series_order_id = $1 AND status = 'paid'`, [order.id]);
    for (const k of kids) assert.equal((await buyer.api(`/live/tickets/${k.id}/cancel`, { method: 'POST' })).status, 200);
    await until(async () => (await sql('SELECT status FROM live_series_orders WHERE id = $1', [order.id]))[0].status === 'refunded', 'order refunded');
    const total = await sql(`SELECT COALESCE(sum(r.amount), 0)::int AS n FROM receipts r JOIN live_tickets t ON t.id = r.ticket_id WHERE t.series_order_id = $1 AND r.kind = 'refund'`, [order.id]);
    assert.equal(total[0].n, 5500, 'every tetri back');
  });

  test('a series ticket counts in its session\'s payout like any other', async () => {
    const p = await published({ title: 'Payout series one', date: day(10) });
    const q = await published({ title: 'Payout series two', date: day(11) });
    const r = await mentor.api('/live/series', { method: 'POST', body: { title: 'Payout series', description: 'A series whose first session takes place.', price: 30, sessionIds: [p.id, q.id] } });
    await mentor.api(`/live/series/${r.series.id}/publish`, { method: 'POST' });
    const o = await (await newBuyer()).api(`/live/series/${r.series.id}/orders`, { method: 'POST', body: {} });
    await bankPays(o.checkoutUrl);
    await until(async () => (await sql('SELECT status FROM live_series_orders WHERE id = $1', [o.order.id]))[0].status === 'paid', 'paid');
    const [kid] = await sql('SELECT * FROM live_tickets WHERE series_order_id = $1 AND session_id = $2', [o.order.id, p.id]);
    await goLive(p);
    await endNormally(p);
    const [payout] = await sql('SELECT amount, status FROM payouts WHERE live_session_id = $1', [p.id]);
    assert.deepEqual([payout.amount, payout.status], [kid.net, 'pending']);
  });
});

describe('replays', () => {
  let s, holder, stranger, ticketId;
  before(async () => {
    s = await published({ title: 'A recorded Q&A about engineering careers', replay: true, replayPrice: 10, date: day(12) });
    [holder, stranger] = [await newBuyer(), await newBuyer()];
    ticketId = await payTicket(await holder.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} }));
  });

  test('only a Live Q&A or a Workshop can be recorded, for less than a ticket; buyers are told before buying', async () => {
    assert.equal((await mentor.api('/live', { method: 'POST', body: draft({ kind: 'circle', maxSeats: 8, replay: true, replayPrice: 10 }) })).error, 'replay_not_for_circle');
    assert.equal((await mentor.api('/live', { method: 'POST', body: draft({ replay: true, replayPrice: 20 }) })).error, 'invalid_replay_price');
    const page = await client(base).api(`/live/s/${s.slug}`);
    assert.deepEqual([page.session.replay, page.session.replayPrice], [true, 1000]);
    assert.equal((await mentor.api(`/live/${s.id}`, { method: 'PUT', body: { replay: false } })).error, 'locked_after_sales');
  });

  test('in a recorded session nobody but the mentor can speak; the mentor records; everybody sees it', async () => {
    await goLive(s);
    const j = await holder.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    assert.deepEqual([j.role, j.canSpeak, j.replay], ['participant', false, true]);
    assert.equal((await holder.api(`/live/${s.id}/hand`, { method: 'POST', body: { raise: true } })).error, 'recorded_session');
    const people = await mentor.api(`/live/${s.id}/state`);
    assert.equal((await mentor.api(`/live/${s.id}/speakers/${people.people[0].id}`, { method: 'POST', body: { allow: true } })).error, 'recorded_session');
    assert.equal((await holder.api(`/live/${s.id}/recording`, { method: 'POST', body: { start: true } })).status, 403, 'only the mentor');
    assert.equal((await mentor.api(`/live/${s.id}/recording`, { method: 'POST', body: { start: true } })).recording, true);
    assert.equal((await holder.api(`/live/${s.id}/state`)).recording, true);
  });

  test('after a normal end the recording becomes the replay: ticket holders watch it free, others see the price', async () => {
    await endNormally(s);
    await until(async () => (await sql(`SELECT 1 FROM live_replays WHERE session_id = $1 AND status = 'ready'`, [s.id])).length, 'replay attached');
    const res = await holder(`/live/${s.slug}/replay`);
    assert.equal(res.status, 200);
    assert.match(res.text, /mock-live-replay\.html\?rec=/);
    assert.match(res.headers.get('content-security-policy'), /frame-src [^;]*http:\/\/localhost:4747/);
    const plain = await fetch(`${base}/live/${s.slug}`);
    assert.doesNotMatch(plain.headers.get('content-security-policy'), /frame-src [^;]*localhost/, 'only the replay page allows it');
    const other = await stranger(`/live/${s.slug}/replay`);
    assert.doesNotMatch(other.text, /mock-live-replay/);
    assert.match(other.text, /data-can-buy="1"/);
    assert.deepEqual((await stranger.api(`/live/${s.id}/replay`)).access, { can: false, ready: true, until: null, canBuy: true, price: 1000 });
    assert.equal((await holder.api(`/live/${s.id}/replay`)).access.can, true);
    assert.equal((await holder.api(`/live/${s.id}/replay/purchases`, { method: 'POST', body: {} })).error, 'already_have_access');
  });

  test('someone without a ticket buys a 30-day pass; the mentor earns 80 % of it', async () => {
    const r = await stranger.api(`/live/${s.id}/replay/purchases`, { method: 'POST', body: {} });
    assert.equal(r.status, 201, r.text);
    await bankPays(r.checkoutUrl);
    await until(async () => (await sql('SELECT status FROM live_replay_purchases WHERE id = $1', [r.purchase.id]))[0].status === 'paid', 'pass paid');
    assert.equal((await stranger.api(`/live/${s.id}/replay`)).access.can, true);
    const [p] = await sql('SELECT amount, status FROM payouts WHERE replay_purchase_id = $1', [r.purchase.id]);
    assert.deepEqual([p.amount, p.status], [800, 'pending']);
    assert.equal((await sql('SELECT amount FROM receipts WHERE replay_purchase_id = $1 AND kind = $2', [r.purchase.id, 'payment']))[0].amount, 1000);
  });

  test('the mentor deletes the replay: nobody can watch it, running passes are refunded and the mentor\'s share comes off', async () => {
    assert.equal((await stranger.api(`/live/${s.id}/replay`, { method: 'DELETE' })).status, 404, 'not someone else');
    const d = await mentor.api(`/live/${s.id}/replay`, { method: 'DELETE' });
    assert.deepEqual([d.deleted, d.refunded], [true, 1]);
    const [pp] = await sql('SELECT * FROM live_replay_purchases WHERE session_id = $1', [s.id]);
    await until(async () => (await sql('SELECT status FROM live_replay_purchases WHERE id = $1', [pp.id]))[0].status === 'refunded', 'pass refunded');
    assert.equal((await sql('SELECT status FROM payouts WHERE replay_purchase_id = $1', [pp.id]))[0].status, 'void');
    assert.equal((await holder.api(`/live/${s.id}/replay`)).access.can, false);
  });

  test('a recording of a session that did not take place (too short) is deleted', async () => {
    const t = await published({ title: 'A recorded session that ends too soon', replay: true, replayPrice: 10, date: day(13) });
    await payTicket(await (await newBuyer()).api(`/live/${t.id}/tickets`, { method: 'POST', body: {} }));
    await goLive(t);
    assert.equal((await mentor.api(`/live/${t.id}/recording`, { method: 'POST', body: { start: true } })).recording, true);
    await pool.query(`UPDATE live_sessions SET starts_at = now() - interval '61 minutes', mentor_seconds = 600 WHERE id = $1`, [t.id]);
    await mentor.api(`/live/${t.id}/end`, { method: 'POST' });
    assert.equal((await sql('SELECT status FROM live_sessions WHERE id = $1', [t.id]))[0].status, 'cancelled');
    await until(async () => (await sql(`SELECT status FROM live_replays WHERE session_id = $1`, [t.id]))[0], 'recording handled');
    assert.equal((await sql(`SELECT status, delete_reason FROM live_replays WHERE session_id = $1`, [t.id]))[0].status, 'deleted');
  });
});
