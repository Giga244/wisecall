// Who may use Wisecall, by age (docs/CLAUDE-CODE-ASKERS-16-PLUS.md): askers are 16 or older, mentors 18 or older (for mentors the ID check is
// what really decides: server/verification/kyc.js). Only the birth year and month are kept, as 'YYYY-MM'.
//
// With no day, somebody counts as a given age only once their whole birth month has passed: born in November 2010, they count as 16 from
// 1 December 2026. So a minor is never treated as older than they might be.
const { query } = require('./db');

const MIN_ASKER_AGE = 16;
const ADULT_AGE = 18;
const MINOR = 'minor_16_17';
const ADULT = 'adult';

// -> 'YYYY-MM', or null when it is not a real birth month (the future, or more than 120 years ago).
function parseYm(value, now = new Date()) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const thisYear = now.getUTCFullYear();
  if (year < thisYear - 120 || year * 12 + month > thisYear * 12 + now.getUTCMonth() + 1) return null;
  return m[0];
}

// Whole years, counting the birthday as the last day of the birth month.
function ageOf(ym, now = new Date()) {
  const [year, month] = ym.split('-').map(Number);
  const months = (now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) - (year * 12 + month);
  return Math.floor((months - 1) / 12);
}

// -> 'under_16' | 'minor_16_17' | 'adult' | null (nothing given yet). 'under_16' is never stored.
function groupOf(ym, now = new Date()) {
  if (!ym) return null;
  const age = ageOf(ym, now);
  if (age < MIN_ASKER_AGE) return 'under_16';
  return age < ADULT_AGE ? MINOR : ADULT;
}

const isMinor = (user) => Boolean(user) && user.ageGroup === MINOR;

// The answer of an age form: { ym, group }, or { error, status } when nothing may be saved. Under 16 says nothing else and keeps nothing;
// 16-17 must also tick that a parent or guardian agrees (they confirm it themselves: no parent's details are asked for).
function check(birthYm, parentPermission) {
  const ym = parseYm(birthYm);
  if (!ym) return { error: 'birth_required', status: 400 };
  const group = groupOf(ym);
  if (group === 'under_16') return { error: 'under_16', status: 403 };
  if (group === MINOR && parentPermission !== true) return { error: 'parent_permission_required', status: 400 };
  return { ym, group };
}

// The columns an age form sets. A minor's profile opens only to them and the admins (server/profiles.js canView).
async function save(userId, { ym, group }, client) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE users SET birth_ym = $2, age_group = $3, age_confirmed_at = now(), adult_confirmed_at = CASE WHEN $3 = 'adult' THEN COALESCE(adult_confirmed_at, now()) ELSE adult_confirmed_at END,
            profile_visibility = CASE WHEN $3 = 'adult' THEN profile_visibility ELSE 'contacts' END,
            parent_permission_at = CASE WHEN $3 = 'adult' THEN NULL ELSE now() END
      WHERE id = $1`, [userId, ym, group]);
}

// Run by the regular sweep: those whose 18th birth month has passed become adults. (Reading a user works the age out anyway, models.js
// userFromRow; this keeps the stored group the admin filter uses true.) -> how many
async function sweep(now = new Date()) {
  // (a birth month this far back or earlier has passed 18 years ago)
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear() - ADULT_AGE, now.getUTCMonth() - 1, 1));
  const ym = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`;
  const { rowCount } = await query(`UPDATE users SET age_group = 'adult' WHERE age_group = 'minor_16_17' AND birth_ym <= $1`, [ym]);
  return rowCount;
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

module.exports = { MIN_ASKER_AGE, ADULT_AGE, MINOR, ADULT, parseYm, ageOf, groupOf, isMinor, check, save, sweep, firstName };
