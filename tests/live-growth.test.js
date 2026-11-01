// Live sessions, Milestone 2: the waiting list hands a freed seat to the first person for 2 hours, following a mentor (at most one email a
// week per mentor, one-click unfollow), ratings and the mentor's summary after a session, the one-time 15 % code for a personal question,
// gift tickets claimed by someone else, the mentor's numbers, the admin's totals, and the share image.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, SAMPLE, wait, longQuestion } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-live2-${process.pid}.jsonl`);
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
const newBuyer = async () => { n += 1; return signup(`Buyer ${n}`, `g${n}@example.com`); };
const day = (d) => new Date(Date.now() + d * 86400000 + 4 * 3600000).toISOString().slice(0, 10);
const draft = (over = {}) => ({ title: 'Growth tests for live sessions', description: 'A session used by the tests of the waiting list, follows, ratings, codes and gifts, long enough.',
  niche: 'tech', kind: 'qa', language: 'en', date: day(3), time: '19:00', durationMin: 60, price: 20, maxSeats: 30, minSeats: 1, ...over });
async function published(over = {}) {
  const c = await mentor.api('/live', { method: 'POST', body: draft(over) });
  assert.equal(c.status, 201, c.text);
  const p = await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
  if (p.session.status === 'review') assert.equal((await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
  return (await sql('SELECT * FROM live_sessions WHERE id = $1', [c.session.id]))[0];
}
const orderOf = (u) => new URL(u).searchParams.get('order');
async function pay(r) {
  await client(base).api(`/mock-bank/orders/${orderOf(r.checkoutUrl)}/complete`, { method: 'POST', body: { outcome: 'success' } });
  await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status === 'paid', 'paid');
  return r.ticket.id;
}
const buyAndPay = async (buyer, sessionId, body = {}) => pay(await buyer.api(`/live/${sessionId}/tickets`, { method: 'POST', body }));
// The session took place: the mentor was there the whole hour, and these tickets' holders were in the room.
async function heldWith(s, ticketIds) {
  await pool.query(`UPDATE live_tickets SET attended_seconds = 3000 WHERE id = ANY($1::uuid[])`, [ticketIds]);
  await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [s.id]);
  await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
  await pool.query(`UPDATE live_sessions SET starts_at = now() - interval '61 minutes', mentor_seconds = 3600 WHERE id = $1`, [s.id]);
  assert.equal((await mentor.api(`/live/${s.id}/end`, { method: 'POST' })).status, 200);
}

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4745, { RATE_LIMIT_MULTIPLIER: '100', SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX,
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

describe('the waiting list', () => {
  test('when sold out people wait; a freed seat is kept 2 hours for the first one, then goes to the next', async () => {
    const s = await published({ title: 'A tiny session that sells out', maxSeats: 2 });
    const [a, b, w1, w2, other] = [await newBuyer(), await newBuyer(), await newBuyer(), await newBuyer(), await newBuyer()];
    const ta = await buyAndPay(a, s.id);
    await buyAndPay(b, s.id);
    assert.equal((await w1.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).error, 'sold_out');
    assert.equal((await w1.api(`/live/${s.id}/waitlist`, { method: 'POST' })).waiting, true);
    const j2 = await w2.api(`/live/${s.id}/waitlist`, { method: 'POST' });
    assert.equal(j2.position, 2);
    assert.equal((await a.api(`/live/${s.id}/waitlist`, { method: 'POST' })).error, 'already_have_ticket');
    // a ticket is cancelled: the seat goes to the first person waiting, for 2 hours
    assert.equal((await a.api(`/live/tickets/${ta}/cancel`, { method: 'POST' })).status, 200);
    await until(() => outbox().some((m) => m.to === 'g3@example.com' && /seat/i.test(m.subject)), 'seat offer email');
    const [o] = await sql(`SELECT * FROM live_waitlist WHERE session_id = $1 AND status = 'offered'`, [s.id]);
    assert.ok(Math.abs(new Date(o.offer_expires_at) - Date.now() - 2 * 3600000) < 60000, 'kept for 2 hours');
    assert.equal((await other.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).error, 'sold_out', 'the kept seat is not for others');
    // the first person lets it go: it passes to the next
    await pool.query(`UPDATE live_waitlist SET offer_expires_at = now() - interval '1 second' WHERE id = $1`, [o.id]);
    await until(async () => (await sql(`SELECT status FROM live_waitlist WHERE session_id = $1 AND user_id = (SELECT id FROM users WHERE email = 'g4@example.com')`, [s.id]))[0].status === 'offered', 'next offered');
    const t = await buyAndPay(w2, s.id);
    assert.equal((await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status, 'paid');
    assert.equal((await sql(`SELECT status FROM live_waitlist WHERE session_id = $1 AND user_id = (SELECT id FROM users WHERE email = 'g4@example.com')`, [s.id]))[0].status, 'bought');
  });
});

describe('following a mentor', () => {
  test('followers get one email a week per mentor when sessions are published; one click unfollows', async () => {
    const f = await newBuyer();
    const fEmail = `g${n}@example.com`;
    assert.equal((await mentor.api(`/live/follows/${mentorId}`, { method: 'POST' })).error, 'own_profile');
    const r = await f.api(`/live/follows/${mentorId}`, { method: 'POST' });
    assert.deepEqual([r.following, r.followers], [true, 1]);
    await published({ title: 'First session for my followers' });
    const mail = await until(() => outbox().find((m) => m.to === fEmail && /First session for my followers/.test(m.subject + m.html)), 'follower email');
    await published({ title: 'Second session the same week' });
    await wait(600);
    assert.equal(outbox().filter((m) => m.to === fEmail && /Mari Mentor/.test(m.subject)).length, 1, 'at most one a week');
    // (the link opens a page that posts its signed token: no sign-in needed, and a mail scanner opening the link changes nothing by itself)
    const token = decodeURIComponent(mail.text.match(/\/unfollow\.html\?t=([^\s&]+)/)[1]);
    assert.equal((await client(base).api('/live/follows/unfollow', { method: 'POST', body: { token: token.slice(0, -2) + 'xx' } })).status, 404, 'a changed token does nothing');
    assert.equal((await f.api(`/live/follows/${mentorId}`)).following, true);
    assert.equal((await client(base).api('/live/follows/unfollow', { method: 'POST', body: { token } })).status, 200);
    assert.equal((await f.api(`/live/follows/${mentorId}`)).following, false);
  });
});

describe('after the session', () => {
  let s, attendee, absent, tAtt, tAbs;
  before(async () => {
    s = await published({ title: 'A session people will rate' });
    [attendee, absent] = [await newBuyer(), await newBuyer()];
    [tAtt, tAbs] = [await buyAndPay(attendee, s.id), await buyAndPay(absent, s.id)];
  });

  test('attendees rate once (not before it ended, not without attending); it shows on the session and the profile', async () => {
    assert.equal((await attendee.api(`/live/tickets/${tAtt}/rating`, { method: 'POST', body: { stars: 5 } })).error, 'not_rateable');
    await heldWith(s, [tAtt]);
    assert.equal((await absent.api(`/live/tickets/${tAbs}/rating`, { method: 'POST', body: { stars: 1 } })).error, 'not_attended');
    assert.equal((await attendee.api(`/live/tickets/${tAtt}/rating`, { method: 'POST', body: { stars: 5, comment: 'Write to me at nino@example.com' } })).error, 'contact_details');
    assert.equal((await attendee.api(`/live/tickets/${tAtt}/rating`, { method: 'POST', body: { stars: 5, comment: 'Clear and honest. <b>Thanks</b>' } })).status, 201);
    assert.equal((await attendee.api(`/live/tickets/${tAtt}/rating`, { method: 'POST', body: { stars: 4 } })).error, 'already_rated');
    assert.equal((await absent.api(`/live/tickets/${tAtt}/rating`, { method: 'POST', body: { stars: 1 } })).status, 404, 'not someone else\'s ticket');
    const page = await client(base).api(`/live/s/${s.slug}`);
    assert.deepEqual([page.ratings.average, page.ratings.count], [5, 1]);
    const html = await (await fetch(`${base}/live/${s.slug}`)).text();
    assert.match(html, /Clear and honest\. &lt;b&gt;Thanks&lt;\/b&gt;/);
    assert.equal((await client(base).api(`/live/ratings/${mentorId}`)).average, 5);
  });

  test('the mentor shares a summary with up to 5 links in the attendees\' inbox; only http(s) links', async () => {
    assert.equal((await mentor.api(`/live/${s.id}/summary`, { method: 'POST', body: { summary: 'Thanks for coming! The slides and the books we talked about.', links: [{ title: 'Bad', url: 'javascript:alert(1)' }] } })).error, 'invalid_link');
    const r = await mentor.api(`/live/${s.id}/summary`, { method: 'POST', body: { summary: 'Thanks for coming! The slides and the books we talked about.', links: [{ title: 'Slides', url: 'https://example.com/slides' }] } });
    assert.equal(r.status, 200);
    assert.equal(r.sentTo, 2);
    const inbox = await attendee.api('/inbox/notifications');
    assert.ok(inbox.notifications.some((x) => x.kind === 'live_summary' && x.data.links[0].url === 'https://example.com/slides'));
    assert.equal((await attendee.api(`/live/${s.id}/summary`, { method: 'POST', body: { summary: 'Not mine to send.' } })).status, 404);
  });

  test('every attendee gets a one-time 15 % code for a question with this mentor; it works once', async () => {
    const [code] = await sql(`SELECT c.* FROM discount_codes c JOIN users u ON u.id = c.user_id WHERE c.source_ticket_id = $1`, [tAtt]);
    assert.ok(code && /^WC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.code));
    assert.equal(code.percent, 15);
    assert.equal((await sql('SELECT count(*)::int AS n FROM discount_codes WHERE source_ticket_id = $1', [tAbs]))[0].n, 0, 'not for someone who did not attend');
    const q = longQuestion('How do I prepare for a senior engineering interview?');
    assert.equal((await absent.api('/bookings', { method: 'POST', body: { mentorId, question: q, discountCode: code.code } })).error, 'invalid_code', 'not someone else\'s code');
    const check = await attendee.api(`/live/discounts/check?code=${code.code}&mentor=${mentorId}`);
    assert.deepEqual([check.amount, check.listPrice], [3400, 4000]);
    const b = await attendee.api('/bookings', { method: 'POST', body: { mentorId, question: q, discountCode: code.code } });
    assert.equal(b.status, 201, b.text);
    assert.equal(b.booking.amount, 3400, '40 ₾ less 15 %');
    assert.equal(b.booking.platformFeeAmount, 680, 'the fee is on what was paid');
    assert.equal((await attendee.api('/bookings', { method: 'POST', body: { mentorId, question: q, discountCode: code.code } })).error, 'code_in_use', 'one payment at a time');
    await client(base).api(`/mock-bank/orders/${b.booking.providerOrderId}/complete`, { method: 'POST', body: { outcome: 'success' } });
    await until(async () => (await sql('SELECT status FROM bookings WHERE id = $1', [b.booking.id]))[0].status === 'paid', 'question paid');
    assert.equal((await attendee.api('/bookings', { method: 'POST', body: { mentorId, question: q, discountCode: code.code } })).error, 'code_used', 'once');
  });

  test('the mentor\'s numbers and the admin\'s totals', async () => {
    const a = await mentor.api('/live/analytics');
    const row = a.sessions.find((x) => x.id === s.id);
    assert.deepEqual([row.sold, row.attended, row.attendanceRate, row.gross, row.fee, row.net, row.rating], [2, 1, 50, 4000, 800, 3200, 5]);
    assert.ok(a.totals.followers >= 0);
    const o = await admin.api('/admin/overview');
    assert.ok(o.live.ended30 >= 1 && o.live.tickets30 >= 2);
  });
});

describe('gifts and the share image', () => {
  test('a gift is paid by one person and claimed by another, who then holds the ticket', async () => {
    const s = await published({ title: 'A session given as a gift' });
    const giver = await newBuyer();
    const r = await giver.api(`/live/${s.id}/tickets`, { method: 'POST', body: { giftEmail: 'friend@example.com' } });
    assert.equal(r.status, 201, r.text);
    await pay(r);
    const mail = await until(() => outbox().find((m) => m.to === 'friend@example.com' && /gift/i.test(m.subject)), 'gift email');
    const token = decodeURIComponent(mail.text.match(/live-claim\.html\?token=([^\s&]+)/)[1]);
    const friend = await signup('Friend Here', 'friend@example.com');
    assert.equal((await friend.api('/live/gifts/claim', { method: 'POST', body: { token: token + 'x' } })).error, 'not_found');
    const c = await friend.api('/live/gifts/claim', { method: 'POST', body: { token } });
    assert.equal(c.status, 200, c.text);
    assert.equal((await friend.api('/live/gifts/claim', { method: 'POST', body: { token } })).error, 'not_found', 'once');
    await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [s.id]);
    assert.equal((await friend.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).role, 'participant');
    assert.equal((await giver.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).error, 'no_ticket', 'the giver does not attend');
    const mine = await giver.api('/live/mine');
    assert.ok(mine.tickets.some((x) => x.gift && x.gift.claimed));
  });

  test('the share image is a 1080 x 1080 PNG, for public sessions only', async () => {
    const s = await published({ title: 'Share this session with your friends' });
    const res = await fetch(`${base}/api/live-share/${s.id}.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1080]);
    const c = await mentor.api('/live', { method: 'POST', body: draft({ title: 'A draft nobody should see' }) });
    assert.equal((await fetch(`${base}/api/live-share/${c.session.id}.png`)).status, 404);
  });
});
