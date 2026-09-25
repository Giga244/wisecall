const config = require('./config');

// The address of someone's profile photo (null when they have none: the page draws their initials). The version
// in the query string changes with each new photo so browsers do not keep showing the old one.
const photoUrl = (user) => (user && user.photoUpdatedAt ? `/api/photo/${user.id}?v=${new Date(user.photoUpdatedAt).getTime()}` : null);

// Only these fields are ever sent to the public (never email, payout details, proof links, etc).
function publicProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleTitle: user.roleTitle,
    niche: user.niche,
    bio: user.bio,
    price: user.price,
    color: user.color,
    photoUrl: photoUrl(user),
    createdAt: user.createdAt
  };
}

// What a logged-in user may see about themselves (no secrets or hashes).
function meProfile(user) {
  if (!user) return null;
  // The encrypted IBAN never leaves the server through this; owners fetch it from /api/me/payout.
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, emailVerifyCodeHash, emailVerifyCodeExpiresAt, payoutIbanEnc, ...rest } = user;
  return {
    ...rest, hasPayoutDetails: Boolean(payoutIbanEnc), hasPassword: Boolean(passwordHash), photoUrl: photoUrl(user), isListedMentor: isListable(user),
    isAdmin: Boolean(user.email) && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase())
  };
}

function isListable(user) {
  return Boolean(user) && (user.role === 'mentor' || user.role === 'both') &&
    Boolean(user.price) && Boolean(user.niche) && Boolean(user.roleTitle) &&
    user.verificationStatus === 'verified' && Boolean(user.payoutIbanEnc);
}

// Express 4 does not catch rejected promises from async handlers; this forwards them to
// the error middleware instead of leaving the request hanging.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { publicProfile, meProfile, isListable, asyncHandler, photoUrl };
