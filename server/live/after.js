// After a live session (Milestone 2): attendees rate it, the mentor shares a short summary with up to 5 links, and every attendee gets a
// one-time 15 % code for a personal question with the same mentor (30 days).
//   attendee = held a paid ticket and was in the room for at least a minute (heartbeats); the session ended normally.
const crypto = require('crypto');
const { query } = require('../db');
const textSafety = require('../textSafety');
const { LiveError } = require('./sessions');

const RATE_DAYS = 14;
const ATTENDED_S = 60;
const CODE_PERCENT = 15;
const CODE_DAYS = 30;
const LINKS_MAX = 5;

// ---- Ratings (the rules of answer ratings: one per person, clean text, no contact details; admins can hide one) ---------------------------
async function rate(user, ticketId, { stars, comment } = {}) {
  const { rows: [t] } = await query(
    `SELECT t.*, s.status AS session_status, s.end_kind, s.ended_at, s.mentor_id FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [ticketId]);
  if (!t || t.holder_id !== user.id) throw new LiveError('not_found');
  if (t.status !== 'paid' || t.session_status !== 'ended' || t.end_kind !== 'normal') throw new LiveError('not_rateable');
  if (t.attended_seconds < ATTENDED_S) throw new LiveError('not_attended');
  if (Date.now() > new Date(t.ended_at).getTime() + RATE_DAYS * 86400000) throw new LiveError('window_closed');
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new LiveError('invalid_stars');
  const text = typeof comment === 'string' ? textSafety.cleanText(comment) : '';
  if ([...text].length > 1000) throw new LiveError('comment_too_long');
  if (text && textSafety.isOffensive(text)) throw new LiveError('offensive');
  if (text && textSafety.findContactDetails(text).length) throw new LiveError('contact_details');
  const { rows } = await query(
    `INSERT INTO live_ratings (ticket_id, session_id, mentor_id, rater_id, stars, comment) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (ticket_id) DO NOTHING RETURNING *`, [t.id, t.session_id, t.mentor_id, user.id, n, text || null]);
  if (!rows[0]) throw new LiveError('already_rated');
  return { stars: rows[0].stars, comment: rows[0].comment };
}

// What the session page and the mentor's profile show: the average, how many, and the comments (no names: "a participant").
const forSession = (sessionId) => summary('session_id', sessionId);
const forMentor = (mentorId) => summary('mentor_id', mentorId);
async function summary(column, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { average: null, count: 0, comments: [] };
  const { rows: [a] } = await query(`SELECT round(avg(stars)::numeric, 1) AS avg, count(*)::int AS n FROM live_ratings WHERE ${column} = $1 AND hidden_at IS NULL`, [id]);
  const { rows } = await query(
    `SELECT stars, comment, created_at FROM live_ratings WHERE ${column} = $1 AND hidden_at IS NULL AND comment IS NOT NULL ORDER BY created_at DESC LIMIT 10`, [id]);
  return { average: a.avg === null ? null : Number(a.avg), count: a.n, comments: rows.map((r) => ({ stars: r.stars, comment: r.comment, createdAt: r.created_at })) };
}

// Admins: the latest ratings (to hide one that breaks the rules), and hiding one, with the reason in the audit log.
async function recentForAdmin() {
  const { rows } = await query(
    `SELECT r.id, r.stars, r.comment, r.created_at, r.hidden_at, r.hide_reason, s.title, s.slug, m.name AS mentor_name
       FROM live_ratings r JOIN live_sessions s ON s.id = r.session_id JOIN users m ON m.id = r.mentor_id ORDER BY r.created_at DESC LIMIT 50`);
  return rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, createdAt: r.created_at, hidden: Boolean(r.hidden_at), hideReason: r.hide_reason,
    session: { title: r.title, slug: r.slug }, mentorName: r.mentor_name }));
}
async function hide(admin, ratingId, reason) {
  const r = textSafety.cleanText(String(reason || ''));
  if (r.length < 5) throw new LiveError('reason_required');
  if (!/^[0-9a-f-]{36}$/i.test(String(ratingId || ''))) throw new LiveError('not_found');
  const { rows: [h] } = await query(`UPDATE live_ratings SET hidden_at = now(), hidden_by = $2, hide_reason = $3 WHERE id = $1 AND hidden_at IS NULL RETURNING *`,
    [ratingId, admin.id, r.slice(0, 500)]);
  if (!h) throw new LiveError('not_found');
  await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, 'live_rating_hidden', $4)`,
    [h.mentor_id, admin.id, admin.email, `rating ${h.id} of live session ${h.session_id}: ${r}`.slice(0, 1000)]);
  return { ok: true };
}

// ---- The mentor's summary and links, sent to the attendees' Inbox ------------------------------------------------------------------------
function cleanLinks(links) {
  const list = (Array.isArray(links) ? links : []).filter((l) => l && (l.url || l.title));
  if (list.length > LINKS_MAX) throw new LiveError('too_many_links', { max: LINKS_MAX });
  return list.map((l) => {
    const url = String(l.url || '').trim();
    let u;
    try { u = new URL(url); } catch (e) { throw new LiveError('invalid_link'); }
    if (!['http:', 'https:'].includes(u.protocol) || url.length > 500) throw new LiveError('invalid_link');
    const title = textSafety.cleanText(String(l.title || '')).slice(0, 100) || u.hostname;
    if (textSafety.isOffensive(title)) throw new LiveError('offensive');
    return { url: u.toString(), title };
  });
}
async function shareSummary(user, sessionId, { summary, links } = {}) {
  const { rows: [s] } = await query('SELECT * FROM live_sessions WHERE id = $1', [sessionId]);
  if (!s || s.mentor_id !== user.id) throw new LiveError('not_found');
  if (s.status !== 'ended' || s.end_kind !== 'normal') throw new LiveError('not_ended');
  const text = textSafety.cleanText(String(summary || ''));
  if ([...text].length < 10 || [...text].length > 2000) throw new LiveError('invalid_summary', { min: 10, max: 2000 });
  if (textSafety.isOffensive(text)) throw new LiveError('offensive');
  if (textSafety.findContactDetails(text).length) throw new LiveError('contact_details');
  const clean = cleanLinks(links);
  const first = !s.summary_sent_at;
  await query(`UPDATE live_sessions SET summary = $2, summary_links = $3, summary_sent_at = COALESCE(summary_sent_at, now()) WHERE id = $1`, [s.id, text, JSON.stringify(clean)]);
  const { rows } = await query(`SELECT DISTINCT holder_id FROM live_tickets WHERE session_id = $1 AND status = 'paid' AND holder_id IS NOT NULL`, [s.id]);
  const inbox = require('../inbox');
  for (const r of rows) {
    await inbox.systemMessage(r.holder_id, first ? 'live_summary' : 'live_summary_updated', { title: s.title, slug: s.slug, summary: text, links: clean });
  }
  return { summary: text, links: clean, sentTo: rows.length };
}

// ---- The 15 % code, after a normal end, for every attendee ---------------------------------------------------------------------------
// Easy to read and type: no 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeText = () => 'WC-' + Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('').replace(/^(.{4})/, '$1-');

async function issueCodes(session) {
  const { rows } = await query(
    `SELECT t.id, t.holder_id FROM live_tickets t WHERE t.session_id = $1 AND t.status = 'paid' AND t.holder_id IS NOT NULL AND t.attended_seconds >= $2
        AND t.holder_id <> $3`, [session.id, ATTENDED_S, session.mentor_id]);
  const { getUserById } = require('../models');
  const mentor = await getUserById(session.mentor_id);
  let n = 0;
  for (const t of rows) {
    const { rows: [c] } = await query(
      `INSERT INTO discount_codes (code, user_id, mentor_id, percent, source_ticket_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) ON CONFLICT (source_ticket_id) DO NOTHING RETURNING *`,
      [codeText(), t.holder_id, session.mentor_id, CODE_PERCENT, t.id, CODE_DAYS]);
    if (!c) continue;
    n += 1;
    await require('./notices').discountCode(c, mentor, session).catch((e) => console.error('[live] code email failed:', e.message));
  }
  return n;
}

// For a question: is this code good for this person and this mentor now? -> the code row (throws LiveError). Used when the question is
// created (server/routes/bookings.js); the question takes the code (claim). It is spent once that question is paid or answered; while
// the payment (or a refund) is under way nobody else can use it; a question that expired unpaid or was refunded gives it back.
const SPENT = ['paid', 'answered'];
const BUSY = ['pending_payment', 'refund_pending'];
const ACTIVE_BOOKING = `('pending_payment', 'paid', 'answered', 'refund_pending')`;
async function check(userId, mentorId, codeTextIn, client) {
  const run = client ? client.query.bind(client) : query;
  const code = String(codeTextIn || '').trim().toUpperCase();
  if (!/^WC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new LiveError('invalid_code');
  const { rows: [c] } = await run(
    `SELECT c.*, b.status AS booking_status FROM discount_codes c LEFT JOIN bookings b ON b.id = c.booking_id WHERE c.code = $1`, [code]);
  if (!c || c.user_id !== userId) throw new LiveError('invalid_code');
  if (c.mentor_id !== mentorId) throw new LiveError('code_other_mentor');
  if (new Date(c.expires_at).getTime() < Date.now()) throw new LiveError('code_expired');
  if (c.booking_id && SPENT.includes(c.booking_status)) throw new LiveError('code_used');
  if (c.booking_id && BUSY.includes(c.booking_status)) throw new LiveError('code_in_use');
  return c;
}
// Takes the code for this question, unless another question took it meanwhile (one statement: two questions cannot both take it).
async function claim(codeId, bookingId) {
  const { rowCount } = await query(
    `UPDATE discount_codes SET booking_id = $2 WHERE id = $1 AND (booking_id IS NULL OR booking_id NOT IN (SELECT id FROM bookings WHERE status IN ${ACTIVE_BOOKING}))`,
    [codeId, bookingId]);
  return rowCount === 1;
}
const discounted = (price, percent) => Math.max(100, Math.round(price * (100 - percent) / 100));

async function myCodes(userId) {
  const { rows } = await query(
    `SELECT c.code, c.percent, c.expires_at, m.name AS mentor_name, m.username AS mentor_username, b.status AS booking_status
       FROM discount_codes c JOIN users m ON m.id = c.mentor_id LEFT JOIN bookings b ON b.id = c.booking_id
      WHERE c.user_id = $1 ORDER BY c.created_at DESC LIMIT 50`, [userId]);
  return rows.map((r) => ({ code: r.code, percent: r.percent, expiresAt: r.expires_at, mentorName: r.mentor_name, mentorUsername: r.mentor_username,
    used: SPENT.includes(r.booking_status), expired: new Date(r.expires_at).getTime() < Date.now() }));
}

module.exports = { rate, forSession, forMentor, recentForAdmin, hide, shareSummary, cleanLinks, issueCodes, check, claim, discounted, myCodes, ATTENDED_S, RATE_DAYS, CODE_PERCENT,
  CODE_DAYS, LINKS_MAX };
