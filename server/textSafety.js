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

module.exports = { findContactDetails, isOffensive, cleanText, length, wordsOf, RUDE };
