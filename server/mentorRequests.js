// "Find me a mentor" (PART 7B): when nobody fits, a visitor says who they need (a field in their own words and the closest category,
// what they need, language, an optional budget). One active request per email and field; it expires after 60 days. A visitor who is not
// signed in confirms by email first. When a matching mentor is listed (the same category, or the words of the field in the mentor's own
// field, tags or title), the person gets ONE email with a link, and can remove the request from any email. A public board shows only
// anonymous counts by field (and the text only when the person ticked "show my request anonymously"), and only from 5 requests on.
const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');
const { sendTemplate } = require('./mail');
const { getUserById, listableSql } = require('./models');
const { isListable } = require('./util');
const niches = require('./niches');
const customNiche = require('./customNiche');
const textSafety = require('./textSafety');

class RequestError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS = 60;
const BOARD_MIN = 5;
const NEED_MIN = 20;
const NEED_MAX = 500;
const LANGS = ['any', 'en', 'ka'];
const token = () => crypto.randomBytes(24).toString('hex');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// -> { request, needsConfirmation }
async function create({ user, email, field, niche, need, language, budgetMin, budgetMax, showPublic, lang }) {
  const signedIn = Boolean(user && user.emailVerified);
  const address = signedIn ? user.email : String(email || '').trim();
  if (!EMAIL_RE.test(address) || address.length > 254) throw new RequestError('invalid_email');
  const f = customNiche.clean(field);
  if (f.error) throw new RequestError('invalid_field');
  const cat = niche === 'other' || niches.isValid(String(niche || '')) ? String(niche) : null;
  if (!cat) throw new RequestError('invalid_niche');
  const text = textSafety.cleanText(need || '');
  if ([...text].length < NEED_MIN || [...text].length > NEED_MAX) throw new RequestError('invalid_need', { min: NEED_MIN, max: NEED_MAX });
  if (textSafety.isOffensive(text)) throw new RequestError('offensive');
  if (textSafety.findContactDetails(text).length) throw new RequestError('contact_details'); // (the request may be shown: no contact details in it)
  const lng = LANGS.includes(language) ? language : 'any';
  const money = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const min = money(budgetMin), max = money(budgetMax);
  for (const v of [min, max]) if (v !== null && (!Number.isInteger(v) || v < config.PRICE_MIN || v > config.PRICE_MAX)) throw new RequestError('invalid_budget');
  if (min !== null && max !== null && min > max) throw new RequestError('invalid_budget');
  const confirmToken = signedIn ? null : token();
  try {
    const { rows: [r] } = await query(
      `INSERT INTO mentor_requests (email, user_id, field_text, field_key, niche, need, language, budget_min, budget_max, show_public, status, confirm_token_hash, token, lang, confirmed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() + make_interval(days => $16)) RETURNING *`,
      [address, signedIn ? user.id : null, f.value, customNiche.groupKey(f.value) || f.value.toLowerCase(), cat, text, lng, min, max, showPublic === true,
        signedIn ? 'active' : 'unconfirmed', confirmToken ? hash(confirmToken) : null, token(), lang === 'ka' ? 'ka' : 'en', signedIn ? new Date() : null, DAYS]);
    if (!signedIn) {
      sendTemplate('mentorRequestConfirm', { to: address, lang: r.lang, data: { field: r.field_text, url: `${config.PUBLIC_URL}/api/requests/confirm?token=${confirmToken}` } })
        .catch((e) => console.error('[email] request confirmation failed:', e.message));
    }
    if (signedIn) afterCreated(r);
    return { request: view(r), needsConfirmation: !signedIn };
  } catch (e) {
    if (e && e.code === '23505') throw new RequestError('already_requested');
    throw e;
  }
}
const view = (r) => ({ id: r.id, field: r.field_text, niche: r.niche, status: r.status, expiresAt: r.expires_at });

async function confirm(t) {
  if (!/^[0-9a-f]{48}$/.test(String(t || ''))) throw new RequestError('not_found');
  const { rows } = await query(
    `UPDATE mentor_requests SET status = 'active', confirmed_at = now(), confirm_token_hash = NULL
      WHERE confirm_token_hash = $1 AND status = 'unconfirmed' RETURNING *`, [hash(t)]);
  if (!rows[0]) throw new RequestError('not_found');
  afterCreated(rows[0]);
  return view(rows[0]);
}

// The link in every email removes the request.
async function remove(t) {
  if (!/^[0-9a-f]{48}$/.test(String(t || ''))) throw new RequestError('not_found');
  const { rowCount } = await query(`UPDATE mentor_requests SET status = 'removed' WHERE token = $1 AND status <> 'removed'`, [t]);
  if (!rowCount) throw new RequestError('not_found');
}

// A request that already has a matching listed mentor is answered at once.
function afterCreated(r) {
  (async () => {
    const { rows } = await query(`SELECT id FROM users WHERE ${listableSql()} ORDER BY created_at DESC LIMIT 500`);
    for (const m of rows) { const sent = await notifyFor(await getUserById(m.id), r.id); if (sent) break; }
  })().catch((e) => console.error('[requests] matching failed:', e.message));
}

// ---- Matching -------------------------------------------------------------------------------------------------------------------------
const wordsOf = (s) => customNiche.groupKey(s).split(' ').filter((w) => w.length >= 4);
function matches(r, mentor) {
  if (r.niche !== 'other' && r.niche === mentor.niche) return true;
  const want = wordsOf(r.field_text);
  if (!want.length) return false;
  const have = new Set([mentor.customNiche, mentor.roleTitle, ...(mentor.specialtyTags || [])].flatMap((x) => wordsOf(x || '')));
  return want.some((w) => have.has(w));
}

// Each request is claimed with one UPDATE before its email, so nobody gets two (two mentors listed at once, two servers).
async function notifyFor(mentor, onlyId) {
  if (!mentor || !isListable(mentor) || !config.EMAIL_ENABLED || config.LAUNCH_MODE === 'prelaunch') return 0;
  const { rows } = await query(
    `SELECT * FROM mentor_requests WHERE status = 'active' AND expires_at > now() ${onlyId ? 'AND id = $1' : ''} ORDER BY created_at LIMIT 500`, onlyId ? [onlyId] : []);
  let sent = 0;
  for (const r of rows.filter((x) => matches(x, mentor))) {
    const { rowCount } = await query(`UPDATE mentor_requests SET status = 'notified', notified_at = now(), notified_mentor_id = $2 WHERE id = $1 AND status = 'active'`, [r.id, mentor.id]);
    if (!rowCount) continue;
    try {
      await sendTemplate('mentorRequestMatched', { to: r.email, lang: r.lang, data: {
        field: r.field_text, name: mentor.name, url: `${config.PUBLIC_URL}${r.lang === 'ka' ? '/ka' : ''}/u/${mentor.username}`,
        unsubscribeUrl: `${config.PUBLIC_URL}/api/requests/remove?token=${r.token}` } });
      sent += 1;
    } catch (e) { console.error('[email] request match failed:', e.message); }
  }
  return sent;
}
async function afterMaybeListed(userId) {
  try { return await notifyFor(await getUserById(userId)); } catch (e) { console.error('[requests] could not notify:', e.message); return 0; }
}

// Runs with the background jobs: requests older than 60 days end.
async function expire() {
  const { rowCount } = await query(`UPDATE mentor_requests SET status = 'expired' WHERE status IN ('active', 'unconfirmed') AND expires_at <= now()`);
  return rowCount;
}

// An account that is deleted takes its requests with it.
async function onAccountDeleted(user) {
  await query(`DELETE FROM mentor_requests WHERE user_id = $1 OR lower(email) = lower($2)`, [user.id, user.email || '']);
}

// ---- The public board: anonymous counts by field, from BOARD_MIN active requests on --------------------------------------------------
async function board() {
  const { rows } = await query(`SELECT field_key, field_text, niche, need, show_public FROM mentor_requests WHERE status = 'active' AND expires_at > now()`);
  if (rows.length < BOARD_MIN) return null;
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.field_key) || { label: r.field_text, niche: r.niche, count: 0, texts: [] };
    g.count += 1;
    if (r.show_public && g.texts.length < 3) g.texts.push(r.need);
    groups.set(r.field_key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---- The admin's view -------------------------------------------------------------------------------------------------------------------
async function dashboard() {
  const [{ rows: all }, { rows: weeks }, { rows: listed }] = await Promise.all([
    query(`SELECT id, email, field_text, field_key, niche, need, language, budget_min, budget_max, show_public, status, created_at, notified_at
             FROM mentor_requests WHERE status <> 'removed' ORDER BY created_at DESC LIMIT 2000`),
    query(`SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS n FROM mentor_requests
            WHERE status <> 'removed' AND created_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1 DESC`),
    query(`SELECT niche, custom_niche, role_title, specialty_tags FROM users WHERE ${listableSql()}`)
  ]);
  const mentors = listed.map((u) => ({ niche: u.niche, customNiche: u.custom_niche, roleTitle: u.role_title, specialtyTags: u.specialty_tags || [] }));
  const groups = new Map();
  for (const r of all) {
    const g = groups.get(r.field_key) || { key: r.field_key, label: r.field_text, niche: r.niche, count: 0, active: 0 };
    g.count += 1;
    if (r.status === 'active') g.active += 1;
    groups.set(r.field_key, g);
  }
  const byField = [...groups.values()].map((g) => ({ ...g, hasMentor: mentors.some((m) => matches({ niche: g.niche, field_text: g.label }, m)) }))
    .sort((a, b) => b.count - a.count);
  return {
    byField, byWeek: weeks, topUnserved: byField.filter((g) => !g.hasMentor).slice(0, 10),
    requests: all.map((r) => ({ id: r.id, email: r.email, field: r.field_text, niche: r.niche, need: r.need, language: r.language,
      budgetMin: r.budget_min, budgetMax: r.budget_max, showPublic: r.show_public, status: r.status, createdAt: r.created_at, notifiedAt: r.notified_at }))
  };
}

// Two spellings of the same field become one (the label of `into` is kept).
async function merge(fromKey, intoKey) {
  const { rows: [into] } = await query(`SELECT field_text, field_key FROM mentor_requests WHERE field_key = $1 LIMIT 1`, [String(intoKey)]);
  if (!into || fromKey === intoKey) throw new RequestError('not_found');
  const { rowCount } = await query(
    `UPDATE mentor_requests SET field_key = $2, field_text = $3 WHERE field_key = $1 AND NOT EXISTS (
       SELECT 1 FROM mentor_requests o WHERE o.field_key = $2 AND lower(o.email) = lower(mentor_requests.email) AND o.status IN ('unconfirmed', 'active') AND mentor_requests.status IN ('unconfirmed', 'active'))`,
    [String(fromKey), into.field_key, into.field_text]);
  return rowCount;
}

module.exports = { RequestError, BOARD_MIN, NEED_MIN, NEED_MAX, create, confirm, remove, afterMaybeListed, expire, onAccountDeleted, board, dashboard, merge, matches };
