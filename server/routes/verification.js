const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler, meProfile, isListable, verificationState } = require('../util');
const { getUserById } = require('../models');
const rules = require('../verification/rules');
const steps = require('../verification/steps');
const kycService = require('../verification/kyc');
const credentials = require('../verification/credentials');
const interviews = require('../verification/interviews');
const experience = require('../verification/experience');

const router = express.Router();

const isMentor = (u) => u.role === 'mentor' || u.role === 'both';

// The mentor's own view of their application: Identity -> Experience -> Review, what is missing, and where it stands, in plain words.
// Sensitive details (ID data, licence number) and the analysis itself (scores, risk) are never included here.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });

  await steps.syncEmailStep(user); // (a verified email counts from the start, not only once the application is sent)
  const stepRows = await steps.loadSteps(user.id);
  const summary = steps.describe(user, stepRows);
  const withDetail = (s) => {
    const row = stepRows[s.step];
    return { ...s, reason: row ? row.reason : null, updatedAt: row ? row.updatedAt : null, decidedAt: row ? row.decidedAt : null, expiresAt: row ? row.expiresAt : null };
  };
  res.json({
    rules: rules.VERSION,
    status: user.verificationStatus,
    // One word for every screen (banner, progress bar, steps): see util.verificationState. A failed required step is never "verified".
    state: verificationState(user),
    note: user.verificationNote,
    niche: user.niche,
    level: summary.level,
    regulated: summary.regulated,
    requirements: summary.requirements.map(withDetail),
    optional: summary.optional.map(withDetail),
    ready: summary.ready,
    // Where the ID check stands, for the progress screen: 'started', 'in_review', 'approved', ...
    kycState: (stepRows.id_kyc && stepRows.id_kyc.evidence && stepRows.id_kyc.evidence.state) || null,
    application: await experience.applicationFor(user, stepRows),
    // What mentors in this field usually ask (the middle half of listed prices, once there are 3), else 20–50 ₾; and the universities
    // a link is recognised from (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2).
    priceRange: await experience.priceRangeFor(user.niche),
    universities: require('../universities').LIST.map((u) => ({ domain: u.domain, en: u.en, ka: u.ka })),
    limits: {
      titleMax: rules.LIMITS.titleMax, tagsMax: rules.LIMITS.tagsMax, tagMax: rules.LIMITS.tagMax, yearsMax: rules.LIMITS.yearsMax,
      storyMin: rules.LIMITS.storyMin, storyMax: rules.LIMITS.storyMax, sampleMin: rules.LIMITS.sampleMin, sampleMax: rules.LIMITS.sampleMax,
      evidenceMax: rules.LIMITS.evidenceMax, evidenceNoteMax: rules.LIMITS.evidenceNoteMax, minutesToApply: rules.LIMITS.minutesToApply
    },
    evidenceKinds: rules.EVIDENCE_KINDS,
    licence: summary.regulated ? { publicRegister: Boolean(rules.REGULATED[user.niche] && rules.REGULATED[user.niche].publicRegister),
      credential: (rules.REGULATED[user.niche] && rules.REGULATED[user.niche].credential) || 'licence' } : null,
    inputs: {
      license: await credentials.ownCredentials(user.id),
      workEmailDomain: user.workEmail ? user.workEmail.split('@')[1] : null,
      documents: (await credentials.listDocuments(user.id)).map(({ id, step, filename, size, uploadedAt }) => ({ id, step, filename, size, uploadedAt }))
    },
    hasPayoutDetails: Boolean(user.payoutIbanEnc),
    listed: isListable(user)
  });
}));

// Starts the ID and selfie check with the provider. The mentor is sent to the returned address.
router.post('/kyc/start', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });
  // (the email code may still be on its way: the ID check does not wait for it, docs/CLAUDE-CODE-EMAIL-CODE-FIX.md; approval does)
  try {
    const out = await kycService.startForMentor(user);
    require('../analytics').event('id_check_started', req);
    // On a computer: the partner's link as a QR code, to do the check on a phone (its camera) instead. Never an empty answer: when the code
    // cannot be drawn the page is told so, with the link itself to open on the phone.
    if (req.body && req.body.qr === true) {
      try {
        out.qr = await require('qrcode').toString(out.url, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' });
      } catch (e) {
        console.error('[kyc] could not draw the QR code:', e.message);
        return res.status(502).json({ error: 'qr_failed', url: out.url });
      }
    }
    res.json(out);
  } catch (e) {
    if (e instanceof steps.VerificationError) return res.status(409).json({ error: e.code });
    if (e.code === 'kyc_unavailable') return res.status(503).json({ error: 'kyc_unavailable' });
    if (e.code === 'kyc_no_credit') {
      await kycService.noCredit(user, e).catch((err) => console.error('[kyc] kyc_no_credit could not be recorded:', err.message));
      return res.status(503).json({ error: 'kyc_no_credit' });
    }
    console.error('[kyc] could not start a verification:', e.message);
    res.status(502).json({ error: 'kyc_error' });
  }
}));

// Just the status of the latest ID check, for the progress screen. No personal data.
router.get('/kyc', requireAuth, asyncHandler(async (req, res) => {
  const s = await kycService.latestSession(req.userToken.id);
  res.json({ status: s ? s.status : null });
}));

// ---- What the mentor submits --------------------------------------------------------------------------------------------
const CODE_STATUS = {
  not_required: 409, invalid_state: 409, no_pending_code: 409, not_found: 404, unknown_step: 404,
  too_many_files: 409, file_too_large: 413, unsupported_file_type: 415,
  slot_unavailable: 409, already_booked: 409, id_check_first: 409, already_passed: 409, too_late: 409,
  application_locked: 409, already_submitted: 409, licence_missing: 409, nothing_changed: 409, same_price: 409, incomplete: 400, duplicate_evidence: 409, too_much_evidence: 409
};

// Turns a VerificationError into a JSON reply (400 unless mapped above); anything else is a real error.
function fail(res, e) {
  if (e instanceof steps.VerificationError) {
    return res.status(CODE_STATUS[e.code] || 400).json({ error: e.code, ...(e.field ? { field: e.field } : {}), ...(e.missing ? { missing: e.missing } : {}) });
  }
  throw e;
}

// Loads the signed-in mentor, or replies with the right error and returns null.
async function mentorOr(req, res) {
  const user = await getUserById(req.userToken.id);
  if (!user) { res.status(404).json({ error: 'not_found' }); return null; }
  if (!isMentor(user)) { res.status(400).json({ error: 'not_a_mentor' }); return null; }
  return user;
}

const submit = (handler) => [requireAuth, asyncHandler(async (req, res) => {
  const user = await mentorOr(req, res);
  if (!user) return;
  const before = await experience.stepsDone(user).catch(() => [true, true, true, true]);
  try {
    res.json((await handler(user, req.body || {}, req, res)) || { ok: true });
    experience.trackSteps(req, before, user.id);
  } catch (e) {
    // (what was refused, by its code only: never the person or what they wrote; docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md)
    if (e instanceof steps.VerificationError) console.warn(`[verification] refused ${req.method} ${req.baseUrl}${req.path} ${e.code}${e.field ? ` (${e.field})` : ''}`);
    fail(res, e);
  }
})];

// Step 2: the Experience form (saved as a draft), the evidence list, then "Submit for review".
router.put('/experience', ...submit(async (user, b) => {
  return { user: meProfile(await experience.saveExperience(user, b)) };
}));
router.post('/evidence', ...submit(async (user, b) => {
  const item = await experience.addEvidence(user, b);
  await require('../verification/reminders').touch(user.id);
  return { evidence: { id: item.id, kind: item.kind, url: item.url, registryId: item.registryId, note: item.note } };
}));
router.delete('/evidence/:id', ...submit(async (user, b, req) => { await experience.removeEvidence(user, req.params.id); }));
router.post('/submit', ...submit(async (user, b, req, res) => {
  const sentUser = await experience.submit(user, { req, res });
  const out = { user: meProfile(sentUser) };
  // (what happens next, by email too; sent while the ID check is still to do: "one step left" instead, once, with a link that starts it)
  const id = experience.idStatusOf(await steps.loadSteps(user.id));
  if (experience.ID_LEFT.includes(id)) await require('../verification/reminders').oneStepLeft(sentUser);
  else require('../notify').notifyApplicationReceived(sentUser);
  require('../analytics').event('mentor_application_submitted', req);
  require('../analytics').event('apply_sent', req);
  const source = require('../attribution').read(req);
  if (source) await require('../db').query('UPDATE users SET application_source = $2 WHERE id = $1 AND application_source IS NULL', [user.id, JSON.stringify(source)]);
  return out;
}));
router.post('/edit', ...submit(async (user) => ({ user: meProfile(await experience.withdraw(user)) })));

// Regulated niches: the licence or registration. Optional for everyone: a work email (badge).
// (an approved mentor moving into a licensed field sends that field's licence before the move is approved: server/mentorEdit.js forLicence)
router.post('/license', ...submit(async (user, b) => credentials.submitLicense(await require('../mentorEdit').forLicence(user), b)));
router.post('/work-email', ...submit((user, b) => credentials.startWorkEmail(user, b.email)));
router.post('/work-email/verify', ...submit((user, b) => credentials.verifyWorkEmail(user, b.code)));

// A private document arrives as the raw file bytes; its name comes in the X-Filename header.
//   diploma           a diploma or certificate, as a piece of evidence (anyone)
//   license_document  the licence itself (regulated niches without a public register)
router.post('/documents/:step', requireAuth, asyncHandler(async (req, res) => {
  const user = await mentorOr(req, res);
  if (!user) return;
  let filename = String(req.get('x-filename') || 'document');
  try { filename = decodeURIComponent(filename); } catch (e) { /* keep it as sent */ }
  try {
    const out = await require('../mentorEdit').storeDocument(user, req.params.step, { filename, buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) });
    res.status(201).json(out);
  } catch (e) { fail(res, e); }
}));

router.delete('/documents/:id', requireAuth, asyncHandler(async (req, res) => {
  const user = await mentorOr(req, res);
  if (!user) return;
  try { await credentials.deleteOwnDocument(user, req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));

// ---- Video interview (only when an admin asked for one) ------------------------------------------------------------------
router.get('/interview', requireAuth, asyncHandler(async (req, res) => {
  const user = await mentorOr(req, res);
  if (user) res.json(await interviews.overview(user));
}));
router.post('/interview/book', ...submit(async (user, b) => ({ booking: await interviews.book(user, b.slotId) })));
router.post('/interview/cancel', ...submit((user) => interviews.cancel(user)));

module.exports = router;
