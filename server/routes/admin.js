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

// The overview: the numbers an admin checks first (sign-ups, applications, the waiting list, questions, refunds, disputes, money).
// Amounts are tetri. "received" is what buyers paid for questions that are not (being) refunded, minus partial refunds; "fee" is
// Wisecall's share of the answered ones (gross, before bank fees and tax); "payouts" uses the ledger's own rules (server/ledger.js).
router.get('/overview', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [users, apps, risks, flags, waiting, bookings, money, disputes, safety, support, payouts] = await Promise.all([
    query(`SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
                   count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month,
                   count(*) FILTER (WHERE role IN ('mentor', 'both'))::int AS mentors
              FROM users WHERE deleted_at IS NULL`),
    query(`SELECT CASE WHEN verification_status = 'pending' AND application_submitted_at IS NULL THEN 'draft' ELSE verification_status END AS status,
                   count(*)::int AS n
              FROM users WHERE role IN ('mentor', 'both') AND deleted_at IS NULL GROUP BY 1`),
    query(`SELECT COALESCE(r.risk, 'none') AS risk, count(*)::int AS n
              FROM users u
              LEFT JOIN LATERAL (SELECT v.risk FROM verification_reviews v WHERE v.user_id = u.id ORDER BY v.created_at DESC LIMIT 1) r ON TRUE
             WHERE u.role IN ('mentor', 'both') AND u.verification_status = 'pending' AND u.application_submitted_at IS NOT NULL AND u.deleted_at IS NULL
             GROUP BY 1`),
    query(`SELECT count(*)::int AS n FROM mentor_flags WHERE status = 'open'`),
    query(`SELECT niche, count(*)::int AS n FROM waitlist WHERE notified_at IS NULL GROUP BY niche ORDER BY n DESC, niche`),
    query(`SELECT status, count(*)::int AS n, count(*) FILTER (WHERE paid_at > now() - interval '30 days')::int AS month FROM bookings GROUP BY status`),
    query(`SELECT COALESCE(sum(amount - COALESCE(refunded_amount, 0)) FILTER (WHERE status IN ('paid', 'answered')), 0)::bigint AS received,
                   COALESCE(sum(platform_fee_amount - round(COALESCE(refunded_amount, 0)::numeric * platform_fee_amount / amount)) FILTER (WHERE status = 'answered'), 0)::bigint AS fee,
                   COALESCE(sum(CASE WHEN status = 'refunded' THEN amount ELSE COALESCE(refunded_amount, 0) END) FILTER (WHERE paid_at IS NOT NULL), 0)::bigint AS refunded,
                   count(*) FILTER (WHERE refunded_amount IS NOT NULL AND status <> 'refunded')::int AS partial,
                   count(*) FILTER (WHERE provider = 'mock' AND paid_at IS NOT NULL)::int AS test_payments
              FROM bookings`),
    query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'resolved')::int AS resolved
              FROM disputes`),
    query(`SELECT count(*)::int AS n FROM safety_events WHERE reviewed_at IS NULL`),
    query(`SELECT count(*)::int AS n FROM threads WHERE kind = 'support' AND status = 'open'`),
    query(`SELECT COALESCE(sum(p.amount) FILTER (WHERE ${ledger.payableSql('p')}), 0)::bigint AS payable,
                   COALESCE(sum(p.amount) FILTER (WHERE ${ledger.holdingSql('p')} OR ${ledger.requestedSql('p')}), 0)::bigint AS holding,
                   COALESCE(sum(${ledger.debtAmountSql('p')}) FILTER (WHERE ${ledger.debtSql('p')}), 0)::bigint AS debt,
                   COALESCE(sum(p.amount) FILTER (WHERE p.status = 'paid'), 0)::bigint AS paid_out
              FROM payouts p`)
  ]);
  const byKey = (rows, key, val = 'n') => Object.fromEntries(rows.map((r) => [r[key], r[val]]));
  const m = money.rows[0];
  const p = payouts.rows[0];
  const q = byKey(bookings.rows, 'status');
  res.json({
    currency: config.CURRENCY,
    feePercent: config.PLATFORM_FEE_PERCENT,
    signups: users.rows[0],
    applications: { byStatus: byKey(apps.rows, 'status'), waitingByRisk: byKey(risks.rows, 'risk'), openFlags: flags.rows[0].n },
    waitlist: { byNiche: byKey(waiting.rows, 'niche'), total: waiting.rows.reduce((s, r) => s + r.n, 0) },
    questions: { byStatus: q, paidLast30Days: bookings.rows.reduce((s, r) => s + r.month, 0) },
    refunds: { pending: q.refund_pending || 0, full: q.refunded || 0, partial: m.partial, amount: Number(m.refunded) },
    disputes: { open: disputes.rows[0].open, resolved: disputes.rows[0].resolved, openSafety: safety.rows[0].n, openSupport: support.rows[0].n },
    money: { received: Number(m.received), fee: Number(m.fee), testPayments: m.test_payments },
    payouts: { payable: Number(p.payable), holding: Number(p.holding), debt: Number(p.debt), paidOut: Number(p.paid_out) },
    // Where people come from: per campaign source (or referring site) and campaign (server/attribution.js).
    sources: await require('../attribution').bySource(),
    // Live sessions: what is coming, live now, the last 30 days (tickets, money), open reports.
    live: await require('../live/analytics').forAdmin()
  });
}));

// ---- Public answers (server/publicAnswers.js): every one is approved by an admin; a regulated field needs it explicitly ----------------
const PA_STATUS = { not_found: 404, not_ready: 409, regulated_needs_permission: 409, invalid_question: 400, invalid_answer: 400, reason_required: 400 };
const paFail = (res, e) => {
  if (!(e instanceof require('../publicAnswers').AnswerError)) throw e;
  res.status(PA_STATUS[e.code] || 400).json({ error: e.code });
};
// ---- Live sessions (server/live/): the approval queue for a mentor's first sessions, what is live now, reports, ending a room ----------
const LIVE_STATUS = { not_found: 404, reason_required: 400, not_cancellable: 409, video_unavailable: 503 };
const liveFail = (res, e) => {
  if (!(e instanceof require('../live/sessions').LiveError)) throw e;
  res.status(LIVE_STATUS[e.code] || 400).json({ error: e.code });
};
router.get('/live', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sessions = require('../live/sessions');
  const { rows } = await query(
    `SELECT s.*, ${sessions.TAKEN_SQL} AS taken, ${sessions.SOLD_SQL} AS sold, ${sessions.WAITING_SQL} AS waiting, u.name AS mentor_name, u.email AS mentor_email,
            (SELECT count(*)::int FROM live_reports r WHERE r.session_id = s.id AND r.status = 'open') AS open_reports,
            EXISTS (SELECT 1 FROM live_replays rp WHERE rp.session_id = s.id AND rp.status = 'ready') AS replay_ready
       FROM live_sessions s JOIN users u ON u.id = s.mentor_id
      WHERE s.status IN ('review', 'published', 'live') OR (s.status IN ('ended', 'cancelled') AND s.updated_at > now() - interval '30 days')
      ORDER BY (s.status = 'review') DESC, (s.status = 'live') DESC, s.starts_at LIMIT 300`);
  const view = (s) => ({ ...sessions.ownerView(s), mentor: { id: s.mentor_id, name: s.mentor_name, email: s.mentor_email }, openReports: s.open_reports,
    cancelReason: s.cancel_reason, endKind: s.end_kind, mentorMinutes: Math.round(s.mentor_seconds / 60) });
  res.json({ sessions: rows.map(view), reports: await require('../live/reports').listOpen(), totals: await require('../live/analytics').forAdmin(),
    ratings: await require('../live/after').recentForAdmin() });
}));
// Deletes a session's replay (passes still running are refunded). Logged with the reason.
router.post('/live/:id/replay/delete', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
  try {
    const out = await require('../live/replays').remove({ ...req.adminUser, isAdminAction: true }, req.params.id, 'admin: ' + reason);
    const { rows: [s] } = await query('SELECT id, title, mentor_id FROM live_sessions WHERE id = $1', [req.params.id]);
    await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, 'live_replay_deleted', $4)`,
      [s.mentor_id, req.adminUser.id, req.adminUser.email, `replay of live session ${s.id} "${s.title}": ${reason}`.slice(0, 1000)]);
    res.json(out);
  } catch (e) { liveFail(res, e); }
}));
// ---- Profiles (server/profileSections.js): reported profiles, hiding a section or the whole profile, the verified mark per item ---------
const PROFILE_STATUS = { not_found: 404, reason_required: 400, invalid_section: 400 };
const profileFail = (res, e) => {
  if (!(e instanceof require('../profileSections').ProfileError)) throw e;
  res.status(PROFILE_STATUS[e.code] || 400).json({ error: e.code });
};
const ownerOf = async (id) => (/^[0-9a-f-]{36}$/i.test(String(id)) ? require('../models').getUserById(String(id)) : null);
router.get('/profiles/reports', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ reports: await require('../profileSections').listReports() });
}));
router.post('/profiles/reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json(await require('../profileSections').resolveReport(req.adminUser, req.params.id, (req.body || {}).resolution)); } catch (e) { profileFail(res, e); }
}));
router.post('/profiles/:userId/hide', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const owner = await ownerOf(req.params.userId);
  if (!owner) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  try { res.json(await require('../profileSections').hide(req.adminUser, owner, { section: b.section || null, reason: b.reason })); } catch (e) { profileFail(res, e); }
}));
router.post('/profiles/:userId/unhide', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const owner = await ownerOf(req.params.userId);
  if (!owner) return res.status(404).json({ error: 'not_found' });
  try { res.json(await require('../profileSections').unhide(req.adminUser, owner, { section: (req.body || {}).section || null })); } catch (e) { profileFail(res, e); }
}));
router.get('/profiles/:userId/items', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.userId))) return res.status(404).json({ error: 'not_found' });
  res.json({ items: await require('../profileSections').itemsForAdmin(req.params.userId) });
}));
router.post('/profile-items/:id/verify', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { res.json({ item: await require('../profileSections').setVerified(req.adminUser, req.params.id, b.verified === true, b.note) }); } catch (e) { profileFail(res, e); }
}));
// Hides a rating of a live session (rude, personal details...): it no longer counts or shows. Logged with the reason.
router.post('/live/ratings/:id/hide', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json(await require('../live/after').hide(req.adminUser, req.params.id, (req.body || {}).reason)); } catch (e) { liveFail(res, e); }
}));
router.post('/live/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { res.json({ session: await require('../live/sessions').approve(req.adminUser, req.params.id, { title: b.title, description: b.description, learnPoints: b.learnPoints }) }); }
  catch (e) { liveFail(res, e); }
}));
router.post('/live/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json({ session: await require('../live/sessions').reject(req.adminUser, req.params.id, (req.body || {}).reason) }); } catch (e) { liveFail(res, e); }
}));
// Ends a session at once for safety (or takes down one that is not live yet): everybody is refunded.
router.post('/live/:id/end', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
  try {
    const s = await require('../live/sessions').cancel(req.params.id, 'admin_safety', { by: req.adminUser, note: reason });
    res.json({ ok: true, sessionStatus: s.status });
  } catch (e) { liveFail(res, e); }
}));
router.post('/live/reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json(await require('../live/reports').resolve(req.adminUser, req.params.id, (req.body || {}).resolution)); } catch (e) { liveFail(res, e); }
}));
// A mentor without an answered question may host once an admin allows it (or not any more); by account id, or by email from the tab.
router.post(['/live/hosts', '/live/hosts/:userId'], requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const allow = (req.body || {}).allow !== false;
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!req.params.userId && !email) return res.status(400).json({ error: 'missing_fields' });
  const { rows: [u] } = await query(
    `UPDATE users SET live_approved_at = ${allow ? 'COALESCE(live_approved_at, now())' : 'NULL'}
      WHERE ${req.params.userId ? 'id::text = $1' : 'lower(email) = $1'} AND role IN ('mentor', 'both') RETURNING id, email`, [req.params.userId || email]);
  if (!u) return res.status(404).json({ error: 'not_found' });
  await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, req.adminUser.id, req.adminUser.email, allow ? 'live_host_allowed' : 'live_host_removed', null]);
  res.json({ ok: true, allowed: allow });
}));

router.get('/public-answers', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ queue: await require('../publicAnswers').queue() });
}));
router.post('/public-answers/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { res.json({ publicAnswer: await require('../publicAnswers').approve(req.adminUser, req.params.id, { question: b.question, answer: b.answer, allowRegulated: b.allowRegulated === true }) }); }
  catch (e) { paFail(res, e); }
}));
router.post('/public-answers/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json({ publicAnswer: await require('../publicAnswers').reject(req.adminUser, req.params.id, (req.body || {}).reason) }); }
  catch (e) { paFail(res, e); }
}));

// ---- "Find me a mentor" requests (server/mentorRequests.js): admins only, with the emails --------------------------------------------
router.get('/requests', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await require('../mentorRequests').dashboard());
}));
router.get('/requests.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const d = await require('../mentorRequests').dashboard();
  sendCsv(res, `wisecall-mentor-requests-${new Date().toISOString().slice(0, 10)}.csv`, ['created', 'email', 'field', 'category', 'need', 'language', 'budget_min', 'budget_max', 'public', 'status'],
    d.requests.map((r) => [new Date(r.createdAt).toISOString(), r.email, r.field, r.niche, r.need, r.language, r.budgetMin || '', r.budgetMax || '', r.showPublic ? 'yes' : 'no', r.status]));
}));
router.post('/requests/merge', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { res.json({ merged: await require('../mentorRequests').merge(String(b.from || ''), String(b.into || '')) }); }
  catch (e) { if (e instanceof require('../mentorRequests').RequestError) return res.status(404).json({ error: e.code }); throw e; }
}));

// ---- Withdrawals (server/withdrawals.js) ---------------------------------------------------------------------------------------------
const WD_STATUS = { not_found: 404, not_open: 409, amount_changed: 409, reference_required: 400, reason_required: 400 };
const wdFail = (res, e) => {
  if (!(e instanceof require('../withdrawals').WithdrawalError)) throw e;
  res.status(WD_STATUS[e.code] || 400).json({ error: e.code, ...(e.amount !== undefined ? { amount: e.amount } : {}) });
};
const isId = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
// The queue (with the full IBANs: every view is logged), the money overview and the recent decisions.
router.get('/withdrawals', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const w = require('../withdrawals');
  const [overview, queue, recent] = await Promise.all([w.overview(), w.queue(req.adminUser), w.recent()]);
  res.set('Cache-Control', 'no-store');
  res.json({ currency: config.CURRENCY, minimum: w.minimum(), overview, queue, recent });
}));
router.post('/withdrawals/:id/pay', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  try { res.json({ request: await require('../withdrawals').markPaid({ batchId: req.params.id, reference: b.reference, amount: b.amount, admin: req.adminUser }) }); }
  catch (e) { wdFail(res, e); }
}));
router.post('/withdrawals/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try { res.json({ request: await require('../withdrawals').reject({ batchId: req.params.id, reason: (req.body || {}).reason, admin: req.adminUser }) }); }
  catch (e) { wdFail(res, e); }
}));
// The open requests as a CSV for one bulk transfer (each exported request remembers its amount), then one reference for all of them.
router.get('/withdrawals.csv', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const csv = await require('../withdrawals').exportCsv(req.adminUser);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }).attachment(`wisecall-withdrawals-${new Date().toISOString().slice(0, 10)}.csv`).send('\uFEFF' + csv);
}));
router.post('/withdrawals/pay-exported', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json(await require('../withdrawals').markExportedPaid({ reference: (req.body || {}).reference, admin: req.adminUser })); }
  catch (e) { wdFail(res, e); }
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
            COALESCE(sum(p.amount) FILTER (WHERE ${ledger.holdingSql('p')} OR ${ledger.requestedSql('p')}), 0)::int AS holding,
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
  let where = "pb.status = 'paid'"; // (transfers that were made; requests are in the Withdrawals view)
  if (mentorId) { params.push(mentorId); where += ' AND pb.mentor_id = $1'; }
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
    if (e instanceof ledger.LedgerError) return res.status(409).json({ error: e.code }); // (request_open: pay the mentor's request instead)
    throw e;
  }
}));

module.exports = router;
