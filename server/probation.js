// Probation: a new mentor's first answers are held for an admin before the buyer sees them.
//   - the first LIMITS.probationAnswers answers of every mentor, in every niche, are held
//   - an admin can approve one at once, keep holding it (flag), or reject it (the buyer is refunded)
//   - an answer nobody has flagged is released automatically after LIMITS.probationHoldHours, unless
//     the mentor has an open flag
//   - the mentor's payout hold period starts when the answer is released, not when it was written
const { query } = require('./db');
const rules = require('./verification/rules');
const steps = require('./verification/steps');
const ledger = require('./ledger');
const notify = require('./notify');
const { bookingFromRow, getUserById } = require('./models');

const HOUR = 3600000;

// Is the answer the mentor is about to give one of their first? (Counts answers already given.)
async function shouldHold(mentorId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM bookings WHERE mentor_id = $1 AND answered_at IS NOT NULL', [mentorId]);
  return rows[0].n < rules.LIMITS.probationAnswers;
}

// The columns that put an answer on hold. They are written in the same statement as the answer itself, so there is
// never a moment when the answer is saved but the buyer could already read it.
const holdPatch = () => ({ answerReview: 'held', answerHeldUntil: new Date(Date.now() + rules.LIMITS.probationHoldHours * HOUR) });

// Makes a held answer visible. `actor` is an admin, or steps.SYSTEM for the automatic release.
// Safe to call twice: only the first call does anything.
async function release(bookingId, actor, how) {
  const { rows } = await query(
    `UPDATE bookings SET answer_review = 'released', answer_released_at = now()
      WHERE id = $1 AND answer_review = 'held' AND status = 'answered' RETURNING *`, [bookingId]
  );
  if (!rows[0]) return null;
  const booking = bookingFromRow(rows[0]);
  await ledger.onAnswered(booking, booking.answerReleasedAt);
  await steps.audit(booking.mentorId, actor, 'answer_released', { reason: how });
  const [seeker, mentor] = await Promise.all([getUserById(booking.seekerId), getUserById(booking.mentorId)]);
  if (seeker && mentor) notify.notifySeekerAnswered(seeker, mentor, booking);
  return booking;
}

// The admin wants a closer look: the answer is not released automatically.
async function flag(bookingId, admin) {
  const { rows } = await query(
    `UPDATE bookings SET answer_flagged_at = COALESCE(answer_flagged_at, now()) WHERE id = $1 AND answer_review = 'held' RETURNING mentor_id`, [bookingId]
  );
  if (!rows[0]) return false;
  await steps.audit(rows[0].mentor_id, steps.adminActor(admin), 'answer_flagged', { reason: 'held for a closer look' });
  return true;
}

// The admin rejects the answer: the buyer gets their money back.
async function reject(bookingId, admin, reason) {
  const { rows } = await query(
    `UPDATE bookings SET answer_review = 'rejected' WHERE id = $1 AND answer_review = 'held' RETURNING mentor_id`, [bookingId]
  );
  if (!rows[0]) return false;
  await steps.audit(rows[0].mentor_id, steps.adminActor(admin), 'answer_rejected', { reason });
  await require('./payments').refundBooking(bookingId, 'answer_rejected');
  return true;
}

// Held answers whose time is up, nobody flagged, and whose mentor has no open flag.
async function releaseDue() {
  const { rows } = await query(
    `SELECT b.id FROM bookings b JOIN users u ON u.id = b.mentor_id
      WHERE b.answer_review = 'held' AND b.status = 'answered' AND b.answer_held_until <= now() AND b.answer_flagged_at IS NULL
        AND u.verification_status <> 'suspended'
        AND NOT EXISTS (SELECT 1 FROM mentor_flags f WHERE f.mentor_id = b.mentor_id AND f.status = 'open')
      ORDER BY b.answer_held_until LIMIT 50`
  );
  let n = 0;
  for (const { id } of rows) {
    try { if (await release(id, steps.SYSTEM, 'automatic release after the check window')) n += 1; }
    catch (e) { console.error(`[jobs] could not release held answer ${id}:`, e.message); }
  }
  return n;
}

// The queue an admin works through.
async function queue() {
  const { rows } = await query(
    `SELECT b.*, u.name AS mentor_name, u.email AS mentor_email, u.niche AS mentor_niche,
            (SELECT count(*)::int FROM bookings x WHERE x.mentor_id = b.mentor_id AND x.answered_at IS NOT NULL AND x.answered_at <= b.answered_at) AS answer_number,
            EXISTS (SELECT 1 FROM mentor_flags f WHERE f.mentor_id = b.mentor_id AND f.status = 'open') AS mentor_flagged
       FROM bookings b JOIN users u ON u.id = b.mentor_id
      WHERE b.answer_review = 'held' AND b.status = 'answered' ORDER BY b.answer_held_until LIMIT 200`
  );
  return rows.map((r) => ({
    id: r.id, question: r.question, answer: r.answer, answeredAt: r.answered_at, heldUntil: r.answer_held_until,
    flagged: Boolean(r.answer_flagged_at), mentorFlagged: r.mentor_flagged, answerNumber: r.answer_number, of: rules.LIMITS.probationAnswers,
    mentor: { id: r.mentor_id, name: r.mentor_name, email: r.mentor_email, niche: r.mentor_niche }
  }));
}

// What the buyer may see: a held answer is hidden from them until it is released, and a rejected one
// (the buyer was refunded) is never shown.
// (the bank's order and refund ids and its error messages are for admins only)
function forViewer(booking, viewerId) {
  const { refundError, providerOrderId, providerRefundId, ...shown } = booking; // eslint-disable-line no-unused-vars
  const held = booking.answerReview === 'held';
  const hidden = held || booking.answerReview === 'rejected';
  if (hidden && booking.seekerId === viewerId) return { ...shown, answer: null, answerHeld: held };
  return { ...shown, answerHeld: held };
}

// What the asker or the mentor is SENT about a booking, at the edge of the API (the server has used the rest by then): forViewer, without the
// moderation's and the bank's internals, and a mentor does not get the asker's account id. (Admins have their own views.)
const NOT_SENT = ['reminderSentAt', 'answerFlaggedAt', 'answerHeldUntil', 'partialRefundStartedAt', 'refundRequestedAt', 'answerReview'];
function trimForClient(b, viewerId) {
  const out = { ...b };
  for (const k of NOT_SENT) delete out[k];
  if (out.seekerId !== viewerId) delete out.seekerId;
  return out;
}
const toClient = (booking, viewerId) => trimForClient(forViewer(booking, viewerId), viewerId);

module.exports = { shouldHold, holdPatch, release, flag, reject, releaseDue, queue, forViewer, toClient, trimForClient };
