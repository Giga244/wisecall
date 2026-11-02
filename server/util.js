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
    extraNiches: user.extraNiches || [], practiceKind: user.practiceKind || null,
    customNiche: user.customNiche || null, // "Your field", in the mentor's own words (shown instead of the category)
    // What students browse and search by (server/categories.js): all of it chosen by the mentor to be found by.
    fieldId: user.fieldId || null, extraFields: user.extraFields || [], directions: user.directions || [], directionOther: user.directionOther || null,
    specializations: user.specialtyTags || [], university: user.university || null, country: user.country || null,
    yearsBand: require('./categories').yearsBand(user.yearsExperience), currentRole: user.currentWork || null,
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
    // needsPayout: payout details are still needed to be listed (a mentor who answers for free needs none)
    ...rest, hasPayoutDetails: Boolean(payoutIbanEnc), needsPayout: user.price !== 0 && !payoutIbanEnc, needsAge: !user.birthYm, hasPassword: Boolean(passwordHash), photoUrl: photoUrl(user), isListedMentor: isListable(user),
    verificationState: verificationState(user),
    isAdmin: Boolean(user.email) && Boolean(user.emailVerified) && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase())
  };
}

// The one rule for "shown in Browse experts and bookable", for a user read through models.getUserById (or USER_SELECT): the same
// conditions as models.listableSql(). A required verification step that no longer holds always wins over an approval
// (hasFailedRequiredStep), and a user object that does not say (undefined) is treated as not listable.
function isListable(user) {
  return Boolean(user) && (user.role === 'mentor' || user.role === 'both') &&
    user.price !== null && user.price !== undefined && Boolean(user.niche) && Boolean(user.roleTitle) &&
    user.verificationStatus === 'verified' && (user.price === 0 || Boolean(user.payoutIbanEnc)) && user.hasFailedRequiredStep === false && // (free: no bank needed)
    !user.deletionRequestedAt && !user.deletedAt; // (an account being deleted is closed at once)
}

// Where a mentor's application stands, in one word, for every screen that shows it (the Settings banner, the progress bar, the
// Verification tab): the steps win over the stored status, so an approved mentor with a step that no longer holds is
// "needs_attention", never "verified".
//   none | pending (not sent yet) | in_review | needs_attention | verified | rejected | suspended
// An application that was never sent is "pending" (or "none") even with a failed step: the pages say neutrally how far it is and name the
// one step that failed, instead of a red "needs attention" at 0 of 3 steps (docs/CLAUDE-CODE-UX-WALKTHROUGH.md C).
function verificationState(user) {
  if (!user || !(user.role === 'mentor' || user.role === 'both')) return 'none';
  const s = user.verificationStatus || 'none';
  if (s === 'suspended' || s === 'rejected') return s;
  if (user.hasFailedRequiredStep && (s === 'verified' || (s === 'pending' && user.applicationSubmittedAt))) return 'needs_attention';
  if (s === 'verified') return 'verified';
  if (s === 'pending') return user.applicationSubmittedAt ? 'in_review' : 'pending';
  return 'none';
}

// Express 4 does not catch rejected promises from async handlers; this forwards them to
// the error middleware instead of leaving the request hanging.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { publicProfile, meProfile, isListable, verificationState, asyncHandler, photoUrl };
