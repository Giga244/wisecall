const { query } = require('./db');
const config = require('./config');

// The API keeps the camelCase shapes the frontend already uses; these mappers translate
// between them and the snake_case Postgres columns.

function userFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
    niche: r.niche,
    roleTitle: r.role_title,
    bio: r.bio,
    price: r.price,
    color: r.color,
    language: r.language,
    payoutName: r.payout_name,
    payoutIbanEnc: r.payout_iban_enc,
    payoutIbanLast4: r.payout_iban_last4,
    payoutUpdatedAt: r.payout_updated_at,
    verificationStatus: r.verification_status,
    proofUrl: r.proof_url,
    sampleAnswer: r.sample_answer,
    verificationNote: r.verification_note,
    verificationDecidedAt: r.verification_decided_at,
    suspendedAt: r.suspended_at,
    suspensionReason: r.suspension_reason,
    workEmail: r.work_email,
    workEmailVerifiedAt: r.work_email_verified_at,
    specialtyTags: r.specialty_tags || [],
    yearsExperience: r.years_experience,
    story: r.story,
    applicationSubmittedAt: r.application_submitted_at,
    verificationRules: r.verification_rules,
    customNiche: r.custom_niche,
    payoutHoldUntil: r.payout_hold_until || null,
    publicAnswersPref: r.public_answers_pref || 'ask',
    fieldOverride: Boolean(r.field_override),
    emailVerified: r.email_verified,
    emailVerifyCodeHash: r.email_code_hash,
    emailVerifyCodeExpiresAt: r.email_code_expires_at,
    resetTokenHash: r.reset_token_hash,
    resetTokenExpiresAt: r.reset_token_expires_at,
    username: r.username,
    usernameChangedAt: r.username_changed_at,
    usernameConfirmed: r.username_confirmed,
    headline: r.headline,
    currentWork: r.current_work,
    city: r.city,
    languages: r.languages || [],
    linkedinUrl: r.linkedin_url,
    websiteUrl: r.website_url,
    profileVisibility: r.profile_visibility,
    theme: r.theme,
    photoUpdatedAt: r.photo_updated_at,
    // Whether a step the mentor's niche requires no longer holds (see failedRequiredStepSql). Only known when the row was read through
    // USER_SELECT (getUserById and friends); undefined otherwise, and then the mentor is treated as not listable.
    hasFailedRequiredStep: r.has_failed_required_step === undefined ? undefined : Boolean(r.has_failed_required_step),
    deletionRequestedAt: r.deletion_requested_at || null,
    adultConfirmedAt: r.adult_confirmed_at || null,
    deletedAt: r.deleted_at || null,
    createdAt: r.created_at
  };
}

function bookingFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    seekerId: r.seeker_id,
    mentorId: r.mentor_id,
    question: r.question,
    answer: r.answer,
    amount: r.amount,
    currency: r.currency,
    platformFeePercent: Number(r.platform_fee_percent),
    platformFeeAmount: r.platform_fee_amount,
    mentorNetAmount: r.mentor_net_amount,
    status: r.status,
    provider: r.provider,
    providerOrderId: r.provider_order_id,
    reminderSentAt: r.reminder_sent_at,
    paidAt: r.paid_at,
    answeredAt: r.answered_at,
    answerDeadline: r.answer_deadline,
    refundedAt: r.refunded_at,
    refundReason: r.refund_reason,
    providerRefundId: r.provider_refund_id,
    refundRequestedAt: r.refund_requested_at,
    refundError: r.refund_error,
    answerReview: r.answer_review,
    answerHeldUntil: r.answer_held_until,
    answerReleasedAt: r.answer_released_at,
    answerFlaggedAt: r.answer_flagged_at,
    declinedAt: r.declined_at,
    declineReason: r.decline_reason,
    refundedAmount: r.refunded_amount,
    partialRefundStartedAt: r.partial_refund_started_at,
    createdAt: r.created_at
  };
}

const USER_COLUMNS = {
  name: 'name', email: 'email', passwordHash: 'password_hash', role: 'role', niche: 'niche',
  roleTitle: 'role_title', bio: 'bio', price: 'price', color: 'color',
  language: 'language', verificationStatus: 'verification_status',
  payoutName: 'payout_name', payoutIbanEnc: 'payout_iban_enc', payoutIbanLast4: 'payout_iban_last4', payoutUpdatedAt: 'payout_updated_at',
  proofUrl: 'proof_url', sampleAnswer: 'sample_answer', verificationNote: 'verification_note',
  verificationDecidedAt: 'verification_decided_at', suspendedAt: 'suspended_at', suspensionReason: 'suspension_reason', emailVerified: 'email_verified', emailVerifyCodeHash: 'email_code_hash',
  emailVerifyCodeExpiresAt: 'email_code_expires_at', resetTokenHash: 'reset_token_hash',
  resetTokenExpiresAt: 'reset_token_expires_at',
  headline: 'headline', currentWork: 'current_work', city: 'city', languages: 'languages', linkedinUrl: 'linkedin_url', websiteUrl: 'website_url',
  profileVisibility: 'profile_visibility', photoUpdatedAt: 'photo_updated_at', theme: 'theme',
  specialtyTags: 'specialty_tags', yearsExperience: 'years_experience', story: 'story', applicationSubmittedAt: 'application_submitted_at',
  verificationRules: 'verification_rules', payoutHoldUntil: 'payout_hold_until', publicAnswersPref: 'public_answers_pref', customNiche: 'custom_niche', emailCodeAttempts: 'email_code_attempts', fieldOverride: 'field_override'
};

const BOOKING_COLUMNS = {
  answer: 'answer', status: 'status',
  providerOrderId: 'provider_order_id', paidAt: 'paid_at', answeredAt: 'answered_at', answerDeadline: 'answer_deadline',
  refundedAt: 'refunded_at', refundReason: 'refund_reason', providerRefundId: 'provider_refund_id',
  refundRequestedAt: 'refund_requested_at', refundError: 'refund_error', reminderSentAt: 'reminder_sent_at',
  answerReview: 'answer_review', answerHeldUntil: 'answer_held_until', answerReleasedAt: 'answer_released_at', answerFlaggedAt: 'answer_flagged_at',
  refundedAmount: 'refunded_amount'
};

// `client` may be a transaction client; otherwise the shared pool is used.
const runner = (client) => (client ? client.query.bind(client) : query);

function buildUpdate(table, columns, id, patch, client, returning = '*') {
  const keys = Object.keys(patch).filter((k) => columns[k]);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${columns[k]} = $${i + 1}`);
  const values = keys.map((k) => patch[k]);
  return runner(client)(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING ${returning}`, [...values, id]);
}

// ---- The "failed required step" rule (docs/AUDIT.md #8) ----------------------------------------------------------------------------
// A mentor with a step their niche requires that no longer holds (failed, or a licence past its expiry date) is never listed or
// bookable, whatever users.verification_status says. This one SQL condition is used by listableSql() (lists, counts, pages) and by
// USER_SELECT (so isListable() in server/util.js sees it too). `u` is the name of the users row in the outer query.
// The steps every mentor needs come from server/verification/rules.js; a regulated niche adds its licence steps.
function failedRequiredStepSql(u = 'users') {
  const rules = require('./verification/rules');
  const niches = require('./niches');
  const lit = (list) => list.filter((k) => /^[a-z0-9_]+$/.test(k)).map((k) => `'${k}'`).join(', ');
  const base = rules.requiredFor(null).concat('video_interview'); // (an interview is required once an admin has asked for one)
  const regulated = [...new Set([...niches.all().filter((n) => n.regulated).map((n) => n.key), ...Object.keys(rules.REGULATED)])];
  const byStep = {};
  for (const key of regulated) {
    for (const step of rules.requiredFor(key)) if (!base.includes(step)) (byStep[step] = byStep[step] || []).push(key);
  }
  const extra = Object.entries(byStep).map(([step, keys]) => ` OR (fs.step = '${step}' AND ${u}.niche IN (${lit(keys)}))`).join('');
  return `EXISTS (SELECT 1 FROM verification_steps fs WHERE fs.user_id = ${u}.id
      AND (fs.status = 'failed' OR (fs.status = 'passed' AND fs.expires_at IS NOT NULL AND fs.expires_at < now()))
      AND (fs.step IN (${lit(base)})${extra}))`;
}
// Every column of a user plus the rule above, for code that decides whether a mentor may be shown.
const userColumnsSql = (u = 'users') => `${u}.*, ${failedRequiredStepSql(u)} AS has_failed_required_step`;

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

async function getUserById(id, client) {
  if (!isUuid(id)) return null;
  const { rows } = await runner(client)(`SELECT ${userColumnsSql()} FROM users WHERE id = $1`, [id]);
  return userFromRow(rows[0]);
}

async function getUserByEmail(email) {
  const { rows } = await query(`SELECT ${userColumnsSql()} FROM users WHERE lower(email) = lower($1)`, [email]);
  return userFromRow(rows[0]);
}

async function updateUser(id, patch, client) {
  const res = await buildUpdate('users', USER_COLUMNS, id, patch, client, userColumnsSql());
  return res ? userFromRow((await res).rows[0]) : getUserById(id, client);
}

async function insertUser(u) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, color, language, email_code_hash, email_code_expires_at, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *, false AS has_failed_required_step`,
    [u.name, u.email, u.passwordHash || null, u.color, u.language || 'en', u.emailVerifyCodeHash || null, u.emailVerifyCodeExpiresAt || null, Boolean(u.emailVerified)]
  );
  return userFromRow(rows[0]);
}

async function getBookingById(id, client) {
  if (!isUuid(id)) return null;
  const { rows } = await runner(client)('SELECT * FROM bookings WHERE id = $1', [id]);
  return bookingFromRow(rows[0]);
}

async function updateBooking(id, patch, client) {
  const res = await buildUpdate('bookings', BOOKING_COLUMNS, id, patch, client);
  return res ? bookingFromRow((await res).rows[0]) : getBookingById(id, client);
}

// A mentor answers ONCE. This is the only way an answer is ever written: the update happens only if the question is paid and has no answer
// yet, so two requests at the same moment (or a second one later) can never replace it. `hold` (from probation.holdPatch) puts a new
// mentor's answer on hold in the same statement, so there is never a moment when it is saved but the buyer could already read it.
// Returns the booking, or null when it was not there to be answered (already answered, refunded, not paid).
async function claimAnswer(id, answer, hold) {
  if (!isUuid(id)) return null;
  const { rows } = await query(
    `UPDATE bookings SET answer = $2, status = 'answered', answered_at = now(),
            answer_review = COALESCE($3, answer_review), answer_held_until = COALESCE($4, answer_held_until)
      WHERE id = $1 AND status = 'paid' AND answered_at IS NULL AND (answer_deadline IS NULL OR answer_deadline > now()) RETURNING *`,
    [id, answer, hold ? hold.answerReview : null, hold ? hold.answerHeldUntil : null]
  );
  return bookingFromRow(rows[0]);
}

// A mentor shows up publicly (and can be booked) only when this is true: approved by an admin, payout details saved (so a question
// can never be paid to someone we cannot pay), and no required verification step that no longer holds. The same rule, for one user
// object, is isListable() in server/util.js. `u` names the users row when the query gives it another name.
function listableSql(u = 'users') {
  return `${u}.role IN ('mentor', 'both') AND ${u}.price IS NOT NULL AND ${u}.niche IS NOT NULL
    AND ${u}.role_title IS NOT NULL AND ${u}.verification_status = 'verified' AND ${u}.payout_iban_enc IS NOT NULL
    AND ${u}.deletion_requested_at IS NULL AND ${u}.deleted_at IS NULL
    AND NOT ${failedRequiredStepSql(u)}`;
}

// { [mentorId]: { ratingAvg, reviewCount, answeredCount } } for the given mentor ids.
async function mentorStatsFor(ids) {
  const out = {};
  ids.forEach((id) => { out[id] = { ratingAvg: null, reviewCount: 0, answeredCount: 0, avgAnswerSeconds: null }; });
  if (!ids.length) return out;
  // The rating numbers come from the ratings table: only ratings that were revealed (see server/ratings.js), not hidden by an
  // admin, and given for a booking that stayed answered.
  const ratings = await query(
    `SELECT r.ratee_id, count(*)::int AS n, round(avg(r.stars)::numeric, 1) AS avg
       FROM ratings r JOIN bookings b ON b.id = r.booking_id
      WHERE r.direction = 'asker_to_mentor' AND r.ratee_id = ANY($1::uuid[]) AND r.revealed_at IS NOT NULL AND r.hidden_at IS NULL AND b.status = 'answered'
      GROUP BY r.ratee_id`, [ids]
  );
  const { rows } = await query(
    `SELECT mentor_id,
            count(*) FILTER (WHERE status = 'answered' AND answer_review <> 'held') AS answered,
            -- how long buyers really waited: from payment to the moment they could read the answer
            avg(EXTRACT(EPOCH FROM (COALESCE(answer_released_at, answered_at) - paid_at)))
              FILTER (WHERE status = 'answered' AND answer_review <> 'held' AND paid_at IS NOT NULL AND answered_at IS NOT NULL) AS avg_seconds
       FROM bookings WHERE mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`,
    [ids]
  );
  rows.forEach((r) => {
    out[r.mentor_id] = {
      ratingAvg: null,
      reviewCount: 0,
      answeredCount: Number(r.answered),
      avgAnswerSeconds: r.avg_seconds === null ? null : Math.max(0, Math.round(Number(r.avg_seconds)))
    };
  });
  ratings.rows.forEach((r) => {
    if (!out[r.ratee_id]) out[r.ratee_id] = { ratingAvg: null, reviewCount: 0, answeredCount: 0, avgAnswerSeconds: null };
    out[r.ratee_id].ratingAvg = Number(r.avg);
    out[r.ratee_id].reviewCount = r.n;
  });
  return out;
}

module.exports = {
  userFromRow, bookingFromRow, getUserById, getUserByEmail, updateUser, insertUser,
  getBookingById, updateBooking, claimAnswer, listableSql, failedRequiredStepSql, userColumnsSql, mentorStatsFor
};
