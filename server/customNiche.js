// "Other: type your own" niche. A mentor whose field is not in the list writes it in their own words (3 to 40 characters). The text is
// public on their profile, so it is cleaned and checked: letters of any alphabet, spaces and a few joining marks only; no links, email
// addresses, phone numbers or long numbers; no rude words (English and Georgian, also written in Latin letters); nothing that looks like
// an instruction to the reviewer. An admin later sees these grouped as "Suggested niches" (see server/routes/adminNiches.js).
const names = require('./verification/names');
const { detectInjection } = require('./verification/injection');

const MIN = 3;
const MAX = 40;

// Whole words (after Georgian is written in Latin letters and spelling variants are folded). Kept short on purpose: the admin reviews
// every application anyway; this only stops the obvious from being saved as a public label.
const RUDE = new Set(['fuck', 'fucking', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'asshole', 'porn', 'porno', 'bastard', 'dick',
  'bozi', 'boz', 'yle', 'mutel', 'mutli', 'trak', 'dedamovtyan']);

// Lower-case Latin words (Georgian written in Latin letters, accents removed). Unlike names.tokens, titles such as "doctor" are kept.
const wordsOf = (text) => names.transliterate(String(text || '')).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// -> { value } or { error: 'invalid_custom_niche' }
function clean(input) {
  if (typeof input !== 'string') return { error: 'invalid_custom_niche' };
  const value = input.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200B-\u200F\u2060-\u2064\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const chars = [...value].length;
  if (chars < MIN || chars > MAX) return { error: 'invalid_custom_niche' };
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\d &+'’,.()\/-]*$/u.test(value)) return { error: 'invalid_custom_niche' };  // (starts with a letter)
  if (/https?:|www\.|@|\.(com|ge|net|org|io|ru)\b/i.test(value)) return { error: 'invalid_custom_niche' };
  if ((value.match(/\d/g) || []).length > 4) return { error: 'invalid_custom_niche' };                           // (no phone numbers)
  const words = wordsOf(value);
  if (words.some((w) => RUDE.has(w) || RUDE.has(names.canon(w)))) return { error: 'invalid_custom_niche' };
  if (detectInjection([{ field: 'niche', text: value }]).found) return { error: 'invalid_custom_niche' };
  return { value };
}

// The grouping key for "Suggested niches": the same words whatever the case, alphabet (Georgian or Latin) or small spelling differences.
function groupKey(label) {
  return wordsOf(label).map(names.canon).filter(Boolean).sort().join(' ');
}

module.exports = { clean, groupKey, MIN, MAX };
