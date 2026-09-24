const config = require('./config');

// Only these fields are ever sent to the public (never email, payout details, proof links, etc).
function publicProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    roleTitle: user.roleTitle,
    niche: user.niche,
    bio: user.bio,
    price: user.price,
    color: user.color,
    createdAt: user.createdAt
  };
}

// What a logged-in user may see about themselves (no secrets or hashes).
function meProfile(user) {
  if (!user) return null;
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, emailVerifyCodeHash, emailVerifyCodeExpiresAt, ...rest } = user;
  return { ...rest, isAdmin: Boolean(user.email) && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase()) };
}

function isListable(user) {
  return Boolean(user) && (user.role === 'mentor' || user.role === 'both') &&
    Boolean(user.price) && Boolean(user.niche) && Boolean(user.roleTitle) &&
    user.verificationStatus === 'verified';
}

// Express 4 does not catch rejected promises from async handlers; this forwards them to
// the error middleware instead of leaving the request hanging.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { publicProfile, meProfile, isListable, asyncHandler };
