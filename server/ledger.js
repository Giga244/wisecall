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
// ...and the mentor's payout details were not changed in the last PAYOUT_CHANGE_HOLD_HOURS.
const payableSql = (p = 'payouts') => `${p}.status = 'pending' AND ${p}.payable_at <= now()
  AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = ${p}.booking_id AND d.status = 'open')
  AND NOT EXISTS (SELECT 1 FROM users hu WHERE hu.id = ${p}.mentor_id AND hu.payout_hold_until > now())`;
// Owed back: paid, then (partly) refunded, and not settled yet. debt_amount is the part owed after a partial refund.
const debtSql = (p = 'payouts') => `${p}.status = 'paid' AND ${p}.debt_flagged_at IS NOT NULL AND ${p}.debt_settled_batch_id IS NULL`;
const debtAmountSql = (p = 'payouts') => `COALESCE(${p}.debt_amount, ${p}.amount)`;
// Earnings stay on hold for the refund window and the dispute window, whichever is longer.
const holdDays = () => Math.max(config.PAYOUT_HOLD_DAYS, config.DISPUTE_DAYS);

// Called when a mentor answers, or, for a held answer (probation), when it is released to the buyer:
// the hold period always starts when the buyer can see the answer. The unique booking_id makes
// editing an answer harmless.
// The booking row is locked and must still be answered: a refund that won the race (it locks the same row) leaves no payout behind, and
// one that comes after finds this payout and voids it (docs/AUDIT.md #6).
async function onAnswered(booking, from) {
  const payableAt = new Date(new Date(from || booking.answeredAt || Date.now()).getTime() + holdDays() * 86400000);
  await query(
    `INSERT INTO payouts (booking_id, mentor_id, amount, currency, payable_at)
     SELECT b.id, $2, $3, $4, $5 FROM bookings b WHERE b.id = $1 AND b.status = 'answered' FOR UPDATE
     ON CONFLICT (booking_id) DO NOTHING`,
    [booking.id, booking.mentorId, booking.mentorNetAmount, booking.currency, payableAt]
  );
}

// Called (inside the refund transaction) when a booking's refund is requested or confirmed.
async function onRefundRequested(client, booking) {
  const { rows } = await client.query('SELECT * FROM payouts WHERE booking_id = $1 FOR UPDATE', [booking.id]);
  const payout = rows[0];
  if (!payout) return;
  if (payout.status === 'pending') {
    await client.query(`UPDATE payouts SET status = 'void' WHERE id = $1`, [payout.id]);
  } else if (payout.status === 'paid' && (!payout.debt_flagged_at || payout.debt_amount !== null)) {
    // (the whole payout is owed back now, even if a part of it already was after a partial refund)
    await client.query('UPDATE payouts SET debt_flagged_at = COALESCE(debt_flagged_at, now()), debt_amount = NULL WHERE id = $1', [payout.id]);
    console.warn(`[ledger] booking ${booking.id} was refunded after its payout was paid: ${payout.amount} tetri is now owed back by mentor ${payout.mentor_id}.`);
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
  if (payout.status === 'pending') {
    const take = Math.min(share, payout.amount);
    await client.query('UPDATE payouts SET amount = amount - $2, refunded_share = refunded_share + $2 WHERE id = $1', [payout.id, take]);
  } else if (payout.status === 'paid') {
    await client.query(
      `UPDATE payouts SET debt_flagged_at = COALESCE(debt_flagged_at, now()), debt_amount = LEAST(amount, COALESCE(debt_amount, 0) + $2), refunded_share = refunded_share + $2
        WHERE id = $1 AND debt_settled_batch_id IS NULL`, [payout.id, share]);
  }
  return share;
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
       COALESCE(sum(amount) FILTER (WHERE status = 'pending' AND NOT (${payableSql()})), 0)::int AS holding,
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
    const balance = await balanceFor(mentorId, client);
    if (balance.payable === 0 && balance.debt === 0) throw new LedgerError('nothing_to_pay');
    if (balance.net < 0) throw new LedgerError('debt_exceeds_earnings');
    // net === 0 is allowed: earnings and refund debts cancel out and are settled with no transfer.
    if (balance.net !== expectedAmount) throw new LedgerError('amount_changed');

    const { rows: mentorRows } = await client.query('SELECT payout_iban_last4 FROM users WHERE id = $1', [mentorId]);
    const { rows } = await client.query(
      `INSERT INTO payout_batches (mentor_id, amount, currency, reference, iban_last4, paid_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [mentorId, balance.net, config.CURRENCY, reference, mentorRows[0] && mentorRows[0].payout_iban_last4, adminId]
    );
    const batch = rows[0];
    await client.query(
      `UPDATE payouts SET status = 'paid', batch_id = $2 WHERE mentor_id = $1 AND ${payableSql()}`,
      [mentorId, batch.id]
    );
    await client.query(
      `UPDATE payouts SET debt_settled_batch_id = $2
        WHERE mentor_id = $1 AND status = 'paid' AND debt_flagged_at IS NOT NULL AND debt_settled_batch_id IS NULL AND batch_id <> $2`,
      [mentorId, batch.id]
    );
    return batch;
  });
}

module.exports = { onAnswered, onRefundRequested, onPartialRefund, balanceFor, markPaid, LedgerError, payableSql, debtSql, debtAmountSql, holdDays };
