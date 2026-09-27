// "Continue with Google": /api/auth/google/start (login and sign-up), /callback (where Google sends the browser back)
// and /link/start (connect Google to an account that is already signed in; used by Settings > Account).
// The rules for who gets in:
//   - a Google account already linked to a Wisecall user: signs that user in
//   - a new email address: a new account (name, email and photo from Google). The email counts as verified only when
//     Google says email_verified = true; otherwise the usual emailed code is needed
//   - an email address that already has an account: linked and signed in only when the email is verified on BOTH sides.
//     Otherwise nothing is linked: the person is asked to sign in with their password first and connect Google in Settings
//   - Google never changes what a mentor must still prove: the ID check, licence and the rest are separate steps
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const google = require('../google');
const identities = require('../identities');
const usernames = require('../usernames');
const { requireAuth, optionalAuth, startSession } = require('../auth');
const { asyncHandler } = require('../util');
const { getUserById, getUserByEmail, insertUser, updateUser } = require('../models');
const { fetchGooglePhoto } = require('../images');
const { setPhoto } = require('../profiles');
const { sendTemplate } = require('../mail');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const safeRedirect = (v) => (typeof v === 'string' && v.length < 300 && /^\/(?![\/\\])/.test(v) ? v : null);
const withRedirect = (path, redirect) => (redirect ? `${path}${path.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(redirect)}` : path);
const PAGE = { login: '/login.html', signup: '/signup.html', link: '/settings.html?tab=account' };

// Something went wrong or was declined: back to the page the person came from, with a short code the page turns into words.
function backWith(res, mode, code, redirect) {
  const base = PAGE[mode] || PAGE.login;
  res.redirect(302, withRedirect(`${base}${base.includes('?') ? '&' : '?'}google=${code}`, redirect));
}

const randomColor = () => ['#ff6f59', '#3db88e', '#f4a93b', '#5b6b8c', '#8c5b9f', '#3f8fc4', '#d1567e', '#3f6b6b'][crypto.randomInt(8)];
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

router.get('/start', asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'signup' ? 'signup' : 'login';
  const redirect = safeRedirect(req.query.redirect);
  if (!config.GOOGLE_ENABLED) return backWith(res, mode, 'unavailable', redirect);
  try {
    const { url, cookie } = await google.start({ redirect, mode, lang: req.query.lang === 'ka' ? 'ka' : 'en' });
    google.setCookie(res, cookie);
    res.redirect(302, url);
  } catch (e) {
    console.error('[google] could not start the sign-in:', e.message);
    backWith(res, mode, 'error', redirect);
  }
}));

// Connect Google to the account that is signed in (Settings > Account).
router.post('/link/start', requireAuth, asyncHandler(async (req, res) => {
  if (!config.GOOGLE_ENABLED) return res.status(404).json({ error: 'google_unavailable' });
  if (await identities.googleFor(req.userToken.id)) return res.status(409).json({ error: 'already_connected' });
  try {
    const { url, cookie } = await google.start({ mode: 'link', userId: req.userToken.id, lang: 'en' });
    google.setCookie(res, cookie);
    res.json({ url });
  } catch (e) {
    console.error('[google] could not start linking:', e.message);
    res.status(502).json({ error: 'google_error' });
  }
}));

async function sendVerificationCode(user, lang) {
  const code = String(crypto.randomInt(100000, 1000000));
  await updateUser(user.id, { emailVerifyCodeHash: await bcrypt.hash(code, 10), emailVerifyCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000), emailCodeAttempts: 0 });
  if (config.EMAIL_ENABLED) {
    try { await sendTemplate('verify', { to: user.email, lang, data: { code } }); return { emailSent: true }; } catch (e) { console.error('[email] verification send failed:', e.message); }
  }
  return { emailSent: false, devCode: config.IS_PROD ? undefined : code };
}

router.get('/callback', optionalAuth, asyncHandler(async (req, res) => {
  const remembered = google.readCookie(req);
  google.clearCookie(res); // one use only
  const mode = remembered ? remembered.mode : 'login';
  const redirect = remembered ? safeRedirect(remembered.redirect) : null;
  if (!config.GOOGLE_ENABLED) return backWith(res, mode, 'unavailable', redirect);

  // The person said no (or Google refused): nothing happens.
  if (req.query.error) return backWith(res, mode, req.query.error === 'access_denied' ? 'cancelled' : 'error', redirect);
  // The state must be the one we made for THIS browser a moment ago (this stops a forged or replayed callback).
  const given = typeof req.query.state === 'string' ? req.query.state : '';
  const same = remembered && given.length === remembered.state.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(remembered.state));
  if (!same) return backWith(res, mode, 'bad_state', redirect);

  let claims;
  try {
    claims = await google.finish(new URL(req.originalUrl, config.PUBLIC_URL), remembered);
  } catch (e) {
    console.error('[google] sign-in failed:', e.message);
    return backWith(res, mode, 'error', redirect);
  }
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const emailVerified = claims.email_verified === true;

  // ---- Connecting Google to the account that is signed in -------------------------------------------------------
  if (mode === 'link') {
    if (!req.userToken || req.userToken.id !== remembered.uid) return backWith(res, 'link', 'bad_state');
    const existing = await identities.findGoogle(claims.sub);
    if (existing) return backWith(res, 'link', existing.user_id === remembered.uid ? 'linked' : 'already_linked');
    if (await identities.googleFor(remembered.uid)) return backWith(res, 'link', 'has_other');
    await identities.linkGoogle(remembered.uid, claims);
    return backWith(res, 'link', 'linked');
  }

  const signIn = async (user, to) => {
    await startSession(req, res, user);
    await require('../verification/signals').record(req, res, user.id, 'login');
    res.redirect(302, to);
  };

  // ---- A Google account we know: sign that person in ---------------------------------------------------------------
  const known = await identities.findGoogle(claims.sub);
  if (known) {
    const user = await getUserById(known.user_id);
    if (!user) return backWith(res, mode, 'error', redirect);
    await identities.touch(known.id);
    return signIn(user, redirect || '/dashboard.html');
  }
  if (!email) return backWith(res, mode, 'no_email', redirect);

  // ---- An email address that already has an account ------------------------------------------------------------------
  const existing = await getUserByEmail(email);
  if (existing) {
    // Only when the address is verified on both sides: otherwise anybody could take over an account by making a Google
    // account with somebody else's address. (The person signs in with their password and connects Google in Settings.)
    if (!(emailVerified && existing.emailVerified)) return backWith(res, mode, 'link_needed', redirect);
    await identities.linkGoogle(existing.id, claims);
    return signIn(existing, redirect || '/dashboard.html');
  }

  // ---- A new person ------------------------------------------------------------------------------------------------
  const name = oneLine(claims.name || claims.given_name, 100) || email.split('@')[0];
  let user;
  try {
    user = await insertUser({ name, email, passwordHash: null, color: randomColor(), language: remembered.lang === 'ka' ? 'ka' : 'en', emailVerified });
  } catch (e) {
    if (e.code === '23505') return backWith(res, mode, 'error', redirect); // (the same address was registered a moment ago)
    throw e;
  }
  await usernames.assignNew(user.id, user.name, null); // a suggestion from the name; they confirm or change it on the next page
  await identities.linkGoogle(user.id, claims);
  const photo = await fetchGooglePhoto(claims.picture);
  if (photo) await setPhoto(user.id, photo, 'google');

  // The pages a new person passes through: (verify the email if Google did not) -> choose a username -> where they were going.
  let to = withRedirect('/choose-username.html', redirect);
  if (!emailVerified) {
    const sent = await sendVerificationCode(user, user.language);
    to = `/verify-email.html?redirect=${encodeURIComponent(to)}${sent.devCode ? `&devCode=${sent.devCode}` : ''}${!sent.emailSent && !sent.devCode ? '&emailFailed=1' : ''}`;
  }
  return signIn(await getUserById(user.id), to);
}));

module.exports = router;
