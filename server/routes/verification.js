const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler } = require('../util');
const { getUserById } = require('../models');
const rules = require('../verification/rules');
const steps = require('../verification/steps');
const kycService = require('../verification/kyc');

const router = express.Router();

const isMentor = (u) => u.role === 'mentor' || u.role === 'both';

// The mentor's own view of their verification: every requirement, its status, and any reason an
// admin gave. Sensitive details (ID data, licence number) are never included here.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });

  const stepRows = await steps.loadSteps(user.id);
  const summary = steps.describe(user, stepRows);
  const withDetail = (s) => {
    const row = stepRows[s.step];
    return { ...s, reason: row ? row.reason : null, updatedAt: row ? row.updatedAt : null, decidedAt: row ? row.decidedAt : null, expiresAt: row ? row.expiresAt : null };
  };
  res.json({
    status: user.verificationStatus,
    note: user.verificationNote,
    niche: user.niche,
    level: summary.level,
    regulated: summary.level === 'regulated',
    requirements: summary.requirements.map((r) => (r.type === 'step' ? withDetail(r) : { ...r, options: r.options.map(withDetail) })),
    ready: summary.ready,
    hasPayoutDetails: Boolean(user.payoutIbanEnc),
    listed: user.verificationStatus === 'verified' && Boolean(user.payoutIbanEnc)
  });
}));

// Starts the ID and selfie check with the provider. The mentor is sent to the returned address.
router.post('/kyc/start', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });
  if (!user.emailVerified) return res.status(400).json({ error: 'email_not_verified' });
  try {
    res.json(await kycService.startForMentor(user));
  } catch (e) {
    if (e instanceof steps.VerificationError) return res.status(409).json({ error: e.code });
    if (e.code === 'kyc_unavailable') return res.status(503).json({ error: 'kyc_unavailable' });
    console.error('[kyc] could not start a verification:', e.message);
    res.status(502).json({ error: 'kyc_error' });
  }
}));

// Just the status of the latest ID check, for the progress screen. No personal data.
router.get('/kyc', requireAuth, asyncHandler(async (req, res) => {
  const s = await kycService.latestSession(req.userToken.id);
  res.json({ status: s ? s.status : null });
}));

module.exports = router;