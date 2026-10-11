// /api/me/2fa: two-step verification for every account (optional; strongly recommended for mentors; required for admins, who manage
// it on the admin page). The same authenticator-app codes and recovery codes as for admins (server/twoFactor.js). Once it is on,
// signing in asks for a code after the password or Google (server/routes/auth.js "second step").
const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const config = require('../config');
const { requireAuth, endAllSessions, startSession, deviceLabel } = require('../auth');
const { isAdminUser } = require('../adminAuth');
const { asyncHandler } = require('../util');
const { getUserById } = require('../models');
const twoFactor = require('../twoFactor');

const router = express.Router();
const STATUS = { invalid_code: 400, not_set_up: 409, already_enabled: 409, locked: 429 };
const fail = (res, e) => {
  if (!(e instanceof twoFactor.TwoFactorError)) throw e;
  if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
  return res.status(STATUS[e.code] || 400).json({ error: e.code });
};
const me = async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) res.status(401).json({ error: 'not_authenticated' });
  return user;
};

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  const state = await twoFactor.stateFor(user.id);
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: state.enabled, recoveryLeft: state.recoveryLeft, admin: isAdminUser(user), recommended: user.role === 'mentor' || user.role === 'both' });
}));

router.post('/setup', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  try {
    const { secret, otpauthUrl } = await twoFactor.beginSetup(user);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      key: secret.match(/.{1,4}/g).join(' '), otpauthUrl,
      qr: await QRCode.toString(otpauthUrl, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
      ...(config.DEV_MODE ? { devCode: require('../totp').code(secret) } : {})
    });
  } catch (e) { fail(res, e); }
}));

router.post('/enable', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  const { code } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'invalid_code' });
  try {
    const { recoveryCodes } = await twoFactor.confirmSetup(user, code);
    // A device that only passed the password must now pass the new step too: every other session ends, this one starts afresh
    // (docs/REVIEW-2.md #11).
    await endAllSessions(user.id);
    await startSession(req, res, user, { mfaAt: Math.floor(Date.now() / 1000) });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recoveryCodes });
  } catch (e) { fail(res, e); }
}));

// Turning it off needs the password (or, with no password, a current code). Admins cannot: it is required for them.
router.post('/disable', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  if (isAdminUser(user) && config.ADMIN_2FA_REQUIRED) return res.status(409).json({ error: 'required_for_admins' });
  const { password, code } = req.body || {};
  if (user.passwordHash) {
    if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'wrong_password' });
  } else {
    try { await twoFactor.verifyLogin(user, { code: String(code || '') }); } catch (e) { return fail(res, e); }
  }
  await twoFactor.reset(user.id);
  // The owner is told (with the device), and every other device is signed out (docs/REVIEW-2.md #11).
  await endAllSessions(user.id);
  await startSession(req, res, user);
  require('../notify').notifyTwoFactorOff(user, { device: deviceLabel(req.get('user-agent')), at: new Date() });
  res.json({ ok: true });
}));

// New recovery codes (the old ones stop working): a current code from the app is needed.
router.post('/recovery-codes', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  try {
    await twoFactor.verifyLogin(user, { code: String((req.body || {}).code || '') });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ recoveryCodes: await twoFactor.regenerateRecovery(user) });
  } catch (e) { fail(res, e); }
}));

module.exports = router;
