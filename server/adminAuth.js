const config = require('./config');
const { asyncHandler } = require('./util');
const { getUserById } = require('./models');

// Lets through only accounts whose email is in ADMIN_EMAILS. Sets req.adminUser.
const requireAdmin = asyncHandler(async (req, res, next) => {
  if (config.ADMIN_EMAILS.length === 0) {
    return res.status(400).json({ error: 'admin_not_configured', message: 'Set ADMIN_EMAILS in .env to enable the admin panel.' });
  }
  const user = await getUserById(req.userToken.id);
  // (The address must also be verified: otherwise anybody could sign up with an admin's address before the admin does.)
  if (!user || !user.emailVerified || !config.ADMIN_EMAILS.includes(user.email.toLowerCase())) return res.status(403).json({ error: 'not_admin' });
  req.adminUser = user;
  next();
});

module.exports = { requireAdmin };
