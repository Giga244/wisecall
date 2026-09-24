const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, optionalAuth } = require('../auth');
const { meProfile, asyncHandler } = require('../util');
const { getUserById, updateUser } = require('../models');
const config = require('../config');

const router = express.Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  if (!req.userToken) return res.json({ user: null });
  const user = await getUserById(req.userToken.id);
  res.json({ user: user ? meProfile(user) : null });
}));

const EDITABLE_FIELDS = ['name', 'bio', 'niche', 'roleTitle', 'price', 'language', 'proofUrl', 'sampleAnswer'];
const NICHES = [
  'business', 'medicine', 'teaching', 'tech', 'fitness', 'creative', 'law',
  'finance', 'marketing', 'design', 'writing', 'parenting', 'engineering', 'science'
];
const MENTOR_APPLICATION_FIELDS = ['niche', 'roleTitle', 'price', 'proofUrl', 'sampleAnswer'];
const URL_RE = /^https?:\/\/.+\..+/i;

router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const updates = req.body || {};
  // Every text field must really be text (or null), never an object or array.
  for (const field of ['name', 'bio', 'roleTitle', 'proofUrl', 'sampleAnswer', 'niche', 'language']) {
    const v = updates[field];
    if (v !== undefined && v !== null && typeof v !== 'string') return res.status(400).json({ error: 'invalid_field', field });
  }
  if (updates.price !== undefined && typeof updates.price !== 'number' && typeof updates.price !== 'string') return res.status(400).json({ error: 'invalid_price' });
  const existing = await getUserById(req.userToken.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Validate every provided field first and build the patch; nothing is written until
  // every check passes, so a rejected request can never leave a partial change behind.
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] === undefined) continue;
    if (field === 'price') {
      const n = Number(updates.price);
      if (!Number.isFinite(n) || n < config.PRICE_MIN || n > config.PRICE_MAX) return res.status(400).json({ error: 'invalid_price' });
      patch.price = Math.round(n);
    } else if (field === 'niche') {
      if (updates.niche !== null && !NICHES.includes(updates.niche)) return res.status(400).json({ error: 'invalid_niche' });
      patch.niche = updates.niche;
    } else if (field === 'language') {
      if (!['en', 'ka'].includes(updates.language)) return res.status(400).json({ error: 'invalid_language' });
      patch.language = updates.language;
    } else if (field === 'proofUrl') {
      const value = String(updates.proofUrl || '').trim();
      if (value && (!URL_RE.test(value) || value.length > 500)) return res.status(400).json({ error: 'invalid_proof_url' });
      patch.proofUrl = value || null;
    } else if (field === 'sampleAnswer') {
      patch.sampleAnswer = String(updates.sampleAnswer || '').trim().slice(0, 3000) || null;
    } else if (field === 'name') {
      const value = String(updates.name || '').trim().slice(0, 100);
      if (!value) return res.status(400).json({ error: 'missing_fields' });
      patch.name = value;
    } else {
      patch[field] = String(updates[field] || '').slice(0, 2000);
    }
  }

  if (updates.becomeMentor === true && existing.role === 'seeker') patch.role = 'mentor';
  if (updates.becomeMentor === false) patch.role = 'seeker';

  const next = { ...existing, ...patch };
  const isMentor = next.role === 'mentor' || next.role === 'both';
  const touchedMentorFields = MENTOR_APPLICATION_FIELDS.some((f) => updates[f] !== undefined);

  // Strict rule: saving mentor details needs a verified email, a proof link and a real sample answer.
  if (touchedMentorFields && isMentor) {
    if (!existing.emailVerified) return res.status(400).json({ error: 'email_not_verified' });
    if (!next.proofUrl) return res.status(400).json({ error: 'proof_required' });
    if (!next.sampleAnswer || next.sampleAnswer.length < 80) return res.status(400).json({ error: 'sample_required' });
  }

  // A complete (or edited) application goes back into the review queue.
  const complete = Boolean(next.roleTitle && next.niche && next.price && next.proofUrl && next.sampleAnswer);
  if (touchedMentorFields && isMentor && complete && existing.verificationStatus !== 'pending') {
    patch.verificationStatus = 'pending';
    patch.verificationNote = null;
  }

  const user = await updateUser(existing.id, patch);
  res.json({ user: meProfile(user) });
}));

router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  if (String(newPassword).length < 8 || String(newPassword).length > 200) return res.status(400).json({ error: 'weak_password' });

  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!(await bcrypt.compare(String(currentPassword), user.passwordHash))) return res.status(400).json({ error: 'wrong_password' });

  await updateUser(user.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
  res.json({ ok: true });
}));

module.exports = router;
