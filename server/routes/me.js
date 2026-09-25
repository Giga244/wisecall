const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, optionalAuth } = require('../auth');
const { meProfile, asyncHandler, isListable } = require('../util');
const { parseProfileUpdates, setPhoto, removePhoto } = require('../profiles');
const { processPhoto, ImageError } = require('../images');
const usernames = require('../usernames');
const identities = require('../identities');
const { query } = require('../db');
const { encrypt, decrypt } = require('../cryptoBox');
const { isValidGeorgianIban, normalize, pretty } = require('../iban');
const ledger = require('../ledger');
const rules = require('../verification/rules');
const verification = require('../verification/steps');
const names = require('../verification/names');
const { getUserById, updateUser } = require('../models');
const config = require('../config');

const router = express.Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  if (!req.userToken) return res.json({ user: null });
  const user = await getUserById(req.userToken.id);
  res.json({ user: user ? meProfile(user) : null });
}));

const EDITABLE_FIELDS = ['name', 'niche', 'roleTitle', 'price', 'language', 'proofUrl', 'sampleAnswer'];
const NICHES = rules.nicheKeys();
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

  // The public profile: headline, current work, city, languages, bio, links, who may see it.
  const profile = parseProfileUpdates(updates, { listable: isListable(existing) });
  if (profile.error) return res.status(400).json({ error: profile.error, field: profile.field });
  Object.assign(patch, profile.patch);

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

  // A complete application goes into the review queue. Changing what an admin already judged (niche,
  // title, proof link, sample answer) sends a live mentor back to review; changing the price does not.
  const complete = Boolean(next.roleTitle && next.niche && next.price && next.proofUrl && next.sampleAnswer);
  const changed = ['niche', 'roleTitle', 'proofUrl', 'sampleAnswer'].filter((f) => patch[f] !== undefined && patch[f] !== existing[f]);
  const canReview = existing.verificationStatus !== 'suspended';
  if (touchedMentorFields && isMentor && complete && canReview && (changed.length || ['none', 'rejected'].includes(existing.verificationStatus))) {
    patch.verificationStatus = 'pending';
    patch.verificationNote = null;
  }

  const user = await updateUser(existing.id, patch);

  // The two steps the mentor completes here go to an admin (again, when they were edited).
  if (touchedMentorFields && isMentor && complete) {
    const actor = verification.mentorActor(user);
    const current = await verification.loadSteps(user.id);
    if (!current.proof_link || changed.includes('proofUrl')) await verification.setStep(user.id, 'proof_link', 'pending', { evidence: { url: user.proofUrl }, replaceEvidence: true, actor });
    if (!current.sample_answer || changed.includes('sampleAnswer')) await verification.setStep(user.id, 'sample_answer', 'pending', { evidence: { length: user.sampleAnswer.length }, replaceEvidence: true, actor });
    await verification.syncEmailStep(user);
  }
  // A changed name is compared with the ID again.
  if (isMentor && patch.name !== undefined && patch.name !== existing.name) await names.recompute(user.id);
  res.json({ user: meProfile(user) });
}));

// The username (the /u/<name> address): once every 30 days; the old one keeps redirecting.
const USERNAME_STATUS = { invalid_username: 400, reserved_username: 400, username_taken: 409, username_change_too_soon: 429, not_found: 404 };
router.put('/username', requireAuth, asyncHandler(async (req, res) => {
  const wanted = (req.body || {}).username;
  if (typeof wanted !== 'string') return res.status(400).json({ error: 'missing_fields' });
  try {
    const r = await usernames.change(req.userToken.id, wanted);
    res.json({ user: meProfile(await getUserById(req.userToken.id)), changed: r.changed });
  } catch (e) {
    if (e instanceof usernames.UsernameError) return res.status(USERNAME_STATUS[e.code] || 400).json({ error: e.code, ...(e.nextChangeAt ? { nextChangeAt: e.nextChangeAt } : {}) });
    throw e;
  }
}));

// The profile photo: the raw file is the request body. It is checked, resized, stripped of its metadata and re-encoded.
const PHOTO_STATUS = { empty_file: 400, unsupported_image_type: 400, invalid_image: 400, file_too_large: 413 };
router.post('/photo', requireAuth, asyncHandler(async (req, res) => {
  try {
    const img = await processPhoto(Buffer.isBuffer(req.body) ? req.body : null);
    await setPhoto(req.userToken.id, img, 'upload');
    res.json({ user: meProfile(await getUserById(req.userToken.id)) });
  } catch (e) {
    if (e instanceof ImageError) return res.status(PHOTO_STATUS[e.code] || 400).json({ error: e.code });
    throw e;
  }
}));

router.delete('/photo', requireAuth, asyncHandler(async (req, res) => {
  await removePhoto(req.userToken.id);
  res.json({ user: meProfile(await getUserById(req.userToken.id)) });
}));

const isMentor = (u) => u.role === 'mentor' || u.role === 'both';

// A mentor's payout details: full name and Georgian IBAN. Only the mentor (and admins, through the
// admin panel) can ever read the IBAN back.
router.get('/payout', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  const iban = decrypt(user.payoutIbanEnc);
  res.json({ hasPayoutDetails: Boolean(user.payoutIbanEnc), name: user.payoutName || '', iban: iban ? pretty(iban) : '', last4: user.payoutIbanLast4 || '' });
}));

router.put('/payout', requireAuth, asyncHandler(async (req, res) => {
  const { name, iban } = req.body || {};
  if (typeof name !== 'string' || typeof iban !== 'string') return res.status(400).json({ error: 'missing_fields' });
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });

  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 5 || cleanName.length > 100 || !cleanName.includes(' ')) return res.status(400).json({ error: 'invalid_payout_name' });
  if (!isValidGeorgianIban(iban)) return res.status(400).json({ error: 'invalid_iban' });

  const normalized = normalize(iban);
  const updated = await updateUser(user.id, {
    payoutName: cleanName,
    payoutIbanEnc: encrypt(normalized),
    payoutIbanLast4: normalized.slice(-4),
    payoutUpdatedAt: new Date()
  });
  // The account holder's name is compared with the name on the ID.
  await names.recompute(user.id);
  require('../waitlist').afterMaybeListed(user.id); // an approved mentor becomes visible once they can be paid
  res.json({ user: meProfile(updated), name: cleanName, iban: pretty(normalized), last4: normalized.slice(-4) });
}));

// What the mentor has earned, what is payable, and what has been paid (for the dashboard).
router.get('/earnings', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  const [balance, items, batches] = await Promise.all([
    ledger.balanceFor(user.id),
    query(
      `SELECT p.booking_id, p.amount, p.status, p.payable_at, p.debt_flagged_at, p.debt_settled_batch_id, pb.paid_at, pb.reference, b.question
         FROM payouts p JOIN bookings b ON b.id = p.booking_id LEFT JOIN payout_batches pb ON pb.id = p.batch_id
        WHERE p.mentor_id = $1 ORDER BY p.created_at DESC LIMIT 200`, [user.id]),
    query('SELECT id, amount, reference, paid_at FROM payout_batches WHERE mentor_id = $1 ORDER BY paid_at DESC LIMIT 100', [user.id])
  ]);
  res.json({
    currency: config.CURRENCY,
    holdDays: config.PAYOUT_HOLD_DAYS,
    balance,
    items: items.rows.map((r) => ({
      bookingId: r.booking_id, amount: r.amount, status: r.status, payableAt: r.payable_at, paidAt: r.paid_at, reference: r.reference,
      question: String(r.question).slice(0, 90), owedBack: Boolean(r.debt_flagged_at), owedBackSettled: Boolean(r.debt_settled_batch_id)
    })),
    batches: batches.rows.map((r) => ({ id: r.id, amount: r.amount, reference: r.reference, paidAt: r.paid_at }))
  });
}));

router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  // Someone who signed in with Google and never had a password can set one without a "current" password.
  const hasPassword = Boolean(user.passwordHash);
  if (typeof newPassword !== 'string' || !newPassword || (hasPassword && (typeof currentPassword !== 'string' || !currentPassword))) return res.status(400).json({ error: 'missing_fields' });
  if (String(newPassword).length < 8 || String(newPassword).length > 200) return res.status(400).json({ error: 'weak_password' });
  if (hasPassword && !(await bcrypt.compare(String(currentPassword), user.passwordHash))) return res.status(400).json({ error: 'wrong_password' });

  await updateUser(user.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
  res.json({ ok: true });
}));

// Connected accounts (Settings > Account): is Google connected, can it be disconnected.
async function identitiesFor(user) {
  const g = await identities.googleFor(user.id);
  return {
    googleEnabled: config.GOOGLE_ENABLED,
    hasPassword: Boolean(user.passwordHash),
    google: g ? { email: g.email, since: g.created_at } : null
  };
}
router.get('/identities', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json(await identitiesFor(user));
}));

// Disconnecting Google is refused when it is the only way to sign in: the person must set a password first.
router.delete('/identities/google', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!(await identities.googleFor(user.id))) return res.status(404).json({ error: 'not_connected' });
  if (!user.passwordHash) return res.status(400).json({ error: 'set_password_first' });
  await identities.unlinkGoogle(user.id);
  res.json(await identitiesFor(user));
}));

module.exports = router;
