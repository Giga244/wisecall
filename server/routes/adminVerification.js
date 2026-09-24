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

const router = express.Router();
const UUID = /^[0-9a-f-]{36}$/i;

const STATUS_FOR_CODE = {
  not_found: 404, unknown_step: 404,
  reason_required: 400, invalid_decision: 400,
  not_manual: 409, not_submitted: 409, invalid_state: 409, steps_incomplete: 409
};

// Turns a VerificationError into a JSON reply; anything else is a real error.
function fail(res, e) {
  if (e instanceof steps.VerificationError) {
    return res.status(STATUS_FOR_CODE[e.code] || 400).json({ error: e.code, missing: e.missing });
  }
  throw e;
}

// Everything an admin needs to review one application: every requirement with its status, the
// evidence, who decided and why, the official registries to check, and the full audit log.
router.get('/mentors/:id/verification', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const mentor = await getUserById(req.params.id);
  if (!mentor || !(mentor.role === 'mentor' || mentor.role === 'both')) return res.status(404).json({ error: 'not_found' });

  const [stepRows, auditRows] = await Promise.all([
    query(`SELECT s.*, u.email AS decided_by_email FROM verification_steps s LEFT JOIN users u ON u.id = s.decided_by WHERE s.user_id = $1`, [mentor.id]),
    query(`SELECT * FROM verification_audit WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT 200`, [mentor.id])
  ]);
  const detail = {};
  stepRows.rows.forEach((r) => {
    detail[r.step] = {
      step: r.step, status: steps.effectiveStatus({ status: r.status, expiresAt: r.expires_at }), rawStatus: r.status, evidence: r.evidence || {},
      reason: r.reason, decidedAt: r.decided_at, decidedBy: r.decided_by_email || (r.decided_by ? null : (r.status === 'pending' ? null : 'system')),
      expiresAt: r.expires_at, updatedAt: r.updated_at, manual: ['admin', 'auto+admin'].includes(rules.STEPS[r.step] && rules.STEPS[r.step].decider)
    };
  });
  const summary = steps.describe(mentor, Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, { status: v.rawStatus, expiresAt: v.expiresAt }])));

  res.json({
    mentor: {
      ...meProfile(mentor), sampleAnswer: mentor.sampleAnswer, proofUrl: mentor.proofUrl
    },
    level: summary.level,
    requirements: summary.requirements.map((r) => (r.type === 'step'
      ? { ...r, ...(detail[r.step] || {}), status: r.status }
      : { ...r, options: r.options.map((o) => ({ ...o, ...(detail[o.step] || {}), status: o.status })) })),
    ready: summary.ready,
    missing: summary.missing,
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

router.post('/mentors/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const mentor = await review.approve({ mentorId: req.params.id, admin: req.adminUser });
    notify.notifyMentorDecision(mentor, true, null);
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

module.exports = router;
