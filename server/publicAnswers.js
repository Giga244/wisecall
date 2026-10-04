// Public answers (an opt-in library). An answered question becomes a public page only when ALL of these hold:
//   1. the asker rated the answer 4 or 5 stars and agreed ("Let others learn from this answer? Your name is never shown"), after seeing
//      and, if they wished, editing the question as it would be published (names, emails, phones, links, @handles and long numbers are
//      removed first; at most 1,000 characters);
//   2. the mentor agreed (Settings: always / ask me each time [default] / never), and may edit the public version of the answer;
//   3. an admin approved it (and, for a regulated field, explicitly allowed it).
// Either person can withdraw at any time: the page is gone at once (410). Nothing here is ever published automatically.
const crypto = require('crypto');
const { query, tx, afterCommit } = require('./db');
const config = require('./config');
const { getUserById, getBookingById } = require('./models');
const niches = require('./niches');
const textSafety = require('./textSafety');
const { LIMITS } = require('./content');

class AnswerError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const QUESTION_MAX = 1000;
const QUESTION_MIN = 20;
const PREFS = ['always', 'ask', 'never'];

// ---- Removing what identifies people from the question --------------------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function redact(text, names = []) {
  let s = String(text || '').normalize('NFKC');
  s = s.replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/\b[\w-]+\.(?:com|ge|net|org|io|ru|me|app|dev|co|info|eu|uk|de)\b(?:\/\S*)?/gi, '[link]')
    .replace(/(^|[\s(,;:])@[\p{L}\p{N}_.]{2,}/gu, '$1[handle]')
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/gi, '[number]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]');
  const parts = [...new Set(names.filter(Boolean).flatMap((n) => [n, ...String(n).split(/\s+/)]).map((p) => p.trim()).filter((p) => [...p].length >= 3))]
    .sort((a, b) => b.length - a.length);
  for (const p of parts) s = s.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(p)}(?=[^\\p{L}]|$)`, 'giu'), '$1[name]');
  return s.replace(/[ \t]+/g, ' ').trim();
}

// A readable address from the published question: Latin letters (Georgian is written in Latin), at most 8 words, plus a short id.
function slugFor(question, id) {
  const latin = require('./verification/names').transliterate(String(question || '')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = latin.replace(/\[(?:name|email|link|handle|number)\]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
  const base = words.join('-').slice(0, 60).replace(/-+$/, '') || 'answer';
  return `${base}-${String(id).replace(/-/g, '').slice(0, 6)}`;
}

// ---- What the dashboard shows ------------------------------------------------------------------------------------------------------
const rowOf = async (bookingId, client) => (await (client ? client.query.bind(client) : query)('SELECT * FROM public_answers WHERE booking_id = $1', [bookingId])).rows[0] || null;
const view = (r) => r && ({
  id: r.id, status: r.status, slug: r.status === 'published' ? r.slug : null, question: r.question_public, answer: r.answer_public,
  askerAgreed: r.asker_consent === true, mentorAgreed: r.mentor_consent === true, rejectReason: r.status === 'rejected' ? r.reject_reason : null
});

async function askerRating(bookingId) {
  const { rows } = await query(`SELECT stars FROM ratings WHERE booking_id = $1 AND direction = 'asker_to_mentor'`, [bookingId]);
  return rows[0] ? rows[0].stars : null;
}
const visibleToAsker = (b) => b.status === 'answered' && b.answerReview !== 'held' && b.answerReview !== 'rejected';

// For each booking of the dashboard: { [bookingId]: { ...view, canOffer, draft } } (draft: the question as it would be published).
async function forBookings(bookings, viewerId) {
  const ids = bookings.map((b) => b.id);
  if (!ids.length) return {};
  const [{ rows }, { rows: stars }, { rows: prefs }] = await Promise.all([
    query('SELECT * FROM public_answers WHERE booking_id = ANY($1::uuid[])', [ids]),
    query(`SELECT booking_id, stars FROM ratings WHERE booking_id = ANY($1::uuid[]) AND direction = 'asker_to_mentor'`, [ids]),
    query('SELECT id, public_answers_pref FROM users WHERE id = ANY($1::uuid[])', [[...new Set(bookings.map((b) => b.mentorId))]])
  ]);
  const byBooking = Object.fromEntries(rows.map((r) => [r.booking_id, r]));
  const starsOf = Object.fromEntries(stars.map((r) => [r.booking_id, r.stars]));
  const prefOf = Object.fromEntries(prefs.map((r) => [r.id, r.public_answers_pref]));
  const out = {};
  for (const b of bookings) {
    const r = byBooking[b.id];
    const asker = b.seekerId === viewerId;
    if (r) { out[b.id] = view(r); continue; }
    if (asker && visibleToAsker(b) && (starsOf[b.id] || 0) >= 4 && prefOf[b.mentorId] !== 'never') {
      out[b.id] = { status: 'can_offer', canOffer: true, draft: (await draftFor(b)).slice(0, QUESTION_MAX) };
    }
  }
  return out;
}
async function draftFor(b) {
  const [asker, mentor] = await Promise.all([getUserById(b.seekerId), getUserById(b.mentorId)]);
  return redact(b.question, [asker && asker.name, mentor && mentor.name]);
}

// ---- The asker -----------------------------------------------------------------------------------------------------------------------
async function askerAgrees(user, bookingId, { question }) {
  const b = await getBookingById(bookingId);
  if (!b || b.seekerId !== user.id) throw new AnswerError('not_found');
  if (!visibleToAsker(b)) throw new AnswerError('not_answered');
  if ((await askerRating(b.id) || 0) < 4) throw new AnswerError('rating_needed');
  const mentor = await getUserById(b.mentorId);
  if (!mentor || mentor.publicAnswersPref === 'never') throw new AnswerError('mentor_declines');
  // (the question the asker approved is checked again: nothing that identifies a person is published, whatever was typed)
  const q = redact(typeof question === 'string' && question.trim() ? question : b.question, [user.name, mentor.name]);
  if ([...q].length < QUESTION_MIN || [...q].length > QUESTION_MAX) throw new AnswerError('invalid_question', { min: QUESTION_MIN, max: QUESTION_MAX });
  if (textSafety.isOffensive(q)) throw new AnswerError('offensive');
  const auto = mentor.publicAnswersPref === 'always';
  return tx(async (client) => {
    if (await rowOf(b.id, client)) throw new AnswerError('already_decided');
    const { rows: [r] } = await client.query(
      `INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, regulated, status, asker_consent, asker_decided_at, mentor_consent, mentor_decided_at, question_public, answer_public)
       VALUES ($1, $2, $3, $4, $5, $6, true, now(), $7, $8, $9, $10) RETURNING *`,
      [b.id, mentor.id, user.id, mentor.niche, niches.isRegulated(mentor.niche), auto ? 'pending_review' : 'pending_mentor',
        auto ? true : null, auto ? new Date() : null, q, String(b.answer || '').slice(0, LIMITS.answerMax)]);
    afterCommit(client, async () => {
      const inbox = require('./inbox');
      if (auto) require('./notify').notifyAdmins('A public answer waits for review', '<p>Open Answers in the admin panel.</p>');
      else await inbox.systemMessage(mentor.id, 'public_answer_request', { bookingId: b.id });
    });
    return view(r);
  });
}

async function askerDeclines(user, bookingId) {
  const b = await getBookingById(bookingId);
  if (!b || b.seekerId !== user.id) throw new AnswerError('not_found');
  const { rows } = await query(
    `INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, status, asker_consent, asker_decided_at)
     VALUES ($1, $2, $3, $4, 'declined', false, now()) ON CONFLICT (booking_id) DO NOTHING RETURNING *`, [b.id, b.mentorId, user.id, null]);
  return view(rows[0] || await rowOf(b.id));
}

// ---- The mentor ----------------------------------------------------------------------------------------------------------------------
async function mentorDecides(user, id, { agree, answer }) {
  return tx(async (client) => {
    const { rows: [r] } = await client.query('SELECT * FROM public_answers WHERE id = $1 FOR UPDATE', [id]);
    if (!r || r.mentor_id !== user.id) throw new AnswerError('not_found');
    if (r.status !== 'pending_mentor') throw new AnswerError('already_decided');
    if (agree !== true) {
      const { rows: [d] } = await client.query(`UPDATE public_answers SET status = 'declined', mentor_consent = false, mentor_decided_at = now() WHERE id = $1 RETURNING *`, [id]);
      return view(d);
    }
    let text = r.answer_public;
    if (typeof answer === 'string' && answer.trim()) {
      text = textSafety.cleanText(answer);
      if ([...text].length < LIMITS.answerMin || [...text].length > LIMITS.answerMax) throw new AnswerError('invalid_answer', { min: LIMITS.answerMin, max: LIMITS.answerMax });
      if (textSafety.isOffensive(text)) throw new AnswerError('offensive');
    }
    const { rows: [u] } = await client.query(
      `UPDATE public_answers SET status = 'pending_review', mentor_consent = true, mentor_decided_at = now(), answer_public = $2 WHERE id = $1 RETURNING *`, [id, text]);
    afterCommit(client, () => require('./notify').notifyAdmins('A public answer waits for review', '<p>Open Answers in the admin panel.</p>'));
    return view(u);
  });
}

// Either person, at any time: the page is removed at once.
async function withdraw(user, id) {
  const { rows } = await query(
    `UPDATE public_answers SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = CASE WHEN asker_id = $2 THEN 'asker' ELSE 'mentor' END
      WHERE id = $1 AND (asker_id = $2 OR mentor_id = $2) AND status <> 'withdrawn' RETURNING *`, [id, user.id]);
  if (!rows[0]) throw new AnswerError('not_found');
  return view(rows[0]);
}

// An account that is deleted takes its public answers with it.
async function onAccountDeleted(userId, client) {
  await (client ? client.query.bind(client) : query)(
    `UPDATE public_answers SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = 'account'
      WHERE (asker_id = $1 OR mentor_id = $1) AND status <> 'withdrawn'`, [userId]);
}

// ---- The admin -----------------------------------------------------------------------------------------------------------------------
async function queue() {
  const { rows } = await query(
    `SELECT pa.*, m.name AS mentor_name, m.username AS mentor_username FROM public_answers pa JOIN users m ON m.id = pa.mentor_id
      WHERE pa.status = 'pending_review' ORDER BY pa.created_at LIMIT 100`);
  return rows.map((r) => ({ ...view(r), niche: r.niche, regulated: r.regulated, mentorName: r.mentor_name, mentorUsername: r.mentor_username, createdAt: r.created_at }));
}

async function approve(admin, id, { question, answer, allowRegulated }) {
  return tx(async (client) => {
    const { rows: [r] } = await client.query('SELECT * FROM public_answers WHERE id = $1 FOR UPDATE', [id]);
    if (!r) throw new AnswerError('not_found');
    if (r.status !== 'pending_review' || r.asker_consent !== true || r.mentor_consent !== true) throw new AnswerError('not_ready');
    if (r.regulated && allowRegulated !== true) throw new AnswerError('regulated_needs_permission');
    const q = typeof question === 'string' && question.trim() ? redact(question) : r.question_public;
    const a = typeof answer === 'string' && answer.trim() ? textSafety.cleanText(answer) : r.answer_public;
    if ([...q].length < QUESTION_MIN || [...q].length > QUESTION_MAX) throw new AnswerError('invalid_question', { min: QUESTION_MIN, max: QUESTION_MAX });
    if ([...a].length < 1 || [...a].length > LIMITS.answerMax) throw new AnswerError('invalid_answer');
    const { rows: [p] } = await client.query(
      `UPDATE public_answers SET status = 'published', question_public = $2, answer_public = $3, slug = $4, allow_regulated = $5,
              reviewed_by = $6, reviewed_at = now(), published_at = now() WHERE id = $1 RETURNING *`,
      [id, q, a, r.slug || slugFor(q, id), Boolean(allowRegulated), admin.id]);
    await client.query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, 'public_answer_published', $4)`,
      [r.mentor_id, admin.id, admin.email, `/answers/${p.slug}${r.regulated ? ' (regulated field, allowed by the admin)' : ''}`]);
    afterCommit(client, async () => {
      const inbox = require('./inbox');
      for (const uid of [r.asker_id, r.mentor_id].filter(Boolean)) await inbox.systemMessage(uid, 'public_answer_published', { slug: p.slug });
    });
    return view(p);
  });
}

async function reject(admin, id, reason) {
  const why = String(reason || '').trim();
  if (why.length < 5 || why.length > 500) throw new AnswerError('reason_required');
  const { rows } = await query(
    `UPDATE public_answers SET status = 'rejected', reject_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND status = 'pending_review' RETURNING *`,
    [id, why, admin.id]);
  if (!rows[0]) throw new AnswerError('not_ready');
  await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, 'public_answer_rejected', $4)`, [rows[0].mentor_id, admin.id, admin.email, why]);
  return view(rows[0]);
}

// ---- The public pages ------------------------------------------------------------------------------------------------------------------
const PUBLIC_COLUMNS = `pa.id, pa.slug, pa.question_public, pa.answer_public, pa.niche, pa.regulated, pa.published_at, pa.helpful_count,
  m.name AS mentor_name, m.username AS mentor_username, m.role_title AS mentor_title, m.custom_niche AS mentor_field, m.price AS mentor_price, m.color AS mentor_color,
  m.photo_updated_at AS mentor_photo_at, m.id AS mentor_id, (${require('./models').listableSql('m')}) AS mentor_listed`;
const publicView = (r) => ({
  id: r.id, slug: r.slug, question: r.question_public, answer: r.answer_public, niche: r.niche, regulated: r.regulated, publishedAt: r.published_at,
  helpful: r.helpful_count,
  mentor: { id: r.mentor_id, name: r.mentor_name, username: r.mentor_username, roleTitle: r.mentor_title, field: r.mentor_field, price: r.mentor_price,
    color: r.mentor_color, photoUrl: r.mentor_photo_at ? `/api/photo/${r.mentor_id}?v=${new Date(r.mentor_photo_at).getTime()}` : null, listed: r.mentor_listed }
});
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// Published answers: search (question and answer), a field, newest or most helpful first; or one mentor's.
async function list({ q, niche, sort, mentorId, limit = 30 } = {}) {
  const params = [];
  let where = `pa.status = 'published'`;
  if (q && String(q).trim()) { params.push('%' + escapeLike(String(q).trim().slice(0, 100)) + '%'); where += ` AND (pa.question_public ILIKE $${params.length} OR pa.answer_public ILIKE $${params.length})`; }
  if (niche && niche !== 'all') { params.push(String(niche)); where += ` AND pa.niche = $${params.length}`; }
  if (mentorId) { params.push(String(mentorId)); where += ` AND pa.mentor_id = $${params.length}::uuid`; }
  params.push(Math.min(Math.max(Number(limit) || 30, 1), 60));
  const order = sort === 'helpful' ? 'pa.helpful_count DESC, pa.published_at DESC' : 'pa.published_at DESC';
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM public_answers pa JOIN users m ON m.id = pa.mentor_id WHERE ${where} ORDER BY ${order} LIMIT $${params.length}`, params);
  return rows.map(publicView);
}

// -> { answer, related } for a published one, { gone: true } for one that was withdrawn or taken down, null when there is none.
async function bySlug(slug) {
  if (!/^[a-z0-9-]{3,80}$/.test(String(slug))) return null;
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS}, pa.status FROM public_answers pa JOIN users m ON m.id = pa.mentor_id WHERE pa.slug = $1`, [slug]);
  const r = rows[0];
  if (!r) return null;
  if (r.status !== 'published') return { gone: true };
  const { rows: rel } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM public_answers pa JOIN users m ON m.id = pa.mentor_id
      WHERE pa.status = 'published' AND pa.id <> $1 AND pa.niche IS NOT DISTINCT FROM $2 ORDER BY pa.helpful_count DESC, pa.published_at DESC LIMIT 3`, [r.id, r.niche]);
  return { answer: publicView(r), related: rel.map(publicView) };
}

// "Helpful": once per visitor (a random id the page keeps, stored only as a keyed hash).
async function helpful(slug, visitorId) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(visitorId || ''))) throw new AnswerError('invalid_visitor');
  const { rows: [a] } = await query(`SELECT id FROM public_answers WHERE slug = $1 AND status = 'published'`, [String(slug)]);
  if (!a) throw new AnswerError('not_found');
  const voter = crypto.createHmac('sha256', config.SESSION_SECRET).update(`helpful:${visitorId}`).digest('hex');
  const { rowCount } = await query('INSERT INTO public_answer_votes (answer_id, voter) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, voter]);
  const { rows: [c] } = rowCount
    ? await query('UPDATE public_answers SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count', [a.id])
    : await query('SELECT helpful_count FROM public_answers WHERE id = $1', [a.id]);
  return { helpful: c.helpful_count, counted: rowCount > 0 };
}

async function sitemapSlugs() {
  const { rows } = await query(`SELECT slug, published_at FROM public_answers WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000`);
  return rows;
}

module.exports = { AnswerError, PREFS, QUESTION_MAX, redact, slugFor, forBookings, askerAgrees, askerDeclines, mentorDecides, withdraw, onAccountDeleted,
  queue, approve, reject, list, bySlug, helpful, sitemapSlugs };
