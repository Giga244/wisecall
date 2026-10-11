// The niches (fields) mentors work in. They live in the database (migration 019) so an admin can add one, rename one or promote a
// mentor's own suggestion ("Other: type your own") without a code change. This module keeps them in memory: loaded when the server starts,
// and again after every change an admin makes. Until the first load it knows the 14 original niches, so nothing breaks.
//
// Whether a niche is REGULATED (never approved automatically; a licence is required) comes from server/verification/registries.js (the
// researched list with sources) OR the database flag (for a niche an admin created as regulated).
const { query } = require('./db');
const { REGULATED } = require('./verification/registries');

const OTHER = 'other'; // a mentor's own niche, written in users.custom_niche

const FALLBACK = [
  ['business', 'Business', 'ბიზნესი', 'business'], ['medicine', 'Medicine', 'მედიცინა', 'medicine'], ['law', 'Law', 'სამართალი', 'law'],
  ['finance', 'Finance', 'ფინანსები', 'finance'], ['tech', 'Tech', 'ტექნოლოგია', 'tech'], ['teaching', 'Teaching', 'სწავლება', 'teaching'],
  ['fitness', 'Fitness', 'ფიტნესი', 'fitness'], ['creative', 'Creative', 'კრეატიული', 'creative'], ['marketing', 'Marketing', 'მარკეტინგი', 'marketing'],
  ['design', 'Design', 'დიზაინი', 'design'], ['writing', 'Writing', 'წერა', 'writing'], ['parenting', 'Parenting', 'მშობლობა', 'parenting'],
  ['engineering', 'Engineering', 'ინჟინერია', 'engineering'], ['science', 'Science', 'მეცნიერება', 'science']
].map(([key, en, ka, icon], i) => ({ key, en, ka, icon, regulated: Object.prototype.hasOwnProperty.call(REGULATED, key), sort: (i + 1) * 10, active: true }));

let list = FALLBACK;
let byKey = new Map(list.map((n) => [n.key, n]));

const fromRow = (r) => ({
  key: r.key, en: r.name_en, ka: r.name_ka, icon: r.icon, sort: r.sort, active: r.active, promotedFrom: r.promoted_from,
  regulated: r.regulated || Object.prototype.hasOwnProperty.call(REGULATED, r.key)
});

async function load() {
  const { rows } = await query('SELECT * FROM niches ORDER BY sort, key');
  list = rows.map(fromRow);
  byKey = new Map(list.map((n) => [n.key, n]));
  require('./publicCache').clear(); // (the public lists name the fields: send the new ones at once)
  return list;
}

const all = () => list;                                   // every niche, active or not (admin)
const active = () => list.filter((n) => n.active);        // what mentors can choose and visitors see
const get = (key) => byKey.get(key) || null;
// A niche a mentor can choose, a visitor can filter by, or a waiting-list entry can name.
const isValid = (key) => { const n = byKey.get(key); return Boolean(n && n.active); };
// A niche a mentor may already have (an inactive one keeps working for the mentors in it).
const exists = (key) => byKey.has(key);
const isRegulated = (key) => Object.prototype.hasOwnProperty.call(REGULATED, key) || Boolean(byKey.get(key) && byKey.get(key).regulated);
// The niche's name in a language ('en' | 'ka'); for "Other", the mentor's own words when given.
function nameOf(key, lang, custom) {
  if (key === OTHER) return custom || (lang === 'ka' ? 'სხვა' : 'Other');
  const n = byKey.get(key);
  if (!n) return key || '';
  return lang === 'ka' ? n.ka : n.en;
}
// For the pages (/api/config): what they need to show and filter niches.
const forClient = () => active().map((n) => ({ key: n.key, en: n.en, ka: n.ka, icon: n.icon, regulated: n.regulated }));

// What a mentor's field is called on the site: their own words, or the category's name when they wrote none (older profiles).
const fieldOf = (user, lang) => (user && user.customNiche) || nameOf(user && user.niche, lang);

module.exports = { OTHER, load, all, active, get, isValid, exists, isRegulated, nameOf, fieldOf, forClient, fromRow };
