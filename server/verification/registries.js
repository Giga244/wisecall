// Regulated professions: which niches they are, where an admin checks a mentor's licence, and where each fact came from.
// EVERY ENTRY NEEDS A LAWYER'S CONFIRMATION before launch (LEGAL-REVIEW.md, "Regulated professions"). Researched September 2026.
//
//   publicRegister  true: the issuing body publishes a register an admin can search, so the licence number + issuing body is enough
//                   (the admin opens the register from the admin panel and looks the mentor up).
//                   false: there is no public register we could confirm, so the mentor ALSO uploads the licence, certificate or diploma
//                   and an admin checks the document by hand. Mentors in these fields are never blocked for lack of a register.
//   registries      links the admin panel shows next to the licence (never fetched by the server: an admin opens them).
//   credential      'diploma' when there is no licence at all and what we accept is a diploma or certificate (psychology, nursing):
//                   the pages then say "diploma or certificate", never "licence", and it needs no end date
//                   (docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md).
//   sources         where the facts above come from.
//
// The keys are niche keys (the niches table, migration 019).
const REGULATED = {
  medicine: {
    label: 'Medicine',
    licence: 'State certificate for independent medical practice (Law of Georgia "On Medical Practice")',
    publicRegister: false, // the agency keeps the register of certificate holders; a public search page could not be confirmed
    registries: [
      { key: 'rama', label: 'Regulation Agency for Medical and Pharmaceutical Activities (state certificates)', url: 'https://rama.moh.gov.ge/' }
    ],
    sources: [
      'https://rama.moh.gov.ge/',
      'https://legal.ge/en/service/healthcare-and-pharmaceutical-law-en/medical-specialist-licensing-en'
    ]
  },
  dentistry: {
    label: 'Dentistry',
    licence: 'State certificate for independent medical practice in a dental specialty (Law of Georgia "On Medical Practice")',
    publicRegister: false,
    registries: [
      { key: 'rama', label: 'Regulation Agency for Medical and Pharmaceutical Activities (state certificates)', url: 'https://rama.moh.gov.ge/' }
    ],
    sources: ['https://rama.moh.gov.ge/']
  },
  pharmacy: {
    label: 'Pharmacy',
    licence: 'Pharmacist qualification; pharmacies are licensed under the Law of Georgia "On Medicines and Pharmaceutical Activities"',
    publicRegister: false,
    registries: [
      { key: 'rama', label: 'Regulation Agency for Medical and Pharmaceutical Activities', url: 'https://rama.moh.gov.ge/' }
    ],
    sources: ['https://matsne.gov.ge/en/document/view/29836', 'https://rama.moh.gov.ge/']
  },
  nursing: {
    label: 'Nursing',
    licence: 'Nursing diploma or certificate (no public register of nurses could be confirmed)',
    credential: 'diploma',
    publicRegister: false,
    registries: [],
    sources: ['https://rama.moh.gov.ge/']
  },
  // (until November 2026 these two counted as medicine, which asked for a doctor's state certificate: docs/PLAN-CATEGORIES.md)
  veterinary: {
    label: 'Veterinary medicine',
    licence: 'Veterinary diploma, certificate or licence (not researched yet: a lawyer should confirm what Georgian law requires and whether a register exists)',
    credential: 'diploma',
    publicRegister: false,
    registries: [],
    sources: []
  },
  nutrition: {
    label: 'Nutrition',
    licence: 'Nutrition or dietetics diploma or certificate (not researched yet: a lawyer should confirm whether a licence is required)',
    credential: 'diploma',
    publicRegister: false,
    registries: [],
    sources: []
  },
  // (docs/CLAUDE-CODE-NEW-CATEGORIES.md: regulated like the fields above. Not researched yet: what is accepted is checked by a person.)
  aviation: {
    label: 'Aviation',
    licence: 'Pilot, cabin crew, air traffic control or aircraft maintenance licence or certificate (not researched yet: a lawyer should confirm what Georgian law requires and whether a register exists)',
    publicRegister: false,
    registries: [],
    sources: []
  },
  maritime: {
    label: 'Maritime',
    licence: "Seafarer's certificate of competency or maritime licence (not researched yet: a lawyer should confirm what Georgian law requires and whether a register exists)",
    publicRegister: false,
    registries: [],
    sources: []
  },
  allied_health: {
    label: 'Allied health',
    licence: 'Physiotherapy, speech therapy, occupational therapy, public health or laboratory diploma, certificate or licence (not researched yet: a lawyer should confirm whether a licence is required)',
    credential: 'diploma',
    publicRegister: false,
    registries: [],
    sources: []
  },
  psychology: {
    label: 'Psychology',
    licence: 'Psychology diploma or certificate (no licensing law or public register for psychologists could be confirmed)',
    credential: 'diploma',
    publicRegister: false,
    registries: [],
    sources: ['https://matsne.gov.ge/ka/document/view/24178 (Law of Georgia on Mental Health: mentions psychologists, no register)']
  },
  law: {
    label: 'Law',
    licence: 'Membership of the Georgian Bar Association (advocates)',
    publicRegister: true,
    registries: [
      { key: 'gba', label: 'Georgian Bar Association: members registry', url: 'https://gba.ge/en/Lawyers/Members-Registry' }
    ],
    sources: ['https://gba.ge/en/Lawyers/Members-Registry']
  },
  finance: {
    label: 'Finance',
    licence: 'Investment advice needs a National Bank of Georgia registration, which is given to companies only; individuals show a certificate (for example CFA or ACCA) or their employer\'s registration',
    publicRegister: false, // the NBG registers list companies, not the individual adviser
    registries: [
      { key: 'nbg', label: 'National Bank of Georgia: licensing and registers of supervised entities', url: 'https://nbg.gov.ge/en/page/licensing-requirements' }
    ],
    sources: ['https://nbg.gov.ge/en/page/licensing-requirements', 'https://legal.ge/en/service/licensing-and-regulatory-permits-en/investment-advisor-license-georgia']
  },
  accounting_tax: {
    label: 'Accounting & tax',
    licence: 'Certified accountant or auditor listed by SARAS (Service for Accounting, Reporting and Auditing Supervision)',
    publicRegister: true,
    registries: [
      { key: 'saras', label: 'SARAS: registers of auditors, certified accountants and accounting firms', url: 'https://saras.gov.ge/en/Home/Supervision' }
    ],
    sources: ['https://saras.gov.ge/en/Home/Supervision', 'https://saras.gov.ge/Content/files/LAW_on_ACCOUNTING_REPORTING_AND_AUDIT_ENG.pdf']
  }
};

// Fields that were looked at and are NOT treated as regulated for giving advice (a lawyer should confirm; LEGAL-REVIEW.md).
const CONSIDERED = {
  architecture: {
    note: 'Architects must be certified to sign building projects (Code on Spatial Planning, Architectural and Construction Activities, since 1 Oct 2020), but advice needs no certificate.',
    sources: ['https://icca.ge/en/news/georgian-code-on-spatial-planning-architectural-and-construction-activities/']
  },
  real_estate: { note: 'No licence for real-estate agents could be confirmed in Georgia.', sources: ['https://napr.gov.ge/en'] },
  tourism: { note: 'No licence for tour guides or hospitality advice could be confirmed.', sources: [] },
  study_abroad: { note: 'No licence for education agents could be confirmed.', sources: [] }
};

// Georgian companies: an admin looks the identification code up in the Public Registry (the server never scrapes it).
const COMPANY_REGISTRY = [
  { key: 'enreg', label: 'Public Registry: search a company by name or identification code', url: 'https://enreg.reestri.gov.ge/' },
  { key: 'napr', label: 'National Agency of Public Registry', url: 'https://napr.gov.ge/en' }
];

module.exports = { REGULATED, CONSIDERED, COMPANY_REGISTRY };
