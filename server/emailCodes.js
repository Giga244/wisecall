// Email codes (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md). Company mail servers (Outlook / Microsoft 365 and the like) often hold mail from a new
// sender for minutes or hours, so a code must still work when it arrives late:
//   - a code works for 24 hours;
//   - any of the last 3 codes sent to the address in use works (a resend does not kill the code before it);
//   - only codes for the address in use count: after "Use another email" the old address's codes are dead;
//   - five wrong codes in a row mean a short wait (LOCK_MINUTES), counted per account in one atomic update before the code is compared, so
//     parallel guesses cannot get more tries; the codes themselves stay alive, so a late mail is never wasted;
//   - "Resend" at most once a minute per account (and the per-address rate limits in server/index.js on top).
// purpose 'verify' is the account's own address; 'change' is a new address a confirmed account is moving to (users.pending_email).
// Only a bcrypt hash of each code is stored. A code from before this table (users.email_code_hash) is still accepted until it expires.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('./db');

const TTL_MS = 24 * 60 * 60 * 1000;
const KEEP = 3;
const MAX_WRONG = 5;
const LOCK_MINUTES = 15;
const RESEND_WAIT_S = 60;

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// A new code for `email`, kept with the ones before it (only the last KEEP are kept). -> the code (to send; never stored)
async function issue(userId, email, { purpose = 'verify', reason = 'signup' } = {}) {
  const code = String(crypto.randomInt(100000, 1000000));
  await query(`INSERT INTO email_codes (user_id, email, purpose, reason, code_hash, expires_at) VALUES ($1, lower($2), $3, $4, $5, $6)`,
    [userId, String(email).trim(), purpose, reason, await bcrypt.hash(code, 10), new Date(Date.now() + TTL_MS)]);
  await query(`DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2 AND id NOT IN (
                 SELECT id FROM email_codes WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC, id LIMIT $3)`, [userId, purpose, KEEP]);
  return code;
}

// Seconds to wait before another resend (0: now).
async function resendWait(userId, purpose = 'verify') {
  const { rows } = await query(
    `SELECT ceil(extract(epoch FROM (max(created_at) + make_interval(secs => $3) - now())))::int AS s FROM email_codes
      WHERE user_id = $1 AND purpose = $2 AND reason IN ('resend', 'switch', 'change')`, [userId, purpose, RESEND_WAIT_S]);
  return Math.max(0, (rows[0] && rows[0].s) || 0);
}

// Takes one try. -> { ok: true } | { wait: seconds } (five wrong in a row: a short wait first)
async function takeTry(userId) {
  // (a wait that is over starts the count again)
  await query(`UPDATE users SET email_code_attempts = 0, email_code_locked_until = NULL WHERE id = $1 AND email_code_locked_until <= now()`, [userId]);
  const { rows } = await query(
    `UPDATE users SET email_code_attempts = email_code_attempts + 1
      WHERE id = $1 AND email_code_locked_until IS NULL AND email_code_attempts < $2 RETURNING email_code_attempts AS n`, [userId, MAX_WRONG]);
  if (rows[0]) return { ok: true, used: rows[0].n };
  const lock = await query(
    `UPDATE users SET email_code_locked_until = COALESCE(email_code_locked_until, now() + make_interval(mins => $2)) WHERE id = $1
     RETURNING ceil(extract(epoch FROM (email_code_locked_until - now())))::int AS s`, [userId, LOCK_MINUTES]);
  return { wait: Math.max(1, (lock.rows[0] && lock.rows[0].s) || LOCK_MINUTES * 60) };
}
// After a wrong code: tries left before the wait (0: the wait starts now).
async function wrong(userId, used) {
  if (used < MAX_WRONG) return MAX_WRONG - used;
  await query(`UPDATE users SET email_code_locked_until = now() + make_interval(mins => $2) WHERE id = $1`, [userId, LOCK_MINUTES]);
  return 0;
}

// Is `code` one of the live codes for `email`? -> 'ok' | 'invalid' | 'expired' (codes were sent, all are over 24 hours old) | 'none'
// purpose: one or a list. A confirmed account moving to an address it was first signed up with checks ['change', 'verify']: the code that
// went to that address at sign-up (and arrived hours late) still works for the move (docs/CLAUDE-CODE-UNKNOWN-ERROR.md).
async function check(user, email, code, purpose = 'verify') {
  const typed = String(code || '').trim();
  const purposes = Array.isArray(purpose) ? purpose : [purpose];
  const { rows } = await query(
    `SELECT code_hash, expires_at > now() AS live FROM email_codes WHERE user_id = $1 AND purpose = ANY($2::text[]) AND email = lower($3)
      ORDER BY created_at DESC LIMIT $4`, [user.id, purposes, String(email).trim(), KEEP * purposes.length]);
  const hashes = rows.filter((r) => r.live).map((r) => r.code_hash);
  // (a code sent before email_codes existed, to the address in use)
  const legacy = purposes.includes('verify') && user.emailVerifyCodeHash && user.emailVerifyCodeExpiresAt && new Date(user.emailVerifyCodeExpiresAt).getTime() > Date.now()
    && same(email, user.email);
  if (legacy) hashes.push(user.emailVerifyCodeHash);
  if (!hashes.length) return rows.length || user.emailVerifyCodeHash ? 'expired' : 'none';
  if (!/^\d{6}$/.test(typed)) return 'invalid';
  for (const h of hashes) if (await bcrypt.compare(typed, h)) return 'ok';
  return 'invalid';
}

// The address is confirmed (or the change is done / dropped): its codes and the count go. email: only the codes of that address (an
// address confirmed now; codes that went to the address used before stay their 24 hours, for a move back to it in Settings).
async function clear(userId, purpose = 'verify', email = null) {
  if (email) await query(`DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2 AND email = lower($3)`, [userId, purpose, String(email).trim()]);
  else await query(`DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2`, [userId, purpose]);
  await query(`UPDATE users SET email_code_attempts = 0, email_code_locked_until = NULL${purpose === 'verify' ? ', email_code_hash = NULL, email_code_expires_at = NULL' : ''} WHERE id = $1`, [userId]);
}

module.exports = { TTL_MS, KEEP, MAX_WRONG, LOCK_MINUTES, RESEND_WAIT_S, issue, resendWait, takeTry, wrong, check, clear };
