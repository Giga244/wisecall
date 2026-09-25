// Two-step verification for admin accounts: an authenticator app (TOTP, see totp.js) plus one-time recovery codes.
//   set-up   beginSetup() makes a secret that is stored (encrypted) but not yet on; confirmSetup() turns it on when the person types a
//            first code from their app, and returns the recovery codes (shown once, only their hashes are kept)
//   sign-in  verifyLogin() takes a code (each 30-second step works once) or a recovery code (works once); after 5 wrong tries in a row
//            nothing is accepted for 5 minutes
// A verified session is recorded in the login cookie (the "mfaAt" time); server/adminAuth.js asks for it before any admin action.
const crypto = require('crypto');
const config = require('./config');
const { query } = require('./db');
const cryptoBox = require('./cryptoBox');
const totp = require('./totp');

const RECOVERY_CODES = 8;
const MAX_WRONG = 5;
const LOCK_MS = 5 * 60 * 1000;

class TwoFactorError extends Error {
  constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra || {}); }
}

const hashRecovery = (code) => crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
// Eight codes like "3f9c1-a07b2" (10 random characters each).
function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODES }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
}

const rowFor = async (userId) => (await query('SELECT * FROM admin_two_factor WHERE user_id = $1', [userId])).rows[0] || null;

// Is this login cookie's second step still fresh? (mfaAt is in seconds.)
function isFresh(mfaAt) {
  const now = Date.now() / 1000;
  return Number.isFinite(mfaAt) && mfaAt <= now + 60 && now - mfaAt < config.ADMIN_2FA_SESSION_HOURS * 3600;
}

async function stateFor(userId) {
  const row = await rowFor(userId);
  return { enabled: Boolean(row && row.enabled_at), pending: Boolean(row && !row.enabled_at), recoveryLeft: row && row.enabled_at ? row.recovery_hashes.length : 0 };
}

// A new secret, kept but not yet on. Once two-step verification is on, it cannot be started again from here (a password alone must not be able
// to swap the app: losing the phone is dealt with by recovery codes, or by whoever runs the server with `npm run admin:reset-2fa`).
async function beginSetup(user) {
  const secret = totp.newSecret();
  const { rowCount } = await query(
    `INSERT INTO admin_two_factor (user_id, secret_enc) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, updated_at = now() WHERE admin_two_factor.enabled_at IS NULL`,
    [user.id, cryptoBox.encrypt(secret)]
  );
  if (!rowCount) throw new TwoFactorError('already_enabled');
  return { secret, otpauthUrl: totp.otpauthUrl({ secret, account: user.email, issuer: 'Wisecall' }) };
}

async function confirmSetup(user, typed) {
  const row = await rowFor(user.id);
  if (!row || row.enabled_at) throw new TwoFactorError(row ? 'already_enabled' : 'no_pending_setup');
  const secret = cryptoBox.decrypt(row.secret_enc);
  const step = secret && totp.verify(secret, typed);
  if (!step) throw new TwoFactorError('invalid_code');
  const codes = newRecoveryCodes();
  const { rowCount } = await query(
    `UPDATE admin_two_factor SET enabled_at = now(), last_step = $2, recovery_hashes = $3, failed_count = 0, locked_until = NULL, updated_at = now()
      WHERE user_id = $1 AND enabled_at IS NULL`, [user.id, step, codes.map(hashRecovery)]
  );
  if (!rowCount) throw new TwoFactorError('already_enabled'); // (two confirmations at the same moment: only one wins)
  return { recoveryCodes: codes };
}

// -> { recoveryLeft, usedRecovery }. Throws TwoFactorError: not_enabled, locked (with retryAfter seconds), invalid_code.
async function verifyLogin(user, { code, recoveryCode } = {}) {
  const row = await rowFor(user.id);
  if (!row || !row.enabled_at) throw new TwoFactorError('not_enabled');
  if (row.locked_until && new Date(row.locked_until) > new Date()) throw new TwoFactorError('locked', { retryAfter: Math.ceil((new Date(row.locked_until) - Date.now()) / 1000) });

  let ok = false, usedRecovery = false, left = row.recovery_hashes.length;
  if (typeof recoveryCode === 'string' && recoveryCode.trim()) {
    const { rows } = await query(
      `UPDATE admin_two_factor SET recovery_hashes = array_remove(recovery_hashes, $2), failed_count = 0, updated_at = now()
        WHERE user_id = $1 AND $2 = ANY(recovery_hashes) RETURNING cardinality(recovery_hashes) AS remaining`, [user.id, hashRecovery(recoveryCode)]
    );
    if (rows[0]) { ok = true; usedRecovery = true; left = rows[0].remaining; }
  } else if (typeof code === 'string') {
    const secret = cryptoBox.decrypt(row.secret_enc);
    const step = secret && totp.verify(secret, code, { afterStep: row.last_step });
    if (step) {
      // "last_step < step" makes the update the gate: the same code sent twice at the same moment is accepted once.
      const { rowCount } = await query(
        `UPDATE admin_two_factor SET last_step = $2, failed_count = 0, updated_at = now() WHERE user_id = $1 AND (last_step IS NULL OR last_step < $2)`, [user.id, step]
      );
      ok = rowCount === 1;
    }
  }
  if (!ok) {
    const { rows } = await query(
      `UPDATE admin_two_factor SET updated_at = now(),
              locked_until = CASE WHEN failed_count + 1 >= $2 THEN now() + make_interval(secs => $3) ELSE locked_until END,
              failed_count = CASE WHEN failed_count + 1 >= $2 THEN 0 ELSE failed_count + 1 END
        WHERE user_id = $1 RETURNING locked_until`, [user.id, MAX_WRONG, LOCK_MS / 1000]
    );
    if (rows[0] && rows[0].locked_until && new Date(rows[0].locked_until) > new Date()) console.warn(`[admin] two-step verification is locked for ${user.email} after ${MAX_WRONG} wrong codes`);
    throw new TwoFactorError('invalid_code');
  }
  return { recoveryLeft: left, usedRecovery };
}

// New recovery codes (the old ones stop working). Needs a session that already passed the second step.
async function regenerateRecovery(user) {
  const codes = newRecoveryCodes();
  const { rowCount } = await query(`UPDATE admin_two_factor SET recovery_hashes = $2, updated_at = now() WHERE user_id = $1 AND enabled_at IS NOT NULL`, [user.id, codes.map(hashRecovery)]);
  if (!rowCount) throw new TwoFactorError('not_enabled');
  return codes;
}

// Development helper (only ever called when config.DEV_MODE): a code that would be accepted right now, so nobody needs a phone to try it. A
// step that was already used (the code that turned it on, a moment ago) is skipped in favour of the next one, which is accepted a
// step early; when there is none, null (wait for the next 30 seconds).
async function devCodeFor(userId) {
  const row = await rowFor(userId);
  const secret = row && cryptoBox.decrypt(row.secret_enc);
  if (!secret) return null;
  const now = totp.stepAt();
  const step = Math.max(now, Number(row.last_step || 0) + 1);
  return step <= now + 1 ? totp.codeAt(secret, step) : null;
}

// Whoever runs the server can switch it off for one person (a lost phone and no recovery codes): they set it up again at their next sign-in.
async function reset(userId) { return (await query('DELETE FROM admin_two_factor WHERE user_id = $1', [userId])).rowCount; }

module.exports = { TwoFactorError, RECOVERY_CODES, MAX_WRONG, LOCK_MS, isFresh, stateFor, beginSetup, confirmSetup, verifyLogin, regenerateRecovery, devCodeFor, reset, hashRecovery };
