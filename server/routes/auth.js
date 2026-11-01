const express = require('express');
const codeAttempts = require('../codeAttempts');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { clearAuthCookie, requireAuth, startSession, endSession, endAllSessions, tokenFrom } = require('../auth');
const { meProfile, asyncHandler } = require('../util');
const { getUserById, getUserByEmail, insertUser, updateUser } = require('../models');
const config = require('../config');
const { sendTemplate } = require('../mail');
const verification = require('../verification/steps');
const usernames = require('../usernames');
const hibp = require('../hibp');
const twoFactor = require('../twoFactor');
const { isAdminUser } = require('../adminAuth');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const ageGate = require('../ageGate');

const router = express.Router();
const isStr = (v) => typeof v === 'string';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sends the email code. Replies go to the support address (a person who answers), and the person's last email result starts as "sent"
// until the provider reports what happened (server/routes/emailWebhook.js). -> true when the provider took it.
async function sendCode(user, to, code) {
  if (!config.EMAIL_ENABLED) return false;
  try {
    await sendTemplate('verify', { to, lang: user.language, data: { code }, quick: true, ...(config.SUPPORT_EMAIL ? { replyTo: config.SUPPORT_EMAIL } : {}) });
    await query(`UPDATE users SET email_status = 'sent', email_status_at = now() WHERE id = $1`, [user.id]);
    return true;
  } catch (e) {
    console.error('[email] verification send failed:', e.message);
    return false;
  }
}
// Compared against when the email is unknown so a wrong email and a wrong password take equally long.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password, language, username, adult, birthYm } = req.body || {};
  if (!isStr(name) || !isStr(email) || !isStr(password) || !name.trim() || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'invalid_email' });
  if (String(password).length < 8 || String(password).length > 200) return res.status(400).json({ error: 'weak_password' });
  // A mentor's sign-up: "I am 18 or older" (a box on the form; the ID check decides later). Everybody else: their birth year and month.
  // Under 16 nothing is created and nothing is kept (server/ageGate.js).
  const asMentor = (req.body || {}).as === 'mentor';
  let age = null;
  if (asMentor) {
    if (adult !== true) return res.status(400).json({ error: 'adult_required' });
    if (birthYm !== undefined && birthYm !== null && ageGate.groupOf(ageGate.parseYm(birthYm)) !== ageGate.ADULT) return res.status(403).json({ error: 'mentor_18' });
  } else {
    age = ageGate.check(birthYm);
    if (age.error) return res.status(age.status).json({ error: age.error });
  }
  if (await hibp.breachCount(password)) return res.status(400).json({ error: 'password_breached' });
  // The username is their choice (checked before anything is created); without one we make one from their name.
  let wantedUsername = null;
  if (username !== undefined && username !== null && username !== '') {
    if (!isStr(username)) return res.status(400).json({ error: 'invalid_username' });
    const problem = usernames.check(username);
    if (problem) return res.status(400).json({ error: problem });
    if (await usernames.isTaken(username)) return res.status(409).json({ error: 'username_taken' });
    wantedUsername = username.trim().toLowerCase();
  }

  const normalizedEmail = email.trim().toLowerCase();
  const verifyCode = String(crypto.randomInt(100000, 1000000));

  let user;
  try {
    user = await insertUser({
      name: String(name).trim().slice(0, 100),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      color: randomColor(),
      language: language === 'ka' ? 'ka' : 'en',
      emailVerifyCodeHash: await bcrypt.hash(verifyCode, 10),
      emailVerifyCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email_taken' });
    throw err;
  }
  if (age) await ageGate.save(user.id, age);
  else await query('UPDATE users SET adult_confirmed_at = now() WHERE id = $1', [user.id]);
  try {
    await usernames.assignNew(user.id, user.name, wantedUsername);
  } catch (e) {
    if (!(e instanceof usernames.UsernameError)) throw e;
    await usernames.assignNew(user.id, user.name, null); // somebody took it a moment ago: use one made from their name
  }
  user = await getUserById(user.id);

  // (not sent: the dev-mode fallback below, local development only)
  const emailSent = await sendCode(user, normalizedEmail, verifyCode);

  await startSession(req, res, user, null, 'sign_in');
  await require('../verification/signals').record(req, res, user.id, 'signup');
  require('../analytics').event('signup', req, { method: 'email', role: asMentor ? 'mentor' : 'asker', ...(age ? { age_group: age.group } : {}) });
  const source = require('../attribution').read(req);
  if (source) await query('UPDATE users SET signup_source = $2 WHERE id = $1', [user.id, JSON.stringify(source)]);
  res.status(201).json({
    user: meProfile(user),
    emailSent,
    devMode: !emailSent && !config.IS_PROD,
    devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isStr(email) || !isStr(password) || !email || !password) return res.status(400).json({ error: 'missing_fields' });

  // Too many wrong passwords for this email lately: wait, whatever the password (server/loginGuard.js).
  const guard = require('../loginGuard');
  const locked = (seconds) => { res.set('Retry-After', String(seconds)); return res.status(429).json({ error: 'account_locked', retryAfter: seconds }); };
  const waiting = await guard.waitFor(email);
  if (waiting) return locked(waiting);

  const user = await getUserByEmail(email.trim());
  // (Someone who only ever signed in with Google has no password: the comparison still runs, and fails.)
  const ok = await bcrypt.compare(password, user && user.passwordHash ? user.passwordHash : DUMMY_HASH) && Boolean(user && user.passwordHash);
  if (!user || !ok) {
    const wait = await guard.failed(email, user);
    return wait ? locked(wait) : res.status(401).json({ error: 'invalid_credentials' });
  }
  await guard.clear(email);

  // Two-step verification turned on (optional for everyone; admins have their own required step after signing in): the code comes
  // next, and only then is there a session.
  if (await needsSecondStep(user)) { askForSecondStep(res, user); return res.json({ twoFactorRequired: true }); }
  await startSession(req, res, user, null, 'sign_in');
  await require('../verification/signals').record(req, res, user.id, 'login');
  res.json({ user: meProfile(user) });
}));

// ---- The second step at sign-in (for an account that turned two-step verification on) -----------------------------------------
// Between the password (or Google) and the code, a short-lived signed cookie remembers who is signing in; it is not a session. It is
// signed with its own key and audience and names the person as `uid` (not `id`), so it can never be read as a sign-in cookie, even
// when copied into one (docs/REVIEW-2.md #1; server/auth.js refuses any token with a purpose or an audience as well).
const PENDING_COOKIE = 'wisecall_2fa';
const PENDING_MINUTES = 10;
const PENDING_KEY = () => `${config.SESSION_SECRET}:second-step`;
const PENDING_AUDIENCE = 'wisecall-2fa';
async function needsSecondStep(user) {
  return !isAdminUser(user) && (await twoFactor.stateFor(user.id)).enabled;
}
function askForSecondStep(res, user) {
  res.cookie(PENDING_COOKIE, jwt.sign({ uid: user.id, purpose: 'second_step' }, PENDING_KEY(), { expiresIn: `${PENDING_MINUTES}m`, audience: PENDING_AUDIENCE }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: PENDING_MINUTES * 60000
  });
}
router.post('/login/second-step', asyncHandler(async (req, res) => {
  let pending = null;
  try { pending = jwt.verify(req.cookies[PENDING_COOKIE] || '', PENDING_KEY(), { audience: PENDING_AUDIENCE }); } catch (e) { /* expired, missing or not ours */ }
  if (!pending || pending.purpose !== 'second_step' || typeof pending.uid !== 'string') return res.status(401).json({ error: 'sign_in_again' });
  const user = await getUserById(pending.uid);
  if (!user) return res.status(401).json({ error: 'sign_in_again' });
  const { code, recoveryCode } = req.body || {};
  if ((code !== undefined && !isStr(code)) || (recoveryCode !== undefined && !isStr(recoveryCode)) || (code === undefined && recoveryCode === undefined)) return res.status(400).json({ error: 'invalid_code' });
  try {
    await twoFactor.verifyLogin(user, { code, recoveryCode });
  } catch (e) {
    if (!(e instanceof twoFactor.TwoFactorError)) throw e;
    if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
    return res.status(e.code === 'locked' ? 429 : 400).json({ error: e.code });
  }
  res.clearCookie(PENDING_COOKIE);
  await startSession(req, res, user, { mfaAt: Math.floor(Date.now() / 1000) }, 'sign_in');
  await require('../verification/signals').record(req, res, user.id, 'login');
  res.json({ user: meProfile(user) });
}));

// Signing out ends this device's session on the server too, not only the cookie in this browser.
router.post('/logout', asyncHandler(async (req, res) => {
  const payload = await tokenFrom(req);
  if (payload) await endSession(payload);
  clearAuthCookie(res);
  res.json({ ok: true });
}));

// Reset tokens look like "<userId>.<random>": the id lets us find the one account to check,
// and only a bcrypt hash of the random part is stored.
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email, as } = req.body || {};
  if (!isStr(email) || !email) return res.status(400).json({ error: 'missing_fields' });

  const user = await getUserByEmail(email.trim());
  // (a mentor who forgot their password mid-application comes back to the application: docs/CLAUDE-CODE-MENTOR-SIGNUP.md #2)
  const mentorPath = as === 'mentor' ? '&as=mentor' : '';
  const rawToken = crypto.randomBytes(32).toString('hex');
  let resetUrl = null;

  if (user) {
    await updateUser(user.id, {
      resetTokenHash: await bcrypt.hash(rawToken, 10),
      resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    resetUrl = `${config.PUBLIC_URL}/reset-password.html?token=${user.id}.${rawToken}${mentorPath}`;
  }

  let emailSent = false;
  if (user && config.EMAIL_ENABLED) {
    try {
      await sendTemplate('reset', { to: user.email, lang: user.language, data: { url: resetUrl }, quick: true });
      emailSent = true;
    } catch (e) {
      console.error('[email] password reset send failed:', e.message);
    }
  }

  // Always respond the same way whether or not the email exists, so this endpoint
  // can't be used to check which emails are registered.
  if (emailSent || config.IS_PROD) return res.json({ ok: true });
  // Local development only: hand the link back so it is testable without email.
  res.json({ ok: true, devMode: true, resetUrl });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!isStr(token) || !isStr(newPassword) || !token || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  if (String(newPassword).length < 8 || String(newPassword).length > 200) return res.status(400).json({ error: 'weak_password' });

  const [userId, rawToken] = token.split('.');
  const user = rawToken ? await getUserById(userId) : null;
  const valid = user && user.resetTokenHash && user.resetTokenExpiresAt &&
    new Date(user.resetTokenExpiresAt).getTime() > Date.now() &&
    await bcrypt.compare(rawToken, user.resetTokenHash);
  if (!valid) return res.status(400).json({ error: 'invalid_or_expired' });
  if (await hibp.breachCount(newPassword)) return res.status(400).json({ error: 'password_breached' });

  await updateUser(user.id, {
    passwordHash: await bcrypt.hash(newPassword, 10),
    resetTokenHash: null,
    resetTokenExpiresAt: null
  });
  // The link reached this address, so whoever reset the password owns it. An account whose address was never confirmed may have been made by
  // somebody else with it, who then turned two-step verification on: that goes, so the real owner can get in (docs/security-audit C4).
  if (!user.emailVerified) await twoFactor.reset(user.id);
  // Whoever else was signed in (a stolen cookie, a forgotten device) is signed out now (docs/AUDIT.md #3).
  await endAllSessions(user.id);
  await require('../loginGuard').clear(user.email); // (a new password ends a lockout at once)
  res.json({ ok: true });
}));

router.post('/verify-email', requireAuth, asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!isStr(code) || !code) return res.status(400).json({ error: 'missing_fields' });

  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.emailVerified) return res.json({ user: meProfile(user) });
  if (!user.emailVerifyCodeHash || !user.emailVerifyCodeExpiresAt) return res.status(400).json({ error: 'no_pending_code' });
  if (new Date(user.emailVerifyCodeExpiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'expired' });
  // At most 5 tries per code for this account, whatever the IP address (docs/AUDIT.md #2); then a new code must be asked for.
  const used = await codeAttempts.takeTry(user.id, 'email');
  if (used === null) return res.status(400).json({ error: 'too_many_attempts' });
  if (!(await bcrypt.compare(code.trim(), user.emailVerifyCodeHash))) {
    const left = await codeAttempts.wrongCode(user.id, 'email', used);
    return res.status(400).json({ error: left ? 'invalid_code' : 'too_many_attempts', attemptsLeft: left });
  }

  const updated = await updateUser(user.id, { emailVerified: true, emailVerifyCodeHash: null, emailVerifyCodeExpiresAt: null, emailCodeAttempts: 0 });
  if (updated.role === 'mentor' || updated.role === 'both') await verification.syncEmailStep(updated);
  require('../analytics').event('email_verified', req);
  res.json({ user: meProfile(updated) });
}));

router.post('/resend-verification', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.emailVerified) return res.status(400).json({ error: 'already_verified' });

  const verifyCode = String(crypto.randomInt(100000, 1000000));
  await updateUser(user.id, {
    emailVerifyCodeHash: await bcrypt.hash(verifyCode, 10),
    emailVerifyCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    emailCodeAttempts: 0
  });

  const emailSent = await sendCode(user, user.email, verifyCode);
  res.json({ ok: true, emailSent, devMode: !emailSent && !config.IS_PROD, devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode });
}));

// A typo in the address (the code went nowhere): while the email is not confirmed yet, the person can correct it on the code screen, and
// a new code goes to the new address. Signed in, rate limited, refused when the address belongs to another account.
router.post('/change-unconfirmed-email', requireAuth, asyncHandler(async (req, res) => {
  const email = isStr((req.body || {}).email) ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'invalid_email' });
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.emailVerified) return res.status(400).json({ error: 'already_verified' });
  if (email === String(user.email).toLowerCase()) return res.status(400).json({ error: 'same_email' });
  const other = await getUserByEmail(email);
  if (other && other.id !== user.id) return res.status(409).json({ error: 'email_taken' });
  const verifyCode = String(crypto.randomInt(100000, 1000000));
  let updated;
  try {
    updated = await updateUser(user.id, { email, emailVerifyCodeHash: await bcrypt.hash(verifyCode, 10), emailVerifyCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000), emailCodeAttempts: 0 });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email_taken' });
    throw err;
  }
  await query('UPDATE users SET email_status = NULL, email_status_at = NULL WHERE id = $1', [user.id]);
  const emailSent = await sendCode(updated, email, verifyCode);
  res.json({ user: meProfile(updated), emailSent, devMode: !emailSent && !config.IS_PROD, devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode });
}));

function randomColor() {
  const palette = ['#ff6f59', '#3db88e', '#f4a93b', '#5b6b8c', '#8c5b9f', '#3f8fc4', '#d1567e', '#3f6b6b'];
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = router;
module.exports.needsSecondStep = needsSecondStep;
module.exports.askForSecondStep = askForSecondStep;
