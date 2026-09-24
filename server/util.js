// Only these fields are ever sent to the public (never email, Stripe ids, proof links, etc).
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
    createdAt: user.createdAt,
    payoutsReady: Boolean(user.stripeAccountId)
  };
}
function meProfile(user) {
  if (!user) return null;
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, emailVerifyCodeHash, emailVerifyCodeExpiresAt, ...rest } = user;
  return rest;
}

function mentorStats(mentorId, bookings) {
  const mentorBookings = bookings.filter(b => b.mentorId === mentorId);
  const rated = mentorBookings.filter(b => typeof b.rating === 'number');
  const answeredCount = mentorBookings.filter(b => b.status === 'answered').length;
  const ratingAvg = rated.length ? rated.reduce((sum, b) => sum + b.rating, 0) / rated.length : null;
  return {
    ratingAvg: ratingAvg !== null ? Math.round(ratingAvg * 10) / 10 : null,
    reviewCount: rated.length,
    answeredCount
  };
}

function isListable(user) {
  return (user.role === 'mentor' || user.role === 'both') &&
    Boolean(user.price) && Boolean(user.niche) && Boolean(user.roleTitle) &&
    user.verificationStatus === 'verified';
}

module.exports = { publicProfile, meProfile, isListable, mentorStats };
