// "Get notified when mentors in your field join". Stores an email and a field; when a mentor in that
// field (or any mentor, for 'any') is listed, each person waiting gets one email and is marked notified.
const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');
const rules = require('./verification/rules');
const { sendTemplate } = require('./mail');
const { getUserById } = require('./models');
const { isListable } = require('./util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class WaitlistError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Adds an address. Asking twice for the same field changes nothing (and reveals nothing).
async function add({ email, niche, language }) {
  const address = String(email || '').trim();
  if (!EMAIL_RE.test(address) || address.length > 254) throw new WaitlistError('invalid_email');
  const field = niche === undefined || niche === null || niche === '' ? 'any' : String(niche);
  if (field !== 'any' && !rules.isValidNiche(field)) throw new WaitlistError('invalid_niche');
  await query(
    `INSERT INTO waitlist (email, niche, language, token) VALUES ($1, $2, $3, $4) ON CONFLICT (lower(email), niche) DO NOTHING`,
    [address, field, language === 'ka' ? 'ka' : 'en', crypto.randomBytes(24).toString('hex')]
  );
}

// The link in every email removes that person from the list.
async function unsubscribe(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) throw new WaitlistError('not_found');
  const { rowCount } = await query('DELETE FROM waitlist WHERE token = $1', [token]);
  if (!rowCount) throw new WaitlistError('not_found');
}

async function listForAdmin() {
  const { rows } = await query('SELECT id, email, niche, language, created_at, notified_at FROM waitlist ORDER BY created_at DESC LIMIT 2000');
  return rows.map((r) => ({ id: r.id, email: r.email, niche: r.niche, language: r.language, createdAt: r.created_at, notifiedAt: r.notified_at }));
}

// A mentor was just listed: tell everyone waiting for that field. Each person is claimed with one UPDATE,
// so two mentors joining at once (or two server processes) never send the same person two emails.
async function mentorJoined(mentor) {
  if (!config.EMAIL_ENABLED) return 0;
  const { rows } = await query(
    `UPDATE waitlist SET notified_at = now() WHERE notified_at IS NULL AND (niche = $1 OR niche = 'any') RETURNING email, niche, language, token`, [mentor.niche]
  );
  for (const r of rows) {
    try {
      await sendTemplate('mentorJoined', {
        to: r.email, lang: r.language,
        data: { niche: mentor.niche === r.niche ? r.niche : 'any', mentorField: mentor.niche, unsubscribeUrl: `${config.PUBLIC_URL}/waitlist-unsubscribe.html?token=${r.token}` }
      });
    } catch (e) {
      console.error('[email] waitlist notice failed:', e.message);
    }
  }
  return rows.length;
}

// Call after anything that could make a mentor visible (final approval, saving payout details).
async function afterMaybeListed(userId) {
  try {
    const mentor = await getUserById(userId);
    if (isListable(mentor)) return await mentorJoined(mentor);
  } catch (e) {
    console.error('[waitlist] could not notify:', e.message);
  }
  return 0;
}

module.exports = { WaitlistError, add, unsubscribe, listForAdmin, mentorJoined, afterMaybeListed };
