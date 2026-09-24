const express = require('express');
const bcrypt = require('bcryptjs');
const { load, withDb } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { meProfile } = require('../util');

const router = express.Router();

router.get('/', optionalAuth, (req, res) => {
  if (!req.userToken) return res.json({ user: null });
  const data = load();
  const user = data.users.find(u => u.id === req.userToken.id);
  if (!user) return res.json({ user: null });
  res.json({ user: meProfile(user) });
});

const EDITABLE_FIELDS = ['name', 'bio', 'niche', 'roleTitle', 'price', 'language', 'proofUrl', 'sampleAnswer'];
const NICHES = [
  'business', 'medicine', 'teaching', 'tech', 'fitness', 'creative', 'law',
  'finance', 'marketing', 'design', 'writing', 'parenting', 'engineering', 'science'
];
const MENTOR_APPLICATION_FIELDS = ['niche', 'roleTitle', 'price', 'proofUrl', 'sampleAnswer'];
const URL_RE = /^https?:\/\/.+\..+/i;

router.patch('/', requireAuth, (req, res) => {
  const updates = req.body || {};
  const data = load();
  const existingUser = data.users.find(u => u.id === req.userToken.id);
  if (!existingUser) return res.status(404).json({ error: 'not_found' });

  // Validate every provided field up front and compute the values to apply — nothing is
  // written to disk until every check passes, so a rejected request can never leave a
  // partial write behind (withDb always persists, even on an error return).
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] === undefined) continue;
    if (field === 'price') {
      const n = Number(updates.price);
      if (!Number.isFinite(n) || n < 1 || n > 5000) return res.status(400).json({ error: 'invalid_price' });
      patch.price = Math.round(n);
    } else if (field === 'niche') {
      if (updates.niche !== null && !NICHES.includes(updates.niche)) return res.status(400).json({ error: 'invalid_niche' });
      patch.niche = updates.niche;
    } else if (field === 'language') {
      if (!['en', 'ka'].includes(updates.language)) return res.status(400).json({ error: 'invalid_language' });
      patch.language = updates.language;
    } else if (field === 'proofUrl') {
      const value = String(updates.proofUrl || '').trim();
      if (value && !URL_RE.test(value)) return res.status(400).json({ error: 'invalid_proof_url' });
      patch.proofUrl = value || null;
    } else if (field === 'sampleAnswer') {
      patch.sampleAnswer = String(updates.sampleAnswer || '').trim().slice(0, 3000) || null;
    } else {
      patch[field] = String(updates[field]).slice(0, 2000);
    }
  }

  let nextRole = existingUser.role;
  if (updates.becomeMentor === true && existingUser.role === 'seeker') nextRole = 'mentor';
  if (updates.becomeMentor === false) nextRole = 'seeker';

  const nextProofUrl = patch.proofUrl !== undefined ? patch.proofUrl : existingUser.proofUrl;

  // Strict rule: saving mentor profile details requires a verified email AND a proof
  // link (LinkedIn, company bio page, etc). No proof, no mentor application — full stop.
  const touchedMentorFields = MENTOR_APPLICATION_FIELDS.some(f => updates[f] !== undefined);
  if (touchedMentorFields && (nextRole === 'mentor' || nextRole === 'both')) {
    if (!existingUser.emailVerified) return res.status(400).json({ error: 'email_not_verified' });
    if (!nextProofUrl) return res.status(400).json({ error: 'proof_required' });
    const nextSample = patch.sampleAnswer !== undefined ? patch.sampleAnswer : existingUser.sampleAnswer;
    if (!nextSample || nextSample.length < 80) return res.status(400).json({ error: 'sample_required' });
  }

  const result = withDb(d => {
    const user = d.users.find(u => u.id === req.userToken.id);
    if (!user) return { error: 'not_found' };

    Object.assign(user, patch);

    if (updates.becomeMentor === true && user.role === 'seeker') {
      user.role = 'mentor';
      user.rating = user.rating || null;
      user.verificationStatus = user.verificationStatus || 'none';
    }
    if (updates.becomeMentor === false) {
      user.role = 'seeker';
    }

    // Submitting a complete mentor application (or editing an already-listed one)
    // sends it back into the review queue — nobody appears publicly without a human check.
    const applicationComplete = Boolean(user.roleTitle && user.niche && user.price && user.proofUrl && user.sampleAnswer);
    if (touchedMentorFields && (user.role === 'mentor' || user.role === 'both') && applicationComplete) {
      if (user.verificationStatus !== 'pending') {
        user.verificationStatus = 'pending';
        user.verificationNote = null;
      }
    }

    return { user };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: meProfile(result.user) });
});

router.post('/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'weak_password' });

  const result = withDb(data => {
    const user = data.users.find(u => u.id === req.userToken.id);
    if (!user) return { error: 'not_found' };
    if (!bcrypt.compareSync(currentPassword, user.passwordHash)) return { error: 'wrong_password' };
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    return { ok: true };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

module.exports = router;
