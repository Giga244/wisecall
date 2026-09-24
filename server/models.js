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
    stripeAccountId: r.stripe_account_id,
    payoutsEnabled: r.payouts_enabled,
    language: r.language,
    verificationStatus: r.verification_status,
    proofUrl: r.proof_url,
    sampleAnswer: r.sample_answer,
    verificationNote: r.verification_note,
    verificationChecks: r.verification_checks,
    emailVerified: r.email_verified,
    emailVerifyCodeHash: r.email_code_hash,
    emailVerifyCodeExpiresAt: r.email_code_expires_at,
    resetTokenHash: r.reset_token_hash,
    resetTokenExpiresAt: r.reset_token_expires_at,
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
    rating: r.rating,
    review: r.review,
    reviewedAt: r.reviewed_at,
    amount: r.amount,
    currency: r.currency,
    platformFeePercent: Number(r.platform_fee_percent),
    platformFeeAmount: r.platform_fee_amount,
    mentorNetAmount: r.mentor_net_amount,
    status: r.status,
    mode: r.mode,
    stripeSessionId: r.stripe_session_id,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    stripeTransferId: r.stripe_transfer_id,
    transferredAt: r.transferred_at,
    transferError: r.transfer_error,
    reminderSentAt: r.reminder_sent_at,
    paidAt: r.paid_at,
    answeredAt: r.answered_at,
    answerDeadline: r.answer_deadline,
    refundedAt: r.refunded_at,
    refundReason: r.refund_reason,
    stripeRefundId: r.stripe_refund_id,
    createdAt: r.created_at
  };
}

const USER_COLUMNS = {
  name: 'name', email: 'email', passwordHash: 'password_hash', role: 'role', niche: 'niche',
  roleTitle: 'role_title', bio: 'bio', price: 'price', color: 'color', stripeAccountId: 'stripe_account_id',
  payoutsEnabled: 'payouts_enabled', language: 'language', verificationStatus: 'verification_status',
  proofUrl: 'proof_url', sampleAnswer: 'sample_answer', verificationNote: 'verification_note',
  verificationChecks: 'verification_checks', emailVerified: 'email_verified', emailVerifyCodeHash: 'email_code_hash',
  emailVerifyCodeExpiresAt: 'email_code_expires_at', resetTokenHash: 'reset_token_hash',
  resetTokenExpiresAt: 'reset_token_expires_at'
};

const BOOKING_COLUMNS = {
  answer: 'answer', rating: 'rating', review: 'review', reviewedAt: 'reviewed_at', status: 'status',
  stripeSessionId: 'stripe_session_id', stripePaymentIntentId: 'stripe_payment_intent_id', paidAt: 'paid_at',
  answeredAt: 'answered_at', answerDeadline: 'answer_deadline', refundedAt: 'refunded_at',
  refundReason: 'refund_reason', stripeRefundId: 'stripe_refund_id', stripeTransferId: 'stripe_transfer_id',
  transferredAt: 'transferred_at', transferError: 'transfer_error', reminderSentAt: 'reminder_sent_at'
};

// `client` may be a transaction client; otherwise the shared pool is used.
const runner = (client) => (client ? client.query.bind(client) : query);

function buildUpdate(table, columns, id, patch, client) {
  const keys = Object.keys(patch).filter((k) => columns[k]);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${columns[k]} = $${i + 1}`);
  const values = keys.map((k) => patch[k]);
  return runner(client)(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`, [...values, id]);
}

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

async function getUserById(id, client) {
  if (!isUuid(id)) return null;
  const { rows } = await runner(client)('SELECT * FROM users WHERE id = $1', [id]);
  return userFromRow(rows[0]);
}

async function getUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return userFromRow(rows[0]);
}

async function updateUser(id, patch, client) {
  const res = await buildUpdate('users', USER_COLUMNS, id, patch, client);
  return res ? userFromRow((await res).rows[0]) : getUserById(id, client);
}

async function insertUser(u) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, color, email_code_hash, email_code_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [u.name, u.email, u.passwordHash, u.color, u.emailVerifyCodeHash, u.emailVerifyCodeExpiresAt]
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

// A mentor shows up publicly (and can be booked) only when this is true. When Stripe is on,
// they must also have finished payout onboarding so a question can never be paid to someone
// we cannot pay out.
function listableSql() {
  return `role IN ('mentor', 'both') AND price IS NOT NULL AND niche IS NOT NULL
    AND role_title IS NOT NULL AND verification_status = 'verified'` + (config.STRIPE_ENABLED ? ' AND payouts_enabled' : '');
}

// { [mentorId]: { ratingAvg, reviewCount, answeredCount } } for the given mentor ids.
async function mentorStatsFor(ids) {
  const out = {};
  ids.forEach((id) => { out[id] = { ratingAvg: null, reviewCount: 0, answeredCount: 0 }; });
  if (!ids.length) return out;
  const { rows } = await query(
    `SELECT mentor_id,
            count(*) FILTER (WHERE status = 'answered') AS answered,
            count(rating) AS reviews,
            round(avg(rating)::numeric, 1) AS avg
       FROM bookings WHERE mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`,
    [ids]
  );
  rows.forEach((r) => {
    out[r.mentor_id] = {
      ratingAvg: r.avg === null ? null : Number(r.avg),
      reviewCount: Number(r.reviews),
      answeredCount: Number(r.answered)
    };
  });
  return out;
}

module.exports = {
  userFromRow, bookingFromRow, getUserById, getUserByEmail, updateUser, insertUser,
  getBookingById, updateBooking, listableSql, mentorStatsFor
};
