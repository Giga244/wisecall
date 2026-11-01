const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { meProfile, asyncHandler } = require('../util');
const { getUserById } = require('../models');
const notify = require('../notify');
const rules = require('../verification/rules');
const steps = require('../verification/steps');
const review = require('../verification/review');
const kycService = require('../verification/kyc');
const flags = require('../verification/flags');
const credentials = require('../verification/credentials');
const interviews = require('../verification/interviews');
const probation = require('../probation');
const payments = require('../payments');
const reports = require('../reports');
const analysis = require('../verification/analysis');
const experience = require('../verification/experience');

const router = express.Router();
const UUID = /^[0-9a-f-]{36}$/i;

const STATUS_FOR_CODE = {
  not_found: 404, unknown_step: 404,
  reason_required: 400, invalid_decision: 400,
  not_manual: 409, not_submitted: 409, invalid_state: 409, steps_incomplete: 409, cannot_approve: 409,
  invalid_slot: 400, invalid_link: 400, not_started: 409, already_passed: 409,
  invalid_custom_niche: 400, invalid_niche: 400, regulated_words: 409, licence_missing: 409
};

// Turns a VerificationError into a JSON reply; anything else is a real error.
function fail(res, e) {
  if (e instanceof steps.VerificationError) {
    return res.status(STATUS_FOR_CODE[e.code] || 400).json({ error: e.code, missing: e.missing, ...(e.code === 'regulated_words' ? { category: e.field } : {}) });
  }
  throw e;
}

// Everything an admin needs to review one application: every requirement with its status, the
// evidence, who decided and why, the official registries to check, and the full audit log.
router.get('/mentors/:id/verification', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const mentor = await getUserById(req.params.id);
  if (!mentor || !(mentor.role === 'mentor' || mentor.role === 'both')) return res.status(404).json({ error: 'not_found' });

  const [kycSummary, openFlags, creds, docs, stepRows, auditRows, reviews, evidence] = await Promise.all([
    kycService.summaryFor(mentor.id),
    flags.openFlagsFor(mentor.id),
    credentials.credentialsFor(mentor.id),
    credentials.listDocuments(mentor.id),
    query(`SELECT s.*, u.email AS decided_by_email FROM verification_steps s LEFT JOIN users u ON u.id = s.decided_by WHERE s.user_id = $1`, [mentor.id]),
    query(`SELECT * FROM verification_audit WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT 200`, [mentor.id]),
    analysis.reviewsFor(mentor.id, 5),
    experience.listEvidence(mentor.id)
  ]);
  const detail = {};
  stepRows.rows.forEach((r) => {
    detail[r.step] = {
      step: r.step, status: steps.effectiveStatus({ status: r.status, expiresAt: r.expires_at }), rawStatus: r.status, evidence: r.evidence || {},
      reason: r.reason, decidedAt: r.decided_at, decidedBy: r.decided_by_email || (r.decided_by ? null : (r.status === 'pending' ? null : 'system')),
      expiresAt: r.expires_at, updatedAt: r.updated_at, manual: ['admin', 'auto+admin'].includes(rules.STEPS[r.step] && rules.STEPS[r.step].decider),
      legacy: rules.LEGACY_STEPS.includes(r.step)
    };
  });
  const summary = steps.describe(mentor, Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, { status: v.rawStatus, expiresAt: v.expiresAt }])));

  res.json({
    mentor: {
      ...meProfile(mentor), sampleAnswer: mentor.sampleAnswer, proofUrl: mentor.proofUrl
    },
    // Step 2 as the mentor filled it in, and step 3: the latest analysis first (AI summary, scores, flags, link checks, cost).
    application: {
      roleTitle: mentor.roleTitle, niche: mentor.niche, customNiche: mentor.customNiche, fieldOverride: mentor.fieldOverride,
      wordsCategory: require('../fieldRules').regulatedCategoryIn(mentor.customNiche, mentor.roleTitle),
      specialtyTags: mentor.specialtyTags, yearsExperience: mentor.yearsExperience,
      story: mentor.story, sampleAnswer: mentor.sampleAnswer, submittedAt: mentor.applicationSubmittedAt, submitted: experience.submitted(mentor)
    },
    evidence: evidence.map((e) => ({ ...e, registry: e.kind === 'company' ? rules.COMPANY_REGISTRY : undefined })),
    analysis: reviews[0] || null,
    analysisHistory: reviews.slice(1).map((r) => ({ id: r.id, trigger: r.trigger, createdAt: r.createdAt, risk: r.risk, outcome: r.outcome, costUsd: r.usage.costUsd, aiError: r.aiError })),
    autoApprove: require('../config').AUTO_APPROVE,
    interviewRequested: Boolean(stepRows.rows.find((r) => r.step === 'video_interview')),
    level: summary.level,
    kyc: kycSummary,
    flags: openFlags,
    credentials: creds,
    workEmail: mentor.workEmail ? { address: mentor.workEmail, verifiedAt: mentor.workEmailVerifiedAt } : null,
    documents: docs,
    requirements: summary.requirements.map((r) => ({ ...r, ...(detail[r.step] || {}), status: r.status })),
    optional: summary.optional.map((r) => ({ ...r, ...(detail[r.step] || {}), status: r.status })),
    // Steps from the first rules, kept for the record.
    legacySteps: Object.values(detail).filter((d) => d.legacy),
    ready: summary.ready,
    missing: summary.missing,
    // One tap: what "Approve" would pass first, and what blocks it (docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md).
    oneTap: await review.oneTapPlan(mentor),
    // Was this mentor listed before, and did an admin just lift their suspension? (Reinstated mentors go back to review on purpose.)
    standing: (() => {
      const last = auditRows.rows.find((a) => ['suspended', 'reinstated', 'approved', 'rejected', 'delisted'].includes(a.action));
      return { wasApproved: auditRows.rows.some((a) => a.action === 'approved'), backInReview: mentor.verificationStatus === 'pending' && Boolean(last) && last.action === 'reinstated' };
    })(),
    registries: rules.registriesFor(mentor.niche),
    audit: auditRows.rows.map((a) => ({
      id: a.id, action: a.action, step: a.step, from: a.from_status, to: a.to_status, reason: a.reason, by: a.actor_label, at: a.created_at
    }))
  });
}));

router.post('/mentors/:id/steps/:step', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { decision, reason } = req.body || {};
  if (typeof decision !== 'string' || (reason !== undefined && typeof reason !== 'string')) return res.status(400).json({ error: 'invalid_decision' });
  try {
    const summary = await review.decideStep({ mentorId: req.params.id, step: req.params.step, decision, reason, admin: req.adminUser });
    res.json({ ready: summary.ready, missing: summary.missing });
  } catch (e) { fail(res, e); }
}));

// A mentor's field: the words and the category ("Your field"), and "not a licensed profession".
router.post('/mentors/:id/field', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (typeof b.text !== 'string' || typeof b.niche !== 'string') return res.status(400).json({ error: 'invalid_field' });
  try {
    const mentor = await require('../verification/experience').setFieldByAdmin({ mentorId: req.params.id, admin: req.adminUser, text: b.text, niche: b.niche, notRegulated: b.notRegulated === true });
    res.json({ mentor: meProfile(mentor) });
  } catch (e) { fail(res, e); }
}));

// { all: true }: one tap (docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md): what is waiting for a person's judgement is passed, then the mentor is
// approved; refused (cannot_approve, with what blocks it) while an automatic check has not passed. Without it: approve as before.
router.post('/mentors/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const mentor = (req.body || {}).all === true
      ? (await review.approveAll({ mentorId: req.params.id, admin: req.adminUser })).mentor
      : await review.approve({ mentorId: req.params.id, admin: req.adminUser });
    notify.notifyMentorDecision(mentor, true, null);
    require('../waitlist').afterMaybeListed(mentor.id); // if they are now visible, tell the people waiting for their field
    res.json({ mentor: meProfile(mentor) });
  } catch (e) { fail(res, e); }
}));

router.post('/mentors/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { reason } = req.body || {};
  if (typeof reason !== 'string') return res.status(400).json({ error: 'reason_required' });
  try {
    const mentor = await review.reject({ mentorId: req.params.id, reason, admin: req.adminUser });
    notify.notifyMentorDecision(mentor, false, mentor.verificationNote);
    res.json({ mentor: meProfile(mentor) });
  } catch (e) { fail(res, e); }
}));

// Runs the automatic analysis again (for example after the mentor fixed a link, or once an AI key was added). It runs in the background:
// the answer comes at once (202) and the panel checks the detail view until the new analysis is there.
router.post('/mentors/:id/analysis', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const mentor = await getUserById(req.params.id);
  if (!mentor || !(mentor.role === 'mentor' || mentor.role === 'both')) return res.status(404).json({ error: 'not_found' });
  if (mentor.verificationStatus !== 'pending') return res.status(409).json({ error: 'invalid_state' });
  const before = (await analysis.reviewsFor(mentor.id, 1))[0];
  await steps.audit(mentor.id, steps.adminActor(req.adminUser), 'analysis_rerun_requested', {});
  analysis.rerun(mentor.id);
  res.status(202).json({ started: true, previous: before ? before.id : null });
}));

// An admin confirms or refuses one piece of evidence by hand (a company code in the Public Registry, a diploma, a link).
router.post('/mentors/:id/evidence/:evidenceId', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { decision, reason } = req.body || {};
  if (typeof decision !== 'string' || (reason !== undefined && typeof reason !== 'string')) return res.status(400).json({ error: 'invalid_decision' });
  try {
    await review.decideEvidence({ mentorId: req.params.id, evidenceId: req.params.evidenceId, decision, reason, admin: req.adminUser });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
}));

// An admin asks for a video interview (optional; never required by default).
router.post('/mentors/:id/interview/request', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const summary = await review.requestInterview({ mentorId: req.params.id, reason: (req.body || {}).reason, admin: req.adminUser });
    res.json({ ready: summary.ready, missing: summary.missing });
  } catch (e) { fail(res, e); }
}));

// What the AI reviews cost (this month and in total), which model is used, and whether automatic approval is on.
router.get('/verification/costs', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(await analysis.costs());
}));

// Asks the ID-verification provider for the latest result (for example when a webhook was lost).
router.post('/mentors/:id/kyc/refresh', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const out = await kycService.refresh(req.params.id);
    res.json({ known: out.known, changed: Boolean(out.changed), kycStatus: out.status || null });
  } catch (e) {
    console.error('[kyc] refresh failed:', e.message);
    res.status(502).json({ error: 'kyc_error' });
  }
}));

// "Re-run ID check" (admins only, reason required, logged): for an ID that may have been read wrongly, for example an age failure. The
// provider is asked again and the age worked out again; if it still fails, the mentor may take the ID check once more.
router.post('/mentors/:id/kyc/rerun', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const reason = req.body && req.body.reason;
  if (typeof reason !== 'string' || reason.trim().length < 5) return res.status(400).json({ error: 'reason_required' });
  const mentor = await getUserById(req.params.id);
  if (!mentor || !(mentor.role === 'mentor' || mentor.role === 'both')) return res.status(404).json({ error: 'not_found' });
  const admin = await getUserById(req.userToken.id);
  res.json(await kycService.adminRerun(mentor.id, admin, reason.trim().slice(0, 1000)));
}));

// An admin closes a flag (for example after checking a name mismatch by hand). A reason is required.
router.post('/flags/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const reason = req.body && req.body.reason;
  if (typeof reason !== 'string' || reason.trim().length < 5) return res.status(400).json({ error: 'reason_required' });
  const done = await flags.resolveById(req.params.id, steps.adminActor(req.adminUser), reason.trim().slice(0, 1000));
  if (!done) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

// ---- Suspension -----------------------------------------------------------------------------------------
router.post('/mentors/:id/suspend', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try { res.json(await review.suspend({ mentorId: req.params.id, reason: (req.body || {}).reason, admin: req.adminUser })); } catch (e) { fail(res, e); }
}));
router.post('/mentors/:id/reinstate', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { reason, reapprove } = req.body || {};
  if (reapprove !== undefined && typeof reapprove !== 'boolean') return res.status(400).json({ error: 'invalid_request' });
  try {
    const out = await review.reinstate({ mentorId: req.params.id, reason, admin: req.adminUser, reapprove: reapprove === true });
    if (out.reapproved) { // listed again, like any approval: the mentor is told, and people waiting for their field are told
      notify.notifyMentorDecision(out.mentor, true, null);
      require('../waitlist').afterMaybeListed(out.mentor.id);
    }
    res.json({ ok: true, reapproved: out.reapproved, ...(out.missing ? { missing: out.missing } : {}) });
  } catch (e) { fail(res, e); }
}));

// ---- Review queue: answers held during probation, and reports ---------------------------------------------
router.get('/answers', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ answers: await probation.queue(), holdHours: rules.LIMITS.probationHoldHours });
}));
router.post('/answers/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const b = await probation.release(req.params.id, steps.adminActor(req.adminUser), 'approved by an admin');
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));
router.post('/answers/:id/flag', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (!(await probation.flag(req.params.id, req.adminUser))) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));
router.post('/answers/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
  try {
    if (!(await probation.reject(req.params.id, req.adminUser, reason.slice(0, 1000)))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof payments.PaymentError) return res.status(e.code === 'refund_failed' ? 502 : 409).json({ error: e.code });
    throw e;
  }
}));

const REPORT_CODES = { invalid_resolution: 400, reason_required: 400, not_found: 404 };
router.get('/reports', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ reports: await reports.listOpen() });
}));
router.post('/reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { await reports.resolve(req.params.id, req.adminUser, b.resolution, b.note); res.json({ ok: true }); }
  catch (e) {
    if (e instanceof reports.ReportError) return res.status(REPORT_CODES[e.code] || 400).json({ error: e.code });
    throw e;
  }
}));

router.get('/question-reports', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ reports: await reports.listOpenForQuestions() });
}));
router.post('/question-reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { await reports.resolveForQuestion(req.params.id, req.adminUser, b.resolution, b.note); res.json({ ok: true }); }
  catch (e) {
    if (e instanceof reports.ReportError) return res.status(REPORT_CODES[e.code] || 400).json({ error: e.code });
    throw e;
  }
}));

// ---- People to keep an eye on: minors, blocked contact details, the "unsafe" flag (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6) ----------
router.get('/people', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ people: await reports.people({ minor: req.query.minor === '1' }) });
}));
// "Unsafe" suspends a mentor while it is looked at: the usual suspension (their open questions are refunded, as with any suspension), and a flag that says why.
// Reinstating them closes the flag.
router.post('/people/:id/unsafe', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
  try {
    const out = await review.suspend({ mentorId: req.params.id, reason: `Marked unsafe: ${reason}`, admin: req.adminUser });
    await require('../verification/flags').openFlag(req.params.id, 'unsafe', { reason: reason.slice(0, 500), by: req.adminUser.email });
    res.json({ ok: true, ...(out && out.refunded !== undefined ? { refunded: out.refunded } : {}) });
  } catch (e) { fail(res, e); }
}));
// A wrong birth year and month (a typing mistake, somebody's own request): cleared, and they are asked again at their next login.
router.post('/people/:id/clear-age', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { rowCount } = await require('../db').query('UPDATE users SET birth_ym = NULL, age_group = NULL, age_confirmed_at = NULL, parent_permission_at = NULL WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not_found' });
  await steps.audit(req.params.id, steps.adminActor(req.adminUser), 'age_cleared', {});
  res.json({ ok: true });
}));

// ---- Video interview slots ----------------------------------------------------------------------------
router.get('/interviews', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ slots: await interviews.listForAdmin() });
}));

router.post('/interviews', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { res.status(201).json({ slots: await interviews.createSlots(req.adminUser, b.startsAt, b.minutes) }); } catch (e) { fail(res, e); }
}));

const slotRoute = (path, method, handler) => router[method](`/interviews/:id${path}`, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try { res.json((await handler(req)) || { ok: true }); } catch (e) { fail(res, e); }
}));
slotRoute('', 'delete', (req) => interviews.deleteOpenSlot(req.params.id));
slotRoute('/link', 'post', async (req) => ({ slot: await interviews.setMeetingLink(req.adminUser, req.params.id, (req.body || {}).link) }));
slotRoute('/cancel', 'post', (req) => interviews.adminCancel(req.adminUser, req.params.id, (req.body || {}).reason));
slotRoute('/result', 'post', (req) => interviews.recordResult(req.adminUser, req.params.id, req.body || {}));

// Download one uploaded document. Admins only, never cached, and every download is written to the audit log.
router.get('/documents/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const doc = await credentials.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not_found' });
  await steps.audit(doc.meta.userId, steps.adminActor(req.adminUser), 'document_viewed', { step: doc.meta.step, reason: doc.meta.filename });
  res.attachment(doc.meta.filename); // (Georgian letters too: docs/AUDIT.md #9)
  res.set({ 'Content-Type': doc.meta.mime, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
  res.send(doc.bytes);
}));

module.exports = router;