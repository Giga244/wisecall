// ALL the mentor-verification rules live in this one file. Change a niche's level, a required step,
// a limit or a registry link here and nothing else has to change.
//
// A mentor cannot appear in Browse experts until an admin has given final approval, and that final
// approval is only possible when every required step for their niche has passed.

// ---- Steps ---------------------------------------------------------------------------------
// decider: who can mark the step passed or failed
//   system    the server (verified email, work-email code)
//   provider  the ID-verification provider, through its signed webhook only
//   auto+admin  the server compares names; a mismatch always goes to an admin
//   admin     a person on the Wisecall team, always with a written reason
const STEPS = {
  email:            { decider: 'system' },
  id_kyc:           { decider: 'provider' },
  name_match:       { decider: 'auto+admin' },
  sample_answer:    { decider: 'admin' },
  proof_link:       { decider: 'admin' },
  license:          { decider: 'admin', credential: true },
  license_document: { decider: 'admin', document: true },
  video_interview:  { decider: 'admin' },
  company_id:       { decider: 'admin' },
  role_proof:       { decider: 'admin', document: true },
  work_email:       { decider: 'system' },
  diploma:          { decider: 'admin', document: true },
  portfolio:        { decider: 'admin' }
};

// ---- Levels --------------------------------------------------------------------------------
// A required entry is a step name, or { anyOf: [...] } meaning "at least one of these".
const LEVELS = {
  // Everyone: verified email, ID + selfie liveness, name match, sample answer, proof link ...
  standard: [
    'email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link',
    // ... plus at least one of: a work email at a company or institution, a diploma/certificate, a portfolio.
    { anyOf: ['work_email', 'diploma', 'portfolio'] }
  ],
  business: [
    'email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link',
    // ... plus a company ID number (Georgian Public Registry) or proof of the person's role.
    { anyOf: ['company_id', 'role_proof'] }
  ],
  regulated: [
    'email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link',
    // ... plus a licence/registration number, a supporting document, and a video interview.
    'license', 'license_document', 'video_interview'
  ]
};

// ---- Niches --------------------------------------------------------------------------------
// `regulated: true` (or level 'regulated') puts a niche on the strictest level. Add the tag to any
// niche you want treated as regulated.
const NICHES = {
  business:    { level: 'business' },
  medicine:    { level: 'regulated', regulated: true, registry: 'medicine' },
  law:         { level: 'regulated', regulated: true, registry: 'law' },
  finance:     { level: 'regulated', regulated: true, registry: 'finance' },
  teaching:    { level: 'standard' },
  tech:        { level: 'standard' },
  fitness:     { level: 'standard' },
  creative:    { level: 'standard' },
  marketing:   { level: 'standard' },
  design:      { level: 'standard' },
  writing:     { level: 'standard' },
  parenting:   { level: 'standard' },
  engineering: { level: 'standard' },
  science:     { level: 'standard' }
};

// Official registries the admin checks by hand. Each is a link to open, not an integration.
// The Bar Association and Public Registry links were confirmed; the health-care and National Bank links
// go to the regulators' sites. REVIEW ALL OF THEM before launch: official sites change.
const REGISTRIES = {
  medicine: [
    { key: 'health', label: 'State Regulation Agency for Medical Activities (health-care professionals and licences)', url: 'http://www.rama.moh.gov.ge/' },
    { key: 'moh', label: 'Ministry of Health of Georgia', url: 'https://www.moh.gov.ge/' }
  ],
  law: [
    { key: 'bar', label: 'Georgian Bar Association: members registry', url: 'https://gba.ge/en/Lawyers/Members-Registry' }
  ],
  finance: [
    { key: 'nbg', label: 'National Bank of Georgia: registers of supervised entities and licences', url: 'https://nbg.gov.ge/en' }
  ],
  business: [
    { key: 'enreg', label: 'Public Registry: search a company by name or ID number', url: 'https://enreg.reestri.gov.ge/' },
    { key: 'napr', label: 'National Agency of Public Registry', url: 'https://napr.gov.ge/en' }
  ]
};
// ---- Limits and timings ---------------------------------------------------------------------
const LIMITS = {
  // Uploaded documents (licences, diplomas): stored privately, admin-only, deleted after a decision.
  maxUploadBytes: 10 * 1024 * 1024,
  allowedUploadTypes: ['application/pdf', 'image/jpeg'],
  documentRetentionDays: 90,

  // Work email: free/personal mailbox providers are refused.
  workEmailCodeMinutes: 15,

  // Probation: a new mentor's first answers wait for an admin before the buyer sees them.
  probationAnswers: 5,
  probationHoldHours: 24,

  // Automatic flags for the admin.
  lowRatingAverage: 3.5,
  lowRatingMinReviews: 5,
  reportsToFlag: 2,

  // Licences carry an expiry date. The admin is reminded this many days before it.
  licenseReminderDays: 30,

  // Name matching: how alike two names must be (0 to 1) to count as a match.
  nameMatchThreshold: 0.82
};

// Mailbox providers that do not prove a work connection (used for the work-email step).
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'rambler.ru', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'zoho.com', 'mail.com', 'tutanota.com', 'tuta.io', 'fastmail.com',
  'yahoo.fr', 'hotmail.co.uk', 'live.ru', 'qq.com', '163.com', '126.com', 'ukr.net', 'i.ua', 'bigmir.net', 'posta.ge', 'mail.ge'
];

// ---- Helpers -------------------------------------------------------------------------------
const nicheKeys = () => Object.keys(NICHES);
const isValidNiche = (niche) => Object.prototype.hasOwnProperty.call(NICHES, niche);

function levelFor(niche) {
  const n = NICHES[niche];
  if (!n) return 'standard';
  return n.regulated ? 'regulated' : n.level;
}

const requiredFor = (niche) => LEVELS[levelFor(niche)];
const registriesFor = (niche) => (NICHES[niche] && REGISTRIES[NICHES[niche].registry || niche]) || [];

// Every step name that could count towards a niche (flat list, for showing progress).
function stepNamesFor(niche) {
  const names = [];
  for (const r of requiredFor(niche)) (typeof r === 'string' ? names.push(r) : names.push(...r.anyOf));
  return names;
}

// Decides whether every requirement is met.
//   statusOf(step) -> 'passed' | 'pending' | 'failed' | undefined
// Returns { ready, missing } where missing lists what is still needed, e.g. ['id_kyc', { anyOf: [...] }].
function evaluate(niche, statusOf) {
  const missing = [];
  for (const r of requiredFor(niche)) {
    if (typeof r === 'string') {
      if (statusOf(r) !== 'passed') missing.push(r);
    } else if (!r.anyOf.some((s) => statusOf(s) === 'passed')) {
      missing.push(r);
    }
  }
  return { ready: missing.length === 0, missing };
}

module.exports = {
  STEPS, LEVELS, NICHES, REGISTRIES, LIMITS, FREE_EMAIL_DOMAINS,
  nicheKeys, isValidNiche, levelFor, requiredFor, registriesFor, stepNamesFor, evaluate
};
