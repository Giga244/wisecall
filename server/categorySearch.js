// The one search box (docs/CLAUDE-CODE-CATEGORIES.md): fields, chips, specializations, universities and countries at once, in Georgian and English, with typos
// and Georgian typed in Latin letters. "სტომატ", "IELTS", "გერმანია", "react" and "თსუ" all work. It only says what matches; server/routes/experts.js adds this
// to the plain text match it already had (names, titles, the About text).
const categories = require('./categories');
const { transliterate } = require('./verification/names');

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();

function editDistance(a, b, stopAbove) {
  if (Math.abs(a.length - b.length) > stopAbove) return stopAbove + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > stopAbove) return stopAbove + 1;
    prev = row;
  }
  return prev[b.length];
}
// How many typing mistakes a word of this length may have: short words must be exact.
const allowed = (n) => (n < 4 ? 0 : (n < 8 ? 1 : 2));

// Does the word (already normalised) match this one word of a text? 2: exactly or by its beginning, 1: with typos, 0: no.
function wordMatch(q, word) {
  if (word.startsWith(q)) return 2;
  const a = allowed(q.length);
  if (!a) return 0;
  // (the whole word, or the beginning of it as long as what was typed: "კარდილოგ" for "კარდიოლოგია")
  if (editDistance(q, word, a) <= a || (word.length > q.length && editDistance(q, word.slice(0, q.length), a) <= a)) return 1;
  return 0;
}

// A text as what can be searched: its words, and the Georgian ones in Latin letters too ("stomat" finds სტომატოლოგია).
function searchWords(text) {
  const n = norm(text);
  if (!n) return [];
  const words = n.split(' ');
  const latin = norm(transliterate(n)).split(' ').filter((w) => w && !words.includes(w));
  return [...words, ...latin];
}

// Every word of the query must match some word of the text (or the whole query a part of it).
function textMatches(query, words, whole) {
  const q = norm(query);
  if (!q) return false;
  if (whole && q.length >= 3 && whole.includes(q)) return true;
  return q.split(' ').every((part) => words.some((w) => wordMatch(part, w)));
}

const indexed = (item) => {
  const words = searchWords(`${item.ka} ${item.en} ${item.keywords || ''}`);
  return { ...item, words, whole: norm(`${item.ka} ${item.en}`) };
};
const FIELD_INDEX = [...categories.FIELD.values()].map((f) => indexed({ id: f.id, ka: f.ka, en: f.en, keywords: f.keywords }));
const CHIP_INDEX = [...categories.CHIP.values()].filter((x) => !x.other).map((x) => indexed({ id: x.id, ka: x.ka, en: x.en, keywords: x.keywords, field: x.field }));
const COUNTRY_INDEX = categories.COUNTRIES.filter((x) => x.id !== 'other').map(indexed);

// What the words name in the list. -> { fields, chips, countries } (ids)
function matchCatalog(query) {
  return {
    fields: FIELD_INDEX.filter((f) => textMatches(query, f.words, f.whole)).map((f) => f.id),
    chips: CHIP_INDEX.filter((x) => textMatches(query, x.words, x.whole)).map((x) => x.id),
    countries: COUNTRY_INDEX.filter((x) => textMatches(query, x.words, x.whole)).map((x) => x.id)
  };
}

// "თსუ" also means every other way of writing that university. Which university a text names: the longest name in it, so "თბილისის სახელმწიფო სამედიცინო
// უნივერსიტეტი" is the medical one, not "თბილისის სახელმწიფო". A one-word name must be a whole word ("სტუ" is not in "სტუდენტი").
const ALIASES = categories.UNIVERSITY_ALIASES.map((g) => g.map(norm));
function universityOf(text) {
  const n = norm(text);
  const words = n.split(' ');
  let best = null;
  let length = 0;
  ALIASES.forEach((group, i) => group.forEach((a) => {
    if (a.length > length && (a.includes(' ') ? n.includes(a) : words.includes(a))) { best = i; length = a.length; }
  }));
  return best;
}
function universityMatches(query, university) {
  const q = norm(query);
  const uni = norm(university);
  if (!q) return false;
  if (uni.includes(q)) return true;
  const asked = universityOf(q);
  return asked !== null && asked === universityOf(uni);
}

// Does this mentor's own text (specializations, university, the "სხვა" words, the words for their field) answer the query? (Typos count here too.)
function mentorMatches(query, u) {
  const texts = [...(u.specialtyTags || []), u.customNiche, u.currentWork, ...Object.values(u.directionOther || {})].filter(Boolean);
  if (texts.some((t) => textMatches(query, searchWords(t), norm(t)))) return true;
  if (u.university) {
    // (typos only from 5 letters: "თსსუ" is not a slip of "თსუ")
    if (universityMatches(query, u.university) || (norm(query).length >= 5 && textMatches(query, searchWords(u.university), norm(u.university)))) return true;
  }
  return false;
}

// The whole answer for one mentor, given matchCatalog's result.
function matches(query, catalog, u) {
  if ([u.fieldId, ...(u.extraFields || [])].some((f) => catalog.fields.includes(f))) return true;
  if ((u.directions || []).some((d) => catalog.chips.includes(d))) return true;
  if (u.country && catalog.countries.includes(u.country)) return true;
  return mentorMatches(query, u);
}

module.exports = { norm, editDistance, matchCatalog, mentorMatches, matches, universityMatches };
