// Live sessions (docs/LIVE-SESSIONS-PLAN.md): who may host, creating and editing a session, publishing (a mentor's first 3 sessions wait
// for an admin), cancelling (everybody refunded), and what the public pages show. Tickets: server/live/tickets.js. The call: room.js.
const crypto = require('crypto');
const { query, tx } = require('../db');
const config = require('../config');
const niches = require('../niches');
const textSafety = require('../textSafety');
const { getUserById } = require('../models');
const { isListable } = require('../util');

class LiveError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const KINDS = ['qa', 'workshop', 'circle'];
const CIRCLE_MAX = 8;
const REVIEW_FIRST = 3; // an admin approves a mentor's first 3 sessions
const TBILISI = '+04:00'; // (Georgia has no daylight saving time)
const CRISIS_FIELDS = ['medicine', 'psychology', 'nursing', 'pharmacy', 'dentistry'];
const LIMITS = { titleMin: 5, titleMax: 100, descriptionMin: 50, descriptionMax: 4000, pointMax: 120, points: 5, durationMin: 30, durationMax: 120,
  priceMin: 5, priceMax: 200 };

// ---- Who can host ----------------------------------------------------------------------------------------------------------------------
async function canHost(user) {
  if (!user || !isListable(user)) return { ok: false, reason: 'not_listed' };
  if (user.liveApprovedAt) return { ok: true };
  const { rows: [r] } = await query(`SELECT count(*)::int AS n FROM bookings WHERE mentor_id = $1 AND status = 'answered'`, [user.id]);
  return r.n >= 1 ? { ok: true } : { ok: false, reason: 'no_answers_yet' };
}

// ---- Checking what a mentor typed -------------------------------------------------------------------------------------------------------
const text = (v) => textSafety.cleanText(typeof v === 'string' ? v : '');
function checkText(value, min, max, field) {
  const t = text(value);
  const n = [...t].length;
  if (n < min || n > max) throw new LiveError('invalid_' + field, { field, min, max });
  if (textSafety.isOffensive(t)) throw new LiveError('offensive', { field });
  if (textSafety.findContactDetails(t).length) throw new LiveError('contact_details', { field });
  return t;
}
const lari = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// "2026-11-03" + "19:30", in Tbilisi time -> a Date (or null)
function tbilisi(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return null;
  const d = new Date(`${date}T${time}:00${TBILISI}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Everything a session needs, checked; `partial` keeps fields that were not sent.
function normalize(b, mentor, existing) {
  const o = {};
  const has = (k) => b[k] !== undefined;
  const base = existing || {};
  o.title = has('title') || !existing ? checkText(b.title, LIMITS.titleMin, LIMITS.titleMax, 'title') : base.title;
  o.description = has('description') || !existing ? checkText(b.description, LIMITS.descriptionMin, LIMITS.descriptionMax, 'description') : base.description;
  if (has('learnPoints') || !existing) {
    const pts = Array.isArray(b.learnPoints) ? b.learnPoints.map(text).filter(Boolean) : [];
    if (pts.length > LIMITS.points) throw new LiveError('too_many_points', { max: LIMITS.points });
    o.learnPoints = pts.map((p) => checkText(p, 3, LIMITS.pointMax, 'point'));
  } else o.learnPoints = base.learn_points;
  o.niche = has('niche') || !existing ? String(b.niche || mentor.niche || 'other') : base.niche;
  if (o.niche !== 'other' && !niches.isValid(o.niche)) throw new LiveError('invalid_niche');
  o.kind = has('kind') || !existing ? String(b.kind || 'qa') : base.kind;
  if (!KINDS.includes(o.kind)) throw new LiveError('invalid_kind');
  o.language = has('language') || !existing ? String(b.language || mentor.language || 'ka') : base.language;
  if (!['ka', 'en'].includes(o.language)) throw new LiveError('invalid_language');
  if (has('date') || has('time') || !existing) {
    o.startsAt = tbilisi(b.date, b.time);
    if (!o.startsAt) throw new LiveError('invalid_time', { field: 'time' });
  } else o.startsAt = new Date(base.starts_at);
  o.durationMin = has('durationMin') || !existing ? Number(b.durationMin || 60) : base.duration_min;
  if (!Number.isInteger(o.durationMin) || o.durationMin < LIMITS.durationMin || o.durationMin > LIMITS.durationMax) throw new LiveError('invalid_duration');
  const price = has('price') || !existing ? lari(b.price) : base.price / 100;
  if (!Number.isInteger(price) || price < LIMITS.priceMin || price > LIMITS.priceMax) throw new LiveError('invalid_price', { min: LIMITS.priceMin, max: LIMITS.priceMax });
  o.price = price * 100;
  const maxCap = o.kind === 'circle' ? CIRCLE_MAX : config.LIVE_MAX_PARTICIPANTS;
  o.maxSeats = has('maxSeats') || !existing ? Number(b.maxSeats || maxCap) : base.max_seats;
  if (!Number.isInteger(o.maxSeats) || o.maxSeats < 2 || o.maxSeats > maxCap) throw new LiveError('invalid_seats', { max: maxCap });
  o.minSeats = has('minSeats') || !existing ? Number(b.minSeats || Math.min(3, o.maxSeats)) : base.min_seats;
  if (!Number.isInteger(o.minSeats) || o.minSeats < 1 || o.minSeats > o.maxSeats) throw new LiveError('invalid_min_seats');
  // Early bird: a lower price, until a date and/or for the first N tickets.
  const early = has('earlyPrice') || !existing ? lari(b.earlyPrice) : (base.early_price === null ? null : base.early_price / 100);
  if (early === null) { o.earlyPrice = null; o.earlyUntil = null; o.earlySeats = null; } else {
    if (!Number.isInteger(early) || early < LIMITS.priceMin || early >= price) throw new LiveError('invalid_early_price');
    o.earlyPrice = early * 100;
    o.earlyUntil = has('earlyUntilDate') || !existing ? (b.earlyUntilDate ? tbilisi(b.earlyUntilDate, '23:59') : null) : (base.early_until ? new Date(base.early_until) : null);
    o.earlySeats = has('earlySeats') || !existing ? (b.earlySeats ? Number(b.earlySeats) : null) : base.early_seats;
    if (o.earlySeats !== null && (!Number.isInteger(o.earlySeats) || o.earlySeats < 1 || o.earlySeats > o.maxSeats)) throw new LiveError('invalid_early_seats');
    if (!o.earlyUntil && !o.earlySeats) throw new LiveError('early_needs_limit');
    if (o.earlyUntil && o.earlyUntil >= o.startsAt) throw new LiveError('invalid_early_date');
  }
  // A replay (Milestone 3, opt-in): only a Live Q&A or a Workshop (in a Small circle everybody's camera is on), for less than a ticket.
  const wantReplay = has('replay') || !existing ? b.replay === true : Boolean(base.replay_enabled);
  if (wantReplay) {
    if (o.kind === 'circle') throw new LiveError('replay_not_for_circle');
    const rp = has('replayPrice') || !existing ? lari(b.replayPrice) : (base.replay_price === null ? null : base.replay_price / 100);
    if (!Number.isInteger(rp) || rp < LIMITS.priceMin || rp >= price) throw new LiveError('invalid_replay_price', { min: LIMITS.priceMin, max: price - 1 });
    o.replay = true;
    o.replayPrice = rp * 100;
  } else { o.replay = false; o.replayPrice = null; }
  // (regulated when the session's field is, when its title names a regulated profession, or when the mentor's own field is regulated)
  o.regulated = niches.isRegulated(o.niche) || Boolean(require('../fieldRules').regulatedCategoryIn(o.title)) || niches.isRegulated(mentor.niche);
  return o;
}

function checkLead(startsAt) {
  const lead = new Date(startsAt).getTime() - Date.now();
  if (lead < config.LIVE_MIN_LEAD_HOURS * 3600000) throw new LiveError('too_soon', { hours: config.LIVE_MIN_LEAD_HOURS });
  if (lead > 180 * 86400000) throw new LiveError('too_far');
}

const slugFor = (title, id) => {
  const latin = require('../verification/names').transliterate(String(title || '')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const base = latin.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8).join('-').slice(0, 60).replace(/-+$/, '') || 'live';
  return `${base}-${String(id).replace(/-/g, '').slice(0, 6)}`;
};

// ---- Reading -------------------------------------------------------------------------------------------------------------------------
const SEATS_SQL = `(SELECT count(*)::int FROM live_tickets t WHERE t.session_id = s.id AND (t.status IN ('paid', 'refund_pending') OR (t.status = 'held' AND t.hold_until > now())))`;
const EARLY_TAKEN_SQL = `(SELECT count(*)::int FROM live_tickets t WHERE t.session_id = s.id AND t.early AND (t.status IN ('paid', 'refund_pending') OR (t.status = 'held' AND t.hold_until > now())))`;
const COVER_SQL = `EXISTS (SELECT 1 FROM live_session_covers c WHERE c.session_id = s.id)`;
// Seats sold or being paid for (SOLD_SQL); seats kept for someone on the waiting list (server/live/waitlist.js) are not for sale either
// (SEATS_SQL = both: what "taken" means everywhere seats are counted).
const SOLD_SQL = SEATS_SQL;
const KEPT_SQL = `(SELECT count(*)::int FROM live_waitlist w WHERE w.session_id = s.id AND w.status = 'offered' AND w.offer_expires_at > now())`;
const TAKEN_SQL = `(${SOLD_SQL} + ${KEPT_SQL})`;
const WAITING_SQL = `(SELECT count(*)::int FROM live_waitlist w WHERE w.session_id = s.id AND w.status IN ('waiting', 'offered'))`;
const ROW_SQL = `SELECT s.*, ${TAKEN_SQL} AS taken, ${SOLD_SQL} AS sold, ${EARLY_TAKEN_SQL} AS early_taken, ${COVER_SQL} AS has_cover FROM live_sessions s`;
async function rowById(id, client) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`${ROW_SQL} WHERE s.id = $1`, [id]);
  return rows[0] || null;
}
async function rowBySlug(slug) {
  const { rows } = await query(`${ROW_SQL} WHERE s.slug = $1`, [String(slug || '')]);
  return rows[0] || null;
}
// The price a new ticket costs now: early-bird while its date has not passed and its seats are not taken.
function currentPrice(s, now = Date.now()) {
  if (s.early_price === null) return { price: s.price, early: false };
  const dateOk = !s.early_until || new Date(s.early_until).getTime() > now;
  const seatsOk = !s.early_seats || Number(s.early_taken || 0) < s.early_seats;
  return dateOk && seatsOk ? { price: s.early_price, early: true } : { price: s.price, early: false };
}
const endsAt = (s) => new Date(new Date(s.starts_at).getTime() + s.duration_min * 60000);

// What anybody may see about a published session.
function publicView(s, mentor) {
  const left = Math.max(0, s.max_seats - Number(s.taken || 0));
  const p = currentPrice(s);
  return {
    id: s.id, slug: s.slug, title: s.title, description: s.description, learnPoints: s.learn_points, niche: s.niche, kind: s.kind,
    language: s.language, startsAt: s.starts_at, endsAt: endsAt(s), durationMin: s.duration_min, price: s.price, earlyPrice: s.early_price,
    earlyUntil: s.early_until, earlySeats: s.early_seats, priceNow: p.price, earlyNow: p.early, maxSeats: s.max_seats, seatsLeft: left,
    status: s.status, regulated: s.regulated, crisisNotice: CRISIS_FIELDS.includes(s.niche) || (mentor && CRISIS_FIELDS.includes(mentor.niche)),
    startingSoon: s.status === 'published' && new Date(s.starts_at).getTime() - Date.now() < 86400000,
    almostFull: left > 0 && left <= Math.max(1, Math.ceil(s.max_seats * 0.2)),
    hasCover: Boolean(s.has_cover), cancelReason: s.status === 'cancelled' ? s.cancel_reason : null,
    replay: Boolean(s.replay_enabled), replayPrice: s.replay_price || null, seriesId: s.series_id || null,
    mentor: mentor ? { id: mentor.id, name: mentor.name, username: mentor.username, niche: mentor.niche, customNiche: mentor.customNiche,
      roleTitle: mentor.roleTitle, photoUrl: require('../util').photoUrl(mentor) } : null
  };
}
// What the mentor sees about their own session (plus the editing state).
function ownerView(s) {
  return { ...publicView(s, null), reviewReason: s.status === 'rejected' ? s.review_reason : null, minSeats: s.min_seats,
    sold: Number(s.sold === undefined ? s.taken || 0 : s.sold || 0), waiting: Number(s.waiting || 0), regulatedAgreed: Boolean(s.regulated_agreed_at),
    createdAt: s.created_at, publishedAt: s.published_at, endKind: s.end_kind || null,
    summary: s.summary || null, summaryLinks: s.summary_links || [], summarySentAt: s.summary_sent_at || null, replayReady: Boolean(s.replay_ready) };
}

// ---- Writing --------------------------------------------------------------------------------------------------------------------------
async function create(mentor, b) {
  const host = await canHost(mentor);
  if (!host.ok) throw new LiveError('cannot_host', { reason: host.reason });
  const o = normalize(b || {}, mentor, null);
  if (o.startsAt.getTime() <= Date.now()) throw new LiveError('too_soon', { hours: config.LIVE_MIN_LEAD_HOURS });
  const id = crypto.randomUUID();
  const { rows: [s] } = await query(
    `INSERT INTO live_sessions (id, slug, mentor_id, title, description, learn_points, niche, kind, language, starts_at, duration_min, price, early_price,
       early_until, early_seats, max_seats, min_seats, regulated, replay_enabled, replay_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [id, slugFor(o.title, id), mentor.id, o.title, o.description, o.learnPoints, o.niche, o.kind, o.language, o.startsAt, o.durationMin, o.price,
      o.earlyPrice, o.earlyUntil, o.earlySeats, o.maxSeats, o.minSeats, o.regulated, o.replay, o.replayPrice]);
  return ownerView(await rowById(s.id));
}

// Free editing until the first ticket is sold; then only the description, the points, the cover and the time (a new time: every buyer is
// told and may cancel for a full refund until the start).
async function update(mentor, id, b) {
  let timeChanged = false;
  let replayChanged = false;
  let out;
  await tx(async (client) => {
    const s = await rowById(id, client);
    if (!s || s.mentor_id !== mentor.id) throw new LiveError('not_found');
    await client.query('SELECT 1 FROM live_sessions WHERE id = $1 FOR UPDATE', [s.id]);
    if (['ended', 'cancelled', 'live'].includes(s.status)) throw new LiveError('not_editable');
    const sold = Number((await client.query(`SELECT count(*)::int AS n FROM live_tickets WHERE session_id = $1 AND status IN ('held', 'paid', 'refund_pending')`, [s.id])).rows[0].n);
    const body = b || {};
    if (sold > 0) {
      const locked = ['title', 'niche', 'kind', 'language', 'durationMin', 'price', 'earlyPrice', 'earlyUntilDate', 'earlySeats', 'maxSeats', 'minSeats', 'replay', 'replayPrice'];
      // (an empty field is the same whether it comes as null, '' or false)
      const same = (v) => (v === null || v === undefined || v === '' || v === false ? '' : String(v));
      const tried = locked.filter((k) => body[k] !== undefined && same(body[k]) !== same(currentValue(s, k)));
      if (tried.length) throw new LiveError('locked_after_sales', { fields: tried });
    }
    const o = normalize(body, mentor, s);
    if (o.startsAt.getTime() !== new Date(s.starts_at).getTime()) {
      if (s.status !== 'draft' || sold > 0) checkLead(o.startsAt);
      timeChanged = sold > 0;
    }
    replayChanged = o.replay !== Boolean(s.replay_enabled);
    await client.query(
      `UPDATE live_sessions SET title=$2, description=$3, learn_points=$4, niche=$5, kind=$6, language=$7, starts_at=$8, duration_min=$9, price=$10,
         early_price=$11, early_until=$12, early_seats=$13, max_seats=$14, min_seats=$15, regulated=$16, updated_at=now(),
         time_changed_at = CASE WHEN $17 THEN now() ELSE time_changed_at END,
         reminded_24h_at = CASE WHEN $17 THEN NULL ELSE reminded_24h_at END, reminded_1h_at = CASE WHEN $17 THEN NULL ELSE reminded_1h_at END,
         status = CASE WHEN status = 'rejected' THEN 'draft' ELSE status END, replay_enabled = $18, replay_price = $19
       WHERE id = $1`,
      [s.id, o.title, o.description, o.learnPoints, o.niche, o.kind, o.language, o.startsAt, o.durationMin, o.price, o.earlyPrice, o.earlyUntil,
        o.earlySeats, o.maxSeats, o.minSeats, o.regulated, timeChanged, o.replay, o.replayPrice]);
    out = await rowById(s.id, client);
  });
  if (timeChanged) require('./notices').timeChanged(out).catch((e) => console.error('[live] time-change emails failed:', e.message));
  // (a new time, or a replay switched on or off before any sale: a new room, made for it)
  if ((timeChanged || replayChanged) && out.room_name) require('./rooms').moveRoom(out).catch((e) => console.error('[live] moving the room failed:', e.message));
  return ownerView(out);
}
function currentValue(s, k) {
  return { title: s.title, niche: s.niche, kind: s.kind, language: s.language, durationMin: s.duration_min, price: s.price / 100,
    earlyPrice: s.early_price === null ? '' : s.early_price / 100, earlySeats: s.early_seats === null ? '' : s.early_seats,
    earlyUntilDate: s.early_until ? new Date(new Date(s.early_until).getTime() + 4 * 3600000).toISOString().slice(0, 10) : '',
    maxSeats: s.max_seats, minSeats: s.min_seats, replay: s.replay_enabled ? true : '', replayPrice: s.replay_price === null ? '' : s.replay_price / 100 }[k];
}

// Publishing: checked again, the agreement for a regulated field, then 'review' (the first 3) or 'published' with its room.
async function publish(mentor, id, { agree } = {}) {
  const host = await canHost(mentor);
  if (!host.ok) throw new LiveError('cannot_host', { reason: host.reason });
  const s = await rowById(id);
  if (!s || s.mentor_id !== mentor.id) throw new LiveError('not_found');
  if (!['draft', 'rejected'].includes(s.status)) throw new LiveError('not_a_draft');
  checkLead(s.starts_at);
  if (s.regulated && agree !== true && !s.regulated_agreed_at) throw new LiveError('agreement_required');
  const { rows: [r] } = await query(`SELECT count(*)::int AS n FROM live_sessions WHERE mentor_id = $1 AND published_at IS NOT NULL`, [mentor.id]);
  const needsReview = r.n < REVIEW_FIRST;
  if (!needsReview) require('./rooms').ensureProvider();
  await query(`UPDATE live_sessions SET regulated_agreed_at = CASE WHEN regulated AND $2 THEN COALESCE(regulated_agreed_at, now()) ELSE regulated_agreed_at END,
                 review_reason = NULL, updated_at = now() WHERE id = $1`, [s.id, agree === true]);
  if (needsReview) {
    await query(`UPDATE live_sessions SET status = 'review' WHERE id = $1 AND status IN ('draft', 'rejected')`, [s.id]);
    require('../notify').notifyAdmins('A live session waits for approval', `<p>${escapeHtml(mentor.name)} sent "${escapeHtml(s.title)}". See the admin panel, Live sessions.</p>`);
    return ownerView(await rowById(s.id));
  }
  // (the room is made first: a session is public only with a room people can join)
  return ownerView(await goLive(s.id));
}
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The session becomes public: its room is made, and the time it went public is kept. The mentor's followers are emailed (at most once a
// week per mentor: server/live/follows.js).
async function goLive(id) {
  const s = await rowById(id);
  const room = await require('./rooms').create(s);
  await query(`UPDATE live_sessions SET status = 'published', room_name = $2, room_url = $3, published_at = COALESCE(published_at, now()), updated_at = now()
                WHERE id = $1 AND status IN ('draft', 'review', 'rejected')`, [id, room.roomName, room.roomUrl]);
  const out = await rowById(id);
  if (out.status === 'published') require('./follows').notifyFollowers(out).catch((e) => console.error('[live] follower emails failed:', e.message));
  return out;
}

// ---- Admins -----------------------------------------------------------------------------------------------------------------------------
async function approve(admin, id, edits) {
  const s = await rowById(id);
  if (!s || s.status !== 'review') throw new LiveError('not_found');
  if (edits && (edits.title !== undefined || edits.description !== undefined || edits.learnPoints !== undefined)) {
    const mentor = await getUserById(s.mentor_id);
    const o = normalize({ title: edits.title, description: edits.description, learnPoints: edits.learnPoints }, mentor, s);
    await query('UPDATE live_sessions SET title = $2, description = $3, learn_points = $4 WHERE id = $1', [s.id, o.title, o.description, o.learnPoints]);
  }
  require('./rooms').ensureProvider();
  await query('UPDATE live_sessions SET reviewed_by = $2, reviewed_at = now() WHERE id = $1', [s.id, admin.id]);
  const out = await goLive(s.id);
  await audit(admin, 'live_approved', s, null);
  require('./notices').reviewed(out, true).catch(() => {});
  return ownerView(out);
}
async function reject(admin, id, reason) {
  const r = text(reason);
  if (r.length < 5) throw new LiveError('reason_required');
  const { rows: [s] } = await query(`UPDATE live_sessions SET status = 'rejected', review_reason = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
                                       WHERE id = $1 AND status = 'review' RETURNING *`, [id, r.slice(0, 500), admin.id]);
  if (!s) throw new LiveError('not_found');
  await audit(admin, 'live_rejected', s, r);
  require('./notices').reviewed(s, false).catch(() => {});
  return ownerView(await rowById(s.id));
}
async function audit(admin, action, s, note) {
  await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, $4, $5)`,
    [s.mentor_id, admin.id, admin.email, action, `live session ${s.id} "${s.title}"${note ? ': ' + note : ''}`.slice(0, 1000)]).catch((e) => console.error('[live] audit failed:', e.message));
}

// ---- Cancelling: everybody is refunded in full, emailed and told in the inbox ------------------------------------------------------------
// reason: 'mentor' | 'min_not_reached' | 'no_show' | 'admin_safety' | 'provider_failed' | 'mentor_suspended' | 'short'
async function cancel(id, reason, { by, note } = {}) {
  const { rows: [s] } = await query(
    `UPDATE live_sessions SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('draft', 'review', 'rejected', 'published', 'live') RETURNING *`, [id, reason]);
  if (!s) throw new LiveError('not_cancellable');
  if (by) await audit(by, 'live_cancelled', s, note ? `${reason}: ${note}` : reason);
  const tickets = require('./tickets');
  const { rows } = await query(`SELECT id FROM live_tickets WHERE session_id = $1 AND status IN ('held', 'paid', 'refund_pending')`, [s.id]);
  for (const t of rows) {
    await tickets.refund(t.id, `session_${reason}`).catch((e) => console.error(`[live] refund of ticket ${t.id} failed (the sweep retries):`, e.message));
  }
  await require('./settle').stopRecording(s).catch(() => {});
  if (s.room_name) require('./rooms').end(s).catch(() => {});
  await require('./waitlist').close(s.id).catch(() => {});
  require('./notices').cancelled(s).catch((e) => console.error('[live] cancel notices failed:', e.message));
  return s;
}
async function cancelByMentor(mentor, id) {
  const s = await rowById(id);
  if (!s || s.mentor_id !== mentor.id) throw new LiveError('not_found');
  return ownerView(await cancel(s.id, 'mentor'));
}

module.exports = { LiveError, KINDS, LIMITS, CIRCLE_MAX, REVIEW_FIRST, CRISIS_FIELDS, canHost, normalize, tbilisi, checkLead, slugFor, rowById, rowBySlug,
  currentPrice, endsAt, publicView, ownerView, create, update, publish, goLive, approve, reject, cancel, cancelByMentor, SEATS_SQL, SOLD_SQL,
  TAKEN_SQL, WAITING_SQL };
