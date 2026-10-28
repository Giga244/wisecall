// "Get notified when mentors in your field join". Stores an email and a field; when a mentor in that
// field (or any mentor, for 'any') is listed, each person waiting gets one email and is marked notified.
const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');
const rules = require('./verification/rules');
const { sendTemplate } = require('./mail');
const { getUserById, listableSql } = require('./models');
const { isListable } = require('./util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class WaitlistError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Adds an address. Asking twice for the same field changes nothing (and reveals nothing).
// wantedQuestion: what they typed on the home page (optional; contact details are taken out, at most 300 characters).
// -> { position }: how many addresses are on the list now ("You're #N on the list"). It is the same answer whether or not the address was
// there already, so it says nothing about who is on the list.
async function add({ email, niche, language, wantedQuestion, source }) {
  const address = String(email || '').trim();
  if (!EMAIL_RE.test(address) || address.length > 254) throw new WaitlistError('invalid_email');
  const field = niche === undefined || niche === null || niche === '' ? 'any' : String(niche);
  if (field !== 'any' && !rules.isValidNiche(field)) throw new WaitlistError('invalid_niche');
  const asked = typeof wantedQuestion === 'string' ? [...require('./publicAnswers').redact(wantedQuestion.replace(/\s+/g, ' ').trim())].slice(0, 300).join('') || null : null;
  await query(
    `INSERT INTO waitlist (email, niche, language, token, prelaunch, wanted_question, source) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (lower(email), niche) DO UPDATE SET wanted_question = COALESCE(waitlist.wanted_question, EXCLUDED.wanted_question),
       source = COALESCE(waitlist.source, EXCLUDED.source)`,
    [address, field, language === 'ka' ? 'ka' : 'en', crypto.randomBytes(24).toString('hex'), config.LAUNCH_MODE === 'prelaunch', asked, source ? JSON.stringify(source) : null]
  );
  const { rows: [n] } = await query('SELECT count(DISTINCT lower(email))::int AS n FROM waitlist');
  return { position: n.n };
}

// The link in every email removes that person from the list.
async function unsubscribe(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) throw new WaitlistError('not_found');
  const { rowCount } = await query('DELETE FROM waitlist WHERE token = $1', [token]);
  if (!rowCount) throw new WaitlistError('not_found');
}

// Anonymous demand for the admins: the typed questions and their fields, newest first, never with an email.
async function demandForAdmin() {
  const { rows } = await query('SELECT niche, wanted_question, created_at FROM waitlist WHERE wanted_question IS NOT NULL ORDER BY created_at DESC LIMIT 500');
  return rows.map((r) => ({ niche: r.niche, question: r.wanted_question, createdAt: r.created_at }));
}

async function listForAdmin() {
  const { rows } = await query('SELECT id, email, niche, language, created_at, notified_at FROM waitlist ORDER BY created_at DESC LIMIT 2000');
  return rows.map((r) => ({ id: r.id, email: r.email, niche: r.niche, language: r.language, createdAt: r.created_at, notifiedAt: r.notified_at }));
}

// A mentor was just listed: tell everyone waiting for that field. Each person is claimed with one UPDATE,
// so two mentors joining at once (or two server processes) never send the same person two emails.
// One email per address: someone on the list for two fields is told once (and both entries count as told).
async function sendNotices(rows, mentorFieldFor) {
  const seen = new Set();
  const once = rows.filter((r) => { const k = r.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (once.length) await query('UPDATE waitlist SET notified_at = now() WHERE notified_at IS NULL AND lower(email) = ANY($1::text[])', [[...seen]]);
  rows = once;
  for (const r of rows) {
    const mentorField = mentorFieldFor(r);
    try {
      await sendTemplate('mentorJoined', {
        to: r.email, lang: r.language,
        data: { niche: mentorField === r.niche ? r.niche : 'any', mentorField, unsubscribeUrl: `${config.PUBLIC_URL}/waitlist-unsubscribe.html?token=${r.token}` }
      });
    } catch (e) {
      console.error('[email] waitlist notice failed:', e.message);
    }
  }
  return rows.length;
}

// Before launch nobody can ask a question, so a "mentors have joined" email would promise something that is not
// possible yet. Nothing is sent and nobody is marked as told; launchDay() below sends it once the site is live.
const notYetOpen = () => config.LAUNCH_MODE === 'prelaunch';

async function mentorJoined(mentor) {
  if (!config.EMAIL_ENABLED || notYetOpen()) return 0;
  const { rows } = await query(
    `UPDATE waitlist SET notified_at = now() WHERE notified_at IS NULL AND (niche = $1 OR niche = 'any') RETURNING email, niche, language, token`, [mentor.niche]
  );
  return sendNotices(rows, () => mentor.niche);
}

// Runs with the background jobs. When the site is live, everybody who joined the list while it was not open yet
// and whose field now has a mentor is told, a few hundred per run.
async function launchDay() {
  if (!config.EMAIL_ENABLED || notYetOpen()) return 0;
  const fields = (await query(`SELECT DISTINCT niche FROM users WHERE ${listableSql()}`)).rows.map((r) => r.niche);
  if (!fields.length) return 0;
  const { rows } = await query(
    `UPDATE waitlist SET notified_at = now()
      WHERE id IN (SELECT id FROM waitlist WHERE notified_at IS NULL AND prelaunch AND (niche = ANY($1::text[]) OR niche = 'any') ORDER BY created_at LIMIT 500)
      RETURNING email, niche, language, token`, [fields]
  );
  return sendNotices(rows, (r) => (r.niche === 'any' ? fields[0] : r.niche));
}

// The fields people wait for most, for the order of the waiting list's field menu (the 6 most common first, then "Other fields").
// Counted from the list itself once it is big enough to mean something; until then the fields we expect most. Remembered 10 minutes.
const EXPECTED_TOP = ['careers_hr', 'study_abroad', 'tech', 'business', 'medicine', 'psychology'];
let topMemo = null;
async function popularFields() {
  if (topMemo && topMemo.at > Date.now() - 10 * 60 * 1000) return topMemo.list;
  let list = EXPECTED_TOP;
  try {
    const { rows } = await query(`SELECT niche, count(*)::int AS n FROM waitlist WHERE niche <> 'any' GROUP BY niche ORDER BY n DESC, niche LIMIT 6`);
    const total = rows.reduce((s, r) => s + r.n, 0);
    if (total >= 30) list = [...rows.map((r) => r.niche), ...EXPECTED_TOP.filter((k) => !rows.some((r) => r.niche === k))].slice(0, 6);
  } catch (e) { /* the expected ones */ }
  list = list.filter((k) => rules.isValidNiche(k));
  topMemo = { at: Date.now(), list };
  return list;
}

// Call after anything that could make a mentor visible (final approval, saving payout details).
async function afterMaybeListed(userId) {
  try {
    await require('./launch').refresh(); // the first listed mentor can open the site (LAUNCH_MODE left empty)
    const mentor = await getUserById(userId);
    if (isListable(mentor)) {
      await require('./mentorRequests').afterMaybeListed(mentor.id); // ("find me a mentor" requests that match)
      return await mentorJoined(mentor);
    }
  } catch (e) {
    console.error('[waitlist] could not notify:', e.message);
  }
  return 0;
}

module.exports = { WaitlistError, add, unsubscribe, listForAdmin, demandForAdmin, popularFields, mentorJoined, launchDay, afterMaybeListed };
