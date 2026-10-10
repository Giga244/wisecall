#!/usr/bin/env node
// Money and seat invariants, checked with SQL after every load test. Each violation is printed with the rows that break it; the exit
// code is 1 when anything is violated (a 🔴 finding in docs/LAUNCH-REHEARSAL.md).
//   DATABASE_URL=... node scripts/rehearsal/invariants.js [--json]
// Amounts are tetri. The fake bank is the only provider in a rehearsal database.
const { sql, close } = require('./lib');

const CHECKS = [
  // ---- seats ----
  ['no oversold session (paid + being refunded <= seats)', `
    SELECT s.slug, s.max_seats, count(t.*) FILTER (WHERE t.status IN ('paid', 'refund_pending'))::int AS sold
      FROM live_sessions s LEFT JOIN live_tickets t ON t.session_id = s.id GROUP BY s.id HAVING count(t.*) FILTER (WHERE t.status IN ('paid', 'refund_pending')) > s.max_seats`],
  ['no oversold session counting live holds (paid + refund_pending + unexpired holds <= seats)', `
    SELECT s.slug, s.max_seats, count(t.*)::int AS taken FROM live_sessions s JOIN live_tickets t ON t.session_id = s.id
     WHERE t.status IN ('paid', 'refund_pending') OR (t.status = 'held' AND t.hold_until > now()) GROUP BY s.id HAVING count(t.*) > s.max_seats`],
  ['one active ticket per attendee per session', `
    SELECT session_id, holder_id, count(*)::int AS n FROM live_tickets WHERE holder_id IS NOT NULL AND status IN ('held', 'paid', 'refund_pending')
     GROUP BY session_id, holder_id HAVING count(*) > 1`],
  ['no orphan seat hold (a hold past its time + 2 sweep periods, or a hold that never got a bank order after 2 minutes)', `
    SELECT id, session_id, hold_until, provider_order_id FROM live_tickets
     WHERE status = 'held' AND series_order_id IS NULL AND (hold_until < now() - interval '30 minutes' OR (provider_order_id IS NULL AND created_at < now() - interval '2 minutes'))`],
  // ---- payments ----
  ['no booking paid twice (at most one payment receipt per booking)', `
    SELECT booking_id, count(*)::int AS n FROM receipts WHERE kind = 'payment' AND booking_id IS NOT NULL GROUP BY booking_id HAVING count(*) > 1`],
  ['no ticket paid twice (at most one payment receipt per ticket)', `
    SELECT ticket_id, count(*)::int AS n FROM receipts WHERE kind = 'payment' AND ticket_id IS NOT NULL GROUP BY ticket_id HAVING count(*) > 1`],
  ['no bank order used by two bookings or tickets', `
    SELECT provider_order_id, count(*)::int AS n FROM (SELECT provider_order_id FROM bookings WHERE provider_order_id IS NOT NULL
      UNION ALL SELECT provider_order_id FROM live_tickets WHERE provider_order_id IS NOT NULL) o GROUP BY 1 HAVING count(*) > 1`],
  ['every paid booking has exactly one payment receipt', `
    SELECT b.id, b.status FROM bookings b WHERE b.paid_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'payment')`],
  ['every paid ticket has a payment receipt', `
    SELECT t.id, t.status FROM live_tickets t WHERE t.paid_at IS NOT NULL AND t.series_order_id IS NULL AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.ticket_id = t.id AND r.kind = 'payment')`],
  ['every refunded booking has a refund receipt, and at most one', `
    SELECT b.id, (SELECT count(*) FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund')::int AS n FROM bookings b
     WHERE (b.status = 'refunded' AND (SELECT count(*) FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund') <> 1)
        OR (b.status <> 'refunded' AND b.refunded_amount IS NULL AND EXISTS (SELECT 1 FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund'))`],
  // ---- payouts ----
  ['no live payout for a refunded booking (pending or paid without being flagged as owed back)', `
    SELECT p.id, p.status, b.status AS booking_status FROM payouts p JOIN bookings b ON b.id = p.booking_id
     WHERE b.status IN ('refunded', 'refund_pending') AND (p.status = 'pending' OR (p.status = 'paid' AND p.debt_flagged_at IS NULL))`],
  ['no payout for a booking that was never answered', `
    SELECT p.id, b.status FROM payouts p JOIN bookings b ON b.id = p.booking_id WHERE b.answered_at IS NULL`],
  ['every answered (released, not refunded) booking has its payout', `
    SELECT b.id FROM bookings b WHERE b.status = 'answered' AND b.answer_review IN ('none', 'released')
       AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.booking_id = b.id)`],
  ['a booking payout + what came off it = the mentor share', `
    SELECT b.id, b.mentor_net_amount, p.amount, p.refunded_share FROM payouts p JOIN bookings b ON b.id = p.booking_id
     WHERE p.status <> 'void' AND p.amount + p.refunded_share <> b.mentor_net_amount`],
  ['a live payout = the net of its paid tickets', `
    SELECT p.id, p.amount, (SELECT COALESCE(sum(t.net), 0) FROM live_tickets t WHERE t.session_id = p.live_session_id AND t.status = 'paid')::int AS net
      FROM payouts p WHERE p.live_session_id IS NOT NULL AND p.status = 'pending'
       AND p.amount <> (SELECT COALESCE(sum(t.net), 0) FROM live_tickets t WHERE t.session_id = p.live_session_id AND t.status = 'paid')`],
  ['fee + mentor share = price on every booking', `SELECT id FROM bookings WHERE platform_fee_amount + mentor_net_amount <> amount`]
];

// The global equation: money in - money out - the platform's fees = what mentors are owed or were paid + what is still held for them.
async function ledger() {
  const [r] = await sql(`
    WITH b AS (SELECT * FROM bookings WHERE paid_at IS NOT NULL),
    t AS (SELECT * FROM live_tickets WHERE paid_at IS NOT NULL AND series_order_id IS NULL)
    SELECT
      (SELECT COALESCE(sum(amount), 0) FROM receipts WHERE kind = 'payment' AND (booking_id IS NOT NULL OR ticket_id IS NOT NULL))::bigint AS payments,
      (SELECT COALESCE(sum(amount), 0) FROM receipts WHERE kind = 'refund' AND (booking_id IS NOT NULL OR ticket_id IS NOT NULL))::bigint AS refunds,
      -- the platform keeps its fee on what was not refunded (a partial refund returns the same proportion of the fee)
      ((SELECT COALESCE(sum(platform_fee_amount - CASE WHEN status = 'refunded' THEN platform_fee_amount ELSE COALESCE(round(refunded_amount::numeric * platform_fee_amount / amount), 0) END), 0) FROM b)
       + (SELECT COALESCE(sum(fee - CASE WHEN status = 'refunded' THEN fee ELSE COALESCE(round(refunded_amount::numeric * fee / price), 0) END), 0) FROM t))::bigint AS fees,
      (SELECT COALESCE(sum(amount), 0) FROM payouts WHERE status <> 'void' AND (booking_id IS NOT NULL OR live_session_id IS NOT NULL))::bigint AS payouts,
      -- held for mentors, not in a payout yet: paid questions not answered yet (or answers still in review), and paid tickets of sessions without a payout
      ((SELECT COALESCE(sum(mentor_net_amount), 0) FROM b WHERE status IN ('paid', 'answered') AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.booking_id = b.id))
       + (SELECT COALESCE(sum(net), 0) FROM t WHERE status = 'paid' AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.live_session_id = t.session_id)))::bigint AS held,
      -- a refund being processed: the money is still in the platform's account
      ((SELECT COALESCE(sum(amount), 0) FROM b WHERE status = 'refund_pending') + (SELECT COALESCE(sum(price), 0) FROM t WHERE status = 'refund_pending'))::bigint AS refunding`);
  const left = Number(r.payments) - Number(r.refunds) - Number(r.fees);
  const right = Number(r.payouts) + Number(r.held) + Number(r.refunding);
  // (a paid payout later refunded is owed back by the mentor: the debt is the difference, so it is reported, not counted as a violation)
  const [debt] = await sql(`SELECT COALESCE(sum(COALESCE(debt_amount, amount)), 0)::bigint AS debt FROM payouts WHERE status = 'paid' AND debt_flagged_at IS NOT NULL AND debt_settled_batch_id IS NULL`);
  return { ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])), left, right, debtOwedBack: Number(debt.debt), diff: left - right };
}

async function main() {
  const out = { violations: [], ledger: null };
  for (const [name, q] of CHECKS) {
    const rows = await sql(q);
    if (rows.length) out.violations.push({ check: name, count: rows.length, sample: rows.slice(0, 5) });
  }
  out.ledger = await ledger();
  // (rounding: a partial refund rounds the fee part to the tetri, so allow 1 tetri per partially refunded row)
  const [{ n: partial }] = await sql(`SELECT ((SELECT count(*) FROM bookings WHERE refunded_amount IS NOT NULL) + (SELECT count(*) FROM live_tickets WHERE refunded_amount IS NOT NULL))::int AS n`);
  if (Math.abs(out.ledger.diff) > partial) out.violations.push({ check: 'ledger: payments - refunds - fees = payouts + held + refunding', count: 1, sample: [out.ledger] });
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(out.violations.length ? `🔴 ${out.violations.length} invariant(s) violated:` : `✅ all ${CHECKS.length + 1} invariants hold`);
    out.violations.forEach((v) => console.log(`  - ${v.check}: ${v.count} row(s), e.g. ${JSON.stringify(v.sample[0])}`));
    console.log(`  ledger: payments ${out.ledger.payments} - refunds ${out.ledger.refunds} - fees ${out.ledger.fees} = ${out.ledger.left}; payouts ${out.ledger.payouts} + held ${out.ledger.held} + refunding ${out.ledger.refunding} = ${out.ledger.right} (diff ${out.ledger.diff}; owed back by mentors ${out.ledger.debtOwedBack})`);
  }
  await close();
  process.exit(out.violations.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
