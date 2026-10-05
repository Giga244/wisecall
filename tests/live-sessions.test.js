// Live sessions, Milestone 1 (docs/LIVE-SESSIONS-PLAN.md): who may host, creating and the admin's approval of a mentor's first sessions,
// selling seats (never more than there are, even when 31 people press "Buy" at once), holds that run out, early-bird limits, payment only
// after the bank's check, refunds (buyer before 24 h, a new time, the mentor cancels, too few people, the mentor does not come), the room
// (tokens only for ticket holders and only from 10 minutes before, raise hand, questions and upvotes), the payout only after a normal end,
// a report holding it, the room page's own security policy, and escaped text.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-live-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
let srv, base, admin, mentor, mentorId, asker, n = 0;

const day = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86400000 + 4 * 3600000); // (Tbilisi time)
  return d.toISOString().slice(0, 10);
};
const draft = (over = {}) => ({ title: 'Ask me about studying medicine abroad', description: 'An hour of answers about applying, exams, money and the first year. For anyone thinking about it.',
  learnPoints: ['How to choose a country', 'What the first year costs'], niche: 'tech', kind: 'qa', language: 'en', date: day(3), time: '19:00',
  durationMin: 60, price: 20, maxSeats: 30, minSeats: 1, ...over });
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${message}`); await wait(150); }
}
// (emails go to the log here, so the sign-up code is read from it)
async function signupVerified(b, name, email) {
  const c = client(b);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345' } });
  assert.equal(su.status, 201, su.text);
  const mail = await until(() => outbox().find((m) => m.to === email), 'sign-up email');
  const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
async function newBuyer() {
  n += 1;
  return signupVerified(base, `Buyer ${n}`, `buyer${n}@example.com`);
}
// A published session (the mentor's first 3 are approved by the admin here).
async function published(over = {}, by = mentor) {
  const c = await by.api('/live', { method: 'POST', body: draft(over) });
  assert.equal(c.status, 201, c.text);
  const p = await by.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
  assert.equal(p.status, 200, p.text);
  if (p.session.status === 'review') assert.equal((await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
  return (await sql('SELECT * FROM live_sessions WHERE id = $1', [c.session.id]))[0];
}
const orderOf = (checkoutUrl) => new URL(checkoutUrl).searchParams.get('order');
async function buyAndPay(buyer, sessionId, body = {}) {
  const r = await buyer.api(`/live/${sessionId}/tickets`, { method: 'POST', body });
  assert.equal(r.status, 201, r.text);
  await client(base).api(`/mock-bank/orders/${orderOf(r.checkoutUrl)}/complete`, { method: 'POST', body: { outcome: 'success' } });
  await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status === 'paid', 'ticket paid');
  return r.ticket.id;
}
// Moves a session's start (tests only: the server keeps 24 h when a mentor publishes).
const startIn = (id, minutes) => pool.query(`UPDATE live_sessions SET starts_at = now() + make_interval(mins => $2) WHERE id = $1`, [id, minutes]);

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4739, { RATE_LIMIT_MULTIPLIER: '100', SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX,
    EMAIL_FROM: 'Wisecall <hi@example.com>', LIVE_PROVIDER: 'fake' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupVerified(base, 'Mika Host', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Software engineer and teacher', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Host');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('who can host, and creating a session', () => {
  test('a listed mentor hosts after one answered question, or when an admin allows it; nobody else', async () => {
    assert.equal((await asker.api('/live', { method: 'POST', body: draft() })).error, 'cannot_host', 'not a mentor');
    const first = await mentor.api('/live', { method: 'POST', body: draft() });
    assert.equal(first.error, 'cannot_host');
    assert.equal(first.reason, 'no_answers_yet');
    assert.equal((await mentor.api(`/admin/live/hosts/${mentorId}`, { method: 'POST' })).status, 403, 'admins only');
    // one answered question is enough
    const b = await bookAndPay(base, asker, mentorId, 'How should I prepare for medical school abroad, step by step?');
    assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(SAMPLE) } })).status, 200);
    assert.equal((await mentor.api('/live', { method: 'POST', body: draft() })).status, 201);
    // and an admin can allow a mentor without one
    const other = await signupVerified(base, 'Nino New', 'nino@example.com');
    await other.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, sampleAnswer: SAMPLE } });
    const otherId = await approveMentor(admin, other);
    await addPayoutDetails(other, undefined, 'Nino New');
    assert.equal((await other.api('/live', { method: 'POST', body: draft() })).error, 'cannot_host');
    assert.equal((await admin.api(`/admin/live/hosts/${otherId}`, { method: 'POST' })).status, 200);
    assert.equal((await other.api('/live', { method: 'POST', body: draft() })).status, 201);
  });

  test('what a session must be: lengths, no contact details, prices, seats, early-bird, 24 hours ahead', async () => {
    const bad = async (over, code) => assert.equal((await mentor.api('/live', { method: 'POST', body: draft(over) })).error, code, JSON.stringify(over));
    await bad({ title: 'Hi' }, 'invalid_title');
    await bad({ description: 'Too short.' }, 'invalid_description');
    await bad({ description: 'Write to me at mika@example.com or call +995 599 123 456 for the details of this session about medicine abroad.' }, 'contact_details');
    await bad({ price: 3 }, 'invalid_price');
    await bad({ price: 250 }, 'invalid_price');
    await bad({ kind: 'circle', maxSeats: 10 }, 'invalid_seats');
    await bad({ maxSeats: 31 }, 'invalid_seats');
    await bad({ earlyPrice: 20 }, 'invalid_early_price');
    await bad({ earlyPrice: 15 }, 'early_needs_limit');
    await bad({ durationMin: 150 }, 'invalid_duration');
    await bad({ date: 'tomorrow' }, 'invalid_time');
    const soon = await mentor.api('/live', { method: 'POST', body: draft({ date: day(0.25), time: new Date(Date.now() + 4 * 3600000 + 3 * 3600000).toISOString().slice(11, 16) }) });
    assert.equal(soon.status, 201, 'a draft can be saved for any time ahead');
    assert.equal((await mentor.api(`/live/${soon.session.id}/publish`, { method: 'POST', body: { agree: true } })).error, 'too_soon');
  });

  test('a mentor\'s first 3 sessions wait for an admin (approve, or reject with a reason); the 4th is public at once', async () => {
    const c = await mentor.api('/live', { method: 'POST', body: draft({ title: 'First session waits for review' }) });
    const p = await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: {} });
    assert.equal(p.session.status, 'review');
    assert.equal((await client(base).api(`/live/s/${c.session.slug}`)).status, 404, 'not public while in review');
    assert.equal((await admin.api(`/admin/live/${c.session.id}/reject`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/live/${c.session.id}/reject`, { method: 'POST', body: { reason: 'Please say who it is for.' } })).status, 200);
    let s = (await mentor.api('/live/mine')).sessions.find((x) => x.id === c.session.id);
    assert.equal(s.status, 'rejected');
    assert.equal(s.reviewReason, 'Please say who it is for.');
    await until(() => outbox().some((m) => m.to === 'mika@example.com' && /Not approved yet/.test(m.subject)), 'the rejection email');
    assert.equal((await mentor.api(`/live/${c.session.id}`, { method: 'PUT', body: { description: 'For students in their last school year who think about medicine abroad: applying, exams, money.' } })).status, 200);
    assert.equal((await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: {} })).session.status, 'review');
    const ok = await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' });
    assert.equal(ok.session.status, 'published');
    const row = (await sql('SELECT room_name, room_url FROM live_sessions WHERE id = $1', [c.session.id]))[0];
    assert.ok(row.room_name && /mock-live-room\.html/.test(row.room_url), 'the room is made when it goes public');
    await published({ title: 'Second approved session here' });
    await published({ title: 'Third approved session here' });
    const fourth = await mentor.api('/live', { method: 'POST', body: draft({ title: 'Fourth goes straight out' }) });
    assert.equal((await mentor.api(`/live/${fourth.session.id}/publish`, { method: 'POST', body: {} })).session.status, 'published');
    s = await client(base).api(`/live/s/${fourth.session.slug}`);
    assert.equal(s.status, 200);
  });

  test('a regulated field needs the agreement, and the session always says it is not a consultation', async () => {
    const c = await mentor.api('/live', { method: 'POST', body: draft({ niche: 'medicine', title: 'Life as a junior doctor abroad' }) });
    assert.equal(c.session.regulated, true);
    assert.equal((await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: {} })).error, 'agreement_required');
    const p = await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
    assert.equal(p.status, 200);
    if (p.session.status === 'review') assert.equal((await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
    const html = await (await fetch(`${base}/live/${c.session.slug}`)).text();
    assert.match(html, /not a consultation, diagnosis or therapy/);
  });
});

describe('selling seats', () => {
  test('31 people press "Buy" at once for 30 seats: exactly 30 get a seat, one is told it is sold out', async () => {
    const s = await published({ title: 'The busy one with thirty seats', maxSeats: 30 });
    const buyers = [];
    for (let i = 0; i < 31; i++) buyers.push(await newBuyer());
    const answers = await Promise.all(buyers.map((b) => b.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })));
    assert.equal(answers.filter((r) => r.status === 201).length, 30);
    assert.equal(answers.filter((r) => r.error === 'sold_out').length, 1);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM live_tickets WHERE session_id = $1 AND status = 'held'`, [s.id]))[0].n, 30);
    assert.equal((await client(base).api(`/live/s/${s.slug}`)).session.seatsLeft, 0);
    // A hold that runs out frees its seat (the sweep asks the bank first: nothing was paid).
    const late = answers.find((r) => r.status === 201);
    await pool.query(`UPDATE live_tickets SET hold_until = now() - interval '1 second' WHERE id = $1`, [late.ticket.id]);
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [late.ticket.id]))[0].status === 'expired', 'hold expired');
    const loser = buyers[answers.findIndex((r) => r.error === 'sold_out')];
    assert.equal((await loser.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).status, 201, 'the freed seat can be bought');
  });

  test('one ticket per person; the mentor cannot buy; a paid ticket only after the bank says so, with a receipt and a calendar file', async () => {
    const s = await published({ title: 'Paying for a seat properly' });
    const b = await newBuyer();
    assert.equal((await mentor.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).error, 'own_session');
    const r = await b.api(`/live/${s.id}/tickets`, { method: 'POST', body: { questions: ['What exams do I need?', 'Is it expensive?'], anonymous: true } });
    assert.equal(r.status, 201);
    assert.equal((await b.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).error, 'payment_in_progress');
    assert.equal((await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status, 'held', 'the redirect alone pays nothing');
    await client(base).api(`/mock-bank/orders/${orderOf(r.checkoutUrl)}/complete`, { method: 'POST', body: { outcome: 'success' } });
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status === 'paid', 'paid');
    assert.equal((await b.api(`/live/${s.id}/tickets`, { method: 'POST', body: {} })).error, 'already_have_ticket');
    const t = (await sql('SELECT * FROM live_tickets WHERE id = $1', [r.ticket.id]))[0];
    assert.deepEqual([t.price, t.fee, t.net], [2000, 400, 1600], '20% fee per ticket, integer tetri');
    assert.equal((await sql(`SELECT count(*)::int AS n FROM receipts WHERE ticket_id = $1 AND kind = 'payment'`, [t.id]))[0].n, 1);
    const mail = await until(() => outbox().find((m) => m.to === t.buyer_id || (m.subject || '').startsWith('Your ticket')), 'ticket email');
    assert.ok(mail.attachments && mail.attachments[0].filename.endsWith('.ics'));
    const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
    assert.match(mail.html, /calendar\.google\.com/);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM live_questions WHERE ticket_id = $1 AND source = 'checkout'`, [t.id]))[0].n, 2);
    const cal = await b.raw(`/api/live/tickets/${t.id}/calendar.ics`);
    assert.equal(cal.status, 200);
    assert.equal((await asker.raw(`/api/live/tickets/${t.id}/calendar.ics`)).status, 404, 'not someone else\'s');
  });

  test('early-bird: the first N tickets, or until a date; the price is fixed on the ticket', async () => {
    const s = await published({ title: 'Early birds pay less here', earlyPrice: 15, earlySeats: 1 });
    const a = await newBuyer();
    const b = await newBuyer();
    const ta = await buyAndPay(a, s.id);
    const tb = await buyAndPay(b, s.id);
    assert.deepEqual((await sql('SELECT price, early FROM live_tickets WHERE id = ANY($1::uuid[]) ORDER BY created_at', [[ta, tb]])).map((r) => [r.price, r.early]),
      [[1500, true], [2000, false]]);
    const d = await published({ title: 'Early bird until a date', earlyPrice: 10, earlyUntilDate: day(1) });
    assert.equal((await client(base).api(`/live/s/${d.slug}`)).session.priceNow, 1000);
    await pool.query(`UPDATE live_sessions SET early_until = now() - interval '1 minute' WHERE id = $1`, [d.id]);
    assert.equal((await client(base).api(`/live/s/${d.slug}`)).session.priceNow, 2000);
  });
});

describe('refunds', () => {
  test('the buyer cancels 24 hours before or earlier for a full refund; later, no; after a new time, until the start', async () => {
    const s = await published({ title: 'Cancel rules for buyers here' });
    const b = await newBuyer();
    const t = await buyAndPay(b, s.id);
    assert.equal((await asker.api(`/live/tickets/${t}/cancel`, { method: 'POST' })).status, 404, 'not someone else\'s ticket');
    await startIn(s.id, 23 * 60);
    assert.equal((await b.api(`/live/tickets/${t}/cancel`, { method: 'POST' })).error, 'too_late_to_cancel');
    // The mentor moves the time: everybody may now cancel until the start.
    await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '3 days' WHERE id = $1`, [s.id]);
    const moved = await mentor.api(`/live/${s.id}`, { method: 'PUT', body: { date: day(5), time: '18:00' } });
    assert.equal(moved.status, 200, moved.text);
    await until(() => outbox().some((m) => /^New time:/.test(m.subject)), 'the new-time email');
    assert.equal((await mentor.api(`/live/${s.id}`, { method: 'PUT', body: { price: 30 } })).error, 'locked_after_sales');
    await startIn(s.id, 60);
    const c = await b.api(`/live/tickets/${t}/cancel`, { method: 'POST' });
    assert.equal(c.status, 200, c.text);
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
    assert.equal((await sql(`SELECT count(*)::int AS n FROM receipts WHERE ticket_id = $1 AND kind = 'refund'`, [t]))[0].n, 1);
  });

  test('the mentor cancels: everybody is refunded and told', async () => {
    const s = await published({ title: 'The mentor will cancel this' });
    const [a, b] = [await newBuyer(), await newBuyer()];
    const ids = [await buyAndPay(a, s.id), await buyAndPay(b, s.id)];
    assert.equal((await mentor.api(`/live/${s.id}/cancel`, { method: 'POST' })).status, 200);
    await until(async () => (await sql(`SELECT count(*)::int AS n FROM live_tickets WHERE id = ANY($1::uuid[]) AND status = 'refunded'`, [ids]))[0].n === 2, 'both refunded');
    await until(() => outbox().filter((m) => /^Cancelled:/.test(m.subject)).length >= 2, 'the cancel emails');
  });

  test('too few people 6 hours before: cancelled and refunded automatically', async () => {
    const s = await published({ title: 'Nobody else came along', minSeats: 3 });
    const t = await buyAndPay(await newBuyer(), s.id);
    await startIn(s.id, 5 * 60);
    await until(async () => (await sql('SELECT status, cancel_reason FROM live_sessions WHERE id = $1', [s.id]))[0].cancel_reason === 'min_not_reached', 'auto-cancelled');
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
  });

  test('the mentor does not come within 15 minutes: cancelled and refunded', async () => {
    const s = await published({ title: 'The mentor forgot to come' });
    const t = await buyAndPay(await newBuyer(), s.id);
    await startIn(s.id, -16);
    await until(async () => (await sql('SELECT cancel_reason FROM live_sessions WHERE id = $1', [s.id]))[0].cancel_reason === 'no_show', 'no-show');
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
  });
});

describe('the room', () => {
  let s, buyer, other, ticket;
  before(async () => {
    s = await published({ title: 'Room rules are tested here' });
    buyer = await newBuyer();
    other = await newBuyer();
    ticket = await buyAndPay(buyer, s.id, { questions: ['Which country is cheapest?'] });
  });

  test('only from 10 minutes before, only ticket holders (and the mentor, as the owner); a nickname when asked', async () => {
    assert.equal((await buyer.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).error, 'not_open_yet');
    await startIn(s.id, 8);
    assert.equal((await other.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).error, 'no_ticket', 'no ticket, no token');
    assert.equal((await client(base).api(`/live/${s.id}/join`, { method: 'POST', body: {} })).status, 401);
    const host = await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    assert.equal(host.role, 'mentor');
    const j = await buyer.api(`/live/${s.id}/join`, { method: 'POST', body: { anonymous: true } });
    assert.equal(j.role, 'participant');
    assert.match(j.displayName, /^Guest \d+$/);
    assert.equal(j.canSpeak, false, 'Live Q&A: watch and listen');
    // the fake video room checks the token as a real service would
    const u = new URL(j.joinUrl);
    const check = await (await fetch(`${base}/api/live-fake/check?room=${encodeURIComponent(u.searchParams.get('room'))}&t=${encodeURIComponent(u.searchParams.get('t'))}`)).json();
    assert.deepEqual([check.ok, check.owner, check.canSend], [true, false, []]);
    const hostCheck = new URL(host.joinUrl);
    assert.equal((await (await fetch(`${base}/api/live-fake/check?room=${encodeURIComponent(hostCheck.searchParams.get('room'))}&t=${encodeURIComponent(hostCheck.searchParams.get('t'))}`)).json()).owner, true);
    const forged = await fetch(`${base}/api/live-fake/check?room=${encodeURIComponent(u.searchParams.get('room'))}&t=${encodeURIComponent(u.searchParams.get('t').slice(0, -3) + 'abc')}`);
    assert.equal(forged.status, 403);
  });

  test('raise hand: only the mentor lets someone speak; then the new token can send audio and video', async () => {
    assert.equal((await buyer.api(`/live/${s.id}/hand`, { method: 'POST', body: { raise: true } })).hand, 'raised');
    const buyerId = (await buyer.api('/me')).user.id;
    assert.equal((await buyer.api(`/live/${s.id}/speakers/${buyerId}`, { method: 'POST', body: { allow: true } })).error, 'forbidden');
    const st = await mentor.api(`/live/${s.id}/state`);
    assert.equal(st.people.find((p) => p.id === buyerId).hand, 'raised');
    assert.ok(!JSON.stringify(st.people).includes('@'), 'the mentor never sees emails');
    assert.equal((await mentor.api(`/live/${s.id}/speakers/${buyerId}`, { method: 'POST', body: { allow: true } })).status, 200);
    const j = await buyer.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    assert.equal(j.canSpeak, true);
    const u = new URL(j.joinUrl);
    assert.deepEqual((await (await fetch(`${base}/api/live-fake/check?room=${encodeURIComponent(u.searchParams.get('room'))}&t=${encodeURIComponent(u.searchParams.get('t'))}`)).json()).canSend, ['audio', 'video']);
  });

  test('questions: anonymous, upvotes (not your own), checkout questions first, "answering now" by the mentor only, text kept as text', async () => {
    const asked = await buyer.api(`/live/${s.id}/questions`, { method: 'POST', body: { body: 'Can I work while studying? <img src=x onerror=alert(1)>' } });
    assert.equal(asked.status, 201);
    const mine = asked.questions.find((q) => q.mine && q.source === 'room');
    assert.equal(mine.body, 'Can I work while studying? <img src=x onerror=alert(1)>', 'stored as text; the page escapes it');
    assert.equal(asked.questions[0].source, 'checkout');
    assert.equal((await buyer.api(`/live/questions/${mine.id}/vote`, { method: 'POST' })).error, 'own_question');
    const late = await newBuyer();
    await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '30 hours' WHERE id = $1`, [s.id]);
    await buyAndPay(late, s.id);
    await startIn(s.id, 5);
    const voted = await late.api(`/live/questions/${mine.id}/vote`, { method: 'POST' });
    assert.equal(voted.questions.find((q) => q.id === mine.id).votes, 1);
    assert.ok(!JSON.stringify(voted.questions).includes('Buyer'), 'never who asked');
    assert.equal((await late.api(`/live/questions/${mine.id}/state`, { method: 'POST', body: { state: 'answering' } })).error, 'forbidden');
    const marked = await mentor.api(`/live/questions/${mine.id}/state`, { method: 'POST', body: { state: 'answering' } });
    assert.equal(marked.questions.find((q) => q.id === mine.id).state, 'answering');
    assert.equal((await other.api(`/live/${s.id}/questions`, { method: 'POST', body: { body: 'I have no ticket' } })).error, 'no_ticket');
  });

  test('the room page alone allows the video frame; other pages do not', async () => {
    const room = await fetch(`${base}/live/${s.slug}/room`);
    const csp = room.headers.get('content-security-policy');
    assert.match(csp, new RegExp(`frame-src ${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(room.headers.get('permissions-policy'), /camera=\(self "http:\/\/localhost:\d+"\)/);
    for (const p of [`/live/${s.slug}`, '/live', '/']) {
      const h = (await fetch(base + p)).headers;
      assert.doesNotMatch(h.get('content-security-policy'), /frame-src/, p);
      assert.match(h.get('permissions-policy'), /camera=\(\)/, p);
    }
  });
});

describe('money after the session', () => {
  test('a normal end (the mentor there for half the time or more): one payout = the tickets\' shares, payable after the hold', async () => {
    const s = await published({ title: 'A session that really happens', durationMin: 60 });
    const ids = [await buyAndPay(await newBuyer(), s.id), await buyAndPay(await newBuyer(), s.id)];
    await startIn(s.id, 5);
    assert.equal((await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).role, 'mentor');
    await pool.query(`UPDATE live_sessions SET starts_at = now() - interval '61 minutes', mentor_seconds = 35 * 60 WHERE id = $1`, [s.id]);
    assert.equal((await mentor.api(`/live/${s.id}/end`, { method: 'POST' })).status, 200);
    const [p] = await sql('SELECT * FROM payouts WHERE live_session_id = $1', [s.id]);
    assert.equal(p.amount, 3200, 'two tickets × 16 ₾');
    assert.equal(p.status, 'pending');
    assert.equal((await sql('SELECT status, end_kind FROM live_sessions WHERE id = $1', [s.id]))[0].end_kind, 'normal');
    assert.equal((await sql(`SELECT count(*)::int AS n FROM live_tickets WHERE id = ANY($1::uuid[]) AND status = 'paid'`, [ids]))[0].n, 2, 'nobody refunded');
    // a report holds it even when the hold has passed; closing the report releases it
    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE id = $1`, [p.id]);
    const reporter = await newBuyer();
    assert.equal((await reporter.api(`/live/${s.id}/report`, { method: 'POST', body: { reason: 'not_as_described', details: 'It was off topic.' } })).status, 201);
    let bal = (await mentor.api('/me/balance')).balance;
    assert.equal(bal.available, 0, 'held while the report is open');
    const reports = (await admin.api('/admin/live')).reports;
    assert.equal((await admin.api(`/admin/live/reports/${reports[0].id}/resolve`, { method: 'POST', body: { resolution: 'Checked: as described.' } })).status, 200);
    bal = (await mentor.api('/me/balance')).balance;
    assert.equal(bal.available, 3200);
  });

  test('a short session (the mentor there for less than half the time): everybody refunded, no payout', async () => {
    const s = await published({ title: 'The mentor left far too early' });
    const t = await buyAndPay(await newBuyer(), s.id);
    await startIn(s.id, 5);
    await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    await pool.query(`UPDATE live_sessions SET mentor_seconds = 10 * 60 WHERE id = $1`, [s.id]);
    assert.equal((await mentor.api(`/live/${s.id}/end`, { method: 'POST' })).status, 200);
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
    assert.equal((await sql('SELECT count(*)::int AS n FROM payouts WHERE live_session_id = $1', [s.id]))[0].n, 0);
    assert.equal((await sql('SELECT cancel_reason FROM live_sessions WHERE id = $1', [s.id]))[0].cancel_reason, 'short');
  });

  test('an admin ends a session for safety: everybody refunded, and it is in the audit log', async () => {
    const s = await published({ title: 'Ended by the team for safety' });
    const t = await buyAndPay(await newBuyer(), s.id);
    assert.equal((await admin.api(`/admin/live/${s.id}/end`, { method: 'POST', body: { reason: 'Unsafe advice was being given.' } })).status, 200);
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
    assert.equal((await sql(`SELECT count(*)::int AS n FROM verification_audit WHERE action = 'live_cancelled' AND reason LIKE '%Unsafe advice%'`))[0].n, 1);
  });
});

describe('the public pages', () => {
  test('/live lists upcoming sessions with filters; a session page has JSON-LD Event and escaped text', async () => {
    const s = await published({ title: 'Escaping <b>bold</b> titles', description: 'A description with <script>alert(1)</script> inside it, long enough to be accepted by the rules.', language: 'ka' });
    const list = await (await fetch(`${base}/live?language=ka`)).text();
    assert.match(list, /Escaping &lt;b&gt;bold&lt;\/b&gt; titles/);
    assert.doesNotMatch(list, /<b>bold<\/b>/);
    const other = await (await fetch(`${base}/live?language=en&type=workshop`)).text();
    assert.doesNotMatch(other, /Escaping &lt;b&gt;/, 'filtered out');
    const page = await (await fetch(`${base}/live/${s.slug}`)).text();
    assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@type'], 'Event');
    assert.equal(ld.offers.priceCurrency, 'GEL');
    assert.equal(ld.eventAttendanceMode, 'https://schema.org/OnlineEventAttendanceMode');
    assert.equal((await fetch(`${base}/ka/live/${s.slug}`)).status, 200);
  });
});

describe('disputes, suspension and accounts', () => {
  test('after a normal end a ticket holder can report a problem; the admin\'s partial or full refund comes off the session payout', async () => {
    const s = await published({ title: 'A session people may dispute' });
    const [a, b] = [await newBuyer(), await newBuyer()];
    const [ta, tb] = [await buyAndPay(a, s.id), await buyAndPay(b, s.id)];
    assert.equal((await a.api(`/live/tickets/${ta}/dispute`, { method: 'POST', body: { reason: 'not_as_described' } })).error, 'not_disputable', 'not before it ended');
    await startIn(s.id, 5);
    await mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    await pool.query(`UPDATE live_sessions SET mentor_seconds = 40 * 60 WHERE id = $1`, [s.id]);
    await mentor.api(`/live/${s.id}/end`, { method: 'POST' });
    const [p0] = await sql('SELECT * FROM payouts WHERE live_session_id = $1', [s.id]);
    assert.equal(p0.amount, 3200);
    assert.equal((await b.api(`/live/tickets/${ta}/dispute`, { method: 'POST', body: { reason: 'not_as_described' } })).status, 404, 'not someone else\'s ticket');
    const d = await a.api(`/live/tickets/${ta}/dispute`, { method: 'POST', body: { reason: 'not_as_described', details: 'Half of it was an advert.' } });
    assert.equal(d.status, 201);
    assert.equal((await a.api(`/live/tickets/${ta}/dispute`, { method: 'POST', body: { reason: 'other' } })).error, 'already_reported');
    const before = (await mentor.api('/me/balance')).balance.available; // (other sessions' earnings)
    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE id = $1`, [p0.id]);
    assert.equal((await mentor.api('/me/balance')).balance.available, before, 'held while the dispute is open');
    const list = (await admin.api('/admin/disputes?status=open')).disputes;
    const mine = list.find((x) => x.kind === 'ticket' && x.ticketId === ta);
    assert.equal(mine.session.title, 'A session people may dispute');
    // a partial refund: 5 GEL back, the mentor's part is 4 GEL (80%)
    assert.equal((await admin.api(`/admin/disputes/${mine.id}/resolve`, { method: 'POST', body: { outcome: 'partial_refund', amount: 500, note: 'Partly as described.' } })).status, 200);
    const [ticketA] = await sql('SELECT status, refunded_amount FROM live_tickets WHERE id = $1', [ta]);
    assert.deepEqual([ticketA.status, ticketA.refunded_amount], ['paid', 500]);
    assert.equal((await sql('SELECT amount FROM payouts WHERE id = $1', [p0.id]))[0].amount, 2800);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM receipts WHERE ticket_id = $1 AND kind = 'refund'`, [ta]))[0].n, 1);
    assert.equal((await mentor.api('/me/balance')).balance.available, before + 2800, 'released once decided');
    // a full refund of the other ticket after its own dispute: its whole share comes off
    const db = await b.api(`/live/tickets/${tb}/dispute`, { method: 'POST', body: { reason: 'technical' } });
    const other = (await admin.api('/admin/disputes?status=open')).disputes.find((x) => x.id === db.dispute.id);
    assert.equal((await admin.api(`/admin/disputes/${other.id}/resolve`, { method: 'POST', body: { outcome: 'full_refund', note: 'The sound did not work.' } })).status, 200);
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [tb]))[0].status === 'refunded', 'refunded');
    assert.equal((await sql('SELECT amount FROM payouts WHERE id = $1', [p0.id]))[0].amount, 1200);
  });

  test('suspending a mentor cancels their sessions and refunds every ticket', async () => {
    const host = await signupVerified(base, 'Suspended Host', 'susp@example.com');
    await host.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, sampleAnswer: SAMPLE } });
    const hostId = await approveMentor(admin, host);
    await addPayoutDetails(host, undefined, 'Suspended Host');
    await admin.api(`/admin/live/hosts/${hostId}`, { method: 'POST' });
    const s = await published({ title: 'A session that will not happen' }, host);
    const t = await buyAndPay(await newBuyer(), s.id);
    assert.equal((await admin.api(`/admin/mentors/${hostId}/suspend`, { method: 'POST', body: { reason: 'Repeated complaints from buyers.' } })).status, 200);
    assert.equal((await sql('SELECT cancel_reason FROM live_sessions WHERE id = $1', [s.id]))[0].cancel_reason, 'mentor_suspended');
    await until(async () => (await sql('SELECT status FROM live_tickets WHERE id = $1', [t]))[0].status === 'refunded', 'refunded');
  });

  test('an account with an upcoming ticket or session cannot be deleted yet; the export includes them', async () => {
    const s = await published({ title: 'Deletion waits for this one' });
    const b = await newBuyer();
    await buyAndPay(b, s.id);
    assert.ok((await b.api('/me/delete/check')).items.includes('live_tickets'));
    assert.ok((await mentor.api('/me/delete/check')).items.includes('live_sessions_hosting'));
    const exported = JSON.parse(await (await b.raw('/api/me/export')).text());
    assert.equal(exported.liveTickets.find((x) => x.title === 'Deletion waits for this one').status, 'paid');
    assert.ok(!JSON.stringify(exported.liveTickets).includes('@'), 'no other people\'s emails');
  });
});
