// /api/live: live sessions (server/live/). Public reading; mentors create and run sessions; ticket holders buy, cancel and join.
// Every rule is checked in server/live/*, here only who is asking and the HTTP status of each refusal.
const express = require('express');
const { requireAuth, optionalAuth } = require('../auth');
const { getUserById } = require('../models');
const { asyncHandler } = require('../util');
const { query } = require('../db');
const sessions = require('../live/sessions');
const tickets = require('../live/tickets');
const room = require('../live/room');
const waitlist = require('../live/waitlist');
const follows = require('../live/follows');
const after = require('../live/after');
const { LiveError } = sessions;

const router = express.Router();
const UUID = /^[0-9a-f-]{36}$/i;
const STATUS = {
  not_found: 404, forbidden: 403, not_authenticated: 401, no_ticket: 403, cannot_host: 403, email_not_verified: 403, own_session: 403,
  sold_out: 409, already_have_ticket: 409, payment_in_progress: 409, not_on_sale: 409, started: 409, not_editable: 409, locked_after_sales: 409,
  not_a_draft: 409, not_cancellable: 409, too_late_to_cancel: 409, not_open_yet: 409, closed: 410, own_question: 409, not_needed: 409,
  payments_closed: 503, video_unavailable: 503, payment_failed_to_start: 502, refund_failed: 502, provider_unavailable: 503, too_many_questions: 429,
  // (Milestone 2: waiting list, follows, ratings, summaries, codes, gifts)
  not_sold_out: 409, own_profile: 403, not_rateable: 409, not_attended: 403, already_rated: 409, window_closed: 409, not_ended: 409,
  code_used: 409, code_in_use: 409, code_expired: 409, gift_closed: 410, too_many_gifts: 429,
  // (Milestone 3: series, replays)
  series_session_not_open: 409, series_session_taken: 409, not_recorded: 409, not_live: 409, recorded_session: 409, already_have_access: 409, series_unavailable: 503
};
const fail = (res, e) => {
  if (!(e instanceof LiveError)) throw e;
  const { code, message, stack, ...extra } = e;
  res.status(STATUS[code] || 400).json({ error: code, ...extra });
};
const me = async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) res.status(401).json({ error: 'not_authenticated' });
  return user;
};
const run = (fn) => asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  try { await fn(user, req, res); } catch (e) { fail(res, e); }
});

// ---- Public -------------------------------------------------------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  res.json({ sessions: await require('../live/listing').upcoming(req.query || {}) });
}));
router.get('/s/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const s = await sessions.rowBySlug(req.params.slug);
  const viewer = req.userToken ? req.userToken.id : null;
  if (!s || (!['published', 'live', 'ended', 'cancelled'].includes(s.status) && s.mentor_id !== viewer)) return res.status(404).json({ error: 'not_found' });
  const mentor = await getUserById(s.mentor_id);
  const out = { session: sessions.publicView(s, mentor), ratings: await after.forSession(s.id) };
  // (part of a series on sale: its page sells all its sessions together)
  if (s.series_id) {
    const sr = await require('../live/series').rowById(s.series_id);
    if (sr && sr.status === 'published') out.series = { title: sr.title, slug: sr.slug, price: sr.price };
  }
  if (s.status === 'ended' && s.replay_enabled) out.replayReady = Boolean(await require('../live/replays').replayOf(s.id));
  if (viewer) {
    // (the ticket this person attends with: their own, or a gift they claimed)
    const { rows } = await query(`SELECT * FROM live_tickets WHERE session_id = $1 AND holder_id = $2 ORDER BY created_at DESC LIMIT 1`, [s.id, viewer]);
    out.ticket = rows[0] ? tickets.view(rows[0]) : null;
    out.isMentor = s.mentor_id === viewer;
    out.waitlist = await waitlist.mine(viewer, s.id);
  }
  res.json(out);
}));
// A mentor's live-session ratings (their profile).
router.get('/ratings/:mentorId', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.mentorId)) return res.status(404).json({ error: 'not_found' });
  res.json(await after.forMentor(req.params.mentorId));
}));

// ---- Series: 2-6 sessions bought together for a bundle price (server/live/series.js) -------------------------------------------------
const series = require('../live/series');
const replays = require('../live/replays');
router.get('/series/s/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const sr = await series.rowBySlug(req.params.slug);
  const viewer = req.userToken ? req.userToken.id : null;
  if (!sr || (sr.status === 'draft' && sr.mentor_id !== viewer)) return res.status(404).json({ error: 'not_found' });
  const out = { series: series.publicView(sr, await series.sessionsOf(sr.id), await getUserById(sr.mentor_id)) };
  if (viewer) {
    out.isMentor = sr.mentor_id === viewer;
    const { rows } = await query(`SELECT * FROM live_series_orders WHERE series_id = $1 AND buyer_id = $2 ORDER BY created_at DESC LIMIT 1`, [sr.id, viewer]);
    out.order = rows[0] ? series.orderView(rows[0]) : null;
  }
  res.json(out);
}));
router.get('/series/mine', requireAuth, run(async (user, req, res) => { res.set('Cache-Control', 'no-store'); res.json({ series: await series.mine(user.id) }); }));
router.post('/series', requireAuth, run(async (user, req, res) => { res.status(201).json({ series: await series.create(user, req.body || {}) }); }));
router.put('/series/:id', requireAuth, run(async (user, req, res) => { res.json({ series: await series.update(user, req.params.id, req.body || {}) }); }));
router.post('/series/:id/publish', requireAuth, run(async (user, req, res) => { res.json({ series: await series.publish(user, req.params.id) }); }));
router.post('/series/:id/cancel', requireAuth, run(async (user, req, res) => { res.json({ series: await series.cancel(user, req.params.id) }); }));
router.post('/series/:id/orders', requireAuth, run(async (user, req, res) => { res.status(201).json(await series.buy(user, req.params.id)); }));
router.post('/series/orders/:id/sync', requireAuth, run(async (user, req, res) => {
  const { rows: [o] } = await query('SELECT buyer_id FROM live_series_orders WHERE id = $1', [UUID.test(req.params.id) ? req.params.id : null]);
  if (!o || o.buyer_id !== user.id) throw new LiveError('not_found');
  res.json({ order: series.orderView(await series.syncOrder(req.params.id)) });
}));

// ---- Replays: recording (the mentor, in the room), watching, a pass for those without a ticket, deleting (server/live/replays.js) -----
router.post('/:id/recording', requireAuth, run(async (user, req, res) => { res.json(await replays.setRecording(user, req.params.id, (req.body || {}).start === true)); }));
router.get('/:id/replay', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  const s = await sessions.rowById(req.params.id);
  if (!s || s.status !== 'ended' || !s.replay_enabled) throw new LiveError('not_found');
  const a = await replays.accessFor(user, s);
  res.json({ access: { can: a.can, ready: a.ready, until: a.until || null, canBuy: Boolean(a.canBuy), price: a.price || null } });
}));
router.post('/:id/replay/purchases', requireAuth, run(async (user, req, res) => { res.status(201).json(await replays.buy(user, req.params.id)); }));
router.post('/replay/purchases/:id/sync', requireAuth, run(async (user, req, res) => {
  const { rows: [p] } = await query('SELECT buyer_id FROM live_replay_purchases WHERE id = $1', [UUID.test(req.params.id) ? req.params.id : null]);
  if (!p || p.buyer_id !== user.id) throw new LiveError('not_found');
  res.json({ purchase: replays.purchaseView(await replays.sync(req.params.id)) });
}));
router.delete('/:id/replay', requireAuth, run(async (user, req, res) => { res.json(await replays.remove(user, req.params.id, 'mentor')); }));

// ---- Following a mentor -------------------------------------------------------------------------------------------------------------
// The link in the email (signed; no sign-in needed) opens /unfollow.html, which posts its token here.
router.post('/follows/unfollow', asyncHandler(async (req, res) => {
  try { res.json(await follows.unfollowByToken((req.body || {}).token)); } catch (e) { fail(res, e); }
}));
router.get('/follows/:mentorId', optionalAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!UUID.test(req.params.mentorId)) return res.status(404).json({ error: 'not_found' });
  res.json(await follows.state(req.userToken ? req.userToken.id : null, req.params.mentorId));
}));
router.post('/follows/:mentorId', requireAuth, run(async (user, req, res) => { res.json(await follows.follow(user, req.params.mentorId)); }));
router.delete('/follows/:mentorId', requireAuth, run(async (user, req, res) => {
  if (!UUID.test(req.params.mentorId)) throw new LiveError('not_found');
  res.json(await follows.unfollow(user, req.params.mentorId));
}));

// ---- Discount codes (after a session: 15 % off a question with the same mentor) ------------------------------------------------------
router.get('/discounts', requireAuth, run(async (user, req, res) => { res.set('Cache-Control', 'no-store'); res.json({ codes: await after.myCodes(user.id) }); }));
router.get('/discounts/check', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  const mentor = UUID.test(String(req.query.mentor || '')) ? await getUserById(String(req.query.mentor)) : null;
  if (!mentor || !require('../util').isListable(mentor)) throw new LiveError('not_found');
  const c = await after.check(user.id, mentor.id, req.query.code);
  const listPrice = Math.round(mentor.price * 100);
  res.json({ code: c.code, percent: c.percent, listPrice, amount: after.discounted(listPrice, c.percent) });
}));

// ---- Mentors ----------------------------------------------------------------------------------------------------------------------------
router.get('/mine', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = await sessions.canHost(user);
  const { rows } = await query(`SELECT s.*, ${sessions.TAKEN_SQL} AS taken, ${sessions.SOLD_SQL} AS sold, ${sessions.WAITING_SQL} AS waiting,
            EXISTS (SELECT 1 FROM live_replays r WHERE r.session_id = s.id AND r.status = 'ready') AS replay_ready FROM live_sessions s WHERE s.mentor_id = $1 ORDER BY s.starts_at DESC LIMIT 200`, [user.id]);
  res.json({ canHost: host.ok, hostReason: host.reason || null, sessions: rows.map(sessions.ownerView), tickets: await tickets.mine(user.id) });
}));
// The mentor's numbers: per session and in total (tickets, attendance, money, rating, followers).
router.get('/analytics', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await require('../live/analytics').forMentor(user.id));
}));
// After a session that took place: a short summary and up to 5 links for the people who attended (to their Inbox).
router.post('/:id/summary', requireAuth, run(async (user, req, res) => {
  const b = req.body || {};
  res.json(await after.shareSummary(user, req.params.id, { summary: b.summary, links: b.links }));
}));
router.post('/', requireAuth, run(async (user, req, res) => { res.status(201).json({ session: await sessions.create(user, req.body || {}) }); }));
router.get('/:id/edit', requireAuth, run(async (user, req, res) => {
  const s = await sessions.rowById(req.params.id);
  if (!s || s.mentor_id !== user.id) throw new LiveError('not_found');
  res.json({ session: { ...sessions.ownerView(s), date: tbilisiDate(s.starts_at), time: tbilisiTime(s.starts_at),
    earlyUntilDate: s.early_until ? tbilisiDate(s.early_until) : '', minSeats: s.min_seats } });
}));
router.put('/:id', requireAuth, run(async (user, req, res) => { res.json({ session: await sessions.update(user, req.params.id, req.body || {}) }); }));
router.post('/:id/publish', requireAuth, run(async (user, req, res) => { res.json({ session: await sessions.publish(user, req.params.id, { agree: (req.body || {}).agree === true }) }); }));
router.post('/:id/cancel', requireAuth, run(async (user, req, res) => { res.json({ session: await sessions.cancelByMentor(user, req.params.id) }); }));
const tbilisiDate = (d) => new Date(new Date(d).getTime() + 4 * 3600000).toISOString().slice(0, 10);
const tbilisiTime = (d) => new Date(new Date(d).getTime() + 4 * 3600000).toISOString().slice(11, 16);

// The cover picture (raw image bytes, like a profile photo).
router.put('/:id/cover', requireAuth, run(async (user, req, res) => {
  const out = await require('../live/covers').set(user, req.params.id, Buffer.isBuffer(req.body) ? req.body : null);
  res.json(out);
}));
router.delete('/:id/cover', requireAuth, run(async (user, req, res) => { res.json(await require('../live/covers').remove(user, req.params.id)); }));

// ---- Tickets ----------------------------------------------------------------------------------------------------------------------------
router.post('/:id/tickets', requireAuth, run(async (user, req, res) => {
  const b = req.body || {};
  res.status(201).json(await tickets.buy(user, req.params.id, { questions: b.questions, anonymous: b.anonymous === true, giftEmail: b.giftEmail }));
}));
// Sold out: one click to wait for a seat (the first person waiting gets a freed seat for 2 hours).
router.post('/:id/waitlist', requireAuth, run(async (user, req, res) => { res.json(await waitlist.join(user, req.params.id)); }));
router.delete('/:id/waitlist', requireAuth, run(async (user, req, res) => { res.json(await waitlist.leave(user, req.params.id)); }));
// Gifts: the person a gift is for claims it with the link from their email; its buyer can send the link again.
router.post('/gifts/claim', requireAuth, run(async (user, req, res) => { res.json(await tickets.claimGift(user, (req.body || {}).token)); }));
router.post('/tickets/:id/gift/resend', requireAuth, run(async (user, req, res) => { res.json(await tickets.resendGift(user, req.params.id)); }));
// Rating a session that took place (once, within 14 days, by whoever attended with this ticket).
router.post('/tickets/:id/rating', requireAuth, run(async (user, req, res) => {
  const b = req.body || {};
  res.status(201).json({ rating: await after.rate(user, req.params.id, { stars: b.stars, comment: b.comment }) });
}));
router.post('/tickets/:id/sync', requireAuth, run(async (user, req, res) => {
  const { rows: [t] } = await query('SELECT buyer_id FROM live_tickets WHERE id = $1', [req.params.id]);
  if (!t || t.buyer_id !== user.id) throw new LiveError('not_found');
  res.json({ ticket: tickets.view(await tickets.sync(req.params.id)) });
}));
router.post('/tickets/:id/cancel', requireAuth, run(async (user, req, res) => { res.json({ ticket: await tickets.cancelByBuyer(user, req.params.id) }); }));
// "Report a problem" after a session that ended normally: the existing dispute flow (server/disputes.js), an admin decides.
const DISPUTE_STATUS = { not_found: 404, forbidden: 404, already_reported: 409, not_disputable: 409, window_closed: 409, invalid_reason: 400 };
router.post('/tickets/:id/dispute', requireAuth, run(async (user, req, res) => {
  const disputes = require('../disputes');
  const b = req.body || {};
  try { res.status(201).json({ dispute: await disputes.openForTicket(user, req.params.id, { reason: b.reason, details: b.details }) }); }
  catch (e) {
    if (!(e instanceof disputes.DisputeError)) throw e;
    res.status(DISPUTE_STATUS[e.code] || 400).json({ error: e.code });
  }
}));
router.get('/tickets/:id/calendar.ics', requireAuth, run(async (user, req, res) => {
  // (the ticket's own status, not the session's: both tables have a status)
  const { rows: [t] } = await query(`SELECT s.*, t.holder_id, t.status AS ticket_status FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [req.params.id]);
  if (!t || t.holder_id !== user.id || t.ticket_status !== 'paid') throw new LiveError('not_found');
  res.set('Cache-Control', 'private, no-store');
  res.type('text/calendar; charset=utf-8').attachment('wisecall-live.ics').send(require('../live/notices').ics(t, user.language));
}));

// ---- The room -------------------------------------------------------------------------------------------------------------------------
router.post('/:id/join', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};
  res.json(await room.join(user, req.params.id, { anonymous: b.anonymous === undefined ? undefined : b.anonymous === true }));
}));
router.post('/:id/heartbeat', requireAuth, run(async (user, req, res) => { res.json(await room.heartbeat(user, req.params.id)); }));
router.get('/:id/state', requireAuth, run(async (user, req, res) => { res.set('Cache-Control', 'no-store'); res.json(await room.state(user, req.params.id)); }));
router.post('/:id/questions', requireAuth, run(async (user, req, res) => { res.status(201).json({ questions: await room.ask(user, req.params.id, (req.body || {}).body) }); }));
router.post('/questions/:qid/vote', requireAuth, run(async (user, req, res) => { res.json({ questions: await room.vote(user, req.params.qid) }); }));
router.post('/questions/:qid/state', requireAuth, run(async (user, req, res) => { res.json({ questions: await room.setQuestionState(user, req.params.qid, (req.body || {}).state) }); }));
router.post('/:id/hand', requireAuth, run(async (user, req, res) => { res.json(await room.hand(user, req.params.id, (req.body || {}).raise === true)); }));
router.post('/:id/speakers/:userId', requireAuth, run(async (user, req, res) => { res.json(await room.setSpeaker(user, req.params.id, req.params.userId, (req.body || {}).allow === true)); }));
router.post('/:id/end', requireAuth, run(async (user, req, res) => { await room.endByMentor(user, req.params.id); res.json({ ok: true }); }));
router.post('/:id/restart', requireAuth, run(async (user, req, res) => { res.json(await room.restart(user, req.params.id)); }));

// ---- Reports ----------------------------------------------------------------------------------------------------------------------------
router.post('/:id/report', requireAuth, run(async (user, req, res) => {
  const b = req.body || {};
  res.status(201).json(await require('../live/reports').report(user, req.params.id, { reason: b.reason, details: b.details }));
}));

module.exports = router;
