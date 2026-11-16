// Step 2 of an application: the Experience form (the field in their own words and its category, years, "Your story"; a title, specialty
// tags and a sample answer are optional) and the evidence list (at least one item of ANY kind; none is required by itself). Self-taught
// people and business owners are welcome. The step-by-step page (/apply.html) asks only for what is required
// (docs/CLAUDE-CODE-UX-WALKTHROUGH.md A): the rest can be added later in Settings.
//
// The form can be saved as a draft at any time. "Submit for review" checks that it is complete, then starts the analysis (step 3).
// A submitted application is locked while it is reviewed; "Edit my application" unlocks it (for an approved mentor that takes the
// profile off Browse experts until the changed application is approved again, as before).
const { query } = require('../db');
const rules = require('./rules');
const steps = require('./steps');
const { size, tidy } = require('../content');
const { storyVerdict } = require('../../public/js/text-rules');
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
    if ([...tag].length > LIMITS.tagMax || /[@<>{}]|https?:|www\./i.test(tag)) return null;
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out.length > LIMITS.tagsMax ? null : out;
}
// Whether what a form sent is the list a mentor already has (the form joins it with commas; spaces around a tag do not count).
function sameTags(input, current) {
  const list = (Array.isArray(input) ? input : String(input || '').split(',')).map((x) => (typeof x === 'string' ? oneLine(x).replace(/^#/, '') : null));
  if (list.some((x) => x === null)) return false;
  return JSON.stringify(list.filter(Boolean)) === JSON.stringify((current || []).map((x) => oneLine(String(x)).replace(/^#/, '')));
}

// Checks the fields that were sent (a draft may be incomplete; lengths are only checked up to the maximum here).
// -> { patch } or { error, field }
const EXTRA_NICHES_MAX = 2;
const PRACTICE_KINDS = ['academic', 'practitioner', 'both'];

// opts.strict: not a draft (a sent or approved mentor's details): my path is all three blocks or none, a sample answer has its question
// (server/mentorStory.js); opts.current: the mentor as they are now.
//
// What the mentor already has is never refused. The forms send every box back with each save, and a value stored under an earlier rule
// (8 specialty tags when 8 were allowed; a current role written on the Profile tab, which takes more) used to stop the whole save, for a
// mentor who had changed nothing. With opts.current, a text that comes back exactly as it is stored is left as it is: only what really
// changed is checked, and written.
function parseExperience(input, opts = {}) {
  const b = input || {};
  const patch = {};
  const cur = opts.current || null;
  const stored = (key, value) => Boolean(cur) && value === oneLine(cur[key] || '');
  // (my path, starting-point tags, the sample answer, "I can help with", work links: docs/CLAUDE-CODE-MENTOR-STORY.md)
  const story = require('../mentorStory').parse(b, { draft: !opts.strict, current: opts.current || {} });
  if (story.error) return story;
  Object.assign(patch, story.patch);
  if (b.roleTitle !== undefined) {
    if (b.roleTitle !== null && typeof b.roleTitle !== 'string') return { error: 'invalid_field', field: 'roleTitle' };
    const v = oneLine(b.roleTitle || '');
    if (!stored('roleTitle', v)) {
      if (v.length > LIMITS.titleMax) return { error: 'title_too_long', field: 'roleTitle' };
      patch.roleTitle = v || null;
    }
  }
  if (b.niche !== undefined) {
    if (b.niche !== null && !rules.isCustomNiche(b.niche) && !rules.isValidNiche(b.niche)) return { error: 'invalid_niche', field: 'niche' };
    patch.niche = b.niche;
  }
  // Up to two more categories (an educational psychologist: Psychology + Teaching). Browse and the filters use them all; niche is the main one.
  if (b.extraNiches !== undefined) {
    if (b.extraNiches !== null && !Array.isArray(b.extraNiches)) return { error: 'invalid_niche', field: 'extraNiches' };
    const keys = [...new Set((b.extraNiches || []).filter((k) => k !== '' && k !== null))];
    if (keys.length > EXTRA_NICHES_MAX) return { error: 'too_many_niches', field: 'extraNiches' };
    if (keys.some((k) => typeof k !== 'string' || !rules.isValidNiche(k) || rules.isCustomNiche(k))) return { error: 'invalid_niche', field: 'extraNiches' };
    patch.extraNiches = keys;
  }
  // "I mainly teach or research" / "I mainly work in practice" / both: optional, a small tag on the profile.
  if (b.practiceKind !== undefined) {
    if (b.practiceKind !== null && b.practiceKind !== '' && !PRACTICE_KINDS.includes(b.practiceKind)) return { error: 'invalid_field', field: 'practiceKind' };
    patch.practiceKind = b.practiceKind || null;
  }
  // "Your field": the field in the mentor's own words, whatever the category (public on the profile, so it is checked like one).
  if (b.customNiche !== undefined && !(typeof b.customNiche === 'string' && b.customNiche.trim() && stored('customNiche', oneLine(b.customNiche)))) {
    if (b.customNiche === null || b.customNiche === '') patch.customNiche = null;
    else {
      const c = require('../customNiche').clean(b.customNiche);
      if (c.error) return { error: c.error, field: 'customNiche' };
      patch.customNiche = c.value;
    }
  }
  // What students browse by (server/categories.js): one main field, up to two more, up to five chips in them, and for each field "Other" in the mentor's words.
  const categories = require('../categories');
  if (b.fieldId !== undefined) {
    if (b.fieldId !== null && !categories.isField(b.fieldId)) return { error: 'invalid_field_id', field: 'fieldId' };
    patch.fieldId = b.fieldId;
  }
  if (b.extraFields !== undefined) {
    if (!Array.isArray(b.extraFields) || b.extraFields.some((f) => !categories.isField(f))) return { error: 'invalid_field_id', field: 'extraFields' };
    const list = [...new Set(b.extraFields)].filter((f) => f !== (b.fieldId !== undefined ? b.fieldId : null));
    if (list.length > categories.LIMITS.extraFields) return { error: 'too_many_fields', field: 'extraFields' };
    patch.extraFields = list;
  }
  if (b.directions !== undefined) {
    if (!Array.isArray(b.directions) || b.directions.some((d) => !categories.isChip(d))) return { error: 'invalid_direction', field: 'directions' };
    const list = [...new Set(b.directions)];
    if (list.length > categories.LIMITS.directions) return { error: 'too_many_directions', field: 'directions' };
    patch.directions = list;
  }
  if (b.directionOther !== undefined) {
    if (b.directionOther !== null && (typeof b.directionOther !== 'object' || Array.isArray(b.directionOther))) return { error: 'invalid_direction', field: 'directionOther' };
    const out = {};
    for (const [fieldId, text] of Object.entries(b.directionOther || {})) {
      if (!categories.isField(fieldId) || typeof text !== 'string') return { error: 'invalid_direction', field: 'directionOther' };
      if (!text.trim()) continue;
      const c = require('../customNiche').clean(text);
      if (c.error) return { error: c.error, field: 'directionOther' };
      out[fieldId] = c.value;
    }
    patch.directionOther = Object.keys(out).length ? out : null;
  }
  if (b.university !== undefined) {
    const v = oneLine(b.university || '');
    if (typeof (b.university === null ? '' : b.university) !== 'string') return { error: 'invalid_university', field: 'university' };
    if (!stored('university', v)) {
      if ([...v].length > categories.LIMITS.universityMax || /[@<>{}]|https?:|www\./i.test(v)) return { error: 'invalid_university', field: 'university' };
      patch.university = v || null;
    }
  }
  if (b.country !== undefined) {
    if (b.country !== null && b.country !== '' && !categories.isCountry(b.country)) return { error: 'invalid_country', field: 'country' };
    patch.country = b.country || null;
  }
  if (b.currentRole !== undefined) {
    const v = oneLine(b.currentRole || '');
    if (typeof (b.currentRole === null ? '' : b.currentRole) !== 'string') return { error: 'invalid_current_role', field: 'currentRole' };
    // (stored as currentWork, which the Profile tab also writes, with its own, wider rule)
    if (!stored('currentWork', v)) {
      if ([...v].length > categories.LIMITS.currentRoleMax || /[@<>{}]|https?:|www\./i.test(v)) return { error: 'invalid_current_role', field: 'currentRole' };
      patch.currentWork = v || null;
    }
  }
  if (b.specialtyTags !== undefined) {
    // (the same tags, in the same order, as the mentor has now: kept, however many there are)
    const same = Boolean(cur) && sameTags(b.specialtyTags, cur.specialtyTags || []);
    if (!same) {
      const tags = parseTags(b.specialtyTags);
      if (!tags) return { error: 'invalid_tags', field: 'specialtyTags' };
      patch.specialtyTags = tags;
    }
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
    if (cur && v === tidy(cur[field] || '')) continue;
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
  // (an academic with that regulated category among their extra ones keeps the main one they chose: it is still theirs, and still reviewed
  // by a person, never approved automatically)
  const academicExtra = r.forced && value('practiceKind') === 'academic' && (value('extraNiches') || []).includes(r.forced);
  if (r.forced && !academicExtra) patch.niche = r.forced;
  return patch;
}
// The extra categories: never the main one again. A regulated one (Psychology, Law...) only for someone who mainly teaches or researches:
// they may give academic, career and study advice in it, never advice on a specific clinical, legal or financial case. Anyone who wants to
// give that advice makes it their main category, with its licence and a person's review, as before.
function extraNicheRules(user, patch) {
  const value = (k) => (patch[k] !== undefined ? patch[k] : user[k]);
  const main = value('niche');
  const extra = (value('extraNiches') || []).filter((k) => k !== main);
  if (extra.some((k) => rules.isRegulated(k)) && value('practiceKind') !== 'academic') throw new VerificationError('extra_regulated', { field: 'extraNiches' });
  if (patch.extraNiches !== undefined || extra.length !== (user.extraNiches || []).length) patch.extraNiches = extra;
  return patch;
}
// Every category a mentor is in (the main one first).
// The field and chips chosen decide the niche (and with it the licence and the review: server/categories.js nicheFor, where a regulated chip always wins). Only
// when they changed: saving the same choice again leaves an existing mentor's niche as it was. Changes the patch.
function fieldToNiche(user, patch) {
  const categories = require('../categories');
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  const value = (k) => (patch[k] !== undefined ? patch[k] : user[k]);
  const main = value('fieldId');
  const chose = (patch.fieldId !== undefined && patch.fieldId !== user.fieldId) || (patch.extraFields !== undefined && !same(patch.extraFields, user.extraFields))
    || (patch.directions !== undefined && !same(patch.directions, user.directions));
  const directions = value('directions') || [];
  const extras = (value('extraFields') || []).filter((f) => f !== main);
  if (patch.extraFields !== undefined || patch.fieldId !== undefined) patch.extraFields = extras;
  // (a chip only stays with a field that stays)
  const kept = directions.filter((d) => [main, ...extras].includes(categories.fieldOfChip(d)));
  if (kept.length !== directions.length) patch.directions = kept;
  if (!chose || !main) return patch;
  patch.niche = categories.nicheFor(main, kept);
  patch.extraNiches = [...new Set(extras.map((f) => categories.nicheFor(f, kept)))].filter((n) => n !== patch.niche && n !== 'other');
  return patch;
}
// The other way: a niche set without a field (the words named a licensed profession and moved it, or an older page or an admin set it): the field follows, so the
// mentor is found where they now count. What they chose before stays as an extra field.
function nicheToField(user, patch) {
  const categories = require('../categories');
  const niche = patch.niche !== undefined ? patch.niche : user.niche;
  const main = patch.fieldId !== undefined ? patch.fieldId : user.fieldId;
  if (!niche || (main && categories.nicheFor(main, patch.directions || user.directions || []) === niche)) return patch;
  if (patch.niche === undefined && main) return patch;
  const hit = categories.fromNiche(niche);
  if (!hit || (hit.fieldId === main && !hit.chip)) return patch;
  const extras = [...new Set([main, ...(patch.extraFields || user.extraFields || [])].filter((f) => f && f !== hit.fieldId))].slice(0, categories.LIMITS.extraFields);
  const directions = [...new Set([...(hit.chip ? [hit.chip] : []), ...(patch.directions || user.directions || [])])]
    .filter((d) => [hit.fieldId, ...extras].includes(categories.fieldOfChip(d))).slice(0, categories.LIMITS.directions);
  Object.assign(patch, { fieldId: hit.fieldId, extraFields: extras, directions });
  return patch;
}

const nichesOf = (user) => [user.niche, ...(user.extraNiches || [])].filter(Boolean);
// Whether any of them is regulated (never approved automatically).
const anyRegulated = (user) => nichesOf(user).some((k) => rules.isRegulated(k));

// Whether the category was chosen by the words (shown to the mentor, so they know why a licence is asked for).
const regulatedByWords = (user) => !user.fieldOverride && rules.isRegulated(user.niche)
  && require('../fieldRules').regulatedCategoryIn(user.customNiche, user.roleTitle) === user.niche;

// "About me" (the profile) and "Your story" (the application) are the same text for most mentors: while they are the same, or one of them is
// still empty, writing one writes the other (docs/CLAUDE-CODE-UX-WALKTHROUGH.md D). Once they differ, each is kept as written.
const inStep = (a, b) => !a || !String(a).trim() || tidy(a) === tidy(b || '');
function storyToBio(user, patch) {
  if (patch.story && inStep(user.bio, user.story)) patch.bio = patch.story;
  return patch;
}
// "My path" (three short blocks, server/mentorStory.js) is the story once all three are there: the review, the copied-text checks and the
// admin's page go on reading users.story, and the About text follows it as it follows any story. An old free-text story stays until then.
function pathToStory(user, patch) {
  const mentorStory = require('../mentorStory');
  if (!mentorStory.PATH_KEYS.some((k) => patch[k] !== undefined)) return patch;
  const next = { ...user, ...patch };
  if (mentorStory.pathComplete(next)) { patch.story = mentorStory.asStory(next); storyToBio(user, patch); }
  return patch;
}
function bioToStory(user, patch) {
  if (patch.bio === undefined || !patch.bio || isLocked(user)) return patch;
  if ([...patch.bio].length <= LIMITS.storyMax && inStep(user.story, user.bio)) patch.story = patch.bio;
  return patch;
}

// What a choice makes of the profile: the field and chips, the words, the extra fields and the rules on them. Changes the patch (and
// throws what saving would). Also used on a copy for a change an admin checks first (server/mentorEdit.js).
function applyChoice(user, patch) {
  // The field in their own words with no category yet: the closest one is chosen for them ("Other" when nothing fits); they can change it.
  fieldToNiche(user, patch);
  const words = patch.customNiche !== undefined ? patch.customNiche : user.customNiche;
  const category = patch.niche !== undefined ? patch.niche : user.niche;
  if (words && !category) patch.niche = require('../fieldSuggest').suggestField(words, patch.roleTitle || user.roleTitle) || 'other';
  extraNicheRules(user, patch); // (what they chose is checked first, then again after the words had their say)
  applyFieldRules(user, patch);
  extraNicheRules(user, patch);
  nicheToField(user, patch);
  return patch;
}

// opts.evenIfSent: an application sent and not decided yet can still be changed from "My details" (the admin sees what changed: server/mentorEdit.js).
async function saveExperience(user, input, opts = {}) {
  if (isLocked(user) && !(opts.evenIfSent && submitted(user))) throw new VerificationError('application_locked');
  // (current: what the mentor already has is kept as it is, never checked again; see parseExperience)
  const { patch, error, field } = parseExperience(input, { current: user });
  if (error) throw new VerificationError(error, { field });
  applyChoice(user, patch);
  storyToBio(user, patch);
  pathToStory(user, patch);
  if (Object.keys(patch).length) patch.applyTouchedAt = new Date(); // (the reminders count from the last change: ./reminders.js)
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

// What the mentor sees about one item: never the admin's notes, the other accounts, or the raw check. A link the automatic check could not
// confirm (LinkedIn and other sites that refuse automatic visitors, a page without the name in its title) is simply checked by our team:
// the mentor is warned only when the page does not open ('problem') or clearly belongs to someone else ('unclear').
function evidenceForMentor(e) {
  const r = e.checkResult || {};
  const warning = e.checkStatus === 'warning' ? ((r.flags || []).includes('other_person') ? 'unclear' : 'team') : null;
  return {
    id: e.id, kind: e.kind, url: e.url, registryId: e.registryId, note: e.note, filename: e.filename,
    state: e.checkStatus === 'ok' ? 'verified' : (e.checkStatus === 'failed' ? 'problem' : (e.checkStatus === 'admin_check' ? 'team' : (warning || 'unchecked'))),
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

// What a link is, from its address, so a mentor only pastes it (the type can still be chosen under "More options"). A university's own
// pages (a staff page, a faculty list) are "a university page" (server/universities.js knows the Georgian ones by name).
const isUniversity = (host) => Boolean(require('../universities').universityOf(host));
function kindFromUrl(value) {
  const url = cleanUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const on = (...domains) => domains.some((d) => host === d || host.endsWith('.' + d));
  if (on('linkedin.com')) return 'linkedin';
  if (on('facebook.com', 'fb.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'threads.net', 'youtube.com', 'youtu.be')) return 'social';
  if (on('github.com', 'gitlab.com', 'behance.net', 'dribbble.com', 'artstation.com', 'vimeo.com', 'soundcloud.com')) return 'portfolio';
  if (on('scholar.google.com', 'researchgate.net', 'orcid.org', 'doi.org', 'academia.edu', 'scopus.com', 'semanticscholar.org', 'ssrn.com', 'pubmed.ncbi.nlm.nih.gov')) return 'publication';
  if (on('apps.apple.com', 'play.google.com')) return 'product';
  if (isUniversity(host)) return 'university';
  return 'website';
}

// input: { kind, url?, registryId?, note? }. A diploma is added by uploading the file (see credentials.storeDocument). Without a kind (or
// "auto") the kind comes from the address.
// opts.evenIfSent: new proof after sending (not while suspended); an admin checks it (server/mentorEdit.js).
async function addEvidence(user, input, opts = {}) {
  if (isLocked(user) && !(opts.evenIfSent && user.verificationStatus !== 'suspended')) throw new VerificationError('application_locked');
  const b = { ...(input || {}) };
  if ((b.kind === undefined || b.kind === null || b.kind === '' || b.kind === 'auto') && b.url) b.kind = kindFromUrl(b.url) || 'website';
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
// -> the list of what is still missing, in the order /apply.html asks for it (codes the pages explain). Only what a reviewer really needs
// (docs/CLAUDE-CODE-UX-WALKTHROUGH.md A): 1 the headline and years (and the field), 2 the story, 3 the price, 4 one piece of evidence (and
// the licence in a regulated field). A title, specialty tags and a sample answer are optional; the ID check is step 5 and the review waits
// for it.
//
// opts.sentBefore: this mentor's application was already sent once (sentBefore, below). It was whole by the rules of its day, so what
// step 1 has asked for since (what I do, the field in my own words, the years of experience) is asked of them too, on the page, but is
// never required: they can change their application and send it again with only what they had.
function missingFor(user, evidence, stepMap, opts = {}) {
  const missing = [];
  // (not the email: an application can be sent while its code is still on the way; it cannot be approved until the email is confirmed,
  // the 'email' identity step, docs/CLAUDE-CODE-EMAIL-CODE-FIX.md)
  if (!opts.sentBefore) {
    if (!user.headline || !String(user.headline).trim()) missing.push('headline');
    if (user.yearsExperience === null || user.yearsExperience === undefined) missing.push('years');
    if (!user.customNiche) missing.push('field');
  }
  if (!(rules.isValidNiche(user.niche) || rules.isCustomNiche(user.niche))) missing.push('niche');
  if (!storyVerdict(user.story, LIMITS.storyMin).ok) missing.push('story'); // (the page runs the same check: public/js/text-rules.js)
  if (user.price === null || user.price === undefined) missing.push('price'); // (0 is a price: free)
  const has = (s) => stepMap[s] && ['pending', 'passed'].includes(steps.effectiveStatus(stepMap[s]));
  // (a field whose register is public, law or accounting: the licence number is the proof, an admin looks it up; nothing to link or upload)
  const numberIsProof = Boolean((rules.REGULATED[user.niche] || {}).publicRegister) && has('license');
  if (!numberIsProof && evidence.filter((e) => e.kind !== 'work_email' || e.checkStatus === 'ok').length < LIMITS.evidenceMin) missing.push('evidence');
  if (rules.isRegulated(user.niche)) {
    if (!has('license')) missing.push('license');
    if (rules.requiredFor(user.niche).includes('license_document') && !has('license_document')) missing.push('license_document');
  }
  return missing;
}
// What step 1 asks for now that an application sent earlier may not have (and "directions": at least one, asked when it is sent).
const ADDED_LATER = ['headline', 'years', 'field', 'directions'];
// Whether this mentor's application has been sent before: it is sent or decided now, or it was and its mentor pressed "Edit my
// application" (which leaves 'application_withdrawn' in the audit, as sending leaves 'application_submitted').
async function sentBefore(user) {
  if (!isMentor(user)) return false;
  if (user.applicationSubmittedAt || user.verificationDecidedAt || ['verified', 'suspended', 'rejected'].includes(user.verificationStatus)) return true;
  const { rows } = await query(
    `SELECT 1 FROM verification_audit WHERE mentor_id = $1 AND action IN ('application_submitted', 'application_resubmitted', 'application_withdrawn') LIMIT 1`, [user.id]);
  return rows.length > 0;
}

// How far an application is (docs/CLAUDE-CODE-APPLY-PROGRESS.md), the one count every page shows (the header's "2/5", the bar on
// /apply.html, the Settings card): which of the five steps are done, how many, and the first one that is not (where "Continue" goes).
// Steps 1-4 are done when nothing they ask for is missing; step 5 when the ID check has passed ("pending" is only started).
//   missing: missingFor(); idStatus: the effective status of the id_kyc step (or undefined) -> { done: [5 booleans], count, next }
const STEP_CODES = [['headline', 'years', 'field', 'niche'], ['story'], ['price'], ['evidence', 'license', 'license_document']];
function applicationProgress(missing, idStatus) {
  const done = [...STEP_CODES.map((codes) => !codes.some((c) => missing.includes(c))), idStatus === 'passed'];
  const open = done.indexOf(false);
  return { done, count: done.filter(Boolean).length, next: open === -1 ? 5 : open + 1 };
}
const progressOf = (missing, stepMap) => applicationProgress(missing, stepMap.id_kyc ? steps.effectiveStatus(stepMap.id_kyc) : undefined);

// Where the ID check stands, in one word for every page (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md):
//   passed | todo | started (opened at the partner, not finished) | checking (finished, the partner is checking) | failed
//   | blocked (under 18 on the ID: only an admin can open it again) | closed (ID checks are not open on this site yet)
function idStatusOf(stepMap) {
  const row = stepMap.id_kyc;
  const s = steps.effectiveStatus(row);
  if (s === 'passed') return 'passed';
  if (stepMap.age && stepMap.age.status === 'failed') return 'blocked';
  if (!require('../config').ID_CHECKS_ENABLED) return 'closed';
  if (s === 'failed') return 'failed';
  if (s === 'pending') return row.evidence && row.evidence.state === 'in_review' ? 'checking' : 'started';
  return 'todo';
}
// The ID check is what is left: steps 1-4 are done and the check is not passed, nor with the partner.
const ID_LEFT = ['todo', 'started', 'failed'];
const idLeftOf = (progress, id) => progress.next === 5 && ID_LEFT.includes(id);

// Where someone is on the way to becoming a mentor, for the "Become a mentor" button on every page (docs/CLAUDE-CODE-MENTOR-BUTTON-SIGNED-IN.md):
//   asker   not a mentor applicant: "Become a mentor"
//   draft   an application started and not sent (or sent back): "Continue your application" (step: the first unfinished step, done: how
//           many of the 5 are done)
//   sent    sent and waiting for a decision: "Application in review"
//   mentor  approved (or suspended): nothing extra
// A draft or a sent application also says where its ID check stands (id: idStatusOf) and whether it is the one step left (idLeft): then
// every page shows "One step left: confirm your identity" (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md).
// (an admin sees nothing extra either: the pages check isAdmin)
// Which of the steps 1-4 are done now. -> [bool, bool, bool, bool]
async function stepsDone(user) {
  if (!isMentor(user)) return [false, false, false, false];
  const [evidence, stepMap, before] = await Promise.all([listEvidence(user.id), steps.loadSteps(user.id), sentBefore(user)]);
  return progressOf(missingFor(user, evidence, stepMap, { sentBefore: before }), stepMap).done.slice(0, 4);
}
// After a save: apply_step_N_done for each step that was not done before and is now (docs/ANALYTICS.md; no personal data).
async function trackSteps(req, before, userId) {
  try {
    const after = await stepsDone(await require('../models').getUserById(userId));
    after.forEach((d, i) => { if (d && !before[i]) require('../analytics').event(`apply_step_${i + 1}_done`, req); });
  } catch (e) { /* (statistics never break a save) */ }
}

// The mentors' funnel for the admin overview (docs/ANALYTICS.md): of the mentors who signed up in the last `days` days, how many verified
// their email, finished each of the steps 1-4, sent the application, passed the ID check and were approved. Counts only.
async function funnel(days = 30) {
  const { query } = require('../db');
  const { userFromRow, userColumnsSql } = require('../models');
  const { rows } = await query(`SELECT ${userColumnsSql()} FROM users WHERE role IN ('mentor', 'both') AND deleted_at IS NULL AND created_at > now() - make_interval(days => $1)
    ORDER BY created_at DESC LIMIT 2000`, [days]);
  const out = { days, signup: 0, emailVerified: 0, step1: 0, step2: 0, step3: 0, step4: 0, sent: 0, idPassed: 0, approved: 0 };
  for (const r of rows) {
    const u = userFromRow(r);
    const stepMap = await steps.loadSteps(u.id);
    const done = await stepsDone(u);
    const sent = submitted(u) || ['verified', 'suspended'].includes(u.verificationStatus);
    out.signup += 1;
    if (u.emailVerified) out.emailVerified += 1;
    done.forEach((d, i) => { if (d || sent) out['step' + (i + 1)] += 1; });
    if (sent) out.sent += 1;
    if (stepMap.id_kyc && steps.effectiveStatus(stepMap.id_kyc) === 'passed') out.idPassed += 1;
    if (u.verificationStatus === 'verified') out.approved += 1;
  }
  return out;
}

async function progressFor(user) {
  // (being a mentor is from 18: somebody younger has no "Become a mentor" button)
  if (!isMentor(user)) return { state: require('../ageGate').isMinor(user) ? 'none' : 'asker', step: null };
  if (user.verificationStatus === 'verified' || user.verificationStatus === 'suspended') return { state: 'mentor', step: null };
  const [evidence, stepMap, before] = await Promise.all([listEvidence(user.id), steps.loadSteps(user.id), sentBefore(user)]);
  const p = progressOf(missingFor(user, evidence, stepMap, { sentBefore: before }), stepMap);
  const id = idStatusOf(stepMap);
  if (submitted(user)) return { state: 'sent', step: null, id, idLeft: idLeftOf(p, id) };
  return { state: 'draft', step: p.next, done: p.count, id, idLeft: idLeftOf(p, id) };
}

// Specialty tags are optional: a mentor who left them empty gets them from their own words (the field, split at commas and "and"), which
// they can change later in Settings. -> a list (at most LIMITS.tagsMax), possibly empty.
function suggestTags(user) {
  const parts = String(user.customNiche || '').split(/\s*(?:[,;/|·&+]|\s(?:and|და)\s)\s*/i).map((p) => oneLine(p)).filter((p) => p.length >= 2);
  return parseTags(parts.slice(0, LIMITS.tagsMax).map((p) => [...p].slice(0, LIMITS.tagMax).join(''))) || [];
}

// What the admin review queue labels "Profile incomplete": the story, headline, field or price an application should never lack (one sent
// before these were all required, or one written straight into the database).
function profileGaps(user) {
  const gaps = [];
  if (!user.story || size(user.story) < LIMITS.storyMin) gaps.push('story');
  if (!user.headline || !String(user.headline).trim()) gaps.push('headline');
  if (!user.customNiche || !(rules.isValidNiche(user.niche) || rules.isCustomNiche(user.niche))) gaps.push('field');
  if (user.price === null || user.price === undefined) gaps.push('price');
  return gaps;
}

// ---- Submitting and editing -------------------------------------------------------------------------------------------------------------------
// req/res: for the account signal (network and device). Returns the updated mentor.
async function submit(user, { req, res } = {}) {
  if (isLocked(user)) throw new VerificationError('already_submitted');
  const [evidence, stepMap, before] = await Promise.all([listEvidence(user.id), steps.loadSteps(user.id), sentBefore(user)]);
  const missing = missingFor(user, evidence, stepMap, { sentBefore: before });
  // (at least one direction, docs/CLAUDE-CODE-NEW-CATEGORIES.md: checked here, when the application is sent, not in missingFor, so the steps
  // of mentors who applied before the rule are counted as they were; and not asked of an application that was sent before: see missingFor)
  if (!before && user.fieldId && !(user.directions || []).length) missing.push('directions'); // (a mentor whose work fits no field, "Other", has none to choose)
  if (missing.length) throw new VerificationError('incomplete', { missing });

  const previous = (await query(`SELECT 1 FROM verification_reviews WHERE user_id = $1 LIMIT 1`, [user.id])).rowCount > 0;
  const trigger = previous || user.verificationStatus === 'rejected' ? 'resubmitted' : 'submitted';
  const patch = { applicationSubmittedAt: new Date(), verificationStatus: 'pending', verificationNote: null };
  if (!(user.specialtyTags || []).length) { const tags = suggestTags(user); if (tags.length) patch.specialtyTags = tags; }
  // (no title of their own: the headline says what they do)
  if (!user.roleTitle && user.headline) patch.roleTitle = [...oneLine(user.headline)].slice(0, LIMITS.titleMax).join('');
  const updated = await updateUser(user.id, patch);
  const actor = steps.mentorActor(user);
  if (!stepMap.experience || stepMap.experience.status !== 'passed') {
    await steps.setStep(user.id, 'experience', 'pending', { evidence: { evidenceItems: evidence.length, tags: (updated.specialtyTags || []).length }, replaceEvidence: true, actor });
  }
  await steps.syncEmailStep(updated);
  await steps.audit(user.id, actor, trigger === 'resubmitted' ? 'application_resubmitted' : 'application_submitted', { from: user.verificationStatus, to: 'pending' });
  if (req) await require('./signals').record(req, res, user.id, 'application');
  require('./analysis').afterSubmit(user.id, trigger);
  return updated;
}

// The ID check passed: an application with nothing else missing is sent at once, with nothing more to press
// (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md 7). Never one that was turned down (that is sent again on purpose). -> the sent mentor, or null
async function sendAfterIdPassed(userId) {
  const user = await getUserById(userId);
  if (!isMentor(user) || isLocked(user) || !['none', 'pending'].includes(user.verificationStatus || 'none')) return null;
  const [evidence, stepMap, before] = await Promise.all([listEvidence(user.id), steps.loadSteps(user.id), sentBefore(user)]);
  if (missingFor(user, evidence, stepMap, { sentBefore: before }).length || steps.effectiveStatus(stepMap.id_kyc) !== 'passed') return null;
  if (!before && user.fieldId && !(user.directions || []).length) return null; // (no direction yet: the mentor is asked on /apply.html, docs/CLAUDE-CODE-NEW-CATEGORIES.md)
  const sent = await submit(user);
  require('../notify').notifyApplicationReceived(sent);
  require('../analytics').event('apply_sent', null);
  return sent;
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
  const [evidence, before] = await Promise.all([listEvidence(user.id), sentBefore(user)]);
  const missing = missingFor(user, evidence, stepMap, { sentBefore: before });
  return {
    form: {
      fieldId: user.fieldId || null, extraFields: user.extraFields || [], directions: user.directions || [], directionOther: user.directionOther || {},
      university: user.university || '', country: user.country || '', currentRole: user.currentWork || '',
      roleTitle: user.roleTitle || '', niche: user.niche || null, extraNiches: user.extraNiches || [], practiceKind: user.practiceKind || null, customNiche: user.customNiche || '', regulatedByWords: regulatedByWords(user), specialtyTags: user.specialtyTags || [], yearsExperience: user.yearsExperience,
      ...require('../mentorStory').formOf(user),
      story: user.story || '', sampleAnswer: user.sampleAnswer || '', price: user.price === undefined ? null : user.price // (0: answers for free)
    },
    evidence: evidence.map(evidenceForMentor),
    missing,
    // (an application that was sent before: what step 1 asks for since then is asked, never required; the page marks it "optional")
    optional: before ? ADDED_LATER : [],
    progress: progressOf(missing, stepMap),
    // the ID check in one word, and whether it is the one step left (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md)
    id: idStatusOf(stepMap),
    idLeft: idLeftOf(progressOf(missing, stepMap), idStatusOf(stepMap)),
    // why the story does not count yet, when it does not: 'short' | 'repeated' (docs/CLAUDE-CODE-STORY-STEP-CHECK.md)
    // (a path that was started and does not count yet says why itself: server/mentorStory.js)
    storyReason: storyVerdict(user.story, LIMITS.storyMin).ok ? null : (require('../mentorStory').pathReason(user) || storyVerdict(user.story, LIMITS.storyMin).reason),
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
  // (where students find them follows the category: server/categories.js)
  const hit = niche !== mentor.niche ? require('../categories').fromNiche(niche) : null;
  const updated = await updateUser(mentor.id, { customNiche: c.value, niche, fieldOverride: override, ...(hit ? { fieldId: hit.fieldId, directions: hit.chip ? [hit.chip] : [], extraFields: (mentor.extraFields || []).filter((f) => f !== hit.fieldId) } : {}) });
  await steps.audit(mentor.id, steps.adminActor(admin), 'niche_changed', {
    reason: `field ${before} -> "${c.value}" (${niche})${override ? '; not a licensed profession (admin decision)' : ''}`
  });
  return updated;
}

// The price range shown on step 3: the middle half of the prices listed mentors in the field ask (free ones aside), once there are 3 of
// them; until then a neutral 20–50 ₾. -> { from, to, fromData }
async function priceRangeFor(niche) {
  if (niche && rules.isValidNiche(niche)) {
    const { rows: [r] } = await query(
      `SELECT count(*)::int AS n, percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS lo, percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS hi
         FROM users WHERE ${require('../models').listableSql()} AND niche = $1 AND price > 0`, [niche]);
    // (a range that is one price, "20–20 ₾", says nothing: the general one is shown instead)
    if (r && r.n >= 3 && Math.round(r.hi) - Math.round(r.lo) >= 5) return { from: Math.round(r.lo), to: Math.round(r.hi), fromData: true };
  }
  return { from: require('../config').PRICE_SUGGEST_MIN, to: require('../config').PRICE_SUGGEST_MAX, fromData: false };
}

module.exports = {
  stepsDone, trackSteps, funnel, priceRangeFor, nichesOf, anyRegulated, EXTRA_NICHES_MAX, PRACTICE_KINDS,
  isLocked, submitted, parseTags, parseExperience, applyChoice, saveExperience, listEvidence, evidenceFromRow, addEvidence, removeEvidence,
  missingFor, sentBefore, ADDED_LATER, profileGaps, submit, withdraw, applicationFor, cleanUrl, applyFieldRules, setFieldByAdmin, kindFromUrl, isUniversity, suggestTags,
  bioToStory, pathToStory, applicationProgress, progressFor, idStatusOf, ID_LEFT, sendAfterIdPassed
};
