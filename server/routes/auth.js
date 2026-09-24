const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { load, withDb } = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../auth');
const { meProfile } = require('../util');
const config = require('../config');
const { sendEmail } = require('../email');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'weak_password' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const verifyCode = String(crypto.randomInt(100000, 1000000));

  const result = withDb(data => {
    const exists = data.users.find(u => u.email === normalizedEmail);
    if (exists) return { error: 'email_taken' };

    const user = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'seeker',
      niche: null,
      roleTitle: null,
      bio: null,
      price: null,
      rating: null,
      color: randomColor(),
      stripeAccountId: null,
      language: 'en',
      verificationStatus: 'none',
      proofUrl: null,
      verificationNote: null,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      emailVerified: false,
      emailVerifyCodeHash: bcrypt.hashSync(verifyCode, 10),
      emailVerifyCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    return { user };
  });

  if (result.error) {
    return res.status(409).json({ error: result.error });
  }

  let emailSent = false;
  if (config.EMAIL_ENABLED) {
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: 'Verify your Wisecall email',
        html: `<p>Your Wisecall verification code is:</p><h2 style="letter-spacing:4px">${verifyCode}</h2><p>It expires in 15 minutes.</p>`
      });
      emailSent = true;
    } catch (e) {
      // Fall through to the dev-mode fallback below — a failed send should never
      // strand someone with a code they can't get to any other way.
      console.error('[email] signup verification send failed:', e.message);
    }
  }

  const token = signToken(result.user);
  setAuthCookie(res, token);
  res.status(201).json({
    user: meProfile(result.user),
    devMode: !emailSent && !config.IS_PROD,
    devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const data = load();
  const user = data.users.find(u => u.email === email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: meProfile(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'missing_fields' });

  const normalizedEmail = email.trim().toLowerCase();
  const rawToken = crypto.randomBytes(32).toString('hex');

  const found = withDb(data => {
    const user = data.users.find(u => u.email === normalizedEmail);
    if (!user) return false;
    user.resetTokenHash = bcrypt.hashSync(rawToken, 10);
    user.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return true;
  });

  const resetUrl = `${config.APP_URL}/reset-password.html?token=${rawToken}`;

  let emailSent = false;
  if (found && config.EMAIL_ENABLED) {
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: 'Reset your Wisecall password',
        html: `<p>Someone (hopefully you) asked to reset your Wisecall password.</p><p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`
      });
      emailSent = true;
    } catch (e) {
      // Fall through to the dev-mode fallback below — logged so a bad Resend setup
      // (unverified domain, wrong sender, etc.) doesn't fail silently.
      console.error('[email] password reset send failed:', e.message);
    }
  }

  // Always respond the same way whether or not the email exists, so this endpoint
  // can't be used to check which emails are registered.
  if (emailSent || config.IS_PROD) {
    res.json({ ok: true });
  } else {
    // No email service configured yet, or the send failed — hand back the link
    // directly so it's still testable / not a dead end.
    res.json({ ok: true, devMode: true, resetUrl: found ? resetUrl : null });
  }
});

router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'weak_password' });

  const result = withDb(data => {
    const now = Date.now();
    const user = data.users.find(u =>
      u.resetTokenHash &&
      u.resetTokenExpiresAt &&
      new Date(u.resetTokenExpiresAt).getTime() > now &&
      bcrypt.compareSync(token, u.resetTokenHash)
    );
    if (!user) return { error: 'invalid_or_expired' };
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    return { ok: true };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.post('/verify-email', requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_fields' });

  const result = withDb(data => {
    const user = data.users.find(u => u.id === req.userToken.id);
    if (!user) return { error: 'not_found' };
    if (user.emailVerified) return { user };
    if (!user.emailVerifyCodeHash || !user.emailVerifyCodeExpiresAt) return { error: 'no_pending_code' };
    if (new Date(user.emailVerifyCodeExpiresAt).getTime() < Date.now()) return { error: 'expired' };
    if (!bcrypt.compareSync(String(code).trim(), user.emailVerifyCodeHash)) return { error: 'invalid_code' };
    user.emailVerified = true;
    user.emailVerifyCodeHash = null;
    user.emailVerifyCodeExpiresAt = null;
    return { user };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: meProfile(result.user) });
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  const verifyCode = String(crypto.randomInt(100000, 1000000));

  const result = withDb(data => {
    const user = data.users.find(u => u.id === req.userToken.id);
    if (!user) return { error: 'not_found' };
    if (user.emailVerified) return { error: 'already_verified' };
    user.emailVerifyCodeHash = bcrypt.hashSync(verifyCode, 10);
    user.emailVerifyCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return { user };
  });

  if (result.error) return res.status(400).json({ error: result.error });

  let emailSent = false;
  if (config.EMAIL_ENABLED) {
    try {
      await sendEmail({
        to: result.user.email,
        subject: 'Your new Wisecall verification code',
        html: `<p>Your new Wisecall verification code is:</p><h2 style="letter-spacing:4px">${verifyCode}</h2><p>It expires in 15 minutes.</p>`
      });
      emailSent = true;
    } catch (e) {
      console.error('[email] resend verification send failed:', e.message);
    }
  }

  res.json({ ok: true, devMode: !emailSent && !config.IS_PROD, devVerifyCode: (emailSent || config.IS_PROD) ? undefined : verifyCode });
});

function randomColor() {
  const palette = ['#b8502e', '#1f4b43', '#b8862f', '#5b6b8c', '#8c5b3f', '#6b7d4f', '#a1543f', '#3f6b6b'];
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = router;
