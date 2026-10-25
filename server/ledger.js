// The payout ledger: what each mentor has earned and what has been paid to them.
//
//   answered booking  -> one "pending" payout for the mentor's share (price minus the platform fee),
//                        payable PAYOUT_HOLD_DAYS after the answer (the buyer's refund window)
//   admin pays mentor -> the payable rows become "paid" inside one batch (one bank transfer)
//   booking refunded  -> a pending payout is voided; one that was already paid becomes a debt the
//                        mentor owes back, deducted from their next payout
//
// Amounts are tetri (1/100 lari). Every function is safe to call twice.
const { query, tx } = require('./db');
const config = require('./config');

// ---- The rules, as SQL on a payouts row named `p` (one definition, used everywhere money is summed) ---------------------------
// Payable: earned, the hold has passed, and no dispute about its booking is open (a dispute holds the money until an admin decides).
// ...and the mentor's payout details were not changed in the last PAYOUT_CHANGE_HOLD_HOURS, and it is not in a withdrawal request.
// (a live session's payout waits the same way while one of its tickets is disputed or the session has an open report)
// ...and no follow-up question is waiting for the mentor's reply: until the reply, or its deadline (server/inbox.js FOLLOW_UP_REPLY_DAYS).
const payableSql = (p = 'payouts') => `${p}.status = 'pending' AND ${p}.payable_at <= now() AND ${p}.batch_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = ${p}.booking_id AND d.status = 'open')
  AND NOT EXISTS (SELECT 1 FROM bookings pb WHERE pb.id = ${p}.booking_id AND pb.partial_refund_amount IS NOT NULL)
  AND (${p}.live_session_id IS NULL OR (
    NOT EXISTS (SELECT 1 FROM disputes d JOIN live_tickets lt ON lt.id = d.ticket_id WHERE lt.session_id = ${p}.live_session_id AND d.status = 'open')
    AND NOT EXISTS (SELECT 1 FROM live_reports lr WHERE lr.session_id = ${p}.live_session_id AND lr.status = 'open')))
  AND NOT EXISTS (SELECT 1 FROM users hu WHERE hu.id = ${p}.mentor_id AND hu.payout_hold_until > now())
  AND NOT EXISTS (SELECT 1 FROM threads ft WHERE ft.booking_id = ${p}.booking_id AND ft.follow_up_due_at > now() AND ft.follow_up_replied_at IS NULL)`;
// On hold: earned, not payable yet, not in a request. Requested: in an open withdrawal request (server/withdrawals.js).
const holdingSql = (p = 'payouts') => `${p}.status = 'pending' AND ${p}.batch_id IS NULL AND NOT (${payableSql(p)})`;
const requestedSql = (p = 'payouts') => `${p}.status = 'pending' AND ${p}.batch_id IS NOT NULL`;
// Owed back: paid, then (partly) refunded, and not all of it settled yet. debt_amount is the whole debt (null: the whole amount);
// debt_settled_amount the part already taken off withdrawals (docs/security-audit M4): what is owed is the difference, so a full refund
// after a settled partial one still owes the rest.
const debtSql = (p = 'payouts') => `${p}.status = 'paid' AND ${p}.debt_flagged_at IS NOT NULL AND COALESCE(${p}.debt_amount, ${p}.amount) > ${p}.debt_settled_amount`;
const owedSql = (p = 'payouts') => `(COALESCE(${p}.debt_amount, ${p}.amount) - ${p}.debt_settled_amount)`;
const debtAmountSql = owedSql; // (what is still owed: every sum of debts reads this)
// Earnings stay on hold for the refund window and the dispute window, whichever is longer.
const holdDays = () => Math.max(config.PAYOUT_HOLD_DAYS, config.DISPUTE_DAYS);

// Called when a mentor answers, or, for a held answer (probation), when it is released to the buyer:
// the hold period always starts when the buyer can see the answer. The unique booking_id makes
// editing an answer harmless.
// The booking row is locked and must still be answered: a refund that won the race (it locks the same row) leaves no payout behind, and
// one that comes after finds this payout and voids it (docs/AUDIT.md #6).
async function onAnswered(booking, from) {
  if (!(booking.mentorNetAmount > 0)) return; // (a free question: nothing is earned, so no payout row)
  const payableAt = new Date(new Date(from || booking.answeredAt || Date.now()).getTime() + holdDays() * 86400000);
  await query(
    `INSERT INTO payouts (booking_id, mentor_id, amount, currency, payable_at)
     SELECT b.id, $2, $3, $4, $5 FROM bookings b WHERE b.id = $1 AND b.status = 'answered' FOR UPDATE
     ON CONFLICT (booking_id) DO NOTHING`,
    [booking.id, booking.mentorId, booking.mentorNetAmount, booking.currency, payableAt]
  );
}

// Is this payout in a withdrawal that is being sent through the bank, or was paid? Its money is leaving (or left): a refund is then owed
// back like one after a payout, never taken off the payout itself (docs/security-audit M3). The request is locked: one being sent waits.
async function leaving(client, payout) {
  if (!payout.batch_id) return false;
  const { rows: [b] } = await client.query('SELECT status FROM payout_batches WHERE id = $1 FOR UPDATE', [payout.batch_id]);
  return Boolean(b) && (b.status === 'sending' || b.status === 'paid');
}
// What a payout's debt was before this refund (none; or debt_amount, or the whole amount when that is null).
const DEBT_BEFORE = 'COALESCE(debt_amount, CASE WHEN debt_flagged_at IS NULL THEN 0 ELSE amount END)';

// Called (inside the refund transaction) when a booking's refund is requested or confirmed.
async function onRefundRequested(client, booking) {
  const { rows } = await client.query('SELECT * FROM payouts WHERE booking_id = $1 FOR UPDATE', [booking.id]);
  const payout = rows[0];
  if (!payout) return;
  if (payout.status === 'pending' && !(await leaving(client, payout))) {
    await client.query(`UPDATE payouts SET status = 'void' WHERE id = $1`, [payout.id]);
    // (in a withdrawal request: the request's amount is computed again, or it is closed when nothing is left)
    if (payout.batch_id) await require('./withdrawals').recompute(client, payout.batch_id);
  } else if ((payout.status === 'paid' || payout.status === 'pending') && (!payout.debt_flagged_at || payout.debt_amount !== null)) {
    // (the whole payout is owed back now, even if a part of it already was after a partial refund: what was settled of that comes off,
    // debt_settled_amount. A payout being sent becomes "paid" with this debt on it, or, when the bank refuses it, is voided.)
    await client.query('UPDATE payouts SET debt_flagged_at = COALESCE(debt_flagged_at, now()), debt_amount = NULL WHERE id = $1', [payout.id]);
    console.warn(`[ledger] booking ${booking.id} was refunded after its payout was ${payout.status === 'paid' ? 'paid' : 'sent'}: ${payout.amount - (payout.debt_settled_amount || 0)} tetri is now owed back by mentor ${payout.mentor_id}.`);
  }
}

// A partial refund of `refundAmount` (tetri): the mentor's part of it is in proportion to their share of the price, rounded to the
// nearest tetri (the platform keeps the same proportion of its fee). Taken off a payout not paid yet, or owed back when it was paid.
// Returns the mentor's part. Runs inside the refund transaction.
async function onPartialRefund(client, booking, refundAmount) {
  const share = Math.round((refundAmount * booking.mentorNetAmount) / booking.amount);
  const { rows } = await client.query('SELECT * FROM payouts WHERE booking_id = $1 FOR UPDATE', [booking.id]);
  const payout = rows[0];
  if (!payout || share <= 0) return share;
  if (payout.status === 'pending' && !(await leaving(client, payout))) {
    const take = Math.min(share, payout.amount);
    await client.query('UPDATE payouts SET amount = amount - $2, refunded_share = refunded_share + $2 WHERE id = $1', [payout.id, take]);
    if (payout.batch_id) await require('./withdrawals').recompute(client, payout.batch_id);
  } else if (payout.status === 'paid' || payout.status === 'pending') {
    // (owed back, on top of any debt it already had, settled or not)
    await client.query(
      `UPDATE payouts SET debt_flagged_at = COALESCE(debt_flagged_at, now()), debt_amount = LEAST(amount, ${DEBT_BEFORE} + $2), refunded_share = refunded_share + $2
        WHERE id = $1`, [payout.id, share]);
  }
  return share;
}

// A live session ended normally (server/live/settle.js): ONE pending payout for the mentor, the sum of what each paid ticket leaves
// after the fee (each ticket keeps its own price, early-bird or normal), payable after the same hold as an answer. One per session.
async function onLiveEnded(client, session) {
  const payableAt = new Date(Date.now() + holdDays() * 86400000);
  await client.query(
    `INSERT INTO payouts (live_session_id, mentor_id, amount, currency, payable_at)
     SELECT $1, $2, sum(t.net), 'gel', $3 FROM live_tickets t WHERE t.session_id = $1 AND t.status = 'paid' HAVING sum(t.net) > 0
     ON CONFLICT (live_session_id) DO NOTHING`, [session.id, session.mentor_id, payableAt]);
}

// A ticket of a session whose payout is already recorded was refunded (in full, or partly after a dispute): the mentor's `part` comes off
// the payout while it is pending (a payout that reaches 0 is void), or is owed back once it was paid. Inside the refund transaction.
async function onTicketRefunded(client, ticket, part) {
  const { rows } = await client.query('SELECT * FROM payouts WHERE live_session_id = $1 FOR UPDATE', [ticket.session_id]);
  return takeBack(client, rows[0], part);
}

// A replay pass (server/live/replays.js): the mentor's share is a payout of its own, payable after the usual hold; a refund takes it back
// the same way as a ticket's.
async function onReplayPaid(client, purchase, mentorId) {
  const payableAt = new Date(Date.now() + holdDays() * 86400000);
  await client.query(
    `INSERT INTO payouts (replay_purchase_id, mentor_id, amount, currency, payable_at) SELECT $1, $2, $3, 'gel', $4 WHERE $3 > 0
     ON CONFLICT (replay_purchase_id) WHERE replay_purchase_id IS NOT NULL DO NOTHING`, [purchase.id, mentorId, purchase.net, payableAt]);
}
async function onReplayRefunded(client, purchase) {
  const { rows } = await client.query('SELECT * FROM payouts WHERE replay_purchase_id = $1 FOR UPDATE', [purchase.id]);
  return takeBack(client, rows[0], purchase.net);
}

async function takeBack(client, payout, part) {
  if (!payout || !(part > 0)) return 0;
  if (payout.status === 'pending' && !(await leaving(client, payout))) {
    const take = Math.min(part, payout.amount);
    await client.query(
      `UPDATE payouts SET amount = amount - $2, refunded_share = refunded_share + $2, status = CASE WHEN amount - $2 <= 0 THEN 'void' ELSE status END WHERE id = $1`,
      [payout.id, take]);
    if (payout.batch_id) await require('./withdrawals').recompute(client, payout.batch_id);
    return take;
  }
  if (payout.status === 'paid' || payout.status === 'pending') {
    await client.query(
      `UPDATE payouts SET debt_flagged_at = COALESCE(debt_flagged_at, now()), debt_amount = LEAST(amount, ${DEBT_BEFORE} + $2), refunded_share = refunded_share + $2
        WHERE id = $1`, [payout.id, part]);
  }
  return part;
}

// What one mentor is owed right now, split into the parts an admin needs to see.
//   payable   pending earnings whose hold period has passed
//   holding   pending earnings still inside the hold period
//   debt      paid earnings whose booking was later refunded (owed back)
//   net       payable minus debt: what a transfer today would be
async function balanceFor(mentorId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT
       COALESCE(sum(amount) FILTER (WHERE ${payableSql()}), 0)::int AS payable,
       COALESCE(sum(amount) FILTER (WHERE ${holdingSql()}), 0)::int AS holding,
       COALESCE(sum(${debtAmountSql()}) FILTER (WHERE ${debtSql()}), 0)::int AS debt,
       COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND debt_flagged_at IS NULL), 0)::int AS paid,
       count(*) FILTER (WHERE ${payableSql()})::int AS payable_count
       FROM payouts WHERE mentor_id = $1`, [mentorId]
  );
  const b = rows[0];
  return { payable: b.payable, holding: b.holding, debt: b.debt, paid: b.paid, payableCount: b.payable_count, net: b.payable - b.debt };
}

class LedgerError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// An admin has sent the mentor a bank transfer. `expectedAmount` is what the admin saw on screen;
// if the balance changed since (a new payable row, a refund) nothing is recorded, so the ledger can
// never disagree with the transfer that was actually made.
async function markPaid({ mentorId, expectedAmount, reference, adminId }) {
  return tx(async (client) => {
    // Lock the mentor's payout rows so two admins cannot record the same transfer twice.
    await client.query('SELECT id FROM payouts WHERE mentor_id = $1 FOR UPDATE', [mentorId]);
    // (a mentor who asked for their money is paid through their request: server/withdrawals.js)
    const { rows: open } = await client.query(`SELECT 1 FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentorId]);
    if (open.length) throw new LedgerError('request_open');
    // (payout details changed in the last PAYOUT_CHANGE_HOLD_HOURS: nothing is paid until the hold ends)
    const { rows: [held] } = await client.query('SELECT payout_hold_until > now() AS held FROM users WHERE id = $1', [mentorId]);
    if (held && held.held) throw new LedgerError('payout_hold');
    const balance = await balanceFor(mentorId, client);
    if (balance.payable === 0 && balance.debt === 0) throw new LedgerError('nothing_to_pay');
    if (balance.net < 0) throw new LedgerError('debt_exceeds_earnings');
    // net === 0 is allowed: earnings and refund debts cancel out and are settled with no transfer.
    if (balance.net !== expectedAmount) throw new LedgerError('amount_changed');

    const { rows: mentorRows } = await client.query('SELECT payout_iban_last4 FROM users WHERE id = $1', [mentorId]);
    const { rows } = await client.query(
      `INSERT INTO payout_batches (mentor_id, amount, currency, reference, iban_last4, paid_by, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'paid', now()) RETURNING *`,
      [mentorId, balance.net, config.CURRENCY, reference, mentorRows[0] && mentorRows[0].payout_iban_last4, adminId]
    );
    const batch = rows[0];
    await client.query(
      `UPDATE payouts SET status = 'paid', batch_id = $2 WHERE mentor_id = $1 AND ${payableSql()}`,
      [mentorId, batch.id]
    );
    // (the debts this transfer took off: settled, each by what was still owed)
    await client.query(
      `UPDATE payouts SET debt_batch_amount = ${owedSql()}, debt_settled_amount = COALESCE(debt_amount, amount), debt_settled_batch_id = $2
        WHERE mentor_id = $1 AND ${debtSql()} AND batch_id <> $2`,
      [mentorId, batch.id]
    );
    return batch;
  });
}

module.exports = { onAnswered, onRefundRequested, onPartialRefund, onLiveEnded, onTicketRefunded, onReplayPaid, onReplayRefunded, balanceFor, markPaid, LedgerError, payableSql, holdingSql, requestedSql, debtSql, debtAmountSql, owedSql, holdDays };
