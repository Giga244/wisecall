// Per-account login lockout (PART 8). After LOGIN_LOCK_FAILURES wrong passwords for one email within LOGIN_LOCK_WINDOW_MINUTES, that email
// waits LOGIN_LOCK_MINUTES whatever password is sent (and after that every try still needs the "are you a person?" check, when it is on);
// the account's owner gets one email, "someone is trying to sign in". The rate limit per IP stays; this one stops slow guessing of one
// account from many addresses. It counts by email, also for addresses that have no account, so the answer never tells whether an account
// exists. Emails are kept only as a keyed hash, and the rows are deleted after a day.
const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');
const { sendTemplate } = require('./mail');

const keyOf = (email) => crypto.createHmac('sha256', config.SESSION_SECRET).update('login-guard:' + String(email || '').trim().toLowerCase()).digest('hex');

// Seconds this email still has to wait (0: none).
async function waitFor(email) {
  const { rows } = await query(
    'SELECT ceil(extract(epoch FROM locked_until - now()))::int AS s FROM login_locks WHERE email_hash = $1 AND locked_until > now()', [keyOf(email)]);
  return rows[0] ? Math.max(1, rows[0].s) : 0;
}

// A wrong password. -> seconds to wait when this one locked the email, else 0.
async function failed(email, user) {
  const k = keyOf(email);
  await query('INSERT INTO login_failures (email_hash) VALUES ($1)', [k]);
  const { rows: [c] } = await query(
    'SELECT count(*)::int AS n FROM login_failures WHERE email_hash = $1 AND created_at > now() - make_interval(mins => $2)', [k, config.LOGIN_LOCK_WINDOW_MINUTES]);
  if (c.n < config.LOGIN_LOCK_FAILURES) return 0;
  // (claimed in one statement: of several tries at the same moment, only one starts the lock and sends the email)
  const { rows } = await query(
    `INSERT INTO login_locks (email_hash, locked_until) VALUES ($1, now() + make_interval(mins => $2))
     ON CONFLICT (email_hash) DO UPDATE SET locked_until = EXCLUDED.locked_until, created_at = now() WHERE login_locks.locked_until <= now()
     RETURNING locked_until`, [k, config.LOGIN_LOCK_MINUTES]);
  await query('DELETE FROM login_failures WHERE email_hash = $1', [k]); // (after the wait, counting starts again)
  if (rows[0] && user && user.email) {
    sendTemplate('loginAttempts', { to: user.email, lang: user.language, data: {
      count: config.LOGIN_LOCK_FAILURES, minutes: config.LOGIN_LOCK_MINUTES, window: config.LOGIN_LOCK_WINDOW_MINUTES, url: `${config.PUBLIC_URL}/forgot-password.html` } })
      .catch((e) => console.error('[email] sign-in attempts warning failed:', e.message));
  }
  return (await waitFor(email)) || config.LOGIN_LOCK_MINUTES * 60;
}

// A good password (or a new one from the reset link): the count starts again.
async function clear(email) {
  const k = keyOf(email);
  await query('DELETE FROM login_failures WHERE email_hash = $1', [k]);
  await query('DELETE FROM login_locks WHERE email_hash = $1', [k]);
}

// With the background jobs.
async function purgeOld() {
  const a = await query(`DELETE FROM login_failures WHERE created_at < now() - interval '1 day'`);
  const b = await query(`DELETE FROM login_locks WHERE locked_until < now() - interval '1 day'`);
  return a.rowCount + b.rowCount;
}

module.exports = { waitFor, failed, clear, purgeOld, keyOf };
