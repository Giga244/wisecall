const jwt = require('jsonwebtoken');
const { SESSION_SECRET } = require('./config');

const COOKIE_NAME = 'wisecall_token';
const COOKIE_DAYS = 30;

// The login cookie is a signed token: { id, email, sid (the session row), sv (the account's session version) } plus `extra` (an admin
// who passed the second step gets { mfaAt: <seconds> }, see server/twoFactor.js). A session is only valid while its row is not revoked
// and the account's session_version still equals sv (docs/AUDIT.md #3): changing or resetting the password, or "sign out other
// devices", raises the version and so ends every older session, stolen cookies included.
function signToken(user, extra) {
  return jwt.sign({ id: user.id, email: user.email, ...(extra || {}) }, SESSION_SECRET, { expiresIn: `${COOKIE_DAYS}d` });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// "Chrome on Windows", from the browser's user agent (a short label for Settings -> Account; nothing else is kept about the device).
function deviceLabel(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const db = () => require('./db');
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

// A new signed-in session for this device: a session row, and the login cookie that names it.
async function startSession(req, res, user, extra) {
  const { rows } = await db().query(
    `WITH s AS (INSERT INTO sessions (user_id, device_label) VALUES ($1, $2) RETURNING id)
     SELECT s.id, u.session_version FROM s, users u WHERE u.id = $1`, [user.id, deviceLabel(req.get && req.get('user-agent'))]);
  setAuthCookie(res, signToken(user, { sid: rows[0].id, sv: rows[0].session_version, ...(extra || {}) }));
  return rows[0].id;
}

// The same session with more claims (an admin who just passed the second step).
function reissue(res, payload, extra) {
  const { iat, exp, ...claims } = payload;
  setAuthCookie(res, jwt.sign({ ...claims, ...(extra || {}) }, SESSION_SECRET, { expiresIn: `${COOKIE_DAYS}d` }));
}

// Is this token's session still valid? Cached for a few seconds per process; a revocation here clears the cache at once.
const CACHE_MS = 10000;
const checked = new Map();
// Only a real sign-in token is a session (docs/REVIEW-2.md #1): one with a purpose or an audience (the "second step" cookie, the Google
// sign-in state) never is, and every token since sessions exist names its session row (sid). A token without one can only be from before
// they existed (signed before SESSIONS_SINCE); those run out by themselves within COOKIE_DAYS.
const SESSIONS_SINCE = Date.parse('2026-09-28T00:00:00Z') / 1000;
async function sessionValid(payload) {
  if (!payload || !isUuid(payload.id) || payload.purpose !== undefined || payload.aud !== undefined) return false;
  if (!isUuid(payload.sid) && !(Number(payload.iat) < SESSIONS_SINCE)) return false;
  const sid = isUuid(payload.sid) ? payload.sid : null;
  const key = `${payload.id}:${sid || '-'}:${payload.sv || 0}`;
  const hit = checked.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  const { rows } = await db().query(
    `SELECT u.session_version, u.deleted_at, s.id AS sid, s.revoked_at, s.last_seen_at
       FROM users u LEFT JOIN sessions s ON s.id = $2 AND s.user_id = u.id WHERE u.id = $1`, [payload.id, sid]);
  const r = rows[0];
  const ok = Boolean(r) && !r.deleted_at && (payload.sv || 0) === r.session_version && (!payload.sid || (Boolean(r.sid) && !r.revoked_at));
  if (checked.size > 5000) checked.clear();
  checked.set(key, { ok, until: Date.now() + CACHE_MS });
  // "Last active" in Settings, updated at most every five minutes.
  if (ok && r.sid && Date.now() - new Date(r.last_seen_at).getTime() > 5 * 60000) {
    db().query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.sid]).catch(() => {});
  }
  return ok;
}
const forget = (userId) => { for (const k of checked.keys()) if (k.startsWith(`${userId}:`)) checked.delete(k); };

// Ends one session (signing out on this device).
async function endSession(payload) {
  if (!payload || !isUuid(payload.sid)) return;
  await db().query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [payload.sid, payload.id]);
  forget(payload.id);
}

// Ends every session of an account (the version goes up, so cookies without a session row end too).
async function endAllSessions(userId) {
  await db().query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [userId]);
  await db().query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  forget(userId);
}

async function listSessions(userId, currentSid) {
  const { rows } = await db().query(
    'SELECT id, device_label, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 50', [userId]);
  return rows.map((r) => ({ id: r.id, device: r.device_label, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === currentSid }));
}

async function revokeSession(userId, sid) {
  if (!isUuid(sid)) return false;
  const { rowCount } = await db().query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [sid, userId]);
  forget(userId);
  return rowCount > 0;
}

// The token from the login cookie, if it is genuine and its session still valid; otherwise null.
async function tokenFrom(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try { payload = jwt.verify(token, SESSION_SECRET); } catch (e) { return null; }
  return (await sessionValid(payload)) ? payload : null;
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  let payload;
  try { payload = jwt.verify(token, SESSION_SECRET); } catch (e) { return res.status(401).json({ error: 'invalid_token' }); }
  sessionValid(payload).then((ok) => {
    if (!ok) { clearAuthCookie(res); return res.status(401).json({ error: 'invalid_token' }); }
    req.userToken = payload;
    next();
  }).catch(next);
}

function optionalAuth(req, res, next) {
  tokenFrom(req).then((payload) => {
    if (payload) req.userToken = payload;
    next();
  }).catch(next);
}

module.exports = {
  signToken, setAuthCookie, clearAuthCookie, requireAuth, optionalAuth, COOKIE_NAME,
  startSession, reissue, endSession, endAllSessions, listSessions, revokeSession, tokenFrom, deviceLabel
};
