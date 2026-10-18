// Step 2 of an application: the Experience form (title, niche, specialty tags, years, "Your story", one sample answer) and the
// evidence list (at least one item of ANY kind; none is required by itself). Self-taught people and business owners are welcome.
//
// The form can be saved as a draft at any time. "Submit for review" checks that it is complete, then starts the analysis (step 3).
// A submitted application is locked while it is reviewed; "Edit my application" unlocks it (for an approved mentor that takes the
// profile off Browse experts until the changed application is approved again, as before).
const { query } = require('../db');
const rules = require('./rules');
const steps = require('./steps');
const { size, tidy, looksRepeated } = require('../content');
const { getUserById, updateUser } = require('../models');
const linkCheck = require('./linkCheck');

const { VerificationError } = steps;
const { LIMITS } = rules;

const isMentor = (u) => Boolean(u) && (u.role === 'mentor' || u.role === 'both');
const submitted = (u) => u.verificationStatus === 'pending' && Boolean(u.applicationSubmittedAt);
// Locked: waiting for a decision, or approved (or suspended). Rejected and never-submitted applications can be edited.
const isLocked = (u) => submitted(u) || u.verificationStatus === 'verified' || u.verificationStatus === 'suspended';

// ---- The form ---------------------------------------------------------------------------------------------------------------------------
const oneLine = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// Specialty tags: a list, or one string separated by commas. -> cleaned list, or null when invalid.
function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const tag = oneLine(raw).replace(/^#/, '');
    if (!tag) continue;
    if (tag.length > LIMITS.tagMax || /[@<>{}]|https?:|www\./i.test(tag)) return null;
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out.length > LIMITS.tagsMax ? null : out;
}

// Checks the fields that were sent (a draft may be incomplete; lengths are only checked up to the maximum here).
// -> { patch } or { error, field }
function parseExperience(input) {
  const b = input || {};
  const patch = {};
  if (b.roleTitle !== undefined) {
    if (b.roleTitle !== null && typeof b.roleTitle !== 'string') return { error: 'invalid_field', field: 'roleTitle' };
    const v = oneLine(b.roleTitle || '');
    if (v.length > LIMITS.titleMax) return { error: 'title_too_long', field: 'roleTitle' };
    patch.roleTitle = v || null;
  }
  if (b.niche !== undefined) {
    if (b.niche !== null && !rules.isCustomNiche(b.niche) && !rules.isValidNiche(b.niche)) return { error: 'invalid_niche', field: 'niche' };
    patch.niche = b.niche;
  }
  // "Your field": the field in the mentor's own words, whatever the category (public on the profile, so it is checked like one).
  if (b.customNiche !== undefined) {
    if (b.customNiche === null || b.customNiche === '') patch.customNiche = null;
    else {
      const c = require('../customNiche').clean(b.customNiche);
      if (c.error) return { error: c.error, field: 'customNiche' };
      patch.customNiche = c.value;
    }
  }
  if (b.specialtyTags !== undefined) {
    const tags = parseTags(b.specialtyTags);
    if (!tags) return { error: 'invalid_tags', field: 'specialtyTags' };
    patch.specialtyTags = tags;
  }
  if (b.yearsExperience !== undefined) {
    if (b.yearsExperience === null || b.yearsExperience === '') patch.yearsExperience = null;
    else {
      const n = Number(b.yearsExperience);
      if (!Number.isInteger(n) || n < 0 || n > LIMITS.yearsMax) return { error: 'invalid_years', field: 'yearsExperience' };
      patch.yearsExperience = n;
    }
  }
  for (const [field, max] of [['story', LIMITS.storyMax], ['sampleAnswer', LIMITS.sampleMax]]) {
    if (b[field] === undefined) continue;
    if (b[field] !== null && typeof b[field] !== 'string') return { error: 'invalid_field', field };
    const v = tidy(b[field] || '');
    if ([...v].length > max) return { error: field === 'story' ? 'story_too_long' : 'sample_too_long', field };
    patch[field] = v || null;
  }
  return { patch };
}

// Regulated work stays regulated: a field or title that names a licensed profession moves a non-regulated category to the regulated one
// (server/fieldRules.js). An admin's "not a licensed profession" lasts until the mentor changes their field or title. Changes the patch.
function applyFieldRules(user, patch) {
  const changed = (k) => patch[k] !== undefined && patch[k] !== user[k];
  const wordsChanged = changed('customNiche') || changed('roleTitle');
  if (wordsChanged && user.fieldOverride) patch.fieldOverride = false;
  const value = (k) => (patch[k] !== undefined ? patch[k] : user[k]);
  const r = require('../fieldRules').categoryFor({ niche: value('niche'), field: value('customNiche'), title: value('roleTitle'), overridden: user.fieldOverride && !wordsChanged });
  if (r.forced) patch.niche = r.forced;
  return patch;
}
// Whether the category was chosen by the words (shown to the mentor, so they know why a licence is asked for).
const regulatedByWords = (user) => !user.fieldOverride && rules.isRegulated(user.niche)
  && require('../fieldRules').regulatedCategoryIn(user.customNiche, user.roleTitle) === user.niche;

async function saveExperience(user, input) {
  if (isLocked(user)) throw new VerificationError('application_locked');
  const { patch, error, field } = parseExperience(input);
  if (error) throw new VerificationError(error, { field });
  applyFieldRules(user, patch);
  // A different niche can need different steps (a licence), so the steps shown are recomputed from it when the page reloads.
  return Object.keys(patch).length ? updateUser(user.id, patch) : user;
}

// ---- Evidence -----------------------------------------------------------------------------------------------------------------------------
const evidenceFromRow = (r) => ({
  id: r.id, kind: r.kind, url: r.url, registryId: r.registry_id, documentId: r.document_id, note: r.note,
  checkStatus: r.check_status, autoVerified: r.auto_verified, checkResult: r.check_result || {}, checkedAt: r.checked_at,
  decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at, filename: r.filename || null
});

async function listEvidence(userId) {
  const { rows } = await query(
    `SELECT e.*, d.filename FROM mentor_evidence e LEFT JOIN verification_documents d ON d.id = e.document_id
      WHERE e.user_id = $1 ORDER BY e.created_at, e.id`, [userId]);
  return rows.map(evidenceFromRow);
}

// What the mentor sees about one item: never the admin's notes, the other accounts, or the raw check.
function evidenceForMentor(e) {
  const r = e.checkResult || {};
  return {
    id: e.id, kind: e.kind, url: e.url, registryId: e.registryId, note: e.note, filename: e.filename,
    state: e.checkStatus === 'ok' ? 'verified' : (e.checkStatus === 'failed' ? 'problem' : (e.checkStatus === 'admin_check' ? 'team' : (e.checkStatus === 'warning' ? 'unclear' : 'unchecked'))),
    problem: e.checkStatus === 'failed' ? (r.flags || []).find((f) => ['dead_link', 'refused_address'].includes(f)) || 'dead_link' : null
  };
}

function cleanUrl(value) {
  const s = String(value || '').trim();
  if (!s || s.length > LIMITS.urlMax) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.')) return null;
  u.hash = '';
  return u.toString();
}

// input: { kind, url?, registryId?, note? }. A diploma is added by uploading the file (see credentials.storeDocument).
async function addEvidence(user, input) {
  if (isLocked(user)) throw new VerificationError('application_locked');
  const b = input || {};
  if (!rules.EVIDENCE_KINDS.includes(b.kind) || b.kind === 'diploma') throw new VerificationError('invalid_kind');
  const note = b.note === undefined || b.note === null ? null : oneLine(String(b.note)).slice(0, LIMITS.evidenceNoteMax) || null;
  let url = null;
  let registryId = null;
  if (b.kind === 'company') {
    if (b.registryId) {
      const f = linkCheck.companyIdFormat(b.registryId);
      if (!f) throw new VerificationError('invalid_company_id');
      registryId = f.value;
    }
    if (b.url) { url = cleanUrl(b.url); if (!url) throw new VerificationError('invalid_url'); }
    if (!registryId && !url) throw new VerificationError('company_needs_id_or_url');
  } else {
    url = cleanUrl(b.url);
    if (!url) throw new VerificationError('invalid_url');
    if (b.kind === 'linkedin' && !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)) throw new VerificationError('not_linkedin');
  }
  const count = (await query('SELECT count(*)::int AS n FROM mentor_evidence WHERE user_id = $1', [user.id])).rows[0].n;
  if (count >= LIMITS.evidenceMax) throw new VerificationError('too_much_evidence');
  try {
    const { rows } = await query(
      `INSERT INTO mentor_evidence (user_id, kind, url, registry_id, note, check_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.id, b.kind, url, registryId, note, registryId && !url ? 'admin_check' : 'unchecked']);
    await steps.audit(user.id, steps.mentorActor(user), 'evidence_added', { reason: `${b.kind}: ${url || registryId}` });
    return evidenceFromRow(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new VerificationError('duplicate_evidence');
    throw e;
  }
}

async function removeEvidence(user, id) {
  if (isLocked(user)) throw new VerificationError('application_locked');
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new VerificationError('not_found');
  const { rows } = await query(`DELETE FROM mentor_evidence WHERE id = $1 AND user_id = $2 AND kind <> 'work_email' RETURNING kind, url, registry_id, document_id`, [id, user.id]);
  if (!rows[0]) throw new VerificationError('not_found');
  // A diploma's file goes with it.
  if (rows[0].document_id) await require('./credentials').deleteOwnDocument(user, rows[0].document_id).catch(() => {});
  await steps.audit(user.id, steps.mentorActor(user), 'evidence_removed', { reason: `${rows[0].kind}: ${rows[0].url || rows[0].registry_id || 'document'}` });
}

// ---- Is it complete? ----------------------------------------------------------------------------------------------------------------------
// -> the list of what is still missing, in the order the form shows it (codes the page explains).
function missingFor(user, evidence, stepMap) {
  const missing = [];
  if (!user.emailVerified) missing.push('email');
  if (!user.roleTitle || user.roleTitle.length < LIMITS.titleMin) missing.push('title');
  if (!user.customNiche) missing.push('field');
  if (!(rules.isValidNiche(user.niche) || rules.isCustomNiche(user.niche))) missing.push('niche');
  if (!(user.specialtyTags || []).length) missing.push('tags');
  if (user.yearsExperience === null || user.yearsExperience === undefined) missing.push('years');
  if (!user.story || size(user.story) < LIMITS.storyMin || looksRepeated(user.story)) missing.push('story');
  if (!user.sampleAnswer || size(user.sampleAnswer) < LIMITS.sampleMin || looksRepeated(user.sampleAnswer)) missing.push('sample');
  if (evidence.filter((e) => e.kind !== 'work_email' || e.checkStatus === 'ok').length < LIMITS.evidenceMin) missing.push('evidence');
  if (rules.isRegulated(user.niche)) {
    const has = (s) => stepMap[s] && ['pending', 'passed'].includes(steps.effectiveStatus(stepMap[s]));
    if (!has('license')) missing.push('license');
    if (rules.requiredFor(user.niche).includes('license_document') && !has('license_document')) missing.push('license_document');
  }
  // (outside the Experience form: the headline on the Profile tab and the price on the Mentor tab; an application is never sent without
  // them, docs/CLAUDE-CODE-SIGNUP-CHECKS.md #2)
  if (!user.headline || !String(user.headline).trim()) missing.push('headline');
  if (!user.price) missing.push('price');
  return missing;
}

// What the admin review queue labels "Profile incomplete": the story, headline, field or price an application should never lack (one sent
// before these were all required, or one written straight into the database).
function profileGaps(user) {
  const gaps = [];
  if (!user.story || size(user.story) < LIMITS.storyMin) gaps.push('story');
  if (!user.headline || !String(user.headline).trim()) gaps.push('headline');
  if (!user.customNiche || !(rules.isValidNiche(user.niche) || rules.isCustomNiche(user.niche))) gaps.push('field');
  if (!user.price) gaps.push('price');
  return gaps;
}

// ---- Submitting and editing -------------------------------------------------------------------------------------------------------------------
// req/res: for the account signal (network and device). Returns the updated mentor.
async function submit(user, { req, res } = {}) {
  if (isLocked(user)) throw new VerificationError('already_submitted');
  const [evidence, stepMap] = await Promise.all([listEvidence(user.id), steps.loadSteps(user.id)]);
  const missing = missingFor(user, evidence, stepMap);
  if (missing.length) throw new VerificationError('incomplete', { missing });

  const previous = (await query(`SELECT 1 FROM verification_reviews WHERE user_id = $1 LIMIT 1`, [user.id])).rowCount > 0;
  const trigger = previous || user.verificationStatus === 'rejected' ? 'resubmitted' : 'submitted';
  const updated = await updateUser(user.id, { applicationSubmittedAt: new Date(), verificationStatus: 'pending', verificationNote: null });
  const actor = steps.mentorActor(user);
  if (!stepMap.experience || stepMap.experience.status !== 'passed') {
    await steps.setStep(user.id, 'experience', 'pending', { evidence: { evidenceItems: evidence.length, tags: (user.specialtyTags || []).length }, replaceEvidence: true, actor });
  }
  await steps.syncEmailStep(updated);
  await steps.audit(user.id, actor, trigger === 'resubmitted' ? 'application_resubmitted' : 'application_submitted', { from: user.verificationStatus, to: 'pending' });
  if (req) await require('./signals').record(req, res, user.id, 'application');
  require('./analysis').afterSubmit(user.id, trigger);
  return updated;
}

// "Edit my application": unlocks a submitted (or approved) application. An approved mentor leaves Browse experts until it is approved again.
async function withdraw(user) {
  if (user.verificationStatus === 'suspended') throw new VerificationError('invalid_state');
  if (!isLocked(user)) return user;
  const actor = steps.mentorActor(user);
  const patch = { applicationSubmittedAt: null };
  if (user.verificationStatus === 'verified') {
    patch.verificationStatus = 'pending';
    await steps.audit(user.id, actor, 'delisted', { from: 'verified', to: 'pending', reason: 'The mentor is editing their application' });
  }
  const updated = await updateUser(user.id, patch);
  const removed = await query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'experience' AND status = 'pending' RETURNING step`, [user.id]);
  await steps.audit(user.id, actor, 'application_withdrawn', { step: removed.rowCount ? 'experience' : null, reason: 'Unlocked for editing' });
  return updated;
}

// ---- The mentor's own view ------------------------------------------------------------------------------------------------------------------
// Where the application stands, in plain words (never the AI's scores or the risk level).
//   not_submitted | waiting_identity | checking | with_team | approved | rejected | suspended
async function stageFor(user, stepMap) {
  if (user.verificationStatus === 'suspended') return 'suspended';
  if (user.verificationStatus === 'rejected') return 'rejected';
  // A required step that no longer holds wins over an approval (the same rule as util.verificationState).
  if (user.hasFailedRequiredStep && (user.verificationStatus === 'verified' || submitted(user))) return 'needs_attention';
  if (user.verificationStatus === 'verified') return 'approved';
  if (!submitted(user)) return 'not_submitted';
  const latest = (await query(
    `SELECT status FROM verification_reviews WHERE user_id = $1 AND submitted_at = $2 ORDER BY created_at DESC LIMIT 1`, [user.id, user.applicationSubmittedAt])).rows[0];
  if (latest && latest.status === 'running') return 'checking';
  const idPassed = steps.effectiveStatus(stepMap.id_kyc) === 'passed';
  if (!latest && !idPassed && require('../config').ID_CHECKS_ENABLED) return 'waiting_identity';
  if (!latest) return 'checking';
  return 'with_team';
}

async function applicationFor(user, stepMap) {
  const evidence = await listEvidence(user.id);
  return {
    form: {
      roleTitle: user.roleTitle || '', niche: user.niche || null, customNiche: user.customNiche || '', regulatedByWords: regulatedByWords(user), specialtyTags: user.specialtyTags || [], yearsExperience: user.yearsExperience,
      story: user.story || '', sampleAnswer: user.sampleAnswer || '', price: user.price || null
    },
    evidence: evidence.map(evidenceForMentor),
    missing: missingFor(user, evidence, stepMap),
    submittedAt: user.applicationSubmittedAt,
    locked: isLocked(user),
    stage: await stageFor(user, stepMap)
  };
}

// ---- An admin changes a mentor's field -------------------------------------------------------------------------------------------------
// text: the field in words (required), niche: a category or "other", notRegulated: the words name a licensed profession but this mentor
// does not practise it ("Doctor Who fan fiction"). A category that needs a licence the approved mentor has not passed is refused.
async function setFieldByAdmin({ mentorId, admin, text, niche, notRegulated }) {
  const mentor = await getUserById(mentorId);
  if (!isMentor(mentor)) throw new VerificationError('not_found');
  const c = require('../customNiche').clean(text);
  if (c.error) throw new VerificationError(c.error, { field: 'customNiche' });
  if (!rules.isValidNiche(niche) && !rules.isCustomNiche(niche)) throw new VerificationError('invalid_niche', { field: 'niche' });
  const words = require('../fieldRules').regulatedCategoryIn(c.value, mentor.roleTitle);
  const override = Boolean(words) && !rules.isRegulated(niche);
  if (override && notRegulated !== true) throw new VerificationError('regulated_words', { field: words });
  if (mentor.verificationStatus === 'verified' && rules.isRegulated(niche) && niche !== mentor.niche) {
    const stepMap = await steps.loadSteps(mentor.id);
    const missing = rules.requiredFor(niche).filter((s) => !stepMap[s] || steps.effectiveStatus(stepMap[s]) !== 'passed');
    if (missing.length) throw new VerificationError('licence_missing', { missing });
  }
  const before = `"${mentor.customNiche || ''}" (${mentor.niche || '-'})`;
  const updated = await updateUser(mentor.id, { customNiche: c.value, niche, fieldOverride: override });
  await steps.audit(mentor.id, steps.adminActor(admin), 'niche_changed', {
    reason: `field ${before} -> "${c.value}" (${niche})${override ? '; not a licensed profession (admin decision)' : ''}`
  });
  return updated;
}

module.exports = {
  isLocked, submitted, parseTags, parseExperience, saveExperience, listEvidence, evidenceFromRow, addEvidence, removeEvidence,
  missingFor, profileGaps, submit, withdraw, applicationFor, cleanUrl, applyFieldRules, setFieldByAdmin
};
