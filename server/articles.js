// "რჩევები" (docs/CLAUDE-CODE-SEO.md 5): articles the owner writes in Admin for what students search for ("how do I choose a profession",
// "which faculty", ...). Nothing here is written or seeded by the site: every article is typed by an admin, and none is public until an
// admin presses Publish.
//
//   the text       a title, a short intro and a body, in Georgian, in English, or both. A language exists when all three are there; the
//                  body is plain text in sections ("## heading", an empty line between paragraphs, "- " for a list): the same few forms
//                  as the help centre (server/help.js), everything else escaped.
//   the address    /ka/advice-articles/<slug> and /advice-articles/<slug>. The slug is Latin (Georgian letters are written in Latin ones)
//                  and no longer changes once the article has been public.
//   publishing     draft -> published, only by Publish; a draft can be saved half-written, a published article cannot be saved broken.
//                  A draft or an article taken down answers 404 and is not in the sitemap (server/pages.js).
const { query } = require('./db');
const help = require('./help');
const categories = require('./categories');

const LANGS = ['ka', 'en'];
// (how long each part may be; the short ones are what a search result shows: about 60 characters of title, 160 of description)
const LIMITS = { titleMin: 5, titleMax: 120, introMin: 20, introMax: 300, bodyMin: 200, bodyMax: 30000, authorMin: 2, authorMax: 80, slugMin: 3, slugMax: 80 };
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class ArticleError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const COLS = `id, slug, status, category, author_name, to_char(article_date, 'YYYY-MM-DD') AS article_date,
  title_ka, intro_ka, body_ka, title_en, intro_en, body_en, created_at, updated_at, published_at, first_published_at`;

// ---- The words ------------------------------------------------------------------------------------------------------------------------
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const line = (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(CONTROL, '').replace(/\s+/g, ' ').trim() : '');
const block = (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\t/g, ' ').replace(/[ ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '');
const len = (s) => [...s].length;

// Georgian letters as Latin ones, for an address people can read and type: "როგორ ავირჩიო პროფესია" -> "rogor-avirchio-profesia"
// (the national system, except ფ, written f as people do in words like profesia and fakulteti).
const KA_LATIN = { ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'f', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h' };
function slugify(text) {
  const latin = [...String(text || '').toLowerCase()].map((c) => (KA_LATIN[c] !== undefined ? KA_LATIN[c] : c)).join('');
  return latin.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slugMax).replace(/-+$/, '');
}

const todayTbilisi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  // (the date shown on an article: not before the site existed, not after tomorrow)
  return s >= '2020-01-01' && d.getTime() <= Date.now() + 36 * 3600 * 1000;
}

// What an admin typed, tidied and checked for what can never be saved (too long, an address that is not one, an unknown category).
// Nothing is cut: a text that is too long is refused and named, so the admin shortens it themselves.
function clean(input) {
  const b = input || {};
  const out = { authorName: line(b.authorName), category: line(b.category) || null, date: line(b.date) || null, slug: line(b.slug).toLowerCase() };
  for (const lang of LANGS) {
    const v = b[lang] || {};
    out[lang] = { title: line(v.title), intro: line(v.intro), body: block(v.body) };
    if (len(out[lang].title) > LIMITS.titleMax) throw new ArticleError('too_long', { field: `${lang}.title`, max: LIMITS.titleMax });
    if (len(out[lang].intro) > LIMITS.introMax) throw new ArticleError('too_long', { field: `${lang}.intro`, max: LIMITS.introMax });
    if (len(out[lang].body) > LIMITS.bodyMax) throw new ArticleError('too_long', { field: `${lang}.body`, max: LIMITS.bodyMax });
  }
  if (!out.ka.title && !out.en.title) throw new ArticleError('title_required', { field: 'ka.title' });
  if (len(out.authorName) > LIMITS.authorMax) throw new ArticleError('too_long', { field: 'authorName', max: LIMITS.authorMax });
  if (out.category && !categories.isField(out.category)) throw new ArticleError('invalid_category', { field: 'category' });
  if (out.date && !validDate(out.date)) throw new ArticleError('invalid_date', { field: 'date' });
  if (out.slug && (!SLUG_RE.test(out.slug) || out.slug.length < LIMITS.slugMin || out.slug.length > LIMITS.slugMax)) throw new ArticleError('invalid_slug', { field: 'slug' });
  return out;
}

const version = (a, lang) => a[lang];
const filled = (v) => [v.title, v.intro, v.body].filter(Boolean).length;
// The languages an article is written in: all three parts are there.
const langsOf = (a) => LANGS.filter((lang) => filled(version(a, lang)) === 3);

// What still stands between an article and Publish: [code, ...]. Empty = it can be public.
function problems(a) {
  const out = [];
  for (const lang of LANGS) {
    const v = version(a, lang);
    const n = filled(v);
    if (n === 0) continue;
    if (n < 3) { out.push(`${lang}_incomplete`); continue; }
    if (len(v.title) < LIMITS.titleMin) out.push(`${lang}_title_short`);
    if (len(v.intro) < LIMITS.introMin) out.push(`${lang}_intro_short`);
    if (len(v.body) < LIMITS.bodyMin) out.push(`${lang}_body_short`);
  }
  if (!langsOf(a).length && !out.length) out.push('no_language');
  if (len(a.authorName) < LIMITS.authorMin) out.push('author_required');
  return out;
}

function fromRow(r) {
  if (!r) return null;
  const a = {
    id: r.id, slug: r.slug, status: r.status, category: r.category || null, authorName: r.author_name, date: r.article_date || null,
    ka: { title: r.title_ka, intro: r.intro_ka, body: r.body_ka }, en: { title: r.title_en, intro: r.intro_en, body: r.body_en },
    createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, everPublished: Boolean(r.first_published_at)
  };
  a.langs = langsOf(a);
  return a;
}

// ---- Admin ----------------------------------------------------------------------------------------------------------------------------
async function all() {
  return (await query(`SELECT ${COLS} FROM articles ORDER BY (status = 'draft') DESC, COALESCE(article_date, created_at::date) DESC, created_at DESC LIMIT 1000`)).rows.map(fromRow);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function byId(id) {
  if (!UUID_RE.test(String(id))) return null;
  return fromRow((await query(`SELECT ${COLS} FROM articles WHERE id = $1`, [id])).rows[0]);
}

// An address nobody has yet, from the title (or the one the admin typed, which must be free).
async function freeSlug(wanted, title, exceptId) {
  const taken = async (s) => (await query('SELECT 1 FROM articles WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)', [s, exceptId || null])).rows.length > 0;
  if (wanted) {
    if (await taken(wanted)) throw new ArticleError('slug_taken', { field: 'slug' });
    return wanted;
  }
  let base = slugify(title);
  if (base.length < LIMITS.slugMin) base = 'article';
  let slug = base;
  for (let i = 2; await taken(slug); i++) slug = `${base.slice(0, LIMITS.slugMax - 4)}-${i}`;
  return slug;
}

const values = (c) => [c.category, c.authorName, c.date, c.ka.title, c.ka.intro, c.ka.body, c.en.title, c.en.intro, c.en.body];

// A new article is always a draft.
async function create(input, adminId) {
  const c = clean(input);
  const slug = await freeSlug(c.slug, c.ka.title || c.en.title, null);
  try {
    const { rows } = await query(
      `INSERT INTO articles (slug, category, author_name, article_date, title_ka, intro_ka, body_ka, title_en, intro_en, body_en, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLS}`, [slug, ...values(c), adminId || null]);
    return fromRow(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new ArticleError('slug_taken', { field: 'slug' });
    throw e;
  }
}

// A draft can be saved half-written. A published article is public the moment it is saved, so it must still be whole; and its address
// stays the one people and search engines already know.
async function update(id, input) {
  const old = await byId(id);
  if (!old) throw new ArticleError('not_found');
  const c = clean(input);
  if (old.everPublished && c.slug && c.slug !== old.slug) throw new ArticleError('slug_locked', { field: 'slug' });
  const slug = old.everPublished ? old.slug : await freeSlug(c.slug || old.slug, '', id);
  if (old.status === 'published') {
    const left = problems({ ...c });
    if (left.length) throw new ArticleError('not_ready', { problems: left });
  }
  try {
    const { rows } = await query(
      `UPDATE articles SET slug = $2, category = $3, author_name = $4, article_date = COALESCE($5::date, CASE WHEN status = 'published' THEN article_date END),
         title_ka = $6, intro_ka = $7, body_ka = $8, title_en = $9, intro_en = $10, body_en = $11, updated_at = now()
       WHERE id = $1 RETURNING ${COLS}`, [id, slug, ...values(c)]);
    bump();
    return fromRow(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new ArticleError('slug_taken', { field: 'slug' });
    throw e;
  }
}

// Publish: only a whole article (a full language, a named author). The date shown is the admin's, or today (in Tbilisi).
async function publish(id, adminId) {
  const a = await byId(id);
  if (!a) throw new ArticleError('not_found');
  const left = problems(a);
  if (left.length) throw new ArticleError('not_ready', { problems: left });
  const { rows } = await query(
    `UPDATE articles SET status = 'published', published_at = now(), first_published_at = COALESCE(first_published_at, now()),
       article_date = COALESCE(article_date, $2::date), published_by = $3 WHERE id = $1 RETURNING ${COLS}`, [id, todayTbilisi(), adminId || null]);
  bump();
  return fromRow(rows[0]);
}

// Taken down: a draft again (404 for everybody else; out of the sitemap).
async function unpublish(id) {
  const { rows } = await query(`UPDATE articles SET status = 'draft' WHERE id = $1 RETURNING ${COLS}`, [UUID_RE.test(String(id)) ? id : null]);
  if (!rows[0]) throw new ArticleError('not_found');
  bump();
  return fromRow(rows[0]);
}

// Only a draft can be deleted (a public article is taken down first, on purpose).
async function remove(id) {
  const a = await byId(id);
  if (!a) throw new ArticleError('not_found');
  if (a.status === 'published') throw new ArticleError('published');
  await query(`DELETE FROM articles WHERE id = $1 AND status = 'draft'`, [id]);
  bump();
}

// ---- The pages ------------------------------------------------------------------------------------------------------------------------
// The article at an address, published or not (the page decides who may see a draft: only a verified admin, as a preview).
async function bySlug(slug) {
  if (!SLUG_RE.test(String(slug || ''))) return null;
  return fromRow((await query(`SELECT ${COLS} FROM articles WHERE slug = $1`, [slug])).rows[0]);
}

// The published articles, newest first: all of them (the sitemap), or those written in a language (that language's pages).
async function published(lang) {
  const { rows } = await query(`SELECT ${COLS} FROM articles WHERE status = 'published' ORDER BY article_date DESC NULLS LAST, created_at DESC LIMIT 1000`);
  const list = rows.map(fromRow);
  return lang ? list.filter((a) => a.langs.includes(lang)) : list;
}

// How many published articles each language has: { ka, en } (the link to "რჩევები" in the menu shows only when there is something to
// read). Kept for half a minute; a change in Admin on this server shows at once.
let counted = null;
function bump() { counted = null; }
async function counts() {
  if (counted && Date.now() - counted.at < 30 * 1000) return counted.n;
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE title_ka <> '' AND intro_ka <> '' AND body_ka <> '')::int AS ka,
            count(*) FILTER (WHERE title_en <> '' AND intro_en <> '' AND body_en <> '')::int AS en FROM articles WHERE status = 'published'`);
  counted = { at: Date.now(), n: { ka: rows[0].ka, en: rows[0].en } };
  return counted.n;
}

// The body as HTML: "#"/"##" are section headings (h2), "###" smaller ones (h3); the title has its own box, so no line is taken as one.
const bodyHtml = (text) => help.render(text, { title: false, level: (n) => (n >= 3 ? 3 : 2) }).html;

// The date as people read it: "15 ნოემბერი 2026" / "15 November 2026".
const MONTHS = {
  ka: ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};
function dateText(ymd, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${Number(m[3])} ${MONTHS[lang === 'ka' ? 'ka' : 'en'][Number(m[2]) - 1]} ${m[1]}` : '';
}

module.exports = { ArticleError, LANGS, LIMITS, slugify, clean, problems, langsOf, all, byId, create, update, publish, unpublish, remove, bySlug, published, counts, bodyHtml, dateText };
