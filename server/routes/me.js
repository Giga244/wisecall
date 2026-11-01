const express = require('express');
const auth = require('../auth');
const bcrypt = require('bcryptjs');
const { requireAuth, optionalAuth, HINT_COOKIE } = require('../auth');
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
const experience = require('../verification/experience');
const { getUserById, updateUser } = require('../models');
const config = require('../config');
const ageGate = require('../ageGate');

const router = express.Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const user = req.userToken ? await getUserById(req.userToken.id) : null;
  // (signed out, or the session ran out: the header's "signed in" hint goes too, see server/auth.js)
  if (!user && req.cookies && req.cookies[HINT_COOKIE]) res.clearCookie(HINT_COOKIE);
  // (and where they are on the way to becoming a mentor: the "Become a mentor" button on every page, server/verification/experience.js)
  res.json({ user: user ? { ...meProfile(user), mentorPath: await experience.progressFor(user) } : null });
}));

const EDITABLE_FIELDS = ['name', 'niche', 'roleTitle', 'price', 'freeWeeklyCap', 'language', 'theme', 'sampleAnswer'];
// Part of the mentor application (step 2, "Experience"): they cannot change while it is being reviewed or once it is approved (the
// mentor presses "Edit my application" first). The price is not part of the application and can change at any time.
const APPLICATION_FIELDS = ['niche', 'roleTitle', 'sampleAnswer'];

// The birth year and month, once: for an account from before the age rule (asked at the next login, and before a first question). Under 16
// nothing is kept and the account stays as it is, without questions. It cannot be changed afterwards (an admin can clear a mistake).
router.post('/age', requireAuth, asyncHandler(async (req, res) => {
  const existing = await getUserById(req.userToken.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.birthYm) return res.status(409).json({ error: 'age_already_set' });
  const age = ageGate.check((req.body || {}).birthYm, (req.body || {}).parentPermission);
  // (a mentor's account is for 18 or older: that comes before asking for a parent's permission)
  if (age.error === 'parent_permission_required' && (existing.role === 'mentor' || existing.role === 'both')) return res.status(403).json({ error: 'mentor_18' });
  if (age.error) return res.status(age.status).json({ error: age.error });
  if (age.group !== ageGate.ADULT && (existing.role === 'mentor' || existing.role === 'both')) return res.status(403).json({ error: 'mentor_18' });
  await ageGate.save(existing.id, age);
  res.json({ user: meProfile(await getUserById(existing.id)) });
}));

router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const updates = req.body || {};
  // Every text field must really be text (or null), never an object or array.
  for (const field of ['name', 'bio', 'roleTitle', 'sampleAnswer', 'niche', 'language', 'theme']) {
    const v = updates[field];
    if (v !== undefined && v !== null && typeof v !== 'string') return res.status(400).json({ error: 'invalid_field', field });
  }
  if (updates.price !== undefined && typeof updates.price !== 'number' && typeof updates.price !== 'string') return res.status(400).json({ error: 'invalid_price' });
  const existing = await getUserById(req.userToken.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  // "I am 18 or older", for an account made with Google (the sign-up form asks it for everyone else). Recorded once.
  if (updates.adultConfirmed === true && !existing.adultConfirmedAt) {
    await require('../db').query('UPDATE users SET adult_confirmed_at = now() WHERE id = $1 AND adult_confirmed_at IS NULL', [existing.id]);
  }

  // Validate every provided field first and build the patch; nothing is written until
  // every check passes, so a rejected request can never leave a partial change behind.
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] === undefined) continue;
    if (field === 'price') {
      const n = Number(updates.price);
      // 0 is "answer for free" (docs/CLAUDE-CODE-FREE-ANSWERS.md); a paid price is PRICE_MIN to PRICE_MAX.
      if (updates.price === '' || !Number.isFinite(n) || (n !== 0 && (n < config.PRICE_MIN || n > config.PRICE_MAX))) return res.status(400).json({ error: 'invalid_price' });
      patch.price = Math.round(n);
    } else if (field === 'freeWeeklyCap') {
      const n = Number(updates.freeWeeklyCap);
      if (!Number.isInteger(n) || n < 1 || n > config.FREE_WEEKLY_CAP_MAX) return res.status(400).json({ error: 'invalid_free_cap', max: config.FREE_WEEKLY_CAP_MAX });
      patch.freeWeeklyCap = n;
    } else if (field === 'niche') {
      if (updates.niche !== null && !rules.isValidNiche(updates.niche)) return res.status(400).json({ error: 'invalid_niche' }); // ("Other" is chosen in the Experience form)
      patch.niche = updates.niche;
    } else if (field === 'theme') {
      if (updates.theme !== null && !['system', 'light', 'dark'].includes(updates.theme)) return res.status(400).json({ error: 'invalid_theme' });
      patch.theme = updates.theme;
    } else if (field === 'language') {
      if (!['en', 'ka'].includes(updates.language)) return res.status(400).json({ error: 'invalid_language' });
      patch.language = updates.language;
    } else if (field === 'sampleAnswer') {
      patch.sampleAnswer = String(updates.sampleAnswer || '').trim().slice(0, rules.LIMITS.sampleMax) || null;
    } else if (field === 'name') {
      const value = String(updates.name || '').trim().slice(0, 100);
      if (!value) return res.status(400).json({ error: 'missing_fields' });
      patch.name = value;
    } else {
      patch[field] = String(updates[field] || '').slice(0, 2000);
    }
  }

  // "Show my profile on the home page" (mentors; off unless they choose it).
  if (updates.showOnHome !== undefined) {
    if (typeof updates.showOnHome !== 'boolean') return res.status(400).json({ error: 'invalid_field', field: 'showOnHome' });
    patch.showOnHome = updates.showOnHome;
  }

  // Public answers: always allow / ask me each time / never (mentors).
  if (updates.publicAnswersPref !== undefined) {
    if (!require('../publicAnswers').PREFS.includes(updates.publicAnswersPref)) return res.status(400).json({ error: 'invalid_field', field: 'publicAnswersPref' });
    patch.publicAnswersPref = updates.publicAnswersPref;
  }

  // The public profile: headline, current work, city, languages, bio, links, who may see it.
  const profile = parseProfileUpdates(updates, { listable: isListable(existing) });
  if (profile.error) return res.status(400).json({ error: profile.error, field: profile.field });
  Object.assign(patch, profile.patch);

  // Being a mentor is from 18: whoever told us they are younger stops here. (The ID check decides for everybody else.)
  if (updates.becomeMentor === true && ageGate.isMinor(existing)) return res.status(403).json({ error: 'mentor_18' });
  // (a minor's profile stays private: server/profiles.js)
  if (ageGate.isMinor(existing)) delete patch.profileVisibility;
  if (updates.becomeMentor === true && existing.role === 'seeker') { patch.role = 'mentor'; require('../analytics').event('mentor_application_started', req); }
  // (the price is step 3 of the application: its "done" event, when this save completes it)
  const stepsBefore = updates.price !== undefined ? await require('../verification/experience').stepsDone(existing).catch(() => null) : null;
  if (updates.becomeMentor === false) patch.role = 'seeker';

  const next = { ...existing, ...patch };
  const isMentor = next.role === 'mentor' || next.role === 'both';
  const changedApplication = APPLICATION_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== existing[f]);

  // Saving mentor details needs a verified email, and the application cannot change while it is reviewed or approved.
  if (changedApplication.length && isMentor) {
    if (!existing.emailVerified) return res.status(400).json({ error: 'email_not_verified' });
    if (experience.isLocked(existing)) return res.status(409).json({ error: 'application_locked' });
  }

  if (isMentor && changedApplication.length) experience.applyFieldRules(existing, patch);
  // (the profile's "About me" and the application's story stay one text while they are the same: server/verification/experience.js)
  if (isMentor && patch.bio !== undefined) experience.bioToStory(existing, patch);
  const user = await updateUser(existing.id, patch);
  // (the headline and the price are part of the application: its reminders count from this change)
  if (isMentor && (patch.price !== undefined || patch.headline !== undefined)) await require('../verification/reminders').touch(user.id);
  if (isMentor && changedApplication.length) await verification.syncEmailStep(user);
  // A changed name is compared with the ID again (a mentor fixing a name that did not match is checked at once).
  if (isMentor && patch.name !== undefined && patch.name !== existing.name) {
    await names.recompute(user.id);
    // Evidence pages are checked for the mentor's name, so an application already analysed is analysed again with the new name.
    if (experience.submitted(user)) require('../verification/analysis').afterNameChange(user.id);
  }
  // An approved mentor who answered for free and now sets a price needs payout details to stay in Browse experts: the page asks for them
  // now (and not before: a free mentor never needs a bank account).
  const payoutNeeded = patch.price > 0 && existing.verificationStatus === 'verified' && !existing.payoutIbanEnc;
  res.json({ user: meProfile(user), ...(payoutNeeded ? { payoutNeeded: true } : {}) });
  if (stepsBefore) require('../verification/experience').trackSteps(req, stepsBefore, user.id);
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
  const { name, iban, currentPassword } = req.body || {};
  if (typeof name !== 'string' || typeof iban !== 'string') return res.status(400).json({ error: 'missing_fields' });
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!isMentor(user)) return res.status(400).json({ error: 'not_a_mentor' });
  // Where the money goes is protected like the password: the current password, or (an account made with Google) a recent sign-in.
  if (user.passwordHash) {
    if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ error: 'password_required' });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ error: 'wrong_password' });
  } else if (!(await auth.signedInRecently(user.id, req.userToken.sid, config.REAUTH_MINUTES))) {
    return res.status(403).json({ error: 'reauth_required', minutes: config.REAUTH_MINUTES });
  }

  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 5 || cleanName.length > 100 || !cleanName.includes(' ')) return res.status(400).json({ error: 'invalid_payout_name' });
  if (!isValidGeorgianIban(iban)) return res.status(400).json({ error: 'invalid_iban' });

  const normalized = normalize(iban);
  // Changing details that were already saved: the mentor is told by email, and their payouts wait (a stolen account cannot redirect
  // money before the owner can react). The first details a mentor saves are not a change.
  const before = user.payoutIbanEnc ? decrypt(user.payoutIbanEnc) : null;
  const changed = Boolean(before) && (before !== normalized || user.payoutName !== cleanName);
  const holdUntil = changed && config.PAYOUT_CHANGE_HOLD_HOURS ? new Date(Date.now() + config.PAYOUT_CHANGE_HOLD_HOURS * 3600000) : undefined;
  const updated = await updateUser(user.id, {
    payoutName: cleanName,
    payoutIbanEnc: encrypt(normalized),
    payoutIbanLast4: normalized.slice(-4),
    payoutUpdatedAt: new Date(),
    ...(holdUntil ? { payoutHoldUntil: holdUntil } : {})
  });
  if (changed) {
    require('../notify').notifyPayoutChanged(updated, { oldLast4: before.slice(-4), newLast4: normalized.slice(-4), holdUntil });
    await verification.audit(user.id, verification.mentorActor(user), 'payout_changed', { reason: `account ending ${before.slice(-4)} -> ${normalized.slice(-4)}${holdUntil ? `; payouts held until ${holdUntil.toISOString()}` : ''}` });
    // A withdrawal asked for before the change is closed (its money waits for the hold like the rest), so a stolen account cannot ask
    // for the money first and then change where it goes (docs/security-audit M1). The mentor is told.
    await require('../withdrawals').rejectOpenRequest(updated);
  }
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
      `SELECT p.booking_id, p.amount, p.status, p.payable_at, p.debt_flagged_at, (p.debt_settled_amount >= COALESCE(p.debt_amount, p.amount)) AS debt_settled, pb.paid_at, pb.reference, b.question
         FROM payouts p JOIN bookings b ON b.id = p.booking_id LEFT JOIN payout_batches pb ON pb.id = p.batch_id
        WHERE p.mentor_id = $1 ORDER BY p.created_at DESC LIMIT 200`, [user.id]),
    query(`SELECT id, amount, reference, paid_at FROM payout_batches WHERE mentor_id = $1 AND status = 'paid' ORDER BY paid_at DESC LIMIT 100`, [user.id])
  ]);
  res.json({
    currency: config.CURRENCY,
    holdDays: config.PAYOUT_HOLD_DAYS,
    balance,
    items: items.rows.map((r) => ({
      bookingId: r.booking_id, amount: r.amount, status: r.status, payableAt: r.payable_at, paidAt: r.paid_at, reference: r.reference,
      question: String(r.question).slice(0, 90), owedBack: Boolean(r.debt_flagged_at), owedBackSettled: Boolean(r.debt_flagged_at && r.debt_settled)
    })),
    batches: batches.rows.map((r) => ({ id: r.id, amount: r.amount, reference: r.reference, paidAt: r.paid_at }))
  });
}));

// The Balance card (Dashboard and Settings → Payouts): available, on hold (with dates), requested, paid out, owed back; the withdrawal
// history; and what, if anything, stands in the way of a withdrawal.
router.get('/balance', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json(await require('../withdrawals').summary(user));
}));

// "Withdraw": the whole available amount (the server computes it; nothing the page sends changes it). Needs the current password, or a
// recent sign-in for an account without one. Asking again while a request is open returns that request.
const WITHDRAW_STATUS = { not_found: 404, password_required: 400, wrong_password: 400, reauth_required: 403, suspended: 403, no_payout_details: 409,
  name_mismatch: 409, open_flags: 409, nothing_available: 409, below_minimum: 409, debt_exceeds_available: 409 };
router.post('/withdrawals', requireAuth, asyncHandler(async (req, res) => {
  const withdrawals = require('../withdrawals');
  try {
    const r = await withdrawals.request({ mentorId: req.userToken.id, password: (req.body || {}).currentPassword, sessionId: req.userToken.sid });
    res.status(r.existing ? 200 : 201).json(r);
  } catch (e) {
    if (!(e instanceof withdrawals.WithdrawalError)) throw e;
    res.status(WITHDRAW_STATUS[e.code] || 400).json({ error: e.code, ...(e.minimum ? { minimum: e.minimum } : {}), ...(e.minutes ? { minutes: e.minutes } : {}) });
  }
}));

// The password typed to confirm an action can only be guessed slowly: per account here, per address in server/index.js (REVIEW-2 #5).
const reauthGuard = require('../reauthGuard');
function tooManyWrong(res, userId) {
  const wait = reauthGuard.blocked(userId);
  if (!wait) return false;
  res.set('Retry-After', String(wait)).status(429).json({ error: 'too_many_requests' });
  return true;
}

router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, code } = req.body || {};
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  // Someone who signed in with Google and never had a password sets one without a "current" password, but only right after a real sign-in
  // on this device, and with two-step verification on, with a current code from the app too: a stolen session must not be able to add a
  // password, which would then unlock the payout details, turning two-step verification off and deleting the account (docs/security-audit C1).
  const hasPassword = Boolean(user.passwordHash);
  if (typeof newPassword !== 'string' || !newPassword || (hasPassword && (typeof currentPassword !== 'string' || !currentPassword))) return res.status(400).json({ error: 'missing_fields' });
  if (String(newPassword).length < 8 || String(newPassword).length > 200) return res.status(400).json({ error: 'weak_password' });
  if (hasPassword) {
    if (tooManyWrong(res, user.id)) return;
    if (!(await bcrypt.compare(String(currentPassword), user.passwordHash))) { reauthGuard.fail(user.id); return res.status(400).json({ error: 'wrong_password' }); }
    reauthGuard.succeed(user.id);
  } else if (!(await auth.signedInRecently(user.id, req.userToken.sid, config.REAUTH_MINUTES))) {
    return res.status(403).json({ error: 'reauth_required', minutes: config.REAUTH_MINUTES });
  }
  if (await require('../hibp').breachCount(newPassword)) return res.status(400).json({ error: 'password_breached' });
  if (!hasPassword) {
    const twoFactor = require('../twoFactor');
    if ((await twoFactor.stateFor(user.id)).enabled) {
      if (typeof code !== 'string' || !code.trim()) return res.status(400).json({ error: 'code_required' });
      try {
        await twoFactor.verifyLogin(user, { code: code.trim() });
      } catch (e) {
        if (!(e instanceof twoFactor.TwoFactorError)) throw e;
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        return res.status(e.code === 'locked' ? 429 : 400).json({ error: e.code === 'locked' ? 'locked' : 'invalid_code' });
      }
    }
  }

  await updateUser(user.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
  // Every other device is signed out (docs/AUDIT.md #3); this one gets a new session, which is not a new sign-in (it keeps this one's time).
  await auth.endAllSessions(user.id);
  await auth.startSession(req, res, user, null, { from: req.userToken });
  // A first password is a security notice: the owner is told, with the device (an account made with Google never had one).
  if (!hasPassword) require('../notify').notifyPasswordSet(user, { device: auth.deviceLabel(req.get('user-agent')), at: new Date() });
  res.json({ ok: true });
}));

// Settings -> Account: download my data (JSON) and delete my account (re-authentication, then a grace period; see server/account.js).
router.get('/export', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  const data = await require('../account').exportData(user);
  res.set('Cache-Control', 'no-store');
  res.type('application/json').attachment(`wisecall-my-data-${new Date().toISOString().slice(0, 10)}.json`).send(JSON.stringify(data, null, 2));
}));

const ACCOUNT_STATUS = { wrong_password: 400, reauth_required: 403, already_requested: 409, open_items: 409, nothing_to_cancel: 409 };
const accountFail = (res, e) => {
  if (!(e instanceof require('../account').AccountError)) throw e;
  res.status(ACCOUNT_STATUS[e.code] || 400).json({ error: e.code, ...(e.items ? { items: e.items } : {}) });
};
router.delete('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (tooManyWrong(res, user.id)) return;
  try {
    const out = await require('../account').requestDeletion(user, { password: (req.body || {}).password, sessionId: req.userToken.sid });
    reauthGuard.succeed(user.id);
    auth.clearAuthCookie(res);
    res.json(out);
  } catch (e) {
    if (e && e.code === 'wrong_password') reauthGuard.fail(user.id);
    accountFail(res, e);
  }
}));
router.post('/delete/cancel', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  try { await require('../account').cancelDeletion(user); res.json({ user: meProfile(await getUserById(user.id)) }); } catch (e) { accountFail(res, e); }
}));
router.get('/delete/check', requireAuth, asyncHandler(async (req, res) => {
  res.json({ items: await require('../account').openItems(req.userToken.id), graceDays: require('../account').DELETION_GRACE_DAYS });
}));

// Settings -> Account: where this account is signed in, signing out one device, or every other device.
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ sessions: await auth.listSessions(req.userToken.id, req.userToken.sid), currentKnown: Boolean(req.userToken.sid) });
}));
router.post('/sessions/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  if (req.params.id === req.userToken.sid) return res.status(400).json({ error: 'use_logout' });
  if (!(await auth.revokeSession(req.userToken.id, req.params.id))) return res.status(404).json({ error: 'not_found' });
  res.json({ sessions: await auth.listSessions(req.userToken.id, req.userToken.sid) });
}));
router.post('/sessions/logout-others', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  await auth.endAllSessions(user.id);
  const sid = await auth.startSession(req, res, user, null, { from: req.userToken }); // (not a new sign-in: it keeps this one's time)
  res.json({ sessions: await auth.listSessions(user.id, sid) });
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
