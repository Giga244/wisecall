// The help centre: the articles in docs/help/<en|ka>/NN-<slug>.md, published at /help/<slug> (and /ka/help/<slug>), with a list at
// /help.html. The Markdown is Wisecall's own, but it is still escaped first and only a few forms are turned into HTML: headings,
// paragraphs, lists, block quotes, **bold**, *italic*, `code` and links to this site or https:// addresses. An article that still has a
// "[CHECK" note (a fact not settled yet) is not published.
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('./email');

const DIR = path.join(__dirname, '..', 'docs', 'help');
let cache = null;

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^\s)"']*)\)/g, '<a href="$2">$1</a>');
}

// -> { title, html, description }
function render(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let title = '', description = '', list = null, para = [];
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(' ');
    if (!description) description = text.replace(/\*\*|\*|`/g, '');
    out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      if (m[1].length === 1 && !title) { title = m[2].trim(); continue; }
      out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line)) || (m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara(); flushList();
      out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return { title, html: out.join('\n'), description };
}

function load() {
  const byLang = {};
  for (const lang of ['en', 'ka']) {
    const dir = path.join(DIR, lang);
    byLang[lang] = !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter((f) => /^\d\d-[a-z0-9-]+\.md$/.test(f)).sort().map((file) => {
      const md = fs.readFileSync(path.join(dir, file), 'utf8');
      if (md.includes('[CHECK')) return null; // (not settled yet: not published)
      const slug = file.replace(/^\d\d-/, '').replace(/\.md$/, '');
      return { slug, ...render(md) };
    }).filter(Boolean);
  }
  return byLang;
}

// The articles in a language, in order: [{ slug, title, html, description }]. Read once (and again on every call outside production,
// so an edited article shows at once while writing it).
function articles(lang) {
  if (!cache || process.env.NODE_ENV !== 'production') cache = load();
  return cache[lang === 'ka' ? 'ka' : 'en'];
}
const article = (lang, slug) => articles(lang).find((a) => a.slug === slug) || null;

module.exports = { articles, article, render };
