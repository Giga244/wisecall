// "Report a problem with this answer": the asker can open ONE dispute per question, within DISPUTE_DAYS of being able to read the
// answer. While it is open the mentor's payout for that question is held (server/ledger.js payableSql). An admin decides: a full
// refund, a partial refund (split in proportion between the platform fee and the mentor's share), or no refund, always with a note
// that both people see. Every step is in the Inbox and by email.
const { query } = require('./db');
const config = require('./config');
const textSafety = require('./textSafety');
const { getBookingById, getUserById } = require('./models');

const ANSWER_REASONS = ['not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other'];
// The mentor did not reply to the free follow-up question by its deadline (server/inbox.js): reported for LIMITS.followUpDisputeDays from
// then, even after the answer's own DISPUTE_DAYS have ended.
const IGNORED_FOLLOW_UP = 'mentor_ignored_follow_up';
const REASONS = [...ANSWER_REASONS, IGNORED_FOLLOW_UP];
const OUTCOMES = ['full_refund', 'partial_refund', 'rejected'];
const DETAILS_MAX = 1500;

class DisputeError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

// When the asker could first read the answer, and until when they can report a problem with it.
function windowFor(booking) {
  if (booking.status !== 'answered' || booking.answerReview === 'held' || !booking.answeredAt) return null;
  const from = new Date(booking.answerReleasedAt || booking.answeredAt);
  return { from, until: new Date(from.getTime() + config.DISPUTE_DAYS * 86400000) };
}

// { [bookingId]: until } for the bookings whose follow-up the mentor did not reply to in time, while that can still be reported.
async function ignoredFollowUps(ids) {
  if (!ids.length) return {};
  const days = require('./inbox').LIMITS.followUpDisputeDays;
  const { rows } = await query(
    `SELECT booking_id, follow_up_missed_at + make_interval(days => $2) AS until FROM threads
      WHERE booking_id = ANY($1::uuid[]) AND follow_up_missed_at IS NOT NULL AND follow_up_missed_at + make_interval(days => $2) > now()`, [ids, days]);
  return Object.fromEntries(rows.map((r) => [r.booking_id, r.until]));
}
// What the asker may still report about a booking: { until, reasons } (null when nothing), for the dashboard.
function optionsFor(booking, ignoredUntil) {
  const w = windowFor(booking);
  const answerOpen = Boolean(w) && Date.now() < +w.until;
  const followUpOpen = Boolean(w) && Boolean(ignoredUntil);
  if (!answerOpen && !followUpOpen) return null;
  const untils = [answerOpen ? w.until : null, followUpOpen ? new Date(ignoredUntil) : null].filter(Boolean);
  return { until: new Date(Math.max(...untils.map(Number))), reasons: [...(answerOpen ? ANSWER_REASONS : []), ...(followUpOpen ? [IGNORED_FOLLOW_UP] : [])] };
}

const view = (d) => d && ({
  id: d.id, reason: d.reason, details: d.details, status: d.status, outcome: d.outcome, refundAmount: d.refund_amount,
  note: d.resolution_note, createdAt: d.created_at, resolvedAt: d.resolved_at
});

async function open(user, bookingId, { reason, details } = {}) {
  if (!REASONS.includes(reason)) throw new DisputeError('invalid_reason');
  const booking = isUuid(bookingId) ? await getBookingById(bookingId) : null;
  if (!booking) throw new DisputeError('not_found');
  if (booking.seekerId !== user.id) throw new DisputeError('forbidden');
  const w = windowFor(booking);
  if (!w) throw new DisputeError('not_disputable');
  if (reason === IGNORED_FOLLOW_UP) {
    // (only when the mentor really missed the follow-up's deadline, and for followUpDisputeDays after it)
    if (!(await ignoredFollowUps([booking.id]))[booking.id]) throw new DisputeError('window_closed');
  } else if (Date.now() > +w.until) throw new DisputeError('window_closed');
  const text = typeof details === 'string' ? textSafety.cleanText(details).slice(0, DETAILS_MAX) : '';
  const { rows } = await query(
    `INSERT INTO disputes (booking_id, opened_by, reason, details) VALUES ($1, $2, $3, $4) ON CONFLICT (booking_id) DO NOTHING RETURNING *`,
    [booking.id, user.id, reason, text || null]);
  if (!rows[0]) throw new DisputeError('already_reported');
  const inbox = require('./inbox');
  inbox.onDisputeOpened(booking);
  const mentor = await getUserById(booking.mentorId);
  require('./notify').notifyDisputeOpened(mentor, booking);
  require('./notify').notifyAdmins('A problem with an answer was reported',
    `<p>Reason: ${reason}. The mentor's payout for this question is on hold. Decide it in the admin panel, Disputes tab (booking ${booking.id}).</p>`);
  return view(rows[0]);
}

// ---- Live sessions: a ticket holder reports that a session that ended normally was not as described (PART: docs/LIVE-SESSIONS-PLAN.md).
// The same rules: one per ticket, within DISPUTE_DAYS of the end, the session's payout waits, an admin decides with a note.
const TICKET_REASONS = ['not_as_described', 'technical', 'wrong_or_harmful', 'rude', 'other'];
function windowForTicket(ticket, session) {
  if (ticket.status !== 'paid' || session.status !== 'ended' || session.end_kind !== 'normal' || !session.ended_at) return null;
  const from = new Date(session.ended_at);
  return { from, until: new Date(from.getTime() + config.DISPUTE_DAYS * 86400000) };
}
async function openForTicket(user, ticketId, { reason, details } = {}) {
  if (!TICKET_REASONS.includes(reason)) throw new DisputeError('invalid_reason');
  if (!isUuid(ticketId)) throw new DisputeError('not_found');
  const { rows: [t] } = await query(
    `SELECT t.*, s.status AS session_status, s.end_kind, s.ended_at, s.title, s.slug, s.mentor_id FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [ticketId]);
  if (!t) throw new DisputeError('not_found');
  // (whoever attended with it: the buyer, or the person who claimed a gift; any refund goes to the card that paid)
  if ((t.holder_id || t.buyer_id) !== user.id) throw new DisputeError('forbidden');
  const w = windowForTicket(t, { status: t.session_status, end_kind: t.end_kind, ended_at: t.ended_at });
  if (!w) throw new DisputeError('not_disputable');
  if (Date.now() > +w.until) throw new DisputeError('window_closed');
  const text = typeof details === 'string' ? textSafety.cleanText(details).slice(0, DETAILS_MAX) : '';
  const { rows } = await query(
    `INSERT INTO disputes (ticket_id, opened_by, reason, details) VALUES ($1, $2, $3, $4) ON CONFLICT (ticket_id) WHERE ticket_id IS NOT NULL DO NOTHING RETURNING *`,
    [t.id, user.id, reason, text || null]);
  if (!rows[0]) throw new DisputeError('already_reported');
  require('./inbox').systemMessage(t.mentor_id, 'live_disputed', { title: t.title, slug: t.slug });
  require('./notify').notifyAdmins('A problem with a live session was reported',
    `<p>Reason: ${reason}. The mentor's payout for this session is on hold. Decide it in the admin panel, Disputes tab.</p>`);
  return view(rows[0]);
}
async function forTickets(ids) {
  if (!ids.length) return {};
  const { rows } = await query('SELECT * FROM disputes WHERE ticket_id = ANY($1::uuid[])', [ids]);
  return Object.fromEntries(rows.map((d) => [d.ticket_id, view(d)]));
}

// { [bookingId]: dispute } for the dashboard.
async function forBookings(ids) {
  if (!ids.length) return {};
  const { rows } = await query('SELECT * FROM disputes WHERE booking_id = ANY($1::uuid[])', [ids]);
  return Object.fromEntries(rows.map((d) => [d.booking_id, view(d)]));
}

async function listForAdmin({ status = 'open' } = {}) {
  const { rows } = await query(
    `SELECT d.*, b.question, b.answer, b.amount, b.mentor_net_amount, b.platform_fee_amount, b.status AS booking_status, b.refunded_amount,
            a.name AS asker_name, a.email AS asker_email, m.name AS mentor_name, m.email AS mentor_email, r.email AS resolved_by_email
       FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN users a ON a.id = b.seeker_id JOIN users m ON m.id = b.mentor_id
       LEFT JOIN users r ON r.id = d.resolved_by
      WHERE d.status = $1 ORDER BY d.created_at LIMIT 200`, [status]);
  const questions = rows.map((d) => ({
    ...view(d), kind: 'question', bookingId: d.booking_id, question: d.question, answer: d.answer, amount: d.amount, mentorNet: d.mentor_net_amount,
    fee: d.platform_fee_amount, bookingStatus: d.booking_status, asker: { name: d.asker_name, email: d.asker_email },
    mentor: { name: d.mentor_name, email: d.mentor_email }, resolvedBy: d.resolved_by_email
  }));
  // (and the live-session tickets: the session instead of a question and answer)
  const { rows: live } = await query(
    `SELECT d.*, t.price, t.fee, t.net, t.status AS ticket_status, s.title, s.slug, a.name AS asker_name, a.email AS asker_email,
            m.name AS mentor_name, m.email AS mentor_email, r.email AS resolved_by_email
       FROM disputes d JOIN live_tickets t ON t.id = d.ticket_id JOIN live_sessions s ON s.id = t.session_id
       LEFT JOIN users a ON a.id = COALESCE(t.holder_id, t.buyer_id) JOIN users m ON m.id = s.mentor_id LEFT JOIN users r ON r.id = d.resolved_by
      WHERE d.status = $1 ORDER BY d.created_at LIMIT 200`, [status]);
  const tickets = live.map((d) => ({
    ...view(d), kind: 'ticket', ticketId: d.ticket_id, session: { title: d.title, slug: d.slug }, amount: d.price, mentorNet: d.net, fee: d.fee,
    ticketStatus: d.ticket_status, asker: { name: d.asker_name, email: d.asker_email }, mentor: { name: d.mentor_name, email: d.mentor_email }, resolvedBy: d.resolved_by_email
  }));
  return [...questions, ...tickets].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
}

// An admin decides. The dispute is claimed first (open -> resolved in one statement), so it is decided once; if the bank refuses the
// refund, the claim is undone and the admin can try again.
async function resolve(admin, disputeId, { outcome, amount, note } = {}) {
  if (!OUTCOMES.includes(outcome)) throw new DisputeError('invalid_outcome');
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length < 5) throw new DisputeError('note_required');
  if (!isUuid(disputeId)) throw new DisputeError('not_found');
  const found = (await query('SELECT * FROM disputes WHERE id = $1', [disputeId])).rows[0];
  if (!found) throw new DisputeError('not_found');
  if (found.ticket_id) return resolveTicket(admin, found, { outcome, amount, note: text });
  const booking = await getBookingById(found.booking_id);
  if (outcome === 'partial_refund' && !(Number.isInteger(amount) && amount >= 1 && amount < booking.amount)) throw new DisputeError('invalid_amount');
  const { rows } = await query(
    `UPDATE disputes SET status = 'resolved', outcome = $2, refund_amount = $3, resolution_note = $4, resolved_by = $5, resolved_at = now()
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [found.id, outcome, outcome === 'partial_refund' ? amount : (outcome === 'full_refund' ? booking.amount : null), text.slice(0, 1000), admin.id]);
  if (!rows[0]) throw new DisputeError('already_resolved');
  const payments = require('./payments');
  try {
    if (outcome === 'full_refund') await payments.refundBooking(booking.id, 'dispute');
    if (outcome === 'partial_refund') await payments.partialRefund(booking.id, amount, 'dispute');
  } catch (e) {
    // The bank's answer to the partial refund was lost: the decision stands, the refund waits for the bank's confirmation (the sweep
    // asks again), and the people are told once it is confirmed (refundConfirmed), or the dispute opens again (refundNotMade).
    if (e.code === 'refund_unconfirmed' && outcome === 'partial_refund') {
      require('./notify').notifyAdmins('A partial refund waits for the bank', `<p>The bank's answer to the partial refund for booking ${booking.id} was lost. Nothing will be sent again: the refund is recorded as soon as the bank shows it, or the dispute opens again if it shows nothing returned within 15 minutes.</p>`);
      return { ...view(rows[0]), refundPending: true };
    }
    await query(`UPDATE disputes SET status = 'open', outcome = NULL, refund_amount = NULL, resolution_note = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = $1`, [found.id]);
    throw new DisputeError(e.code === 'refund_failed' ? 'refund_failed' : (e.code || 'refund_failed'), { detail: e.message });
  }
  return announce(view(rows[0]), booking.id);
}

// The asker and the mentor are told the decision (the Inbox and an email).
async function announce(d, bookingId) {
  const fresh = await getBookingById(bookingId);
  require('./inbox').onDisputeResolved(fresh, d);
  const [asker, mentor] = await Promise.all([getUserById(fresh.seekerId), getUserById(fresh.mentorId)]);
  require('./notify').notifyDisputeResolved(asker, mentor, fresh, d);
  return d;
}

// The sweep (server/payments.js settleUnconfirmedRefunds): the bank now shows the partial refund was made, so the decision is announced;
// or it shows nothing was returned, so the decision is undone and the admin decides again.
async function refundConfirmed(bookingId) {
  const { rows: [d] } = await query(`SELECT * FROM disputes WHERE booking_id = $1 AND status = 'resolved' AND outcome = 'partial_refund' ORDER BY resolved_at DESC LIMIT 1`, [bookingId]);
  if (d) await announce(view(d), bookingId);
}
async function refundNotMade(bookingId) {
  const { rows: [d] } = await query(
    `UPDATE disputes SET status = 'open', outcome = NULL, refund_amount = NULL, resolution_note = NULL, resolved_by = NULL, resolved_at = NULL
      WHERE id = (SELECT id FROM disputes WHERE booking_id = $1 AND status = 'resolved' AND outcome = 'partial_refund' ORDER BY resolved_at DESC LIMIT 1) RETURNING id`, [bookingId]);
  if (d) require('./notify').notifyAdmins('A partial refund was not made', `<p>The bank shows nothing returned for the partial refund of booking ${bookingId}. The dispute is open again: decide it again.</p>`);
}

// A live-session ticket's dispute: the same decision, through the ticket's own refunds (server/live/tickets.js).
async function resolveTicket(admin, found, { outcome, amount, note }) {
  const { rows: [t] } = await query(`SELECT t.*, s.title, s.slug, s.mentor_id FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [found.ticket_id]);
  if (outcome === 'partial_refund' && !(Number.isInteger(amount) && amount >= 1 && amount < t.price)) throw new DisputeError('invalid_amount');
  const { rows } = await query(
    `UPDATE disputes SET status = 'resolved', outcome = $2, refund_amount = $3, resolution_note = $4, resolved_by = $5, resolved_at = now()
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [found.id, outcome, outcome === 'partial_refund' ? amount : (outcome === 'full_refund' ? t.price : null), note.slice(0, 1000), admin.id]);
  if (!rows[0]) throw new DisputeError('already_resolved');
  const tickets = require('./live/tickets');
  try {
    if (outcome === 'full_refund') await tickets.refund(t.id, 'dispute');
    if (outcome === 'partial_refund') await tickets.partialRefund(t.id, amount, 'dispute');
  } catch (e) {
    if (e.code === 'refund_unconfirmed' && outcome === 'partial_refund') { // (as for a question: the sweep settles it, ticketRefundSettled)
      require('./notify').notifyAdmins('A partial refund waits for the bank', `<p>The bank's answer to the partial refund for live ticket ${t.id} was lost. Nothing will be sent again until the bank shows what it returned.</p>`);
      return { ...view(rows[0]), refundPending: true };
    }
    await query(`UPDATE disputes SET status = 'open', outcome = NULL, refund_amount = NULL, resolution_note = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = $1`, [found.id]);
    throw new DisputeError('refund_failed', { detail: e.message });
  }
  return announceTicket(view(rows[0]), t, outcome);
}

// The holder, the buyer and the mentor are told a ticket dispute's decision.
function announceTicket(d, t, outcome) {
  const inbox = require('./inbox');
  for (const uid of [...new Set([t.holder_id, t.buyer_id, t.mentor_id].filter(Boolean))]) {
    inbox.systemMessage(uid, 'live_dispute_resolved', { title: t.title, slug: t.slug, outcome, amount: d.refundAmount, note: d.note });
  }
  return d;
}

// The sweep (server/live/tickets.js settleUnconfirmedPartials): the bank showed the ticket's partial refund was made (announce the
// decision), or that nothing went back (the dispute opens again for the admin).
async function ticketRefundSettled(ticketId, made) {
  const { rows: [d] } = await query(`SELECT * FROM disputes WHERE ticket_id = $1 AND status = 'resolved' AND outcome = 'partial_refund' ORDER BY resolved_at DESC LIMIT 1`, [ticketId]);
  if (!d) return;
  if (made) {
    const { rows: [t] } = await query(`SELECT t.*, s.title, s.slug, s.mentor_id FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1`, [ticketId]);
    announceTicket(view(d), t, 'partial_refund');
    return;
  }
  await query(`UPDATE disputes SET status = 'open', outcome = NULL, refund_amount = NULL, resolution_note = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = $1`, [d.id]);
  require('./notify').notifyAdmins('A partial refund was not made', `<p>The bank shows nothing returned for the partial refund of live ticket ${ticketId}. The dispute is open again: decide it again.</p>`);
}

module.exports = { REASONS, ANSWER_REASONS, TICKET_REASONS, OUTCOMES, DisputeError, windowFor, windowForTicket, ignoredFollowUps, optionsFor, open, openForTicket, forBookings, forTickets, listForAdmin, resolve, refundConfirmed, refundNotMade, ticketRefundSettled };
