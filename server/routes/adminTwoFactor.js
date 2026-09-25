// Two-step verification for admins (see server/twoFactor.js): status, set-up, first confirmation, sign-in with a code or a recovery code, and
// new recovery codes. These are the only admin routes that do NOT need the second step to have been passed (they are how it is passed), but
// they still need an admin account: anybody else gets the same plain 403 as everywhere.
const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, signToken, setAuthCookie } = require('../auth');
const { requireAdmin, requireAdminUser } = require('../adminAuth');
const { asyncHandler } = require('../util');
const config = require('../config');
const twoFactor = require('../twoFactor');

const router = express.Router();

const STATUS = { already_enabled: 409, no_pending_setup: 409, not_enabled: 409, invalid_code: 400, locked: 429 };
function fail(res, e) {
  if (!(e instanceof twoFactor.TwoFactorError)) throw e;
  if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
  return res.status(STATUS[e.code] || 400).json({ error: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) });
}

// From now on this login is a verified admin session (for ADMIN_2FA_SESSION_HOURS).
const markVerified = (res, user) => setAuthCookie(res, signToken(user, { mfaAt: Math.floor(Date.now() / 1000) }));

// Where this admin stands. (On a developer's computer it also carries the code the app would show now, so nobody needs a phone to try it.)
router.get('/status', requireAuth, requireAdminUser, asyncHandler(async (req, res) => {
  const state = await twoFactor.stateFor(req.adminUser.id);
  const verified = !config.ADMIN_2FA_REQUIRED || twoFactor.isFresh(req.userToken.mfaAt);
  res.json({
    required: config.ADMIN_2FA_REQUIRED, enabled: state.enabled, verified, recoveryLeft: state.recoveryLeft,
    ...(config.DEV_MODE && state.enabled ? { devCode: await twoFactor.devCodeFor(req.adminUser.id) } : {})
  });
}));

// Starts the set-up: a secret (kept but not on yet), the address for the QR code, the QR code itself and the key to type by hand.
router.post('/setup', requireAuth, requireAdminUser, asyncHandler(async (req, res) => {
  try {
    const { secret, otpauthUrl } = await twoFactor.beginSetup(req.adminUser);
    const { code } = require('../totp');
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      secret, key: secret.match(/.{1,4}/g).join(' '), otpauthUrl,
      qr: await QRCode.toString(otpauthUrl, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
      ...(config.DEV_MODE ? { devCode: code(secret) } : {}) // development only: the code the app would show now
    });
  } catch (e) { fail(res, e); }
}));

// The first code from the app turns two-step verification on, signs this session in as verified, and returns the recovery codes ONCE.
router.post('/enable', requireAuth, requireAdminUser, asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'invalid_code' });
  try {
    const { recoveryCodes } = await twoFactor.confirmSetup(req.adminUser, code);
    markVerified(res, req.adminUser);
    console.log(`[admin] two-step verification turned on for ${req.adminUser.email}`);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recoveryCodes });
  } catch (e) { fail(res, e); }
}));

// Signing in as an admin: a code from the app, or one recovery code.
router.post('/verify', requireAuth, requireAdminUser, asyncHandler(async (req, res) => {
  const { code, recoveryCode } = req.body || {};
  if ((code !== undefined && typeof code !== 'string') || (recoveryCode !== undefined && typeof recoveryCode !== 'string') || (code === undefined && recoveryCode === undefined)) return res.status(400).json({ error: 'invalid_code' });
  try {
    const out = await twoFactor.verifyLogin(req.adminUser, { code, recoveryCode });
    markVerified(res, req.adminUser);
    if (out.usedRecovery) console.log(`[admin] ${req.adminUser.email} signed in with a recovery code (${out.recoveryLeft} left)`);
    res.json({ ok: true, recoveryLeft: out.recoveryLeft, usedRecovery: out.usedRecovery });
  } catch (e) { fail(res, e); }
}));

// New recovery codes (the old ones stop working). Only from a session that has passed the second step.
router.post('/recovery-codes', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ recoveryCodes: await twoFactor.regenerateRecovery(req.adminUser) });
  } catch (e) { fail(res, e); }
}));

module.exports = router;
