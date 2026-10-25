// Free questions (docs/CLAUDE-CODE-FREE-ANSWERS.md): a mentor whose price is 0 answers for free. Such a question is a booking of amount 0
// with provider 'free', made 'paid' at once: no bank, no receipt, no fee, no payout. Everything else is a paid question's: the answer
// deadline, probation, the free follow-up, ratings, reports. When it ends without an answer (the deadline, a decline, a suspension, an
// admin) it is closed, never refunded: payments.refundBooking hands it to close() below, which makes no money record.
//
// Nothing stops a flood of free questions but these limits (checked under a lock, so two at once cannot both slip through):
//   - the asker's email is confirmed;
//   - open (asked, not answered or closed yet): FREE_OPEN_PER_MENTOR with one mentor, FREE_OPEN_TOTAL in all;
//   - the mentor's own weekly number (users.free_weekly_cap, Monday to Sunday UTC): when it is reached, "Free questions are full this week".
const { tx, query } = require('./db');
const config = require('./config');
const { bookingFromRow, updateBooking } = require('./models');

class FreeError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; this.extra = extra; }
}
const STATUS = { email_not_verified: 403, free_limit_mentor: 409, free_limit_total: 409, free_full: 409 };

// (only a booking that is still open; amount 0 is what makes it free)
const OPEN_SQL = `b.amount = 0 AND b.status = 'paid' AND b.answered_at IS NULL AND b.declined_at IS NULL`;
const WEEK_SQL = `date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

// { [mentorId]: { used, cap, full } } this week, for mentors who answer for free.
async function weekFor(mentors) {
  const free = mentors.filter((m) => m && m.price === 0);
  if (!free.length) return {};
  const { rows } = await query(
    `SELECT mentor_id, count(*)::int AS n FROM bookings WHERE mentor_id = ANY($1::uuid[]) AND amount = 0 AND created_at >= ${WEEK_SQL} GROUP BY mentor_id`,
    [free.map((m) => m.id)]);
  const used = Object.fromEntries(rows.map((r) => [r.mentor_id, r.n]));
  return Object.fromEntries(free.map((m) => {
    const cap = m.freeWeeklyCap || 10;
    return [m.id, { used: used[m.id] || 0, cap, full: (used[m.id] || 0) >= cap }];
  }));
}

// Asks a free question. -> the booking. Throws FreeError.
async function ask({ seeker, mentor, question, source }) {
  if (!seeker.emailVerified) throw new FreeError('email_not_verified');
  const payments = require('./payments');
  const booking = await tx(async (client) => {
    // (the mentor first, then the asker: always in that order, so two requests never wait on each other)
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('free-mentor:' || $1))`, [mentor.id]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('free-asker:' || $1))`, [seeker.id]);
    const { rows: [n] } = await client.query(
      `SELECT count(*) FILTER (WHERE ${OPEN_SQL} AND b.seeker_id = $1 AND b.mentor_id = $2)::int AS with_mentor,
              count(*) FILTER (WHERE ${OPEN_SQL} AND b.seeker_id = $1)::int AS total,
              count(*) FILTER (WHERE b.amount = 0 AND b.mentor_id = $2 AND b.created_at >= ${WEEK_SQL})::int AS week
         FROM bookings b WHERE b.seeker_id = $1 OR b.mentor_id = $2`, [seeker.id, mentor.id]);
    if (n.week >= (mentor.freeWeeklyCap || 10)) throw new FreeError('free_full');
    if (n.with_mentor >= config.FREE_OPEN_PER_MENTOR) throw new FreeError('free_limit_mentor', { max: config.FREE_OPEN_PER_MENTOR });
    if (n.total >= config.FREE_OPEN_TOTAL) throw new FreeError('free_limit_total', { max: config.FREE_OPEN_TOTAL });
    const { rows } = await client.query(
      `INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount,
                             status, provider, source, paid_at, answer_deadline)
       VALUES ($1, $2, $3, 0, $4, 0, 0, 0, 'paid', 'free', $5, now(), $6) RETURNING *`,
      [seeker.id, mentor.id, question, config.CURRENCY, source ? JSON.stringify(source) : null, payments.deadlineFromNow()]);
    return bookingFromRow(rows[0]);
  });
  require('./notify').notifyMentorNewQuestion(mentor, booking);
  require('./analytics').event('question_free', null, { field: String(mentor.niche || '') });
  return booking;
}

// Closes a free question that ends without an answer, in the caller's transaction (payments.refundBooking: the deadline, a decline, a
// suspension, an admin, a rejected answer). It is marked 'refunded' with the reason, like a paid one, so every list and
// sweep treats it alike; there is no bank, no receipt and no ledger row. -> the booking
async function close(client, booking, reason) {
  return updateBooking(booking.id, {
    status: 'refunded', refundedAt: new Date(), refundReason: booking.refundReason || reason, refundRequestedAt: booking.refundRequestedAt || new Date(), refundError: null
  }, client);
}

module.exports = { FreeError, STATUS, ask, close, weekFor };
