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
const { LiveError } = sessions;

const router = express.Router();
const STATUS = {
  not_found: 404, forbidden: 403, not_authenticated: 401, no_ticket: 403, cannot_host: 403, email_not_verified: 403, own_session: 403,
  sold_out: 409, already_have_ticket: 409, payment_in_progress: 409, not_on_sale: 409, started: 409, not_editable: 409, locked_after_sales: 409,
  not_a_draft: 409, not_cancellable: 409, too_late_to_cancel: 409, not_open_yet: 409, closed: 410, own_question: 409, not_needed: 409,
  payments_closed: 503, video_unavailable: 503, payment_failed_to_start: 502, refund_failed: 502, provider_unavailable: 503, too_many_questions: 429
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
  const out = { session: sessions.publicView(s, mentor) };
  if (viewer) {
    const { rows } = await query(`SELECT * FROM live_tickets WHERE session_id = $1 AND buyer_id = $2 ORDER BY created_at DESC LIMIT 1`, [s.id, viewer]);
    out.ticket = rows[0] ? tickets.view(rows[0]) : null;
    out.isMentor = s.mentor_id === viewer;
  }
  res.json(out);
}));

// ---- Mentors ----------------------------------------------------------------------------------------------------------------------------
router.get('/mine', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = await sessions.canHost(user);
  const { rows } = await query(`SELECT s.*, ${sessions.SEATS_SQL} AS taken FROM live_sessions s WHERE s.mentor_id = $1 ORDER BY s.starts_at DESC LIMIT 200`, [user.id]);
  res.json({ canHost: host.ok, hostReason: host.reason || null, sessions: rows.map(sessions.ownerView), tickets: await tickets.mine(user.id) });
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
  res.status(201).json(await tickets.buy(user, req.params.id, { questions: b.questions, anonymous: b.anonymous === true }));
}));
router.post('/tickets/:id/sync', requireAuth, run(async (user, req, res) => {
  const { rows: [t] } = await query('SELECT buyer_id FROM live_tickets WHERE id = $1', [req.params.id]);
  if (!t || t.buyer_id !== user.id) throw new LiveError('not_found');
  res.json({ ticket: tickets.view(await tickets.sync(req.params.id)) });
}));
router.post('/tickets/:id/cancel', requireAuth, run(async (user, req, res) => { res.json({ ticket: await tickets.cancelByBuyer(user, req.params.id) }); }));
router.get('/tickets/:id/calendar.ics', requireAuth, run(async (user, req, res) => {
  // (the ticket's own status, not the session's: both tables have a status)
  const { rows: [t] } = await query(`SELECT s.*, t.buyer_id, t.status AS ticket_status FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [req.params.id]);
  if (!t || t.buyer_id !== user.id || t.ticket_status !== 'paid') throw new LiveError('not_found');
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
