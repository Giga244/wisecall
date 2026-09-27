// ALL the mentor-verification rules live in this one file ("verification rules v2"). Change a threshold, a step, a limit or which
// niches are regulated here (the licence registers are in ./registries.js) and nothing else has to change.
//
// A mentor applies in three steps: 1 Identity (automatic ID + selfie check, age 18+, name matches the ID), 2 Experience (one form with
// at least one piece of evidence of any kind: self-taught people and business owners are welcome, no employer is needed), 3 Review
// (an automatic analysis, then either automatic approval, only when every condition in DECISION below holds, or a person on our team).
// Nobody is ever rejected by the computer: every rejection is made by a person, with a reason, and the mentor can apply again.
const { REGULATED, COMPANY_REGISTRY } = require('./registries');

const VERSION = 2;

// ---- Steps ---------------------------------------------------------------------------------
// decider: who can mark the step passed or failed
//   system      the server (verified email, the work-email code)
//   provider    the ID-verification provider, through its signed webhook only
//   auto+admin  the server decides when it can (age from the ID, names that match); anything unclear waits for an admin
//   review      the analysis (automatic approval) or an admin's final approval
//   admin       a person on the Wisecall team, always with a written reason
// group: where the step shows in the mentor's progress bar (identity -> experience -> review).
const STEPS = {
  email:            { decider: 'system',     group: 'identity' },
  id_kyc:           { decider: 'provider',   group: 'identity' },
  age:              { decider: 'auto+admin', group: 'identity' },    // 18 or older, from the date of birth on the ID
  name_match:       { decider: 'auto+admin', group: 'identity' },    // the profile name (and licence name) match the ID
  experience:       { decider: 'review',     group: 'experience' },  // the Experience form: pending = submitted, passed = accepted
  license:          { decider: 'admin',      group: 'experience', credential: true },   // regulated niches: number + issuing body
  license_document: { decider: 'admin',      group: 'experience', document: true },     // regulated niches with no public register
  video_interview:  { decider: 'admin',      group: 'review' },      // only when an admin asks for one
  // Optional: they add a public badge, and are never required.
  work_email:       { decider: 'system',     optional: true },
  diploma:          { decider: 'admin',      optional: true, document: true }
};
// Steps from rules v1. Old rows keep them for the record; nothing new is written for them.
const LEGACY_STEPS = ['sample_answer', 'proof_link', 'company_id', 'role_proof', 'portfolio'];
const OPTIONAL_STEPS = Object.keys(STEPS).filter((s) => STEPS[s].optional);
const IDENTITY_STEPS = ['email', 'id_kyc', 'age', 'name_match'];

// ---- Niches --------------------------------------------------------------------------------
// Every niche in this list is REGULATED: never approved automatically, and a licence (number + issuing body) is required, which an
// admin checks against the official register. See ./registries.js for the registers and their sources.
const NICHES = {
  business: {}, medicine: {}, teaching: {}, tech: {}, fitness: {}, creative: {}, law: {}, finance: {},
  marketing: {}, design: {}, writing: {}, parenting: {}, engineering: {}, science: {}
};
const isRegulated = (niche) => Object.prototype.hasOwnProperty.call(REGULATED, niche);

// ---- The Experience form and evidence --------------------------------------------------------------
const EVIDENCE_KINDS = ['linkedin', 'website', 'portfolio', 'social', 'publication', 'company', 'diploma', 'product', 'testimonials', 'other'];
// work_email evidence is added by the server when a work address is confirmed; it cannot be typed in.

// ---- Limits and timings ---------------------------------------------------------------------
const LIMITS = {
  // The Experience form
  titleMin: 2, titleMax: 100,
  tagsMax: 8, tagMax: 40,
  yearsMax: 70,
  storyMin: 100, storyMax: 1500,
  sampleMin: 150, sampleMax: 3000,
  evidenceMin: 1, evidenceMax: 10, evidenceNoteMax: 200, urlMax: 500,
  minutesToApply: 10,

  // Uploaded documents (licences, diplomas): stored privately, admin-only, deleted after a decision.
  maxUploadBytes: 10 * 1024 * 1024,
  allowedUploadTypes: ['application/pdf', 'image/jpeg'],
  documentRetentionDays: 90,

  // Age from the ID
  minAge: 18,

  // Work email (optional badge): free/personal mailbox providers are refused.
  workEmailCodeMinutes: 15,

  // Video interview (only when an admin asks for one)
  interviewMinutes: 20,
  interviewMinNoticeHours: 12,
  interviewMaxDaysAhead: 120,

  // Probation: a new mentor's first answers wait for an admin before the buyer sees them.
  // (The PROBATION_ANSWERS variable exists only so automated tests can switch it off; it is ignored in production.)
  probationAnswers: process.env.NODE_ENV !== 'production' && process.env.PROBATION_ANSWERS !== undefined && process.env.PROBATION_ANSWERS !== '' && Number.isInteger(Number(process.env.PROBATION_ANSWERS)) ? Number(process.env.PROBATION_ANSWERS) : 5,
  probationHoldHours: 24,

  // Automatic flags for the admin.
  lowRatingAverage: 3.5,
  lowRatingMinReviews: 5,
  reportsToFlag: 2,

  // Licences carry an expiry date. The admin is reminded this many days before it.
  licenseReminderDays: 30,

  // Name matching: how alike two names must be (0 to 1) to count as a match.
  nameMatchThreshold: 0.82,

  // Link checks (step 3): every request is limited like this.
  linkTimeoutMs: 6000,
  linkMaxBytes: 300 * 1024,
  linkMaxRedirects: 3,
  newDomainDays: 180,          // a website registered less recently than this is "brand-new"

  // Account signals are kept this long, then deleted.
  signalRetentionDays: 180,
  signalWindowDays: 30,        // "many applications from the same network or device" looks this far back
  duplicateTextSimilarity: 0.8 // two stories (or sample answers) this alike on different accounts count as copied
};

// ---- The automatic decision ("rules v2") -------------------------------------------------------------------
// AUTO-APPROVE only if ALL of these hold (AUTO_APPROVE=on is set in the environment; it is off by default):
//   the niche is not regulated; the ID check passed; age 18+ confirmed; the names match; no interview was requested;
//   the AI recommends "approve"; every AI score is at least minScore; the AI found no red flags; at least one piece of evidence was
//   verified automatically (the page opened and showed the mentor's name or brand); and the risk level is "low".
// Anything else goes to a person ("Needs human"), sorted by risk, with the AI's summary on top.
const DECISION = {
  label: 'rules v2',
  minScore: 75,
  minAutoVerifiedEvidence: 1,
  riskAllowed: 'low'
};

// What the AI scores (0-100), and the red flags it may raise. The AI only advises: the decision is made by the code below.
const SCORE_KEYS = ['expertise_credibility', 'story_consistency', 'sample_answer_quality', 'advice_safety', 'niche_fit'];
const RED_FLAGS = [
  'prompt_injection',            // the application tries to give instructions to the reviewer
  'inconsistent_story',          // the story, title, years and evidence do not fit together
  'unverifiable_claims',         // big claims that nothing in the evidence supports
  'unsafe_advice',               // the sample answer could hurt someone
  'regulated_advice',            // it gives medical, legal or financial advice that needs a licence
  'generic_or_copied',           // reads like a template, or copied from elsewhere
  'niche_mismatch',              // the experience does not fit the chosen niche
  'contact_or_off_platform',     // asks people to pay or talk outside Wisecall
  'spam_or_promotion',
  'offensive_content',
  'other'
];

// Risk points: 0 = low, 1-2 = medium, 3 or more = high.
const RISK = {
  mediumAt: 1,
  highAt: 3,
  points: {
    identity_pending: 1, identity_declined: 3, age_unknown: 1, under_age: 3, names_differ: 2,
    ai_score_below_50: 2, ai_score_below_threshold: 1, ai_red_flag: 1, ai_red_flags_max: 3, prompt_injection: 3,
    no_evidence_opened: 2, dead_link: 1, shortener: 1, new_domain: 1, no_auto_verified_evidence: 1,
    new_email_domain: 1, shared_network: 1, shared_device: 2, duplicate_story: 3, duplicate_sample: 2, duplicate_evidence: 2
  }
};

// Mailbox providers that do not prove a work connection (used for the work-email badge).
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'rambler.ru', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'zoho.com', 'mail.com', 'tutanota.com', 'tuta.io', 'fastmail.com',
  'yahoo.fr', 'hotmail.co.uk', 'live.ru', 'qq.com', '163.com', '126.com', 'ukr.net', 'i.ua', 'bigmir.net', 'posta.ge', 'mail.ge'
];

// ---- Helpers -------------------------------------------------------------------------------
const nicheKeys = () => Object.keys(NICHES);
const isValidNiche = (niche) => Object.prototype.hasOwnProperty.call(NICHES, niche);
const levelFor = (niche) => (isRegulated(niche) ? 'regulated' : 'standard');

// The steps a mentor in this niche needs before they can be approved.
function requiredFor(niche) {
  const out = [...IDENTITY_STEPS, 'experience'];
  if (isRegulated(niche)) {
    out.push('license');
    if (!REGULATED[niche].publicRegister) out.push('license_document');
  }
  return out;
}
const stepNamesFor = requiredFor;
// Steps a mentor in this niche may submit something for (the required ones and the optional badges).
const canSubmit = (niche, step) => requiredFor(niche).includes(step) || OPTIONAL_STEPS.includes(step);

const registriesFor = (niche) => (isRegulated(niche) ? REGULATED[niche].registries : []);

// Whether every requirement for approval is met.
//   statusOf(step) -> 'passed' | 'pending' | 'failed' | undefined
//   extra: steps this mentor needs on top of the niche's (an interview an admin asked for)
// The Experience step counts once it is submitted (the approval itself accepts it); every other step must have passed.
function evaluate(niche, statusOf, extra = []) {
  const missing = [];
  for (const step of [...requiredFor(niche), ...extra]) {
    const s = statusOf(step);
    const ok = step === 'experience' ? (s === 'pending' || s === 'passed') : s === 'passed';
    if (!ok) missing.push(step);
  }
  return { ready: missing.length === 0, missing };
}

// ---- Risk and decision (pure functions: the analysis gathers the facts, these decide) ------------------------------
// facts: { identity: { kyc, age, names }, ai, aiError, injection, links: { total, opened, autoVerified, dead, shorteners, newDomains },
//          signals: { newEmailDomain, sharedNetwork, sharedDevice, duplicateStory, duplicateSample, duplicateEvidence } }
// -> { level, score, points: [{ code, points }] }
function riskFrom(f) {
  const P = RISK.points;
  const points = [];
  const add = (code, n = P[code]) => { if (n > 0) points.push({ code, points: n }); };
  const id = f.identity || {};
  if (id.kyc === 'failed') add('identity_declined'); else if (id.kyc !== 'passed') add('identity_pending');
  if (id.age === 'failed') add('under_age'); else if (id.kyc === 'passed' && id.age !== 'passed') add('age_unknown');
  if (id.kyc === 'passed' && id.names !== 'passed') add('names_differ');

  if (f.ai) {
    const scores = SCORE_KEYS.map((k) => f.ai.scores[k]);
    if (scores.some((s) => s < 50)) add('ai_score_below_50');
    else if (scores.some((s) => s < DECISION.minScore)) add('ai_score_below_threshold');
    const flags = f.ai.red_flags.filter((r) => r.code !== 'prompt_injection').length;
    if (flags) add('ai_red_flag', Math.min(flags * P.ai_red_flag, P.ai_red_flags_max));
  }
  if (f.injection || (f.ai && f.ai.red_flags.some((r) => r.code === 'prompt_injection'))) add('prompt_injection');

  const l = f.links || {};
  if (l.total && !l.opened) add('no_evidence_opened');
  if (l.dead) add('dead_link');
  if (l.shorteners) add('shortener');
  if (l.newDomains) add('new_domain');
  if (!l.autoVerified) add('no_auto_verified_evidence');

  const s = f.signals || {};
  for (const k of ['newEmailDomain', 'sharedNetwork', 'sharedDevice', 'duplicateStory', 'duplicateSample', 'duplicateEvidence']) {
    if (s[k]) add(k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()));
  }
  const score = points.reduce((sum, p) => sum + p.points, 0);
  const level = score >= RISK.highAt ? 'high' : (score >= RISK.mediumAt ? 'medium' : 'low');
  return { level, score, points };
}

// -> { outcome: 'auto_approved' | 'needs_human', reasons: [{ code, ... }], wouldAutoApprove }
// facts: { autoApproveOn, regulated, identity, interviewRequested, ai, aiError, injection, risk, autoVerifiedEvidence }
function decide(f) {
  const reasons = [];
  const id = f.identity || {};
  if (f.regulated) reasons.push({ code: 'regulated_niche' });
  if (id.kyc !== 'passed') reasons.push({ code: 'identity_not_verified' });
  if (id.age !== 'passed') reasons.push({ code: 'age_not_confirmed' });
  if (id.names !== 'passed') reasons.push({ code: 'names_differ' });
  if (f.interviewRequested) reasons.push({ code: 'interview_requested' });
  if (!f.ai) reasons.push({ code: 'ai_unavailable', detail: f.aiError || null });
  else {
    if (f.ai.recommendation !== 'approve') reasons.push({ code: 'ai_recommends_' + f.ai.recommendation });
    const low = SCORE_KEYS.filter((k) => !(f.ai.scores[k] >= DECISION.minScore));
    if (low.length) reasons.push({ code: 'scores_below', keys: low, min: DECISION.minScore });
  }
  // Red flags from the AI, plus our own check for text that tries to instruct the reviewer (it counts even if the AI missed it).
  const flags = new Set(f.ai ? f.ai.red_flags.map((r) => r.code) : []);
  if (f.injection) flags.add('prompt_injection');
  if (flags.size) reasons.push({ code: 'red_flags', flags: [...flags] });
  if ((f.autoVerifiedEvidence || 0) < DECISION.minAutoVerifiedEvidence) reasons.push({ code: 'no_auto_verified_evidence' });
  if (!f.risk || f.risk.level !== DECISION.riskAllowed) reasons.push({ code: 'risk_' + (f.risk ? f.risk.level : 'unknown') });
  const wouldAutoApprove = reasons.length === 0;
  if (!f.autoApproveOn) reasons.unshift({ code: 'auto_approve_off' });
  return { outcome: reasons.length ? 'needs_human' : 'auto_approved', reasons, wouldAutoApprove };
}

module.exports = {
  VERSION, STEPS, LEGACY_STEPS, OPTIONAL_STEPS, IDENTITY_STEPS, NICHES, REGULATED, COMPANY_REGISTRY, EVIDENCE_KINDS, LIMITS,
  DECISION, SCORE_KEYS, RED_FLAGS, RISK, FREE_EMAIL_DOMAINS,
  nicheKeys, isValidNiche, isRegulated, levelFor, requiredFor, stepNamesFor, canSubmit, registriesFor, evaluate, riskFrom, decide
};
