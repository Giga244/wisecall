// "Your field": a mentor describes their field in their own words ("Crypto trading", "Nail artist", "Study in Germany") and picks the
// closest category, or "Other". The words are public, so they are checked like any public label (server/customNiche.js).
//
// Regulated work stays regulated whatever the mentor typed: when the field or the title names a regulated profession (a doctor, a
// lawyer, a financial adviser, ...) and the chosen category is not regulated, the matching regulated category is used instead, so
// the licence step and "never approved automatically" apply. An admin can clear that for one mentor ("Doctor Who fan fiction" is
// not medicine); the override lasts until the mentor changes their field or title again.
const niches = () => require('./niches');

// category -> English words (whole words, an optional plural "s") and Georgian stems (any ending: ექიმი, ექიმის, ექიმად).
// Order matters: the first category that matches is used.
const PROFESSIONS = [
  ['dentistry', ['dentist', 'orthodontist', 'dental surgeon'], ['სტომატოლოგ', 'ორთოდონტ']],
  ['pharmacy', ['pharmacist'], ['ფარმაცევტ']],
  ['nursing', ['nurse', 'midwife'], ['ექთან', 'ბებიაქალ']],
  ['psychology', ['psychologist', 'psychotherapist', 'psychoanalyst'], ['ფსიქოლოგ', 'ფსიქოთერაპევტ']],
  ['veterinary', ['veterinarian', 'veterinary surgeon', 'vet'], ['ვეტერინარ']],
  ['nutrition', ['dietitian', 'dietician', 'nutritionist'], ['დიეტოლოგ', 'ნუტრიციოლოგ']],
  ['medicine', ['doctor', 'physician', 'surgeon', 'paediatrician', 'pediatrician', 'cardiologist', 'dermatologist', 'gynaecologist',
    'gynecologist', 'neurologist', 'psychiatrist', 'oncologist', 'radiologist', 'anaesthetist', 'anesthesiologist', 'ophthalmologist',
    'urologist', 'endocrinologist', 'family medicine', 'general practitioner'],
  ['ექიმ', 'ქირურგ', 'პედიატრ', 'კარდიოლოგ', 'დერმატოლოგ', 'გინეკოლოგ', 'ნევროლოგ', 'ფსიქიატრ', 'ონკოლოგ', 'რადიოლოგ', 'ანესთეზიოლოგ',
    'ოფთალმოლოგ', 'უროლოგ', 'ენდოკრინოლოგ']],
  ['law', ['lawyer', 'attorney', 'advocate', 'solicitor', 'barrister', 'notary', 'legal adviser', 'legal advisor', 'legal counsel'],
    ['ადვოკატ', 'იურისტ', 'ნოტარიუს', 'იურიდიული კონსულტანტ', 'იურიდიული მრჩეველ']],
  ['accounting_tax', ['accountant', 'auditor', 'tax adviser', 'tax advisor', 'tax consultant'], ['ბუღალტერ', 'აუდიტორ', 'საგადასახადო კონსულტანტ', 'საგადასახადო მრჩეველ']],
  ['finance', ['financial adviser', 'financial advisor', 'financial planner', 'investment adviser', 'investment advisor', 'wealth manager',
    'stockbroker', 'broker'], ['ფინანსური მრჩეველ', 'ფინანსური კონსულტანტ', 'საინვესტიციო მრჩეველ', 'ბროკერ']]
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES = PROFESSIONS.map(([niche, en, ka]) => ({
  niche,
  en: new RegExp(`(?:^|[^a-z])(?:${en.map((w) => escapeRe(w).replace(/ /g, '\\s+')).join('|')})s?(?![a-z])`, 'i'),
  ka
}));

// -> the regulated category the words name, or null.
function regulatedCategoryIn(...texts) {
  const text = texts.filter(Boolean).join(' \n ').normalize('NFKC').toLowerCase();
  if (!text) return null;
  for (const r of RULES) {
    if (r.en.test(text) || r.ka.some((stem) => text.includes(stem))) return r.niche;
  }
  return null;
}

// The category to keep for a mentor's field, title and chosen category. -> { niche, forced } where forced names the regulated category
// that replaced the chosen one (null when the choice stands). overridden: an admin cleared this mentor's words.
function categoryFor({ niche, field, title, overridden }) {
  if (overridden || !niche) return { niche, forced: null };
  if (niches().isRegulated(niche)) return { niche, forced: null };
  const hit = regulatedCategoryIn(field, title);
  return hit && hit !== niche && niches().isValid(hit) ? { niche: hit, forced: hit } : { niche, forced: null };
}

module.exports = { regulatedCategoryIn, categoryFor, PROFESSIONS };
