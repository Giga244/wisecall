// Checks on text people send each other through Wisecall (the booking follow-up in the Inbox, and later public texts).
//   findContactDetails(text) -> ['phone' | 'email' | 'messenger' | 'external_payment', ...] (empty when nothing was found)
//   isOffensive(text)        -> true when a rude word is in it (English and Georgian, also Georgian written in Latin letters)
// Patterns are English and Georgian. They aim at what moves a conversation (or a payment) off the site: a phone number, an email
// address, a messenger or social handle, a request to pay outside Wisecall. Talking ABOUT money or apps (a finance question about
// crypto, say) is fine; asking to be paid, or to be contacted, somewhere else is not.
const names = require('./verification/names');

const PATTERNS = {
  phone: [
    /\+\s?\d(?:[\s().-]?\d){7,}/,                                   // +995 555 12 34 56, +44 20 7946 0958
    /(?:^|\D)(?:995[\s.-]?)?5\d{2}(?:[\s.-]?\d{2}){3}(?!\d)/,        // Georgian mobiles: 555 12 34 56, 555123456
    /(?:^|\D)0?32[\s.-]?2\d{2}(?:[\s.-]?\d{2}){2}(?!\d)/,            // Tbilisi landlines: 032 2 12 34 56
    /\d(?:[ .-]?\d){10,}/                                           // any other long run of digits
  ],
  email: [
    /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}/i,
    /\b(?:gmail|g-mail|yahoo|hotmail|outlook|icloud|protonmail|yandex|mail\.ru)\b/i,
    /ჯიმეილ|ჯი-მეილ|ჰოტმეილ|იაჰუ/
  ],
  messenger: [
    /\b(?:whats\s?app|viber|telegram|signal\s+app|skype|we\s?chat|discord|snapchat|messenger|instagram|insta|facebook|tiktok|linkedin|zoom\s+id)\b/i,
    /\b(?:t\.me|wa\.me|m\.me|fb\.me|ig\.me|instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|vk\.com)\b/i,
    /(?:^|[\s(,;:])@[a-z0-9_.]{3,}/i,                                // an @handle
    /ვა[ცტ]საპ|ვოცაპ|ვაცაპ|ვაიბერ|ტელეგრამ|სკაიპ|ინსტაგრამ|ინსტა|ფეისბუქ|მესენჯერ|ტიკტოკ|ლინკდინ|ლინქდინ/
  ],
  external_payment: [
    /\b(?:pay|send|transfer|wire)\s+(?:me|us)\b/i,
    /\bmy\s+(?:paypal|revolut|iban|bank\s+account|card(?:\s+number)?|account\s+number|wallet|crypto\s+wallet)\b/i,
    /\b(?:paypal|revolut|payoneer|venmo|zelle|cash\s?app|western\s?union|moneygram)\b/i,
    /\b(?:outside|off)\s+(?:of\s+)?(?:wisecall|the\s+(?:site|platform|app))\b/i,
    /\bGE\s?\d{2}\s?[A-Z]{2}\s?\d/i,                                 // a Georgian IBAN
    /გადმომირიცხ|ჩამირიცხ|გადამიხად|გადამირიცხ|ჩემს\s?(?:ბარათზე|ანგარიშზე|საფულეზე)|ჩემი\s?(?:ბარათის|ანგარიშის)\s?ნომ|საიტის\s?გარეთ|პლატფორმის\s?გარეთ|პეიპალ|რევოლუტ/
  ]
};

// Invisible characters and look-alike forms are removed first, so "t.me" cannot hide as "t​.me".
const normalise = (text) => String(text || '').normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200B-\u200F\u2060-\u2064\uFEFF]/g, '');

function findContactDetails(text) {
  const t = normalise(text);
  return Object.keys(PATTERNS).filter((kind) => PATTERNS[kind].some((re) => re.test(t)));
}

// ---- Questions and answers (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 4) ------------------------------------------------------------
// Narrower than the patterns above, because these are long texts about real subjects: naming Instagram, or "we looked at grades. Then", must pass.
//   everywhere: a phone number, an email address, an @handle, a link to a social network or a messenger, an invitation to one, and "call me", "write
//               to me" or "number" with at least three digits next to it. Any other public link (an article, a university's page) is fine.
//   strict (the asker is 16-17), on top of that: naming a messenger at all, naming an email provider, shorter numbers, numbers spelled out in words.
const MESSENGERS = 'whats\\s?app|viber|telegram|signal\\s+app|skype|we\\s?chat|discord|snapchat';
const SOCIAL = 'instagram|insta|facebook|fb|tiktok|linkedin|messenger';
const KA_MESSENGERS = 'ვა[ცტ]საპ|ვოცაპ|ვაცაპ|ვაიბერ|ტელეგრამ|სკაიპ|დისკორდ|სნეპჩატ';
const KA_SOCIAL = 'ინსტაგრამ|ინსტა|ფეისბუქ|ტიკტოკ|მესენჯერ|ლინკდინ|ლინქდინ';
const KA_WRITE = 'მომწერე|მომწერეთ|დამიკავშირდი|დამიკავშირდით|დამირეკე|დამირეკეთ|მიპოვე|მიპოვეთ|დამამატე|დამამატეთ';
const CODE_WORDS = 'override|media|param|returns?|staticmethod|classmethod|property|import|keyframes|supports|font-face|deprecated|test|component|injectable|dataclass|app|type|interface|entity|service|autowired';
const CONTACT = {
  email: [
    /[a-z0-9._%+-]+\s?@\s?[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
    /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\{at\})\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}/i,
    /[a-z0-9._%+-]+\s+at\s+(?:gmail|g-mail|yahoo|hotmail|outlook|icloud|proton(?:mail)?|yandex|mail)\b/i
  ],
  handle: [new RegExp(`(?:^|[\\s(,;:])@(?!(?:${CODE_WORDS})\\b)[a-z0-9_.]{3,}`, 'i')],
  social_link: [
    /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*(?:t\.me|telegram\.(?:me|org|dog)|wa\.me|whatsapp\.com|m\.me|fb\.me|fb\.com|fb\.watch|facebook\.com|messenger\.com|instagram\.com|instagr\.am|ig\.me|tiktok\.com|viber\.com|discord\.gg|discord\.com|discordapp\.com|snapchat\.com|linkedin\.com|lnkd\.in|vk\.com|x\.com|twitter\.com|threads\.net)(?![a-z0-9-])/i,
    /viber:\/\/|whatsapp:\/\/|tg:\/\//i
  ],
  contact_invite: [
    new RegExp(`\\b(?:write|message|msg|text|call|contact|find|add|dm|reach|ping|follow)\\s+(?:me|us)\\b.{0,30}\\b(?:${MESSENGERS}|${SOCIAL})\\b`, 'i'),
    new RegExp(`\\b(?:${MESSENGERS}|${SOCIAL})\\b.{0,20}\\b(?:write|message|msg|text|call|contact|find|add|dm|reach|ping)\\s+(?:me|us)\\b`, 'i'),
    new RegExp(`\\b(?:on|via|over|through)\\s+(?:my\\s+)?(?:${MESSENGERS})\\b`, 'i'),
    new RegExp(`\\bmy\\s+(?:${MESSENGERS}|${SOCIAL})\\b`, 'i'),
    /\b(?:dm|inbox|pm)\s+me\b/i,
    new RegExp(`(?:${KA_MESSENGERS})(?:ზე|ში|ით)`),
    new RegExp(`(?:${KA_WRITE}).{0,30}(?:${KA_SOCIAL})|(?:${KA_SOCIAL}).{0,30}(?:${KA_WRITE})`),
    new RegExp(`ჩემ(?:ი|ს|ს?\\s)\\s?(?:${KA_MESSENGERS}|${KA_SOCIAL})`)
  ]
};
const STRICT_CONTACT = {
  messenger: [new RegExp(`\\b(?:${MESSENGERS})\\b`, 'i'), new RegExp(KA_MESSENGERS)],
  email: [/\b(?:gmail|g-mail|yahoo|hotmail|outlook|icloud|protonmail|yandex|mail\.ru)\b/i, /ჯიმეილ|ჯი-მეილ|ჰოტმეილ|იაჰუ/],
  spelled_number: [
    /(?:\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b[\s,.-]+){5,}\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/i,
    /(?:(?:ნული|ერთი|ორი|სამი|ოთხი|ხუთი|ექვსი|შვიდი|რვა|ცხრა)[\s,.-]+){5,}(?:ნული|ერთი|ორი|სამი|ოთხი|ხუთი|ექვსი|შვიდი|რვა|ცხრა)/
  ]
};
const CALL_WORDS = 'დამირეკე|დამირეკეთ|მომწერე|მომწერეთ|ნომერ|call\\s+me|text\\s+me|ring\\s+me|my\\s+number|phone\\s+number|whats\\s?app\\s+me';
const CALL_NEAR_DIGITS = [new RegExp(`(?:${CALL_WORDS})[^\\d]{0,30}(\\d(?:[\\s.-]?\\d){2,})`, 'gi'), new RegExp(`(\\d(?:[\\s.-]?\\d){2,})[^\\d]{0,30}(?:${CALL_WORDS})`, 'gi')];
const CURRENCY_AFTER = /^\s*(?:ლარ|₾|gel\b|usd\b|\$|€|eur|dollar|დოლარ|ევრო|თეთრ)/i;
const isYear = (d) => /^(?:19|20)\d\d$/.test(d);

// A run of digits that is not a phone number: years in a row ("2023 2024 2025"), a date, an amount of money.
function harmlessNumber(run, after) {
  if (CURRENCY_AFTER.test(after)) return true;
  const groups = run.split(/[^\d]+/).filter(Boolean);
  if (groups.length > 1 && groups.every(isYear)) return true;
  if (/^\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d\d$|^(?:19|20)\d\d[./-]\d{1,2}[./-]\d{1,2}$/.test(run)) return true;
  return false;
}
function hasPhone(t, strict) {
  if (/\+\s?\d(?:[\s().-]?\d){7,}/.test(t)) return true;
  const min = strict ? 7 : 10;
  for (const m of t.matchAll(/\(?\d(?:[ .()-]{0,2}\d)+/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (harmlessNumber(m[0], t.slice(m.index + m[0].length, m.index + m[0].length + 12))) continue;
    if (digits.length >= min) return true;
    // (Georgian numbers: 5xx xx xx xx, 5xx xxx xxx, and Tbilisi's 032 2xx xx xx)
    if (digits.length === 9 && /^(?:5|32)/.test(digits)) return true;
  }
  return false;
}

// -> the kinds found (empty when nothing was).
function findBlockedContact(text, { strict = false } = {}) {
  const t = normalise(text);
  const kinds = new Set();
  if (hasPhone(t, strict)) kinds.add('phone');
  for (const [kind, res] of Object.entries(CONTACT)) if (res.some((re) => re.test(t))) kinds.add(kind);
  if (strict) for (const [kind, res] of Object.entries(STRICT_CONTACT)) if (res.some((re) => re.test(t))) kinds.add(kind);
  for (const re of CALL_NEAR_DIGITS) {
    for (const m of t.matchAll(re)) if (!isYear(m[1].replace(/\D/g, ''))) kinds.add('contact_phrase');
  }
  return [...kinds];
}

// Whole words, after Georgian is written in Latin letters and spelling variants are folded. Kept short on purpose: it stops the
// obvious; a person reviews what is public anyway.
const RUDE = new Set(['fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'asshole', 'porn', 'porno',
  'bastard', 'dick', 'nigger', 'faggot', 'retard',
  'bozi', 'boz', 'yle', 'mutel', 'mutli', 'trak', 'dedamovtyan', 'dedamovtkan', 'shechema']);
const wordsOf = (text) => names.transliterate(normalise(text)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isOffensive(text) {
  return wordsOf(text).some((w) => RUDE.has(w) || RUDE.has(names.canon(w)));
}

// Plain text as people typed it, tidied: no control characters, at most two empty lines in a row, trimmed. Never HTML: every page
// escapes it (or sets it as text) when it shows it.
function cleanText(text) {
  return normalise(text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const length = (text) => [...String(text || '')].length;

module.exports = { findContactDetails, findBlockedContact, isOffensive, cleanText, length, wordsOf, RUDE };
