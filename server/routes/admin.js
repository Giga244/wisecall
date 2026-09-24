const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { meProfile, asyncHandler } = require('../util');
const { userFromRow, bookingFromRow, getUserById, updateUser, mentorStatsFor } = require('../models');
const config = require('../config');
const payments = require('../payments');
const notify = require('../notify');
const verificationSteps = require('../verification/steps');
const ledger = require('../ledger');
const { decrypt } = require('../cryptoBox');
const { pretty } = require('../iban');

const router = express.Router();

router.get('/mentors', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = `role IN ('mentor', 'both')`;
  if (status) { params.push(String(status)); where += ` AND verification_status = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  const mentors = rows.map(userFromRow);
  const ids = mentors.map((m) => m.id);
  const [stats, stepMap] = await Promise.all([mentorStatsFor(ids), verificationSteps.loadStepsFor(ids)]);
  res.json({
    mentors: mentors.map((m) => {
      const v = verificationSteps.describe(m, stepMap[m.id]);
      return { ...meProfile(m), ...stats[m.id], verification: { level: v.level, ready: v.ready, missing: v.missing } };
    })
  });
}));
const BOOKING_STATUSES = ['pending_payment', 'paid', 'answered', 'refund_pending', 'refunded', 'expired'];

// All bookings, newest first, with both people's names so support can see what happened.
router.get('/bookings', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = 'TRUE';
  if (status) {
    if (!BOOKING_STATUSES.includes(String(status))) return res.status(400).json({ error: 'invalid_status' });
    params.push(String(status)); where = `b.status = $1`;
  }
  const { rows } = await query(
    `SELECT b.*, s.name AS seeker_name, s.email AS seeker_email, m.name AS mentor_name, m.email AS mentor_email,
            p.status AS payout_status, p.debt_flagged_at AS payout_debt_flagged_at
       FROM bookings b JOIN users s ON s.id = b.seeker_id JOIN users m ON m.id = b.mentor_id
       LEFT JOIN payouts p ON p.booking_id = b.id
      WHERE ${where} ORDER BY b.created_at DESC LIMIT 200`, params);
  res.json({
    bookings: rows.map((r) => ({
      ...bookingFromRow(r),
      seekerName: r.seeker_name, seekerEmail: r.seeker_email, mentorName: r.mentor_name, mentorEmail: r.mentor_email,
      payoutStatus: r.payout_status || null, owedBack: Boolean(r.payout_debt_flagged_at)
    }))
  });
}));

router.post('/bookings/:id/refund', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const booking = await payments.refundBooking(req.params.id, 'admin');
    console.log(`[admin] ${req.adminUser.email} refunded booking ${booking.id}`);
    const { rows } = await query('SELECT debt_flagged_at FROM payouts WHERE booking_id = $1', [booking.id]);
    res.json({ booking, mentorOwesBack: Boolean(rows[0] && rows[0].debt_flagged_at) });
  } catch (e) {
    if (e instanceof payments.PaymentError) {
      return res.status(e.code === 'not_found' ? 404 : (e.code === 'refund_failed' ? 502 : 409)).json({ error: e.code, message: e.code === 'refund_failed' ? e.message : undefined });
    }
    throw e;
  }
}));

// ---- Mentor payouts (manual bank transfers) -------------------------------------------------

// One row per mentor with money involved: what is payable now, still on hold, or owed back.
async function payoutRows() {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.payout_name, u.payout_iban_enc, u.payout_iban_last4,
            COALESCE(sum(p.amount) FILTER (WHERE p.status = 'pending' AND p.payable_at <= now()), 0)::int AS payable,
            COALESCE(sum(p.amount) FILTER (WHERE p.status = 'pending' AND p.payable_at > now()), 0)::int AS holding,
            COALESCE(sum(p.amount) FILTER (WHERE p.status = 'paid' AND p.debt_flagged_at IS NOT NULL AND p.debt_settled_batch_id IS NULL), 0)::int AS debt,
            count(*) FILTER (WHERE p.status = 'pending' AND p.payable_at <= now())::int AS payable_count
       FROM users u JOIN payouts p ON p.mentor_id = u.id
      GROUP BY u.id ORDER BY u.name`
  );
  return rows
    .map((r) => {
      const iban = decrypt(r.payout_iban_enc);
      return {
        mentorId: r.id, name: r.name, email: r.email, payoutName: r.payout_name || null,
        iban: iban ? pretty(iban) : null, ibanLast4: r.payout_iban_last4 || null,
        payable: r.payable, holding: r.holding, debt: r.debt, net: r.payable - r.debt, payableCount: r.payable_count
      };
    })
    .filter((r) => r.payable > 0 || r.holding > 0 || r.debt > 0);
}

// CSV cells that start with = + - @ can run as formulas in Excel, so they are neutralised.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sendCsv = (res, filename, header, lines) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  // The byte-order mark makes Excel read the Georgian letters correctly.
  res.send('\ufeff' + [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
};
const lari = (tetri) => (tetri / 100).toFixed(2);

router.get('/payouts', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ currency: config.CURRENCY, holdDays: config.PAYOUT_HOLD_DAYS, mentors: await payoutRows() });
}));

// The transfers to make today, ready for a spreadsheet or bulk upload at the bank.
router.get('/payouts.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = (await payoutRows()).filter((r) => r.net > 0);
  sendCsv(res, `wisecall-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
    ['mentor_name', 'mentor_email', 'account_holder', 'iban', 'amount_gel', 'currency', 'answered_bookings', 'note'],
    rows.map((r) => [r.name, r.email, r.payoutName, (r.iban || '').replace(/\s/g, ''), lari(r.net), 'GEL', r.payableCount, `Wisecall payout ${new Date().toISOString().slice(0, 10)}`]));
}));

async function historyRows(mentorId) {
  const params = [];
  let where = 'TRUE';
  if (mentorId) { params.push(mentorId); where = 'pb.mentor_id = $1'; }
  const { rows } = await query(
    `SELECT pb.*, u.name AS mentor_name, u.email AS mentor_email, a.email AS paid_by_email
       FROM payout_batches pb JOIN users u ON u.id = pb.mentor_id LEFT JOIN users a ON a.id = pb.paid_by
      WHERE ${where} ORDER BY pb.paid_at DESC LIMIT 500`, params);
  return rows;
}

router.get('/payouts/history', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await historyRows();
  res.json({
    batches: rows.map((r) => ({
      id: r.id, mentorId: r.mentor_id, mentorName: r.mentor_name, amount: r.amount, reference: r.reference,
      paidAt: r.paid_at, paidBy: r.paid_by_email, ibanLast4: r.iban_last4
    }))
  });
}));

router.get('/payouts/history.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await historyRows();
  sendCsv(res, 'wisecall-payout-history.csv', ['paid_at', 'mentor_name', 'mentor_email', 'amount_gel', 'currency', 'reference', 'iban_last4', 'recorded_by'],
    rows.map((r) => [new Date(r.paid_at).toISOString(), r.mentor_name, r.mentor_email, lari(r.amount), 'GEL', r.reference, r.iban_last4, r.paid_by_email]));
}));

// "Mark as paid": the admin has sent the bank transfer and now records it. `amount` (tetri) must
// equal what the panel showed; if the balance changed in the meantime nothing is recorded.
router.post('/payouts/:mentorId/pay', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { amount, reference } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(req.params.mentorId)) return res.status(404).json({ error: 'not_found' });
  if (!Number.isInteger(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });
  if (typeof reference !== 'string' || !reference.trim() || reference.trim().length > 100) return res.status(400).json({ error: 'reference_required' });

  const mentor = await getUserById(req.params.mentorId);
  if (!mentor) return res.status(404).json({ error: 'not_found' });
  try {
    const batch = await ledger.markPaid({ mentorId: mentor.id, expectedAmount: amount, reference: reference.trim(), adminId: req.adminUser.id });
    console.log(`[admin] ${req.adminUser.email} recorded a payout of ${batch.amount} tetri to mentor ${mentor.id} (${batch.reference})`);
    if (batch.amount > 0) notify.notifyPayoutPaid(mentor, batch);
    res.json({ batch: { id: batch.id, amount: batch.amount, reference: batch.reference, paidAt: batch.paid_at } });
  } catch (e) {
    if (e instanceof ledger.LedgerError) return res.status(409).json({ error: e.code });
    throw e;
  }
}));

module.exports = router;
