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

const router = express.Router();
const isStr = (v) => typeof v === 'string';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Compared against when the email is unknown so a wrong email and a wrong password take equally long.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password, language, username, adult } = req.body || {};
  if (!isStr(name) || !isStr(email) || !isStr(password) || !name.trim() || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'invalid_email' });
  if (String(password).length < 8 || String(password).length > 200) return res.status(400).json({ error: 'weak_password' });
  // "I am 18 or older" (a box on the form).
  if (adult !== true) return res.status(400).json({ error: 'adult_required' });
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
  await query('UPDATE users SET adult_confirmed_at = now() WHERE id = $1', [user.id]);
  try {
    await usernames.assignNew(user.id, user.name, wantedUsername);
  } catch (e) {
    if (!(e instanceof usernames.UsernameError)) throw e;
    await usernames.assignNew(user.id, user.name, null); // somebody took it a moment ago: use one made from their name
  }
  user = await getUserById(user.id);

  let emailSent = false;
  if (config.EMAIL_ENABLED) {
    try {
      await sendTemplate('verify', { to: normalizedEmail, lang: user.language, data: { code: verifyCode } });
      emailSent = true;
    } catch (e) {
      // Fall through to the dev-mode fallback below (local development only).
      console.error('[email] signup verification send failed:', e.message);
    }
  }

  await startSession(req, res, user);
  await require('../verification/signals').record(req, res, user.id, 'signup');
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

  const user = await getUserByEmail(email.trim());
  // (Someone who only ever signed in with Google has no password: the comparison still runs, and fails.)
  const ok = await bcrypt.compare(password, user && user.passwordHash ? user.passwordHash : DUMMY_HASH) && Boolean(user && user.passwordHash);
  if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' });

  // Two-step verification turned on (optional for everyone; admins have their own required step after signing in): the code comes
  // next, and only then is there a session.
  if (await needsSecondStep(user)) { askForSecondStep(res, user); return res.json({ twoFactorRequired: true }); }
  await startSession(req, res, user);
  await require('../verification/signals').record(req, res, user.id, 'login');
  res.json({ user: meProfile(user) });
}));

// ---- The second step at sign-in (for an account that turned two-step verification on) -----------------------------------------
// Between the password (or Google) and the code, a short-lived signed cookie remembers who is signing in; it is not a session.
const PENDING_COOKIE = 'wisecall_2fa';
const PENDING_MINUTES = 10;
async function needsSecondStep(user) {
  return !isAdminUser(user) && (await twoFactor.stateFor(user.id)).enabled;
}
function askForSecondStep(res, user) {
  res.cookie(PENDING_COOKIE, jwt.sign({ id: user.id, purpose: 'second_step' }, config.SESSION_SECRET, { expiresIn: `${PENDING_MINUTES}m` }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: PENDING_MINUTES * 60000
  });
}
router.post('/login/second-step', asyncHandler(async (req, res) => {
  let pending = null;
  try { pending = jwt.verify(req.cookies[PENDING_COOKIE] || '', config.SESSION_SECRET); } catch (e) { /* expired or missing */ }
  if (!pending || pending.purpose !== 'second_step') return res.status(401).json({ error: 'sign_in_again' });
  const user = await getUserById(pending.id);
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
  await startSession(req, res, user, { mfaAt: Math.floor(Date.now() / 1000) });
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
  const { email } = req.body || {};
  if (!isStr(email) || !email) return res.status(400).json({ error: 'missing_fields' });

  const user = await getUserByEmail(email.trim());
  const rawToken = crypto.randomBytes(32).toString('hex');
  let resetUrl = null;

  if (user) {
    await updateUser(user.id, {
      resetTokenHash: await bcrypt.hash(rawToken, 10),
      resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    resetUrl = `${config.PUBLIC_URL}/reset-password.html?token=${user.id}.${rawToken}`;
  }

  let emailSent = false;
  if (user && config.EMAIL_ENABLED) {
    try {
      await sendTemplate('reset', { to: user.email, lang: user.language, data: { url: resetUrl } });
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
  // Whoever else was signed in (a stolen cookie, a forgotten device) is signed out now (docs/AUDIT.md #3).
  await endAllSessions(user.id);
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

  let emailSent = false;
  if (config.EMAIL_ENABLED) {
    try {
      await sendTemplate('verify', { to: user.email, lang: user.language, data: { code: verifyCode } });
      emailSent = true;
    } catch (e) {
      console.error('[email] resend verification send failed:', e.message);
    }
  }

  res.json({ ok: true, emailSent, devMode: !emailSent && !config.IS_PROD, devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode });
}));

function randomColor() {
  const palette = ['#ff6f59', '#3db88e', '#f4a93b', '#5b6b8c', '#8c5b9f', '#3f8fc4', '#d1567e', '#3f6b6b'];
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = router;
module.exports.needsSecondStep = needsSecondStep;
module.exports.askForSecondStep = askForSecondStep;
