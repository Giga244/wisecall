const jwt = require('jsonwebtoken');
const config = require('./config');
const { asyncHandler } = require('./util');
const { getUserById } = require('./models');
const { COOKIE_NAME } = require('./auth');

// An admin is an account whose email is in ADMIN_EMAILS. The address must also be verified: otherwise anybody could sign up with an
// admin's address before the admin does.
const isAdminUser = (user) => Boolean(user && user.emailVerified && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase()));

// Who is asking, from the login cookie alone (pages and files are not API calls, so there is no requireAuth before them).
// Returns { user, admin }: user is null when nobody is signed in (or the session is invalid or expired).
async function whoIsAsking(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return { user: null, admin: false };
  let id;
  try { id = jwt.verify(token, config.SESSION_SECRET).id; } catch (e) { return { user: null, admin: false }; }
  const user = await getUserById(id);
  return { user: user || null, admin: isAdminUser(user) };
}

// Lets through only admins. Sets req.adminUser. Anyone else gets the same plain 403, whatever the reason (no admin is configured, the
// account is not on the list, the address is not verified): the answer says nothing about how the site is set up.
const requireAdmin = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.userToken.id);
  if (!isAdminUser(user)) return res.status(403).json({ error: 'not_admin' });
  req.adminUser = user;
  next();
});

// The admin scripts and dictionaries are files, not API calls: they are served to admins only, so their texts (and the settings they
// mention) are never sent to anybody else.
const adminOnlyFile = asyncHandler(async (req, res, next) => {
  if ((await whoIsAsking(req)).admin) return next();
  res.status(403).set('Cache-Control', 'no-store').type('text/plain').send('Forbidden');
});

module.exports = { requireAdmin, isAdminUser, whoIsAsking, adminOnlyFile };
