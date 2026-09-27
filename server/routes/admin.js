const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { meProfile, asyncHandler } = require('../util');
const { userFromRow, bookingFromRow, getUserById, updateUser, mentorStatsFor, userColumnsSql, failedRequiredStepSql } = require('../models');
const config = require('../config');
const payments = require('../payments');
const notify = require('../notify');
const verificationSteps = require('../verification/steps');
const rules = require('../verification/rules');
const flags = require('../verification/flags');
const ledger = require('../ledger');
const waitlist = require('../waitlist');
const { decrypt } = require('../cryptoBox');
const { pretty } = require('../iban');

const router = express.Router();

// The mentor list. ?queue=needs_human: submitted applications waiting for a person, riskiest first (then the oldest), with the latest
// analysis (AI summary on top). ?status=...: mentors in that verification status. ?status=failed_step: approved mentors with a required
// step that failed: still marked verified (should never last: the sweep delists them), or taken off the site for it and not sorted out
// yet (an open 'required_step_failed' flag).
const RISK_ORDER = { high: 0, medium: 1, low: 2 };
router.get('/mentors', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { status, queue } = req.query;
  const params = [];
  let where = `role IN ('mentor', 'both')`;
  if (queue === 'needs_human') where += ` AND verification_status = 'pending'`;
  else if (status === 'failed_step') {
    where += ` AND ((verification_status = 'verified' AND ${failedRequiredStepSql()})
                OR EXISTS (SELECT 1 FROM mentor_flags f WHERE f.mentor_id = users.id AND f.kind = 'required_step_failed' AND f.status = 'open'))`;
  } else if (status) { params.push(String(status)); where += ` AND verification_status = $${params.length}`; }
  const { rows } = await query(`SELECT ${userColumnsSql()} FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  const mentors = rows.map(userFromRow);
  const ids = mentors.map((m) => m.id);
  const [stats, stepMap, flagRows, standingRows, reviews] = await Promise.all([
    mentorStatsFor(ids), verificationSteps.loadStepsFor(ids),
    query(`SELECT mentor_id, count(*)::int AS n FROM mentor_flags WHERE status = 'open' AND mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`, [ids]),
    // the last thing that happened to each mentor's standing: "reinstated" (and still pending) means back in review after a suspension
    query(`SELECT DISTINCT ON (mentor_id) mentor_id, action FROM verification_audit
            WHERE mentor_id = ANY($1::uuid[]) AND action IN ('suspended', 'reinstated', 'approved', 'rejected', 'delisted') ORDER BY mentor_id, created_at DESC`, [ids]),
    require('../verification/analysis').latestFor(ids)
  ]);
  const openFlags = Object.fromEntries(flagRows.rows.map((r) => [r.mentor_id, r.n]));
  const lastStanding = Object.fromEntries(standingRows.rows.map((r) => [r.mentor_id, r.action]));
  const list = mentors.map((m) => {
      const v = verificationSteps.describe(m, stepMap[m.id]);
      // "waiting" = required steps a person has to look at (submitted, decided by an admin, not yet decided).
      const waiting = v.requirements.filter((r) => {
        const row = stepMap[m.id][r.step];
        return row && row.status === 'pending' && ['admin', 'auto+admin'].includes(rules.STEPS[r.step].decider);
      }).length;
      const done = v.requirements.filter((r) => r.status === 'passed').length;
      const a = reviews[m.id];
      const submitted = m.verificationStatus === 'pending' && Boolean(m.applicationSubmittedAt);
      return {
        ...meProfile(m), ...stats[m.id],
        verification: { level: v.level, ready: v.ready, missing: v.missing, done, total: v.requirements.length, waiting, openFlags: openFlags[m.id] || 0, backInReview: m.verificationStatus === 'pending' && lastStanding[m.id] === 'reinstated', submitted, failedRequired: Boolean(m.hasFailedRequiredStep) },
        analysis: a ? {
          status: a.status, risk: a.risk, outcome: a.outcome, createdAt: a.createdAt, forCurrentSubmission: Boolean(m.applicationSubmittedAt) && String(a.submittedAt) === String(m.applicationSubmittedAt),
          recommendation: a.ai ? a.ai.recommendation : null, summary: a.ai ? a.ai.admin_summary : null, aiError: a.aiError, costUsd: a.usage.costUsd,
          wouldAutoApprove: Boolean(a.checks && a.checks.wouldAutoApprove)
        } : null
      };
  });
  if (queue === 'needs_human') {
    // Submitted applications first, riskiest first, then the oldest submission; drafts (not submitted yet) last.
    const rank = (m) => (m.verification.submitted ? 0 : 1);
    const risk = (m) => (m.analysis && m.analysis.risk ? RISK_ORDER[m.analysis.risk] : 3);
    list.sort((x, y) => rank(x) - rank(y) || risk(x) - risk(y) || new Date(x.applicationSubmittedAt || x.createdAt) - new Date(y.applicationSubmittedAt || y.createdAt));
  }
  res.json({ mentors: list });
}));
// Reported problems with answers: the open ones (or ?status=resolved), and the decision (full / partial / no refund, with a note).
router.get('/disputes', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ disputes: await require('../disputes').listForAdmin({ status: req.query.status === 'resolved' ? 'resolved' : 'open' }) });
}));
router.post('/disputes/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const disputes = require('../disputes');
  const admin = await getUserById(req.userToken.id);
  const b = req.body || {};
  try {
    res.json({ dispute: await disputes.resolve(admin, req.params.id, { outcome: b.outcome, amount: b.amount, note: b.note }) });
  } catch (e) {
    if (!(e instanceof disputes.DisputeError)) throw e;
    res.status({ not_found: 404, already_resolved: 409, refund_failed: 502 }[e.code] || 400).json({ error: e.code, message: e.detail });
  }
}));

// Questions that looked like an emergency (not paid for; the person saw help text). ?open=0 lists the reviewed ones too.
router.get('/safety', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ events: await require('../safety').listForAdmin({ open: req.query.open !== '0' }) });
}));
router.post('/safety/:id/review', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const admin = await getUserById(req.userToken.id);
  if (!(await require('../safety').markReviewed(req.params.id, admin, (req.body || {}).note))) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
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

// ---- Waiting list ("get notified when mentors in your field join") ------------------------------------
router.get('/waitlist', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await waitlist.listForAdmin();
  const byNiche = {};
  rows.forEach((r) => { byNiche[r.niche] = (byNiche[r.niche] || 0) + 1; });
  res.json({ signups: rows, total: rows.length, byNiche });
}));
router.get('/waitlist.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await waitlist.listForAdmin();
  sendCsv(res, `wisecall-waitlist-${new Date().toISOString().slice(0, 10)}.csv`, ['email', 'field', 'language', 'signed_up', 'notified'],
    rows.map((r) => [r.email, r.niche, r.language, new Date(r.createdAt).toISOString(), r.notifiedAt ? new Date(r.notifiedAt).toISOString() : '']));
}));

// ---- Mentor payouts (manual bank transfers) -------------------------------------------------

// One row per mentor with money involved: what is payable now, still on hold, or owed back.
async function payoutRows() {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.payout_name, u.payout_iban_enc, u.payout_iban_last4,
            COALESCE(sum(p.amount) FILTER (WHERE ${ledger.payableSql('p')}), 0)::int AS payable,
            COALESCE(sum(p.amount) FILTER (WHERE p.status = 'pending' AND NOT (${ledger.payableSql('p')})), 0)::int AS holding,
            COALESCE(sum(${ledger.debtAmountSql('p')}) FILTER (WHERE ${ledger.debtSql('p')}), 0)::int AS debt,
            count(*) FILTER (WHERE ${ledger.payableSql('p')})::int AS payable_count,
            EXISTS (SELECT 1 FROM mentor_flags f WHERE f.mentor_id = u.id AND f.status = 'open' AND f.kind IN ('name_mismatch', 'payout_name_mismatch')) AS flagged,
            u.verification_status = 'suspended' AS suspended
       FROM users u JOIN payouts p ON p.mentor_id = u.id
      GROUP BY u.id ORDER BY u.name`
  );
  return rows
    .map((r) => {
      const iban = decrypt(r.payout_iban_enc);
      return {
        mentorId: r.id, name: r.name, email: r.email, payoutName: r.payout_name || null,
        iban: iban ? pretty(iban) : null, ibanLast4: r.payout_iban_last4 || null,
        payable: r.payable, holding: r.holding, debt: r.debt, net: r.payable - r.debt, payableCount: r.payable_count, flagged: r.flagged, suspended: r.suspended
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
  res.json({ currency: config.CURRENCY, holdDays: ledger.holdDays(), mentors: await payoutRows() });
}));

// The transfers to make today, ready for a spreadsheet or bulk upload at the bank.
router.get('/payouts.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  // Mentors with an open name-mismatch flag are left out: nothing is sent until an admin resolves it.
  const rows = (await payoutRows()).filter((r) => r.net > 0 && !r.flagged && !r.suspended);
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
  // Never send money to an account whose holder does not match the verified ID.
  if (await flags.hasOpenFlag(mentor.id, ['name_mismatch', 'payout_name_mismatch'])) return res.status(409).json({ error: 'name_mismatch' });
  // Nothing is sent to a suspended mentor until an admin has decided what happens to their earnings.
  if (mentor.verificationStatus === 'suspended') return res.status(409).json({ error: 'mentor_suspended' });
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
