// The question and answer on the home page's phone (docs/CLAUDE-CODE-NEW-HOME.md 2.2). Only a real one that both people agreed to show: a
// published public answer (the asker and the mentor said yes and an admin approved it; the database refuses anything else), from a real
// question (never a sample answer to a question our team wrote), by a mentor who is still listed. An admin chooses which one; none chosen,
// or the chosen one withdrawn, and the phone is not shown. The asker is never named: only the question's field.
const { query } = require('./db');
const { listableSql } = require('./models');

const KEY = 'home_qa';
const ANSWER_CHARS = 300;
const QUESTION_CHARS = 240;
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
const FROM = `FROM public_answers pa JOIN users m ON m.id = pa.mentor_id JOIN bookings b ON b.id = pa.booking_id`;

async function chosenId() {
  const { rows: [r] } = await query('SELECT value FROM site_settings WHERE key = $1', [KEY]);
  return r && r.value && typeof r.value.id === 'string' ? r.value.id : null;
}

// What the home page shows, or null (then the phone is hidden).
async function current() {
  const id = await chosenId();
  if (!id) return null;
  const { rows: [r] } = await query(
    `SELECT pa.id, pa.niche, pa.question_public, pa.answer_public, b.paid_at, b.created_at AS asked_at, b.answered_at,
            m.name, m.username, m.color, m.role_title, m.niche AS mentor_niche, m.field_id,
            (SELECT r.stars FROM ratings r WHERE r.booking_id = b.id AND r.direction = 'asker_to_mentor' AND r.revealed_at IS NOT NULL AND r.hidden_at IS NULL LIMIT 1) AS stars
       ${FROM} WHERE pa.id = $1 AND ${SHOWABLE}`, [id]);
  if (!r) return null;
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

// For the admin: the answers that may be shown, newest first, and which one is chosen.
async function forAdmin() {
  const [id, { rows }] = await Promise.all([chosenId(), query(
    `SELECT pa.id, pa.niche, pa.question_public, pa.answer_public, pa.published_at, m.name ${FROM} WHERE ${SHOWABLE} ORDER BY pa.published_at DESC LIMIT 100`)]);
  return {
    chosen: rows.some((r) => r.id === id) ? id : null,
    answers: rows.map((r) => ({ id: r.id, niche: r.niche, mentor: r.name, question: clip(r.question_public, 160), answer: clip(r.answer_public, ANSWER_CHARS), publishedAt: r.published_at }))
  };
}

class HomeQaError extends Error { constructor(code) { super(code); this.code = code; } }

// id: one of the showable answers, or null for none. Kept with who chose it.
async function choose(admin, id) {
  if (id !== null) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HomeQaError('not_found');
    const { rows } = await query(`SELECT 1 ${FROM} WHERE pa.id = $1 AND ${SHOWABLE}`, [id]);
    if (!rows.length) throw new HomeQaError('not_found');
  }
  await query(`INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [KEY, id === null ? null : JSON.stringify({ id }), admin.id]);
  return { chosen: id };
}

module.exports = { current, forAdmin, choose, clip, HomeQaError, ANSWER_CHARS };
