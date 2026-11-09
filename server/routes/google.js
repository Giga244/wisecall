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
const ageGate = require('../ageGate');
const jwt = require('jsonwebtoken');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// A path on this site only (the same rule as public/js/api.js safeRedirect, docs/security-audit C7): one "/" first, no control character or
// blank anywhere (a browser drops them, so "/\t/evil.com" would be "//evil.com"), and read as a URL it is still this site.
const safeRedirect = (v) => {
  if (typeof v !== 'string' || v.length >= 300 || !/^\/(?![\/\\])/.test(v) || /[\u0000- \u007f-\u009f\s]/.test(v)) return null;
  try {
    const site = new URL(config.PUBLIC_URL).origin;
    const u = new URL(v, site);
    return u.origin === site ? u.pathname + u.search + u.hash : null;
  } catch (e) { return null; }
};
const withRedirect = (path, redirect) => (redirect ? `${path}${path.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(redirect)}` : path);
const PAGE = { login: '/login.html', signup: '/signup.html', link: '/settings.html?tab=account' };

// Something went wrong or was declined: back to the page the person came from, with a short code the page turns into words.
function backWith(res, mode, code, redirect) {
  const base = PAGE[mode] || PAGE.login;
  res.redirect(302, withRedirect(`${base}${base.includes('?') ? '&' : '?'}google=${code}`, redirect));
}

// An account from before the age rule is asked once, at its next login (a mentor's account when they ask a first question).
const askAge = (user, to) => (!user.birthYm && user.role === 'seeker' && !/^\/apply\.html/.test(to) ? withRedirect('/age-check.html', to) : to);

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

// A new person is asked their age before an account exists (docs/CLAUDE-CODE-ASKERS-16-PLUS.md: under 16, nothing may be stored). Until then
// what Google told us waits in a short-lived signed cookie in their own browser: its own key and audience, so it can never be read as a sign-in.
const NEW_COOKIE = 'wisecall_google_new';
const NEW_MINUTES = 30;
const NEW_KEY = () => `${config.SESSION_SECRET}:google-new`;
const NEW_AUDIENCE = 'wisecall-google-new';
const newCookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/google' });
const readNew = (req) => {
  try { return jwt.verify((req.cookies || {})[NEW_COOKIE] || '', NEW_KEY(), { audience: NEW_AUDIENCE }); } catch (e) { return null; }
};

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
    // Two-step verification turned on: the code is asked for on the sign-in page before there is a session.
    const authRoutes = require('./auth');
    if (await authRoutes.needsSecondStep(user)) {
      authRoutes.askForSecondStep(res, user);
      return res.redirect(302, `/login.html?step=code&redirect=${encodeURIComponent(to)}`);
    }
    await startSession(req, res, user, null, 'sign_in');
    await require('../verification/signals').record(req, res, user.id, 'login');
    res.redirect(302, to);
  };

  // ---- A Google account we know: sign that person in ---------------------------------------------------------------
  const known = await identities.findGoogle(claims.sub);
  if (known) {
    const user = await getUserById(known.user_id);
    if (!user) return backWith(res, mode, 'error', redirect);
    await identities.touch(known.id);
    return signIn(user, askAge(user, redirect || '/dashboard.html'));
  }
  if (!email) return backWith(res, mode, 'no_email', redirect);

  // ---- An email address that already has an account ------------------------------------------------------------------
  const existing = await getUserByEmail(email);
  if (existing) {
    // Only when the address is verified on both sides: otherwise anybody could take over an account by making a Google
    // account with somebody else's address. (The person signs in with their password and connects Google in Settings.)
    if (!(emailVerified && existing.emailVerified)) return backWith(res, mode, 'link_needed', redirect);
    await identities.linkGoogle(existing.id, claims);
    return signIn(existing, askAge(existing, redirect || '/dashboard.html'));
  }

  // ---- A new person ------------------------------------------------------------------------------------------------
  res.cookie(NEW_COOKIE, jwt.sign({
    sub: claims.sub, email, email_verified: emailVerified, name: oneLine(claims.name || claims.given_name, 100) || email.split('@')[0],
    picture: claims.picture || null, lang: remembered.lang === 'ka' ? 'ka' : 'en', redirect
  }, NEW_KEY(), { expiresIn: `${NEW_MINUTES}m`, audience: NEW_AUDIENCE }), { ...newCookieOptions(), maxAge: NEW_MINUTES * 60000 });
  return res.redirect(302, withRedirect('/age-check.html?google=1', redirect));
}));

// The age page, for a new person from Google: is somebody waiting?
router.get('/new', (req, res) => {
  const who = readNew(req);
  if (!who) return res.status(404).json({ error: 'sign_in_again' });
  res.json({ name: who.name });
});

// Their age: now the account is made, and they carry on where a new person goes. Under 16 what Google told us is forgotten.
router.post('/new', asyncHandler(async (req, res) => {
  const who = readNew(req);
  if (!who) return res.status(401).json({ error: 'sign_in_again' });
  const age = ageGate.check((req.body || {}).birthYm, (req.body || {}).parentPermission);
  if (age.error) {
    if (age.error === 'under_16') res.clearCookie(NEW_COOKIE, newCookieOptions());
    return res.status(age.status).json({ error: age.error });
  }
  const { email, name, redirect } = who;
  const emailVerified = who.email_verified === true;
  const claims = { sub: who.sub, email, email_verified: emailVerified };
  // (the same Google account or address, signed up a moment ago in another tab)
  if (await identities.findGoogle(who.sub) || await getUserByEmail(email)) { res.clearCookie(NEW_COOKIE, newCookieOptions()); return res.status(409).json({ error: 'sign_in_again' }); }
  let user;
  try {
    user = await insertUser({ name, email, passwordHash: null, color: randomColor(), language: who.lang, emailVerified });
    require('../analytics').event('signup', req, { method: 'google', age_group: age.group });
    const source = require('../attribution').read(req);
    if (source) await require('../db').query('UPDATE users SET signup_source = $2 WHERE id = $1', [user.id, JSON.stringify(source)]);
  } catch (e) {
    if (e.code === '23505') { res.clearCookie(NEW_COOKIE, newCookieOptions()); return res.status(409).json({ error: 'sign_in_again' }); } // (the same address was registered a moment ago)
    throw e;
  }
  await ageGate.save(user.id, age);
  await usernames.assignNew(user.id, user.name, null); // a suggestion from the name; they confirm or change it on the next page
  await identities.linkGoogle(user.id, claims);
  const photo = await fetchGooglePhoto(who.picture);
  if (photo) await setPhoto(user.id, photo, 'google');
  // (Google already confirmed the address: the welcome now; otherwise it comes when the emailed code is entered)
  if (emailVerified) require('../notify').notifyWelcome(user);

  // The pages a new person passes through: (verify the email if Google did not) -> choose a username -> where they were going.
  let to = withRedirect('/choose-username.html', redirect);
  if (!emailVerified) {
    const sent = await sendVerificationCode(user, user.language);
    to = `/verify-email.html?redirect=${encodeURIComponent(to)}${sent.devCode ? `&devCode=${sent.devCode}` : ''}${!sent.emailSent && !sent.devCode ? '&emailFailed=1' : ''}`;
  }
  res.clearCookie(NEW_COOKIE, newCookieOptions());
  await startSession(req, res, await getUserById(user.id), null, 'sign_in');
  await require('../verification/signals').record(req, res, user.id, 'login');
  res.status(201).json({ to });
}));

module.exports = router;

module.exports.safeRedirect = safeRedirect; // (for tests/security-audit-1.test.js)
