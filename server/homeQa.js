// The questions and answers on the home page's phone (docs/CLAUDE-CODE-RANDOM-PHONE.md). Only real ones that both people agreed to show:
// a published public answer (the asker and the mentor said yes and an admin approved it; the database refuses anything else), from a real
// question (never a sample answer to a question our team wrote), by a mentor who is still listed, and not kept off the phone by an admin.
// The page plays them in a random order, a different one on each loop; an admin may pin one to come first. With fewer than three, the page
// fills the rotation with examples marked as such (public/js/phone-rotation.js). The asker is never named: only the question's field.
const { query } = require('./db');
const { listableSql } = require('./models');

const KEY = 'home_qa';
const ANSWER_CHARS = 300;
const QUESTION_CHARS = 240;
const MAX = 20; // (how many the page gets at most: plenty for a visit)
// About n characters, cut at a word where there is one, ending with "...".
function clip(text, n) {
  const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
  if (chars.length <= n) return chars.join('');
  const cut = chars.slice(0, n).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > n * 0.7 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}...`;
}

// The answers that may be shown: published, from a real question, both said yes, the mentor still listed.
const SHOWABLE = `pa.status = 'published' AND NOT pa.is_sample AND pa.booking_id IS NOT NULL AND pa.asker_consent IS TRUE AND pa.mentor_consent IS TRUE
  AND ${listableSql('m')}`;
const ON_PHONE = `${SHOWABLE} AND pa.phone_hidden_at IS NULL`;
const FROM = `FROM public_answers pa JOIN users m ON m.id = pa.mentor_id JOIN bookings b ON b.id = pa.booking_id`;
const COLUMNS = `pa.id, pa.niche, pa.question_public, pa.answer_public, b.paid_at, b.created_at AS asked_at, b.answered_at,
  m.name, m.username, m.color, m.role_title, m.niche AS mentor_niche, m.field_id,
  (SELECT r.stars FROM ratings r WHERE r.booking_id = b.id AND r.direction = 'asker_to_mentor' AND r.revealed_at IS NOT NULL AND r.hidden_at IS NULL LIMIT 1) AS stars`;

async function pinnedId() {
  const { rows: [r] } = await query('SELECT value FROM site_settings WHERE key = $1', [KEY]);
  return r && r.value && typeof r.value.id === 'string' ? r.value.id : null;
}

function shape(r) {
  const from = new Date(r.paid_at || r.asked_at).getTime();
  const days = r.answered_at ? Math.max(1, Math.ceil((new Date(r.answered_at).getTime() - from) / 86400000)) : null;
  return {
    id: r.id,
    niche: r.niche || r.mentor_niche,
    question: clip(r.question_public, QUESTION_CHARS),
    answer: clip(r.answer_public, ANSWER_CHARS),
    days,
    stars: Number.isInteger(r.stars) ? r.stars : null,
    mentor: { name: r.name, username: r.username, color: r.color, roleTitle: r.role_title, niche: r.mentor_niche, fieldId: r.field_id || null }
  };
}

// What the home page plays: the pinned one (when it may still be shown) first, then the others in a random order. The page shuffles again
// and keeps two of the same field apart, so a cached copy of this list still plays differently for each visitor.
async function rotation() {
  const id = await pinnedId();
  const [pinned, others] = await Promise.all([
    id ? query(`SELECT ${COLUMNS} ${FROM} WHERE pa.id = $1 AND ${ON_PHONE}`, [id]) : { rows: [] },
    query(`SELECT ${COLUMNS} ${FROM} WHERE ${ON_PHONE} AND pa.id IS DISTINCT FROM $1 ORDER BY random() LIMIT ${MAX}`, [id])
  ]);
  const answers = [...pinned.rows, ...others.rows].slice(0, MAX).map(shape);
  return { pinned: pinned.rows.length ? id : null, answers };
}

// For the admin: the answers that may be shown, newest first, which one is pinned, and which are kept off the phone.
async function forAdmin() {
  const [id, { rows }] = await Promise.all([pinnedId(), query(
    `SELECT pa.id, pa.niche, pa.question_public, pa.answer_public, pa.published_at, pa.phone_hidden_at, m.name ${FROM} WHERE ${SHOWABLE} ORDER BY pa.published_at DESC LIMIT 100`)]);
  const pinned = rows.some((r) => r.id === id && !r.phone_hidden_at) ? id : null;
  return {
    pinned,
    chosen: pinned, // (the earlier name)
    shown: rows.filter((r) => !r.phone_hidden_at).length,
    answers: rows.map((r) => ({ id: r.id, niche: r.niche, mentor: r.name, question: clip(r.question_public, 160), answer: clip(r.answer_public, ANSWER_CHARS),
      publishedAt: r.published_at, hidden: Boolean(r.phone_hidden_at) }))
  };
}

class HomeQaError extends Error { constructor(code) { super(code); this.code = code; } }

const isId = (id) => /^[0-9a-f-]{36}$/i.test(String(id));

// id: one of the answers the phone may show, to come first; or null for no pin. Kept with who chose it.
async function choose(admin, id) {
  if (id !== null) {
    if (!isId(id)) throw new HomeQaError('not_found');
    const { rows } = await query(`SELECT 1 ${FROM} WHERE pa.id = $1 AND ${ON_PHONE}`, [id]);
    if (!rows.length) throw new HomeQaError('not_found');
  }
  await query(`INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [KEY, id === null ? null : JSON.stringify({ id }), admin.id]);
  return { pinned: id, chosen: id };
}

// Keep an answer off the phone (or let it back on). Hiding the pinned one also unpins it.
async function setHidden(admin, id, hidden) {
  if (!isId(id)) throw new HomeQaError('not_found');
  const { rows } = await query(`UPDATE public_answers SET phone_hidden_at = ${hidden ? 'now()' : 'NULL'}
    WHERE id = $1 AND status = 'published' RETURNING id`, [id]);
  if (!rows.length) throw new HomeQaError('not_found');
  if (hidden && (await pinnedId()) === id) await choose(admin, null);
  return { id, hidden };
}

module.exports = { rotation, forAdmin, choose, setHidden, clip, HomeQaError, ANSWER_CHARS };
