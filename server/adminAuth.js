const path = require('path');
const config = require('./config');
const { asyncHandler } = require('./util');
const { getUserById } = require('./models');
const twoFactor = require('./twoFactor');

// An admin is an account whose email is in ADMIN_EMAILS. The address must also be verified: otherwise anybody could sign up with an
// admin's address before the admin does.
const isAdminUser = (user) => Boolean(user && user.emailVerified && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase()));

// Who is asking, from the login cookie alone (pages and files are not API calls, so there is no requireAuth before them).
// -> { user, admin, verified }: user is null when nobody is signed in (or the session is invalid or expired); verified means the admin has
// also passed the second step (an authenticator app) in this session, or the second step is not required.
async function whoIsAsking(req) {
  const payload = await require('./auth').tokenFrom(req); // (a genuine cookie whose session is still valid)
  if (!payload) return { user: null, admin: false, verified: false };
  const user = await getUserById(payload.id);
  const admin = isAdminUser(user);
  return { user: user || null, admin, verified: admin && (!config.ADMIN_2FA_REQUIRED || twoFactor.isFresh(payload.mfaAt)) };
}

// Lets through only admins, whether or not they have passed the second step: for the two-step verification routes themselves.
// Anyone else gets the same plain 403, whatever the reason (no admin is configured, the account is not on the list, the address is not
// verified): the answer says nothing about how the site is set up. Sets req.adminUser.
const requireAdminUser = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.userToken.id);
  if (!isAdminUser(user)) return res.status(403).json({ error: 'not_admin' });
  req.adminUser = user;
  next();
});

// Lets through only admins who have also passed the second step in this session (an authenticator app, ADMIN_2FA): the guard of every
// admin action. Without it: 403 two_factor_setup_required (nothing set up yet) or two_factor_required (a code is needed).
const requireAdmin = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.userToken.id);
  if (!isAdminUser(user)) return res.status(403).json({ error: 'not_admin' });
  if (config.ADMIN_2FA_REQUIRED && !twoFactor.isFresh(req.userToken.mfaAt)) {
    const state = await twoFactor.stateFor(user.id);
    return res.status(403).json({ error: state.enabled ? 'two_factor_required' : 'two_factor_setup_required' });
  }
  req.adminUser = user;
  next();
});

// Is this URL one of the admin scripts or dictionaries (/js/admin*.js, /i18n/admin-*.json)? The file server decodes and tidies a path before
// it opens a file (%61 is "a", "/./" and "\" are separators, and Windows ignores case and trailing dots and spaces), so the check is made
// on the same tidied path, and on the whole start of the name, never on the raw text of the URL.
function tidyPath(urlPath) {
  try { return path.posix.normalize(decodeURIComponent(String(urlPath)).replace(/\\/g, '/')).toLowerCase(); }
  catch (e) { return null; } // a path that cannot be read
}
function isAdminFile(urlPath) {
  const p = tidyPath(urlPath);
  return p === null || /^\/(js\/admin|i18n\/admin)/.test(p); // (an unreadable path is not let through)
}
// The two-step verification page needs its own script and its own small dictionary (admin2fa-en.json) before the admin has passed the
// second step; nothing else of the panel does.
const isTwoFactorAsset = (urlPath) => { const p = tidyPath(urlPath); return p === '/js/admin-2fa.js' || (p !== null && /^\/i18n\/admin2fa-[a-z]{2}\.json$/.test(p)); };

// Those files are for admins only (and, once the second step is required, for admins who passed it): their texts (and the settings they
// mention) are never sent to anybody else.
const adminOnlyFile = asyncHandler(async (req, res, next) => {
  if (!isAdminFile(req.path)) return next();
  const who = await whoIsAsking(req);
  if (isTwoFactorAsset(req.path) ? who.admin : who.verified) return next();
  res.status(403).set('Cache-Control', 'no-store').type('text/plain').send('Forbidden');
});

module.exports = { requireAdmin, requireAdminUser, isAdminUser, whoIsAsking, adminOnlyFile, isAdminFile, tidyPath };
