// Serves the site's HTML pages. Pages contain {{PUBLIC_URL}} and friends, which are filled in here
// so canonical links, share images and sitemaps always use the real public address. Expert
// profile pages also get their own title and description for search engines and link previews.
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const { query } = require('./db');
const { listableSql } = require('./models');
const { escapeHtml } = require('./email');
const assets = require('./assets');

const PUBLIC = path.join(__dirname, '..', 'public');
const UUID_RE = /^[0-9a-f-]{36}$/i;
const cache = new Map();

// The tags every page needs in its <head> (icons, the web app manifest, the theme colour) live in one file and are added
// here, so no page can forget them or point at an old icon.
const HEAD_TAGS = path.join(__dirname, 'headTags.html');

function readPage(file) {
  if (cache.has(file)) return cache.get(file);
  const full = path.join(PUBLIC, file);
  let html = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  if (html !== null) {
    html = html.replace('</head>', () => fs.readFileSync(HEAD_TAGS, 'utf8') + '</head>');
    html = assets.rewrite(html); // every stylesheet, script, logo, icon and font address gets ?v=<hash of the file> (see assets.js)
    html = require('./live/switch').stripLive(html); // (the live-sessions parts, only while they are switched on)
  }
  if (config.IS_PROD) cache.set(file, html);
  return html;
}

// ---- Languages ---------------------------------------------------------------------------------------------------------------
// Every page has an English address (/about.html) and a Georgian one (/ka/about.html). The Georgian one is served by the same route:
// languagePrefix() takes /ka off the address and remembers the language (res.locals.pageLang), and the head of the page is then
// written in that language: <html lang>, the title and description (meta.<page>.* in the dictionaries), the share tags, the canonical
// address, and links to both language versions (hreflang; Georgian is the default, the site's main market).
const DICTS = {};
const dict = (lang) => (DICTS[lang] = DICTS[lang] || JSON.parse(fs.readFileSync(path.join(PUBLIC, 'i18n', `${lang === 'ka' ? 'ka' : 'en'}.json`), 'utf8')));
const langOf = (res) => (res.locals && res.locals.pageLang === 'ka' ? 'ka' : 'en');
// The language of the link preview: English only under /en/; the bare address and /ka/ are previewed in Georgian (see localize).
const shareLangOf = (res) => (res.locals && res.locals.pageLang === 'en' ? 'en' : 'ka');
// A page built from content or from words of its own (the lists, a field page, a profile) names its preview title and description itself.
// On a bare address they are written in Georgian, whatever the language the page itself is shown in: ogFor(res, (d) => ({ title, description })).
function ogFor(res, make) {
  if (!res.locals.pageLang) res.locals.og = make(dict('ka'));
}
const kaUrl = (enPath) => `${config.PUBLIC_URL}/ka${enPath === '/' ? '/' : enPath}`;
// (the matching page, /match, is public/find-a-mentor.html, with its own title and description: meta.match.*)
const pageKeyOf = (p) => (p === '/' || p === '/index.html' ? 'index' : (p === '/match' ? 'match' : (/^\/([\w-]+)\.html$/.exec(p) || [])[1] || null));
// A page's description in a language. Before launch a page may have another one (meta.<page>.description.prelaunch): the home page's
// usual words are about paying for a question, and nothing can be bought yet. The numbers in it come from the settings.
function metaDescription(d, key) {
  const text = (config.LAUNCH_MODE === 'prelaunch' && d[`meta.${key}.description.prelaunch`]) || d[`meta.${key}.description`];
  return text ? withSettings(text) : text;
}

function languagePrefix(req, res, next) {
  if (req.path === '/ka') return res.redirect(301, '/ka/' + (req.url.slice(3) || ''));
  if (req.path.startsWith('/ka/') && !req.path.startsWith('/ka/api/')) {
    res.locals.pageLang = 'ka';
    req.url = req.url.slice(3);
  } else if (req.path.startsWith('/en/') && !req.path.startsWith('/en/api/')) {
    // (an English page at /en/...: the same page as without a prefix, always in English; public/js/i18n.js keeps the language the same way)
    res.locals.pageLang = 'en';
    req.url = req.url.slice(3);
  }
  next();
}

// The page's own texts in its language, written here as public/js/i18n.js would write them in the browser (data-i18n holds plain text
// only: the script sets textContent), so a Georgian page is Georgian from its first frame and nothing moves when the script runs. The
// script still runs and writes the same words. Before launch, data-i18n-prelaunch names the text instead; numbers that come from the
// settings ({answerDays}, {feePct}, ...) are filled in the same way; a text that cannot be filled here is left for the script.
const I18N_VAR = /\{(answerDays|holdDays|disputeDays|feePct|sharePct|priceMin|priceMax|questionMin|questionMax|answerMin|answerMax|unpaidDays|payoutMin)\}/g;
function i18nVars() {
  const limits = require('./content').LIMITS;
  return {
    answerDays: config.ANSWER_DEADLINE_DAYS, holdDays: require('./ledger').holdDays(), disputeDays: config.DISPUTE_DAYS, feePct: config.PLATFORM_FEE_PERCENT,
    sharePct: 100 - config.PLATFORM_FEE_PERCENT, priceMin: config.PRICE_MIN, priceMax: config.PRICE_MAX, payoutMin: config.PAYOUT_MIN_GEL,
    questionMin: limits.questionMin, questionMax: limits.questionMax, answerMin: limits.answerMin, answerMax: limits.answerMax, unpaidDays: config.UNPAID_ATTEMPT_DAYS
  };
}
function translateBody(html, lang) {
  const d = { ...dict(lang) };
  for (const n of require('./niches').forClient()) d['niche.' + n.key] = lang === 'ka' ? n.ka : n.en;
  const vars = i18nVars();
  const pre = config.LAUNCH_MODE === 'prelaunch';
  const text = (key) => {
    if (typeof d[key] !== 'string') return null;
    const out = d[key].replace(I18N_VAR, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
    return /\{[A-Za-z0-9_]+\}/.test(out) ? null : out; // (a {date}, {name} or number this server cannot fill: the page's own text stays)
  };
  const body = html.indexOf('<body');
  if (body < 0) return html;
  let rest = html.slice(body);
  // the texts of elements
  rest = rest.replace(/<([a-z][a-z0-9]*)\b([^<>]*?)\sdata-i18n="([\w.-]+)"([^<>]*)>([^<]*)<\/\1>/g, (m, tag, a, key, b, old) => {
    const pk = pre ? /\sdata-i18n-prelaunch="([\w.-]+)"/.exec(a + ' ' + b) : null;
    const value = text((pk && pk[1]) || key);
    return value === null ? m : `<${tag}${a} data-i18n="${key}"${b}>${escapeHtml(value)}</${tag}>`;
  });
  // placeholders, accessible names, titles and alternative text
  rest = rest.replace(/<[a-z][a-z0-9]*\b[^<>]*\sdata-i18n-(?:placeholder|aria|title|alt)="[^"]*"[^<>]*>/g, (tag) => {
    for (const [attr, target] of [['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label'], ['data-i18n-title', 'title'], ['data-i18n-alt', 'alt']]) {
      const k = new RegExp(`\\s${attr}="([\\w.-]+)"`).exec(tag);
      const value = k && text(k[1]);
      if (value === null || !k) continue;
      const has = new RegExp(`\\s${target}="[^"]*"`);
      tag = has.test(tag) ? tag.replace(has, () => ` ${target}="${escapeHtml(value)}"`) : tag.replace(/\s*(\/?)>$/, (mm, slash) => ` ${target}="${escapeHtml(value)}"${slash}>`);
    }
    return tag;
  });
  return html.slice(0, body) + rest;
}

// A link on a Georgian page leads to the Georgian page (/answers -> /ka/answers; docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md #2): every page of
// the site has a /ka address. Files (styles, scripts, fonts, images, the sitemap), the API and addresses already in Georgian stay as they
// are. The same rule runs in the browser for links the scripts draw (public/js/i18n.js kaHref).
const KA_SKIP = /^\/(?:ka(?:[/?#]|$)|api\/|js\/|css\/|fonts\/|img\/|images\/|brand\/|uploads?\/|mock-|auth\/)/;
function kaHref(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || KA_SKIP.test(href)) return href;
  const p = href.split(/[?#]/)[0];
  if (/\.[a-z0-9]+$/i.test(p) && !/\.html$/i.test(p)) return href;
  return '/ka' + href;
}
const kaLinks = (html) => html.replace(/(<a\b[^>]*?\shref=")([^"]+)(")/g, (m, a, href, b) => a + kaHref(href) + b);

// The share picture (og:image, twitter:image): one picture per language, public/og/og-<lang>.png, 1200x630, with its size and its alternative
// text in the page's language. Pages still carry the old picture (public/og-image-1200x630.png) in their source, which stays as the fallback
// and is replaced here; a page that names its own picture (a mentor's photo, a live session's cover) keeps it and only gets the alternative text.
const OG_OLD = /\/og-image-1200x630\.png(?:\?v=[0-9a-f]{10})?"/;
function shareImage(html, lang) {
  if (!/<meta property="og:image" content="/.test(html)) return html;
  const alt = String(dict(lang)['meta.ogAlt'] || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); // (an apostrophe stays readable)
  const url = escapeHtml(config.PUBLIC_URL + assets.rewrite(`/og/og-${lang === 'ka' ? 'ka' : 'en'}.png`));
  html = html.replace(/\s*<meta (?:property="og:image:(?:width|height|alt)"|name="twitter:image:alt") content="[^"]*">/g, '');
  html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(\/og-image-1200x630\.png(?:\?v=[0-9a-f]{10})?")/g, (m, a, b) => (OG_OLD.test(b) ? a + url + '"' : m));
  return html.replace(/<meta property="og:image" content="[^"]*">/, (m) => `${m}\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="${alt}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, (m) => `${m}\n<meta name="twitter:image:alt" content="${alt}">`);
}

// The head of a page in its language, with its alternates. Pages without a canonical address (error pages) only get <html lang>.
// langs: the languages the page exists in (an article may be written in one only: then only that one is named).
// share: the language of the link preview (og:/twitter: tags). Georgian is the site's default language and the address people share is the
// bare one, so a page without a prefix is previewed in Georgian (picture, title, description, alt text) while the page itself stays as it
// is; only /en/ pages are previewed in English. og: a page built from content brings its own preview title and description (see ogFor).
function localize(html, lang, langs = ['en', 'ka'], share = lang, og = null) {
  if (!langs.includes(share)) { share = lang; og = null; } // (a page that exists in one language only is previewed in that language)
  html = html.replace(/<html lang="[a-z-]+"/, () => `<html lang="${lang}"${config.LAUNCH_MODE === 'prelaunch' ? ' data-launch="prelaunch"' : ''}`);
  html = translateBody(html, lang);
  if (lang === 'ka') html = kaLinks(html);
  html = shareImage(html, share);
  const canon = /<link rel="canonical" href="([^"]*)">/.exec(html);
  if (!canon) return html;
  const enUrl = canon[1];
  const enPath = enUrl.startsWith(config.PUBLIC_URL) ? (enUrl.slice(config.PUBLIC_URL.length) || '/') : enUrl;
  const ka = kaUrl(enPath);
  const d = dict(lang);
  const key = pageKeyOf(enPath);
  const title = key && d[`meta.${key}.title`];
  const description = key && metaDescription(d, key);
  // (the preview's words are those of the share language; a page built from content brings its own, see ogFor)
  const ds = dict(share);
  const shareTitle = (key && ds[`meta.${key}.title`]) || (og && og.title);
  const shareDescription = (key && metaDescription(ds, key)) || (og && og.description);
  if (title) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  if (shareTitle) html = html.replace(/(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*(")/g, (m, a, b) => a + escapeHtml(shareTitle) + b);
  if (description) html = html.replace(/(<meta name="description" content=")[^"]*(")/, (m, a, b) => a + escapeHtml(description) + b);
  if (shareDescription) html = html.replace(/(<meta (?:property|name)="(?:og|twitter):description" content=")[^"]*(")/g, (m, a, b) => a + escapeHtml(shareDescription) + b);
  if (lang === 'ka') {
    html = html.replace(canon[0], () => `<link rel="canonical" href="${escapeHtml(ka)}">`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, (m, a, b) => a + escapeHtml(ka) + b);
  }
  const tags = [
    ...(langs.includes('en') ? [`<link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}">`] : []),
    ...(langs.includes('ka') ? [`<link rel="alternate" hreflang="ka" href="${escapeHtml(ka)}">`] : []),
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(langs.includes('ka') ? ka : enUrl)}">`,
    `<meta property="og:locale" content="${share === 'ka' ? 'ka_GE' : 'en_US'}">`,
    ...(langs.length > 1 ? [`<meta property="og:locale:alternate" content="${share === 'ka' ? 'en_US' : 'ka_GE'}">`] : [])
  ];
  // (a Georgian page draws its words in Noto Sans Georgian: fetched at once, like the latin fonts every page preloads)
  if (lang === 'ka') tags.push(assets.rewrite('<link rel="preload" href="/fonts/noto-sans-georgian.woff2" as="font" type="font/woff2" crossorigin>'));
  return html.replace('</head>', () => tags.join('\n') + '\n</head>');
}

// Structured data for search engines (JSON-LD). It is data, not a script: the Content-Security-Policy does not run it. "<" is escaped
// so a value can never close the tag.
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const addToHead = (html, extra) => html.replace('</head>', () => extra + '\n</head>');

// A description of about 155 characters, cut at a word, with "…" when it was cut.
function shortText(s, max = 155) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return (cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)) + '…').trim();
}

// HTML is always asked for again (the answer is a small 304 when nothing changed), so a new release shows at once; the files it names
// carry a version in their address and are kept for a year.
function sendHtml(res, status, html) {
  if (!res.get('Cache-Control')) res.set('Cache-Control', 'no-cache');
  res.set('Speculation-Rules', require('./speculation').HEADER); // (which links the browser may fetch ahead: server/speculation.js)
  if (status === 200 && res.req) require('./analytics').pageview(res.req); // (off unless PLAUSIBLE_DOMAIN is set; not for a page fetched ahead)
  res.status(status).type('html').send(localize(html, langOf(res), (res.locals && res.locals.pageLangs) || undefined, shareLangOf(res), (res.locals && res.locals.og) || null));
}

function fill(html, vars) {
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function baseVars(canonicalPath) {
  // GOOGLE_HIDDEN: the "Continue with Google" block on the login and sign-up pages exists only when Google sign-in is set up.
  return { PUBLIC_URL: config.PUBLIC_URL, CANONICAL_URL: config.PUBLIC_URL + canonicalPath, GOOGLE_HIDDEN: config.GOOGLE_ENABLED ? '' : 'hidden' };
}

// A public mentor's name and role for the page <title>; null when they aren't listed.
async function expertMeta(id) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await query(
    `SELECT name, role_title, bio, price FROM users WHERE id = $1 AND ${listableSql()}`, [id]
  );
  return rows[0] || null;
}

// The profile page. Its title, description and share tags come from the person, but only from what is public: a private
// profile shows just "Wisecall", and only listed mentors with a public profile may be indexed by search engines.
async function sendProfile(res, row, asked) {
  const html = readPage('profile.html');
  if (html === null) return false;
  const { userFromRow } = require('./models');
  const { isListable } = require('./util');
  const u = row ? userFromRow(row) : null;
  const listable = Boolean(u) && isListable(u);
  const isPublic = Boolean(u) && u.profileVisibility === 'public';
  const lang = langOf(res);
  const vars = baseVars(u ? `/u/${u.username}` : '/profile.html');
  let extraHead = '';
  vars.OG_IMAGE = config.PUBLIC_URL + assets.rewrite('/og-image-1200x630.png');
  vars.PROFILE_SSR = SKELETON;
  if (u && isPublic) {
    const title = listable ? `${u.name}, ${u.roleTitle} — Wisecall` : `${u.name} — Wisecall`;
    vars.TITLE = escapeHtml(title);
    // The profile's visible content, in the page itself, so search engines and link previews can read it (the page script then
    // draws the full, interactive profile over it). Only what a visitor may see: About and the headline follow their visibility.
    const profile = await require('./profiles').view(u, null);
    const text = listable
      ? (lang === 'ka' ? `დაუსვი კითხვა: ${u.name} (${u.roleTitle}), ${u.price === 0 ? 'უფასოდ' : `${u.price} ₾`}. ${profile.bio || ''}` : `Ask ${u.name} (${u.roleTitle}) a question on Wisecall ${u.price === 0 ? 'for free' : `for ${u.price} GEL`}. ${profile.bio || ''}`)
      : `${u.name} — Wisecall. ${profile.headline || profile.bio || ''}`;
    vars.DESCRIPTION = escapeHtml(shortText(text));
    // (the preview of a bare address is Georgian: the same sentence as /ka/ writes)
    ogFor(res, () => ({ description: shortText(listable ? `დაუსვი კითხვა: ${u.name} (${u.roleTitle}), ${u.price === 0 ? 'უფასოდ' : `${u.price} ₾`}. ${profile.bio || ''}` : `${u.name} — Wisecall. ${profile.headline || profile.bio || ''}`) }));
    if (u.photoUpdatedAt) vars.OG_IMAGE = config.PUBLIC_URL + require('./util').photoUrl(u);
    const stats = listable ? (await require('./models').mentorStatsFor([u.id]))[u.id] : null;
    // (the About written into the page is the mentor's own: not the copy of their path made before, which the page shows as "ჩემი გზა")
    vars.PROFILE_SSR = profileSsr({ ...profile, bio: profile.bio ? (require('./mentorStory').ownAbout(u) || null) : null }, stats, listable ? u : null, lang);
    // (worksFor, alumniOf, knowsAbout, knowsLanguage: only from the sections everyone may see)
    const extra = await require('./profileSections').jsonLdFields(u);
    if (listable) extraHead = profileJsonLd({ ...u, bio: profile.bio }, stats, lang, extra);
    else if (Object.keys(extra).length) extraHead = personJsonLd(u, lang, extra);
  } else {
    ogFor(res, () => ({ title: 'პროფილი — Wisecall', description: 'პროფილი Wisecall-ზე, სადაც ადამიანები გადამოწმებულ ექსპერტებს კითხვებს უსვამენ.' }));
    vars.TITLE = lang === 'ka' ? 'პროფილი — Wisecall' : 'Profile — Wisecall';
    vars.DESCRIPTION = lang === 'ka' ? 'პროფილი Wisecall-ზე, სადაც ადამიანები გადამოწმებულ ექსპერტებს კითხვებს უსვამენ.' : 'A profile on Wisecall, where people ask verified experts and get real, paid answers.';
  }
  vars.ROBOTS = listable && isPublic ? 'index, follow' : 'noindex';
  const page = fill(html, vars);
  sendHtml(res, u || asked === undefined ? 200 : 404, extraHead ? addToHead(page, extraHead) : page);
  return true;
}

// What stands in the profile area until the page script has drawn the profile (a private or unknown profile shows only this).
// While the page script loads a profile: the box where a question is asked (the right column), as a skeleton.
const ASK_SKELETON = `<div class="skeleton-card ask-skeleton"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-price"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line w80"></span><span class="skeleton skeleton-btn"></span><span class="skeleton skeleton-btn"></span><span class="skeleton skeleton-line w70"></span><span class="skeleton skeleton-line w60"></span></div>`;
const LOADING_STATUS = '<p class="sr-only" role="status" data-i18n="experts.loading" data-skeleton>Loading…</p>';
// A profile the server does not write (nobody listed by that name yet, or not public): the whole layout as a skeleton.
const SKELETON = `<div class="expert-layout" aria-hidden="true">
      <div class="profile-card">
        <div class="profile-head">
          <span class="skeleton skeleton-avatar"></span>
          <div class="skeleton-stack"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line w60"></span><div class="skeleton-row"><span class="skeleton skeleton-pill"></span><span class="skeleton skeleton-pill"></span></div></div>
        </div>
        <span class="skeleton skeleton-line w80" style="margin-top:24px"></span><span class="skeleton skeleton-line w60"></span>
      </div>
      <div class="ask-side">${ASK_SKELETON}</div>
      <div class="profile-section profile-about"><span class="skeleton skeleton-name w40"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w90"></span><span class="skeleton skeleton-line w60"></span></div>
    </div>
    ${LOADING_STATUS}`;

// A public profile as plain HTML (only what the public profile shows; every value escaped).
function profileSsr(p, stats, mentor, lang) {
  const ka = lang === 'ka';
  const d = dict(lang);
  // (each fact as the page script shows it: a small label over the value)
  const fact = (key, value) => `<li><span class="muted small">${escapeHtml(d[key] || '')}</span><strong>${escapeHtml(value)}</strong></li>`;
  const facts = [
    p.city ? fact('profile.city', p.city) : '',
    (p.languages || []).length ? fact('profile.languages', p.languages.map((l) => d['lang.' + l] || l).join(', ')) : '',
    mentor ? fact('expert.stat.price', mentor.price === 0 ? (ka ? 'უფასო' : 'Free') : (ka ? `${mentor.price} ₾ ერთ კითხვაზე` : `${mentor.price} GEL per question`)) : '',
    stats && stats.reviewCount ? fact('expert.stat.rating', ka ? `★ ${stats.ratingAvg} (${stats.reviewCount} შეფასება)` : `★ ${stats.ratingAvg} (${stats.reviewCount} reviews)`) : ''
  ].join('');
  // (a mentor's role title is made from their headline when they apply, cut at its limit: said once, whole; public/js/profile.js does the same)
  const norm = (s) => String(s || '').replace(/[\s…]+/g, ' ').trim().toLowerCase();
  const headlineIsTitle = Boolean(mentor && p.headline && mentor.roleTitle && norm(p.headline).startsWith(norm(mentor.roleTitle)));
  const role = mentor ? (headlineIsTitle ? p.headline : mentor.roleTitle) : p.headline;
  // The rich sections everyone may see, as plain text for search engines and link previews (the page script draws them properly).
  const s = p.sections || {};
  const when = (d) => (d ? (d.month ? `${d.month}/${d.year}` : String(d.year)) : '');
  const parts = [
    (s.experience || []).length ? `<h2>${ka ? 'გამოცდილება' : 'Experience'}</h2><ul>${s.experience.flatMap((g) => g.items).map((i) => `<li>${escapeHtml(i.title)} — ${escapeHtml(i.organisation)} (${escapeHtml(when(i.start))} – ${escapeHtml(i.current ? (ka ? 'დღემდე' : 'now') : when(i.end || i.start))})</li>`).join('')}</ul>` : '',
    (s.education || []).length ? `<h2>${ka ? 'განათლება' : 'Education'}</h2><ul>${s.education.map((e) => `<li>${escapeHtml([e.school, e.degree, e.field].filter(Boolean).join(', '))}</li>`).join('')}</ul>` : '',
    (s.skills || []).length ? `<h2>${ka ? 'უნარები' : 'Skills'}</h2><p>${escapeHtml(s.skills.join(', '))}</p>` : ''
  ].join('');
  // (in the page's final layout, so nothing moves when the page script draws it: the photo, the badges and the box for a question
  // stand in as skeletons until then; data-skeleton marks them, so the script can take them away if the profile cannot be loaded)
  return `<div class="expert-layout${mentor ? '' : ' profile-plain'}">
      <article class="profile-card profile-ssr">
        <div class="profile-head">
          <span class="skeleton skeleton-avatar" aria-hidden="true" data-skeleton></span>
          <div>
            <h1>${escapeHtml(p.name)}</h1>
            ${role ? `<p class="profile-title">${escapeHtml(role)}</p>` : ''}
            ${mentor && p.headline && !headlineIsTitle ? `<p class="profile-headline">${escapeHtml(p.headline)}</p>` : ''}
          </div>
        </div>
        ${mentor ? '<div class="profile-tags" aria-hidden="true" data-skeleton><span class="skeleton skeleton-pill sm"></span><span class="skeleton skeleton-pill lg"></span><span class="skeleton skeleton-pill"></span></div>' : ''}
        ${mentor ? '<p class="profile-share" aria-hidden="true" data-skeleton><span class="skeleton skeleton-share"></span></p>' : ''}
        ${facts ? `<ul class="profile-facts">${facts}</ul>` : ''}
        ${mentor ? `<div class="profile-stats" aria-hidden="true" data-skeleton>${'<div><span class="skeleton skeleton-line w60"></span><span class="skeleton skeleton-name w40"></span></div>'.repeat(4)}</div>` : ''}
      </article>
      ${mentor ? `<div class="ask-side" aria-hidden="true" data-skeleton>${ASK_SKELETON}</div>` : ''}
      ${p.bio || parts ? `<section class="profile-section profile-about">${p.bio ? `<p class="profile-bio">${escapeHtml(p.bio)}</p>` : ''}${parts}</section>` : ''}
      ${LOADING_STATUS}
    </div>`;
}

// Somebody who is not a mentor but chose to show some sections to everyone: a plain Person (public sections only).
function personJsonLd(u, lang, extra) {
  const url = lang === 'ka' ? kaUrl(`/u/${u.username}`) : `${config.PUBLIC_URL}/u/${u.username}`;
  return jsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'ProfilePage', url, mainEntity: { '@id': `${url}#person` } },
    { '@type': 'Person', '@id': `${url}#person`, name: u.name, url, ...extra }] });
}

// A listed mentor as a person who offers a service (a paid written answer); its rating only when there are real, visible reviews.
function profileJsonLd(u, stats, lang, extra = {}) {
  const url = lang === 'ka' ? kaUrl(`/u/${u.username}`) : `${config.PUBLIC_URL}/u/${u.username}`;
  const niches = require('./niches');
  const service = {
    '@type': 'Service', name: lang === 'ka' ? `კითხვა: ${u.name}` : `A question to ${u.name}`, serviceType: niches.fieldOf(u, lang),
    provider: { '@id': `${url}#person` },
    offers: { '@type': 'Offer', price: String(u.price), priceCurrency: 'GEL', url }
  };
  if (stats && stats.reviewCount > 0 && stats.ratingAvg) service.aggregateRating = { '@type': 'AggregateRating', ratingValue: stats.ratingAvg, reviewCount: stats.reviewCount, bestRating: 5, worstRating: 1 };
  const person = {
    '@type': 'Person', '@id': `${url}#person`, name: u.name, jobTitle: u.roleTitle, url,
    ...(u.photoUpdatedAt ? { image: config.PUBLIC_URL + require('./util').photoUrl(u) } : {}), ...(u.bio ? { description: shortText(u.bio, 300) } : {}),
    ...extra
  };
  const crumbs = {
    '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Wisecall', item: lang === 'ka' ? kaUrl('/') : `${config.PUBLIC_URL}/` },
      ...(u.niche && u.niche !== 'other' ? [{ '@type': 'ListItem', position: 2, name: niches.nameOf(u.niche, lang), item: lang === 'ka' ? kaUrl(`/advice/${u.niche}`) : `${config.PUBLIC_URL}/advice/${u.niche}` }] : []),
      { '@type': 'ListItem', position: u.niche && u.niche !== 'other' ? 3 : 2, name: u.name, item: url }
    ]
  };
  return jsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'ProfilePage', url, mainEntity: { '@id': `${url}#person` } }, person, service, crumbs] });
}

// Texts may carry the site's settings ({answerDays}, {priceMin}, ...), as they do in the pages' own script (public/js/i18n.js).
function withSettings(text) {
  const v = {
    answerDays: config.ANSWER_DEADLINE_DAYS, holdDays: config.PAYOUT_HOLD_DAYS, disputeDays: config.DISPUTE_DAYS, feePct: config.PLATFORM_FEE_PERCENT,
    sharePct: 100 - config.PLATFORM_FEE_PERCENT, priceMin: config.PRICE_MIN, priceMax: config.PRICE_MAX, payoutMin: config.PAYOUT_MIN_GEL
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m));
}

// /faq.html: every question and answer, grouped, written in by the server in the page's language (also as FAQPage data), and under
// them three example questions and answers written by the team ("What an answer looks like", which used to be on the home page).
const FAQ_GROUPS = [['asking', [1, 7, 11, 10, 15]], ['payments', [2, 3, 4, 6]], ['mentors', [5, 16, 8, 9]], ['account', [13, 14]]];
const FAQ_EXAMPLES = [[1, 'tech'], [2, 'business'], [3, 'teaching']];
function faqVars(lang) {
  const d = dict(lang);
  const items = [];
  const html = FAQ_GROUPS.map(([group, ns]) => `
  <section class="faq-group" aria-labelledby="faq-${group}">
    <h2 id="faq-${group}" data-i18n="faq.group.${group}">${escapeHtml(d[`faq.group.${group}`] || group)}</h2>
    ${ns.filter((n) => d[`faq.${n}.q`]).map((n) => {
      const q = withSettings(d[`faq.${n}.q`]), a = withSettings(d[`faq.${n}.a`]);
      items.push({ q, a });
      return `<details class="faq-item" id="q${n}"><summary data-i18n="faq.${n}.q">${escapeHtml(q)}</summary><p data-i18n="faq.${n}.a">${escapeHtml(a)}</p></details>`;
    }).join('\n    ')}
  </section>`).join('') + `
  <section class="faq-group faq-examples" aria-labelledby="faq-examples">
    <h2 id="faq-examples" data-i18n="ex.title">${escapeHtml(d['ex.title'])}</h2>
    <p data-i18n="ex.sub">${escapeHtml(d['ex.sub'])}</p>
    <div class="example-grid">${FAQ_EXAMPLES.map(([n, niche]) => `
      <article class="example-card">
        <header><span class="ex-niche" data-i18n="niche.${niche}">${escapeHtml(d[`niche.${niche}`] || niche)}</span><span class="ex-tag" data-i18n="ex.label">${escapeHtml(d['ex.label'])}</span></header>
        <h3 class="ex-q" data-i18n="ex.${n}.q">${escapeHtml(d[`ex.${n}.q`])}</h3>
        <p class="ex-a" data-i18n="ex.${n}.a">${escapeHtml(d[`ex.${n}.a`])}</p>
        <p class="ex-who" data-i18n="ex.${n}.who">${escapeHtml(d[`ex.${n}.who`])}</p>
      </article>`).join('')}
    </div>
  </section>`;
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: lang,
    mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) });
  return { vars: { FAQ_TITLE: escapeHtml(d['faq.page.title']), FAQ_INTRO: escapeHtml(d['faq.page.intro']), FAQ_ITEMS: html }, head: ld };
}

// /how-we-verify.html: the checks, the badges, the regulated fields (from the niches), in the page's language.
function verifyVars(lang) {
  const d = dict(lang);
  const noDate = (s) => String(s || '').replace(/\s*[^.]*\{date\}\.?$/, '');
  const vars = {
    HVP_TITLE: d['hvp.title'], HVP_INTRO: d['hvp.intro'], HVP_STEPS: d['hvp.steps'], BADGE_TITLE: d['badge.title'], HV_BADGES: d['hv.badges'],
    HVP_REGULATED_TITLE: d['hvp.regulated.title'], HVP_REGULATED_BODY: d['hvp.regulated.body'], HVP_NEVER_TITLE: d['hvp.never.title'], HV_PRIVACY: d['hv.privacy'],
    BADGE_ID_TIP: noDate(d['badge.id.tip']), BADGE_EXPERIENCE_TIP: noDate(d['badge.experience.tip']), BADGE_LICENSE_TIP: noDate(d['badge.license.tip']),
    BADGE_WORKEMAIL_TIP: noDate(d['badge.workEmail.tip']), BADGE_DIPLOMA_TIP: noDate(d['badge.diploma.tip'])
  };
  for (const n of [1, 2, 3, 4, 5]) { vars[`HV_${n}_TITLE`] = d[`hv.${n}.title`]; vars[`HV_${n}_BODY`] = d[`hv.${n}.body`]; }
  Object.keys(vars).forEach((k) => { vars[k] = escapeHtml(withSettings(vars[k] || '')); });
  const niches = require('./niches');
  vars.REGULATED_LIST = niches.active().filter((n) => n.regulated)
    .map((n) => `<li><a href="${lang === 'ka' ? '/ka' : ''}/advice/${n.key}">${escapeHtml(lang === 'ka' ? n.ka : n.en)}</a></li>`).join('');
  return vars;
}

// The help centre (server/help.js): /help.html lists the articles, /help/<slug> shows one; both in the page's language.
function sendHelp(res, slug) {
  const help = require('./help');
  const html = readPage('help.html');
  if (html === null) return false;
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const list = help.articles(lang);
  const a = slug ? help.article(lang, slug) : null;
  if (slug && !a) return false;
  const nav = list.filter((x) => !a || x.slug !== a.slug).map((x) => `<li><a href="${prefix}/help/${x.slug}">${escapeHtml(x.title)}</a></li>`).join('');
  const helpTitle = d['help.title'] || 'Help centre';
  if (!a) ogFor(res, (g) => ({ title: `${g['help.title'] || helpTitle} — Wisecall`, description: shortText(g['help.intro'] || '') }));
  const vars = {
    ...baseVars(a ? `/help/${a.slug}` : '/help.html'),
    TITLE: escapeHtml(a ? `${a.title} — Wisecall` : `${helpTitle} — Wisecall`),
    DESCRIPTION: escapeHtml(shortText(a ? a.description : (d['help.intro'] || ''))),
    H1: escapeHtml(a ? a.title : helpTitle),
    CRUMBS: a ? `<li><a href="${prefix}/help.html">${escapeHtml(helpTitle)}</a></li><li><span aria-current="page">${escapeHtml(a.title)}</span></li>` : `<li><span aria-current="page">${escapeHtml(helpTitle)}</span></li>`,
    BODY: a ? `<article class="help-article">${a.html}</article>` : `<p class="legal-intro">${escapeHtml(d['help.intro'] || '')}</p>`,
    NAV_TITLE: escapeHtml(a ? (d['help.more'] || 'More help') : (d['help.articles'] || 'Articles')),
    NAV: nav
  };
  sendHtml(res, 200, fill(html, vars));
  return true;
}

// The home page: who runs the site, and the site itself. The organisation carries its other names (the name in Georgian letters, and
// "Wisecall Georgia": there are other companies called Wisecall), what it is in the page's language, the country it serves, its languages
// and its social pages (docs/CLAUDE-CODE-SEO.md 4).
function homeJsonLd(lang) {
  const url = lang === 'ka' ? kaUrl('/') : `${config.PUBLIC_URL}/`;
  const d = dict(lang);
  const org = { '@type': 'Organization', '@id': `${config.PUBLIC_URL}/#org`, name: 'Wisecall', alternateName: ['უაისქოლი', 'Wisecall Georgia'],
    url: `${config.PUBLIC_URL}/`, logo: config.PUBLIC_URL + assets.rewrite('/brand/wisecall-mark.svg'),
    description: d['org.description'] || '', areaServed: 'GE', knowsLanguage: ['ka', 'en'],
    ...(config.LEGAL_NAME ? { legalName: config.LEGAL_NAME } : {}), ...(config.SUPPORT_EMAIL ? { email: config.SUPPORT_EMAIL } : {}),
    sameAs: Object.values(config.SOCIAL_URLS || {}).filter(Boolean) };
  const site = { '@type': 'WebSite', '@id': `${config.PUBLIC_URL}/#site`, name: 'Wisecall', url, inLanguage: lang === 'ka' ? 'ka' : 'en', publisher: { '@id': org['@id'] },
    description: metaDescription(d, 'index') || '' };
  return jsonLd({ '@context': 'https://schema.org', '@graph': [org, site] });
}
// Search Console's and Bing's "HTML tag" proof of ownership: on the home page (both languages), only when the code is set.
function verificationTags() {
  return [
    config.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeHtml(config.GOOGLE_SITE_VERIFICATION)}">` : '',
    config.BING_SITE_VERIFICATION ? `<meta name="msvalidate.01" content="${escapeHtml(config.BING_SITE_VERIFICATION)}">` : ''
  ].filter(Boolean).join('\n');
}

// /llms.txt: what Wisecall is, in a few plain lines, for AI assistants that read it (docs/CLAUDE-CODE-SEO.md 1). The addresses come from
// PUBLIC_URL and the facts from the settings (the askers' age, the days to answer, the mentors' share), so it cannot fall behind them.
function llmsTxt() {
  const u = config.PUBLIC_URL;
  const ka = (p) => `${u}/ka${p}`;
  const pre = config.LAUNCH_MODE === 'prelaunch';
  return [
    '# Wisecall',
    '',
    '> Wisecall (უაისქოლი) is a Georgian platform where students and young people ask verified experts questions about their field, studies and career, and get a written answer.',
    '',
    `- Site: ${u} (Georgian: ${u}/ka/)`,
    `- Status: ${pre ? 'opening soon; a waitlist is open now.' : 'open.'}`,
    '- Languages: Georgian and English.',
    `- How it works: choose an expert in your field, write your question, get a written answer within ${config.ANSWER_DEADLINE_DAYS} days or your money back.`,
    `- Mentors: adults, ID-verified; they set their own price or answer for free, and keep ${100 - config.PLATFORM_FEE_PERCENT}%.`,
    `- Askers: ${require('./ageGate').MIN_ASKER_AGE} and older. Written only, no calls; personal contacts are protected.`,
    ...(config.SUPPORT_EMAIL ? [`- Contact: ${config.SUPPORT_EMAIL}`] : []),
    '',
    '## Pages',
    `- [How we verify mentors](${ka('/how-we-verify.html')})`,
    `- [Find your mentor (matching)](${ka('/match')})`,
    `- [Become a mentor](${ka('/become-a-mentor.html')})`,
    `- [FAQ](${ka('/faq.html')})`,
    `- [Help center](${ka('/help.html')})`,
    `- [About](${ka('/about.html')})`,
    ''
  ].join('\n');
}

// ---- Public answers (server/publicAnswers.js) -------------------------------------------------------------------------------------------
// /answers: the published answers (search, field, newest or most helpful), and /answers/<slug>: one of them, with the mentor and three
// related answers. Written in the page's language for search engines and link previews; only published answers exist here (a withdrawn
// one is 410 Gone, anything else 404), and a search result page is not indexed.
const paText = (text) => escapeHtml(String(text || '')).replace(/\n/g, '<br>');
function answerCard(a, prefix, d) {
  return `<article class="answer-card">
      ${a.sample ? `<span class="chip-tag answer-sample">${escapeHtml(d['pa.sample'])}</span>` : ''}
      <h2 class="answer-q"><a href="${prefix}/answers/${encodeURIComponent(a.slug)}">${escapeHtml(shortText(a.question, 160))}</a></h2>
      <p class="answer-a">${escapeHtml(shortText(a.answer, 240))}</p>
      <p class="muted small">${escapeHtml(a.mentor.name)}${a.mentor.field || a.mentor.roleTitle ? ' · ' + escapeHtml(a.mentor.field || a.mentor.roleTitle) : ''} · ${escapeHtml((d['answers.helpfulCount'] || '{n} found this helpful').replace('{n}', a.helpful))}</p>
    </article>`;
}

async function sendAnswers(req, res) {
  const html = readPage('answers.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const ka = lang === 'ka';
  const prefix = ka ? '/ka' : '';
  const niches = require('./niches');
  const q = String(req.query.q || '').slice(0, 100);
  const niche = niches.isValid(String(req.query.niche || '')) ? String(req.query.niche) : 'all';
  const sort = req.query.sort === 'helpful' ? 'helpful' : 'newest';
  const list = await require('./publicAnswers').list({ q, niche, sort, limit: 30 });
  const searching = Boolean(q) || niche !== 'all' || sort !== 'newest';
  const h1 = d['answers.title'];
  ogFor(res, (g) => ({ title: `${g['answers.title']} — Wisecall`, description: g['answers.intro'] }));
  sendHtml(res, 200, fill(html, {
    ...baseVars('/answers'),
    TITLE: escapeHtml(`${h1} — Wisecall`), DESCRIPTION: escapeHtml(d['answers.intro']), OG_TYPE: 'website',
    ROBOTS: !searching && list.length ? 'index, follow' : 'noindex', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    H1: escapeHtml(h1), INTRO: escapeHtml(d['answers.intro']), Q: escapeHtml(q), SEARCH: escapeHtml(d['answers.search']), FIELD: escapeHtml(d['answers.field']),
    SORT: escapeHtml(d['answers.sort']), SEARCH_BUTTON: escapeHtml(d['answers.searchButton']),
    NICHE_OPTIONS: [`<option value="all">${escapeHtml(d['niche.all'])}</option>`].concat(niches.active().map((n) => `<option value="${n.key}"${n.key === niche ? ' selected' : ''}>${escapeHtml(ka ? n.ka : n.en)}</option>`)).join(''),
    SORT_OPTIONS: ['newest', 'helpful'].map((s) => `<option value="${s}"${s === sort ? ' selected' : ''}>${escapeHtml(d['answers.sort.' + s])}</option>`).join(''),
    LIST: list.length ? list.map((a) => answerCard(a, prefix, d)).join('') : `<p class="muted">${escapeHtml(d[searching ? 'answers.noMatch' : 'answers.none'])}</p>`,
    NOTE: escapeHtml(d['answers.note'])
  }));
}

async function sendAnswer(req, res, slug) {
  const found = await require('./publicAnswers').bySlug(slug);
  if (!found) return notFoundHandler(req, res);
  const html = readPage('answer.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const base = { ...baseVars(`/answers/${slug}`), PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']), LIBRARY: escapeHtml(d['answers.title']), OG_TYPE: 'article' };
  // Withdrawn by the asker or the mentor, or taken down: gone, and said so.
  if (found.gone) {
    res.set('Cache-Control', 'no-store');
    return void sendHtml(res, 410, fill(html, { ...base, TITLE: escapeHtml(`${d['answers.gone.title']} — Wisecall`), DESCRIPTION: escapeHtml(d['answers.gone.body']), ROBOTS: 'noindex',
      CRUMB: escapeHtml(d['answers.gone.title']), BODY: `<h1>${escapeHtml(d['answers.gone.title'])}</h1><p>${escapeHtml(d['answers.gone.body'])}</p><p><a class="btn btn-outline" href="${prefix}/answers">${escapeHtml(d['answers.title'])}</a></p>` }));
  }
  const a = found.answer;
  const m = a.mentor;
  const title = shortText(a.question, 70);
  const profile = `${prefix}/u/${encodeURIComponent(m.username || '')}`;
  const mentorCard = `<aside class="answer-mentor settings-card">
      <p class="muted small">${escapeHtml(d['answers.answeredBy'])}</p>
      <p class="card-name">${m.username ? `<a class="plain-link" href="${profile}">${escapeHtml(m.name)}</a>` : escapeHtml(m.name)}</p>
      <p class="muted small">${escapeHtml([m.roleTitle, m.field].filter(Boolean).join(' · '))}</p>
      ${m.listed && m.username ? `<a class="btn btn-primary" href="${profile}">${escapeHtml((d['answers.askOwn'] || 'Ask {name} your own question').replace('{name}', m.name))}</a>` : ''}
    </aside>`;
  const body = `
  <article class="answer-full">
    <h1 class="answer-full-q">${paText(a.question)}</h1>
    ${a.sample ? `<p><span class="chip-tag answer-sample">${escapeHtml(d['pa.sample'])}</span> <span class="muted small">${escapeHtml(d['pa.sample.note'])}</span></p>` : `<p class="muted small">${escapeHtml(d['answers.asker'])}</p>`}
    ${a.regulated ? `<p class="advice-regulated">${escapeHtml(d['answers.regulated'])}</p>` : ''}
    <div class="answer-full-a">${paText(a.answer)}</div>
    <p class="answer-helpful"><button type="button" class="btn btn-outline btn-sm" id="helpfulBtn" data-slug="${escapeHtml(a.slug)}">${escapeHtml(d['answers.helpful'])}</button>
      <span class="muted small" id="helpfulCount" aria-live="polite">${escapeHtml((d['answers.helpfulCount'] || '{n}').replace('{n}', a.helpful))}</span></p>
    <div id="answerReport" data-mentor="${escapeHtml(m.id || '')}"></div>
  </article>
  ${mentorCard}
  ${found.related.length ? `<section class="answers-related"><h2>${escapeHtml(d['answers.related'])}</h2>${found.related.map((x) => answerCard(x, prefix, d)).join('')}</section>` : ''}
  <p class="muted small">${escapeHtml(d['answers.note'])}</p>`;
  const url = lang === 'ka' ? kaUrl(`/answers/${a.slug}`) : `${config.PUBLIC_URL}/answers/${a.slug}`;
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'QAPage', url, inLanguage: lang,
    mainEntity: { '@type': 'Question', name: title, text: a.question, answerCount: 1, datePublished: new Date(a.publishedAt).toISOString(),
      acceptedAnswer: { '@type': 'Answer', text: a.answer, datePublished: new Date(a.publishedAt).toISOString(), upvoteCount: a.helpful,
        author: { '@type': 'Person', name: m.name, ...(m.username ? { url: `${config.PUBLIC_URL}/u/${m.username}` } : {}) } } } });
  sendHtml(res, 200, addToHead(fill(html, { ...base, TITLE: escapeHtml(`${title} — Wisecall`), DESCRIPTION: escapeHtml(shortText(a.answer)), ROBOTS: 'index, follow',
    CRUMB: escapeHtml(shortText(a.question, 40)), BODY: body }), ld));
}

// /requests: what people are looking for, as anonymous counts by field (a request's text only when its author allowed it), with a way to
// become a mentor for it. It exists only from 5 active requests on.
async function sendRequestsBoard(req, res) {
  const fields = await require('./mentorRequests').board();
  if (!fields) return notFoundHandler(req, res);
  const html = readPage('requests.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const niches = require('./niches');
  const h1 = d['rq.board.title'];
  const list = fields.map((f) => `<article class="answer-card">
      <h2>${escapeHtml(d[f.count === 1 ? 'rq.board.countOne' : 'rq.board.count'].replace('{n}', f.count).replace('{field}', () => f.label))}</h2>
      ${f.niche !== 'other' && niches.isValid(f.niche) ? `<p class="muted small">${escapeHtml(niches.nameOf(f.niche, lang))}</p>` : ''}
      ${f.texts.map((x) => `<p class="answer-a">“${escapeHtml(x)}”</p>`).join('')}
      <p><a class="btn btn-primary btn-sm" href="${prefix}/signup.html?mentor=1">${escapeHtml(d['rq.board.become'])}</a></p>
    </article>`).join('');
  ogFor(res, (g) => ({ title: `${g['rq.board.title']} — Wisecall`, description: g['rq.board.intro'] }));
  sendHtml(res, 200, fill(html, { ...baseVars('/requests'), TITLE: escapeHtml(`${h1} — Wisecall`), DESCRIPTION: escapeHtml(d['rq.board.intro']), OG_TYPE: 'website',
    ROBOTS: 'index, follow', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']), H1: escapeHtml(h1), INTRO: escapeHtml(d['rq.board.intro']), LIST: list,
    ASK: escapeHtml(d['rq.cta']) }));
}

// Written on the server in the page's language, for search engines (JSON-LD Event) and for people without JavaScript.

const liveMoney = (tetri) => `${(tetri / 100).toFixed(tetri % 100 ? 2 : 0)} ₾`;
// (one formatter per language, made once: building one costs about 0.2 ms, docs/TODO-REHEARSAL.md R-12)
const LIVE_WHEN = {};
function liveWhen(dateish, lang) {
  const key = lang === 'ka' ? 'ka' : 'en';
  LIVE_WHEN[key] = LIVE_WHEN[key] || new Intl.DateTimeFormat(key === 'ka' ? 'ka-GE' : 'en-GB', { timeZone: 'Asia/Tbilisi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return LIVE_WHEN[key].format(new Date(dateish));
}
function liveCard(s, prefix, d, lang) {
  const labels = [s.startingSoon ? `<span class="badge badge-pending_payment">${escapeHtml(d['live.label.soon'])}</span>` : '',
    s.almostFull ? `<span class="badge badge-rejected">${escapeHtml(d['live.label.almostFull'])}</span>` : '',
    s.seatsLeft === 0 ? `<span class="badge badge-muted">${escapeHtml(d['live.label.soldOut'])}</span>` : ''].join(' ');
  return `<article class="live-card">
    ${s.hasCover ? `<img class="live-card-cover" src="/api/live-covers/${s.id}.webp" alt="" width="600" height="315" loading="lazy">` : ''}
    <div class="live-card-body">
      <p class="live-card-meta small"><span class="live-kind">${escapeHtml(d['live.kind.' + s.kind])}</span> · <time datetime="${escapeHtml(new Date(s.startsAt).toISOString())}" data-local="${escapeHtml(new Date(s.startsAt).toISOString())}">${escapeHtml(liveWhen(s.startsAt, lang))}</time> · ${escapeHtml(d['live.lang.' + s.language])}</p>
      <h2 class="live-card-title"><a class="plain-link" href="${prefix}/live/${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a></h2>
      <p class="muted small">${escapeHtml(s.mentor ? s.mentor.name : '')}</p>
      <p class="live-card-foot"><strong>${escapeHtml(liveMoney(s.priceNow))}</strong>${s.earlyNow ? ` <span class="muted small"><s>${escapeHtml(liveMoney(s.price))}</s> ${escapeHtml(d['live.early'])}</span>` : ''} ${labels}</p>
    </div>
  </article>`;
}

async function sendLiveList(req, res) {
  const html = readPage('live.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const q = req.query || {};
  const f = { niche: q.field, language: q.language, kind: q.type, from: q.from, to: q.to, maxPrice: q.maxPrice };
  const list = await require('./live/listing').upcoming(f);
  const filtering = Object.values(f).some(Boolean);
  const niches = require('./niches');
  const opt = (value, label, current) => `<option value="${escapeHtml(value)}"${String(current || '') === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  ogFor(res, (g) => ({ title: `${g['live.title']} — Wisecall`, description: g['live.intro'] }));
  sendHtml(res, 200, fill(html, { ...baseVars('/live'), TITLE: escapeHtml(`${d['live.title']} — Wisecall`), DESCRIPTION: escapeHtml(d['live.intro']), OG_TYPE: 'website',
    ROBOTS: filtering ? 'noindex, follow' : 'index, follow', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']), H1: escapeHtml(d['live.title']), INTRO: escapeHtml(d['live.intro']),
    F_FIELD: escapeHtml(d['live.f.field']), F_LANGUAGE: escapeHtml(d['live.f.language']), F_TYPE: escapeHtml(d['live.f.type']), F_FROM: escapeHtml(d['live.f.from']),
    F_TO: escapeHtml(d['live.f.to']), F_PRICE: escapeHtml(d['live.f.maxPrice']), F_APPLY: escapeHtml(d['live.f.apply']), F_ANY: escapeHtml(d['live.f.any']),
    FIELD_OPTIONS: niches.active().map((n) => opt(n.key, niches.nameOf(n.key, lang), f.niche)).join(''),
    LANGUAGE_OPTIONS: ['ka', 'en'].map((l) => opt(l, d['live.lang.' + l], f.language)).join(''),
    TYPE_OPTIONS: ['qa', 'workshop', 'circle'].map((k) => opt(k, d['live.kind.' + k], f.kind)).join(''),
    FROM: escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(String(f.from || '')) ? f.from : ''), TO: escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(String(f.to || '')) ? f.to : ''),
    MAX_PRICE: escapeHtml(Number.isInteger(Number(f.maxPrice)) && Number(f.maxPrice) > 0 ? String(Number(f.maxPrice)) : ''),
    LIST: list.length ? list.map((s) => liveCard(s, prefix, d, lang)).join('') : `<p class="muted">${escapeHtml(d[filtering ? 'live.noMatch' : 'live.none'])}</p>`,
    HOST: escapeHtml(d['live.hostCta']) }));
}

async function sendLiveSession(req, res, slug) {
  const sessions = require('./live/sessions');
  const s = await sessions.rowBySlug(slug);
  const viewer = req.userToken ? req.userToken.id : null;
  if (!s || (!['published', 'live', 'ended', 'cancelled'].includes(s.status) && s.mentor_id !== viewer)) return notFoundHandler(req, res);
  const html = readPage('live-session.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const mentor = await require('./models').getUserById(s.mentor_id);
  const v = sessions.publicView(s, mentor);
  const profile = mentor && mentor.username ? `${prefix}/u/${encodeURIComponent(mentor.username)}` : null;
  const stats = mentor ? (await require('./models').mentorStatsFor([mentor.id]))[mentor.id] || {} : {};
  const preview = !['published', 'live', 'ended', 'cancelled'].includes(s.status);
  const ratings = await require('./live/after').forSession(s.id);
  const body = `
  <article class="live-page" data-session="${escapeHtml(s.id)}" data-slug="${escapeHtml(s.slug)}" data-status="${escapeHtml(s.status)}">
    ${preview ? `<p class="pay-notice">${escapeHtml(d['live.previewNote'])}</p>` : ''}
    ${s.status === 'cancelled' ? `<p class="pay-notice cancelled">${escapeHtml(d['live.cancelledNote'])}</p>` : ''}
    ${v.hasCover ? `<img class="live-cover" src="/api/live-covers/${s.id}.webp" alt="" width="1200" height="630">` : ''}
    <p class="live-card-meta"><span class="live-kind">${escapeHtml(d['live.kind.' + s.kind])}</span> · ${escapeHtml(d['live.lang.' + s.language])} · ${escapeHtml((d['live.duration'] || '{n} min').replace('{n}', s.duration_min))}</p>
    <h1>${escapeHtml(s.title)}</h1>
    ${s.regulated ? `<p class="advice-regulated">${escapeHtml(d['live.regulatedLabel'])}</p>` : ''}
    <p class="live-when"><time datetime="${escapeHtml(new Date(s.starts_at).toISOString())}" data-local="${escapeHtml(new Date(s.starts_at).toISOString())}">${escapeHtml(liveWhen(s.starts_at, lang))}</time>
      <span class="muted small">(${escapeHtml(d['live.tbilisiTime'])})</span> <span class="muted small live-local" hidden></span></p>
    <div class="live-layout">
      <div class="live-main">
        <div class="live-description">${escapeHtml(s.description).replace(/\n/g, '<br>')}</div>
        ${s.learn_points.length ? `<h2>${escapeHtml(d['live.learn'])}</h2><ul class="live-points">${s.learn_points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
        ${ratings.count ? `<section class="live-ratings"><h2>${escapeHtml(d['live.ratings.title'])}</h2>
          <p><strong>${escapeHtml(d['live.ratings.summary'].replace('{avg}', ratings.average).replace('{n}', ratings.count))}</strong></p>
          ${ratings.comments.length ? `<ul class="live-comments">${ratings.comments.map((c) => `<li><span aria-hidden="true">${'★'.repeat(c.stars)}</span><span class="sr-only">${c.stars}/5</span> ${escapeHtml(c.comment)}</li>`).join('')}</ul>` : ''}
        </section>` : ''}
      </div>
      <aside class="live-side settings-card">
        <p class="live-price"><strong id="livePrice">${escapeHtml(liveMoney(v.priceNow))}</strong>${v.earlyNow ? ` <span class="muted small"><s>${escapeHtml(liveMoney(s.price))}</s> ${escapeHtml(d['live.early'])}</span>` : ''}</p>
        <p class="muted small" id="liveSeats">${escapeHtml((d['live.seatsLeft'] || '{n} places left').replace('{n}', v.seatsLeft))}</p>
        <div id="liveBuy"><noscript><p class="muted small">${escapeHtml(d['live.needsJs'])}</p></noscript></div>
        <p class="live-share">${'<button type="button" class="btn btn-outline btn-sm copy-link" data-url="' + escapeHtml(`${config.PUBLIC_URL}${prefix}/live/${s.slug}`) + '"><span class="copy-label">' + escapeHtml(d['copy.link']) + '</span></button>'}
          <a class="btn btn-outline btn-sm" rel="noopener" target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${config.PUBLIC_URL}${prefix}/live/${s.slug}`)}">Facebook</a>
          ${['published', 'live'].includes(s.status) ? `<a class="btn btn-outline btn-sm" href="/api/live-share/${escapeHtml(s.id)}.png" download="wisecall-live.png">${escapeHtml(d['live.shareImage'])}</a>` : ''}</p>
        <p class="small"><button type="button" class="linklike" id="liveReport">${escapeHtml(d['live.report'])}</button></p>
      </aside>
    </div>
    ${mentor ? `<aside class="answer-mentor settings-card live-mentor">
      <p class="muted small">${escapeHtml(d['live.hostedBy'])}</p>
      <p class="card-name">${profile ? `<a class="plain-link" href="${profile}">${escapeHtml(mentor.name)}</a>` : escapeHtml(mentor.name)}
        <span class="tag tag-verified">${escapeHtml(d['expert.verified'])}</span></p>
      <p class="muted small">${escapeHtml([mentor.roleTitle, mentor.customNiche || (mentor.niche && mentor.niche !== 'other' ? require('./niches').nameOf(mentor.niche, lang) : '')].filter(Boolean).join(' · '))}${stats.ratingAvg ? ` · ★ ${escapeHtml(String(stats.ratingAvg))}` : ''}</p>
      <div id="liveFollow" class="live-follow"></div>
    </aside>` : ''}
  </article>`;
  const url = lang === 'ka' ? kaUrl(`/live/${s.slug}`) : `${config.PUBLIC_URL}/live/${s.slug}`;
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'Event', name: s.title, description: shortText(s.description, 300), url, inLanguage: s.language,
    startDate: new Date(s.starts_at).toISOString(), endDate: sessions.endsAt(s).toISOString(),
    eventStatus: s.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation', url },
    ...(mentor ? { organizer: { '@type': 'Person', name: mentor.name, ...(mentor.username ? { url: `${config.PUBLIC_URL}/u/${mentor.username}` } : {}) },
      performer: { '@type': 'Person', name: mentor.name } } : {}),
    offers: { '@type': 'Offer', price: (v.priceNow / 100).toFixed(2), priceCurrency: 'GEL', url, availability: v.seatsLeft > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      validThrough: new Date(s.starts_at).toISOString() },
    ...(v.hasCover ? { image: `${config.PUBLIC_URL}/api/live-covers/${s.id}.webp` } : {}) });
  sendHtml(res, 200, addToHead(fill(html, { ...baseVars(`/live/${s.slug}`), TITLE: escapeHtml(`${s.title} — Wisecall`), DESCRIPTION: escapeHtml(shortText(s.description)),
    ROBOTS: preview || s.status === 'cancelled' ? 'noindex' : 'index, follow', OG_TYPE: 'website', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    LIBRARY: escapeHtml(d['live.title']), CRUMB: escapeHtml(shortText(s.title, 40)), BODY: body,
    OG_IMAGE: v.hasCover ? `${config.PUBLIC_URL}/api/live-covers/${s.id}.webp` : `${config.PUBLIC_URL}/og-image-1200x630.png` }), ld));
}

// The room: the ONLY page whose Content-Security-Policy allows the video provider's frame (and whose Permissions-Policy lets that frame use
// the camera, the microphone and screen sharing). Who may actually join is decided by POST /api/live/:id/join.
async function sendLiveRoom(req, res, slug) {
  const sessions = require('./live/sessions');
  const s = await sessions.rowBySlug(slug);
  if (!s || !['published', 'live', 'ended'].includes(s.status) || !s.room_url) return notFoundHandler(req, res);
  const html = readPage('live-room.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  let origin;
  try { origin = require('./live/rooms').frameOrigin(s); } catch (e) { return notFoundHandler(req, res); }
  const security = require('./security');
  res.set('Content-Security-Policy', security.cspWith({ frameSrc: origin }));
  res.set('Permissions-Policy', `camera=(self "${origin}"), microphone=(self "${origin}"), display-capture=(self "${origin}"), geolocation=(), payment=()`);
  res.set('Cache-Control', 'no-store');
  const host = await require('./models').getUserById(s.mentor_id);
  const crisis = sessions.CRISIS_FIELDS.includes(s.niche) || Boolean(host && sessions.CRISIS_FIELDS.includes(host.niche));
  sendHtml(res, 200, fill(html, { ...baseVars(`/live/${s.slug}/room`), TITLE: escapeHtml(`${s.title} — ${d['live.room.title']} — Wisecall`), DESCRIPTION: escapeHtml(shortText(s.description)),
    ROBOTS: 'noindex, nofollow', OG_TYPE: 'website', PREFIX: prefix, SESSION_ID: escapeHtml(s.id), SLUG: escapeHtml(s.slug), KIND: escapeHtml(s.kind), H1: escapeHtml(s.title),
    CRISIS: crisis ? `<p class="advice-regulated live-crisis" role="note">${escapeHtml(d['live.crisis'])}</p>` : '',
    REGULATED: s.regulated ? `<p class="advice-regulated">${escapeHtml(d['live.regulatedLabel'])}</p>` : '', FRAME_ORIGIN: escapeHtml(origin) }));
}

// A series: /live/series/<slug> (server/live/series.js). The sessions, the bundle price and what it saves; the page script sells it.
async function sendLiveSeries(req, res, slug) {
  const seriesMod = require('./live/series');
  const sr = await seriesMod.rowBySlug(slug);
  const viewer = req.userToken ? req.userToken.id : null;
  if (!sr || (sr.status === 'draft' && sr.mentor_id !== viewer)) return notFoundHandler(req, res);
  const html = readPage('live-series.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const mentor = await require('./models').getUserById(sr.mentor_id);
  const list = await seriesMod.sessionsOf(sr.id);
  const v = seriesMod.publicView(sr, list, mentor);
  const profile = mentor && mentor.username ? `${prefix}/u/${encodeURIComponent(mentor.username)}` : null;
  const body = `
  <article class="live-page live-series-page" data-series="${escapeHtml(sr.id)}" data-slug="${escapeHtml(sr.slug)}" data-status="${escapeHtml(sr.status)}">
    ${sr.status === 'draft' ? `<p class="pay-notice">${escapeHtml(d['live.previewNote'])}</p>` : ''}
    ${sr.status === 'cancelled' ? `<p class="pay-notice cancelled">${escapeHtml(d['live.series.cancelled'])}</p>` : ''}
    <p class="live-card-meta"><span class="live-kind">${escapeHtml((d['live.series.label'] || '{n} sessions').replace('{n}', list.length))}</span></p>
    <h1>${escapeHtml(sr.title)}</h1>
    <div class="live-layout">
      <div class="live-main">
        <div class="live-description">${escapeHtml(sr.description).replace(/\n/g, '<br>')}</div>
        <h2>${escapeHtml(d['live.series.sessions'])}</h2>
        <ol class="live-series-list">${list.map((s) => `<li><a class="plain-link" href="${prefix}/live/${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a><br>
          <span class="muted small"><time datetime="${escapeHtml(new Date(s.starts_at).toISOString())}">${escapeHtml(liveWhen(s.starts_at, lang))}</time> · ${escapeHtml(d['live.kind.' + s.kind])} · ${escapeHtml(liveMoney(s.price))}</span></li>`).join('')}</ol>
      </div>
      <aside class="live-side settings-card">
        <p class="live-price"><strong>${escapeHtml(liveMoney(v.price))}</strong> <span class="muted small"><s>${escapeHtml(liveMoney(v.sumPrice))}</s></span></p>
        <p class="muted small">${escapeHtml((d['live.series.saving'] || '').replace('{amount}', liveMoney(v.saving)))}</p>
        <div id="seriesBuy"><noscript><p class="muted small">${escapeHtml(d['live.needsJs'])}</p></noscript></div>
        <p class="live-share"><button type="button" class="btn btn-outline btn-sm copy-link" data-url="${escapeHtml(`${config.PUBLIC_URL}${prefix}/live/series/${sr.slug}`)}"><span class="copy-label">${escapeHtml(d['copy.link'])}</span></button></p>
      </aside>
    </div>
    ${mentor ? `<aside class="answer-mentor settings-card live-mentor">
      <p class="muted small">${escapeHtml(d['live.hostedBy'])}</p>
      <p class="card-name">${profile ? `<a class="plain-link" href="${profile}">${escapeHtml(mentor.name)}</a>` : escapeHtml(mentor.name)} <span class="tag tag-verified">${escapeHtml(d['expert.verified'])}</span></p>
      <p class="muted small">${escapeHtml(mentor.roleTitle || '')}</p>
    </aside>` : ''}
  </article>`;
  sendHtml(res, 200, fill(html, { ...baseVars(`/live/series/${sr.slug}`), TITLE: escapeHtml(`${sr.title} — Wisecall`), DESCRIPTION: escapeHtml(shortText(sr.description)),
    ROBOTS: sr.status === 'published' ? 'index, follow' : 'noindex', OG_TYPE: 'website', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    LIBRARY: escapeHtml(d['live.title']), CRUMB: escapeHtml(shortText(sr.title, 40)), BODY: body }));
}

// The replay of a session: /live/<slug>/replay. Whoever may watch gets a short-lived address from the video service (made for this view,
// never stored); this page alone allows that service's origin in its security policy. Others see what it costs (server/live/replays.js).
async function sendLiveReplay(req, res, slug) {
  const sessions = require('./live/sessions');
  const replays = require('./live/replays');
  const s = await sessions.rowBySlug(slug);
  if (!s || s.status !== 'ended' || !s.replay_enabled) return notFoundHandler(req, res);
  const html = readPage('live-replay.html');
  if (html === null) return notFoundHandler(req, res);
  const lang = langOf(res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const user = req.userToken ? await require('./models').getUserById(req.userToken.id) : null;
  const a = await replays.accessFor(user, s);
  let player = '';
  if (a.can) {
    const p = await replays.playback(user, s).catch((e) => { console.error('[live] replay address failed:', e.message); return null; });
    if (p && p.kind === 'video') {
      res.set('Content-Security-Policy', require('./security').cspWith({ mediaSrc: p.origin }));
      player = `<video class="live-replay-video" controls preload="metadata" controlsList="nodownload" src="${escapeHtml(p.url)}"></video>`;
    } else if (p) {
      res.set('Content-Security-Policy', require('./security').cspWith({ frameSrc: p.origin }));
      player = `<iframe class="live-call live-replay-frame" src="${escapeHtml(p.url)}" title="${escapeHtml(d['live.replay.title'])}"></iframe>`;
    } else player = `<p class="pay-notice failed">${escapeHtml(d['live.replay.unavailable'])}</p>`;
  }
  res.set('Cache-Control', 'no-store');
  const until = a.until ? liveWhen(a.until, lang) : null;
  const body = `
  <article class="live-page live-replay-page" data-session="${escapeHtml(s.id)}" data-slug="${escapeHtml(s.slug)}" data-can="${a.can ? '1' : ''}">
    <p class="live-card-meta"><span class="live-kind">${escapeHtml(d['live.replay.title'])}</span></p>
    <h1>${escapeHtml(s.title)}</h1>
    <p class="muted small">${escapeHtml(d['live.replay.what'])}</p>
    ${a.can ? `${player}${until ? `<p class="muted small">${escapeHtml(d['live.replay.until'].replace('{date}', until))}</p>` : ''}`
      : `<div class="settings-card live-replay-buy" id="replayBuy" data-price="${escapeHtml(String(a.price || ''))}" data-ready="${a.ready ? '1' : ''}" data-can-buy="${a.canBuy ? '1' : ''}">
          <noscript><p class="muted small">${escapeHtml(d['live.needsJs'])}</p></noscript></div>`}
    <p class="small"><a class="plain-link" href="${prefix}/live/${encodeURIComponent(s.slug)}">${escapeHtml(d['live.replay.back'])}</a></p>
  </article>`;
  sendHtml(res, 200, fill(html, { ...baseVars(`/live/${s.slug}/replay`), TITLE: escapeHtml(`${s.title} — ${d['live.replay.title']} — Wisecall`),
    DESCRIPTION: escapeHtml(shortText(s.description)), ROBOTS: 'noindex, nofollow', OG_TYPE: 'website', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    LIBRARY: escapeHtml(d['live.title']), CRUMB: escapeHtml(shortText(s.title, 40)), BODY: body }));
}

// A page per field: /advice/<niche>. The title, description, mentor list and links to the other fields are written in here, in English,
// for search engines and link previews; the page script then draws it in the visitor's language, with badges and ratings. Before launch
// no mentor is listed (the page offers the waiting list), and only a field with a listed mentor may be indexed.
async function sendAdvice(req, res, key) {
  const niches = require('./niches');
  const n = niches.get(key);
  if (!n || !n.active) return notFoundHandler(req, res);
  const html = readPage('advice.html');
  if (html === null) return notFoundHandler(req, res);
  await require('./launch').ensureFresh(5000);
  const live = config.LAUNCH_MODE !== 'prelaunch';
  const rows = live ? (await query(
    `SELECT name, username, role_title, custom_niche, price FROM users WHERE ${listableSql()} AND (niche = $1 OR $1 = ANY(extra_niches)) AND username IS NOT NULL AND profile_visibility = 'public'
      ORDER BY created_at DESC LIMIT 60`, [key])).rows : [];
  const lang = langOf(res);
  const ka = lang === 'ka';
  const name = niches.nameOf(key, lang);
  const h1 = ka ? `რჩევა: ${name} — მათგან, ვისაც ეს გაუვლია` : `Advice on ${name} from people who have done it`;
  const intro = ka
    ? `დაუსვი კითხვა გადამოწმებულ მენტორს (${name}) და მიიღე ნამდვილი, წერილობითი პასუხი. Wisecall-ის ყველა მენტორმა გაიარა პირადობის შემოწმება და გამოცდილების განხილვა.`
    : `Ask a verified mentor your question about ${name} and get a real, written answer. Every mentor on Wisecall passed an ID check and a review of their experience.`;
  ogFor(res, () => {
    const g = niches.nameOf(key, 'ka');
    return { title: `რჩევა: ${g} — მათგან, ვისაც ეს გაუვლია — Wisecall`,
      description: `დაუსვი კითხვა გადამოწმებულ მენტორს (${g}) და მიიღე ნამდვილი, წერილობითი პასუხი. Wisecall-ის ყველა მენტორმა გაიარა პირადობის შემოწმება და გამოცდილების განხილვა.` };
  });
  const vars = {
    ...baseVars(`/advice/${key}`),
    TITLE: escapeHtml(`${h1} — Wisecall`),
    DESCRIPTION: escapeHtml(intro),
    ROBOTS: live && rows.length ? 'index, follow' : 'noindex',
    NICHE_KEY: escapeHtml(key),
    NICHE_NAME: escapeHtml(name),
    H1: escapeHtml(h1),
    INTRO: escapeHtml(intro),
    LIST_TITLE: escapeHtml(ka ? `მენტორები: ${name}` : `Mentors: ${name}`),
    REGULATED_HIDDEN: n.regulated ? '' : 'hidden',
    REGULATED_NOTE: n.regulated ? escapeHtml(ka
      ? `${name} რეგულირებადი სფეროა: აქაურმა მენტორებმა ლიცენზიაც წარმოადგინეს და ჩვენი გუნდის წევრმა შეამოწმა. პასუხები პირადი გამოცდილება და აზრია და არა პროფესიული რჩევა შენი კონკრეტული შემთხვევისთვის.`
      : `${name} is a regulated field: mentors here also showed their licence, and a person on our team checked it. Answers are personal experience and opinion, not professional advice for your situation.`) : '',
    MENTORS: rows.length
      ? rows.map((r) => `<a class="expert-card" href="/u/${encodeURIComponent(r.username)}"><div class="card-top"><div><div class="card-name">${escapeHtml(r.name)}</div><div class="card-role">${escapeHtml([r.role_title, r.custom_niche].filter(Boolean).join(' · '))}</div></div></div><div class="card-bottom"><span class="price">${r.price === 0 ? (ka ? 'უფასო' : 'Free') : `${escapeHtml(String(r.price))} ₾`}</span></div></a>`).join('')
      : `<p class="muted">${escapeHtml(live ? (ka ? `${name}: მენტორები ჯერ არ არიან.` : `No mentors in ${name} yet.`) : (ka ? 'Wisecall მალე გაიხსნება.' : 'Wisecall opens soon.'))}</p>`,
    OTHER_NICHES: niches.active().filter((x) => x.key !== key).map((x) => `<li><a class="niche-chip" href="${ka ? '/ka' : ''}/advice/${x.key}"><span>${escapeHtml(ka ? x.ka : x.en)}</span></a></li>`).join('')
  };
  sendHtml(res, 200, fill(html, vars));
  return true;
}

// ---- "რჩევები": the articles written in Admin (server/articles.js; docs/CLAUDE-CODE-SEO.md 5) ---------------------------------------------
// /advice-articles: the published articles of the page's language; /advice-articles/<slug>: one of them. Both are written here, whole, in
// the page's language (nothing of the text needs a script), with Article data naming the real author. Only published articles exist: a
// draft or an article taken down is 404 (a verified admin alone sees it, as a preview that is never indexed). An article written in one
// language only has only that language's address, and names only that one in its head and in the sitemap.
const articleUrl = (lang, p) => (lang === 'ka' ? kaUrl(p) : config.PUBLIC_URL + p);
const fieldName = (id, lang) => { const f = require('./categories').FIELDS.find((x) => x.id === id); return f ? (lang === 'ka' ? f.ka : f.en) : ''; };
// The end of every article page: "find your mentor" (the matching page, at the article's field), and before launch the waiting list (a
// plain link to the home page's form; public/js/article.js puts the form itself here).
function articleEnd(lang, d, category) {
  const prefix = lang === 'ka' ? '/ka' : '';
  const pre = config.LAUNCH_MODE === 'prelaunch';
  return `
  <section class="article-next" aria-labelledby="articleNextTitle">
    <h2 id="articleNextTitle">${escapeHtml(d['home2.match.q'])}</h2>
    <p>${escapeHtml(d['home2.match.body'])}</p>
    <p><a class="btn btn-primary" href="${prefix}/match${category ? `?f=${encodeURIComponent(category)}` : ''}">${escapeHtml(d['home2.match.cta'])}</a></p>
  </section>${pre ? `
  <section class="article-wait" aria-labelledby="articleWaitTitle">
    <h2 id="articleWaitTitle">${escapeHtml(d['articles.wait.title'])}</h2>
    <p>${escapeHtml(d['articles.wait.body'])}</p>
    <div id="articleWait" data-field="${escapeHtml(category || '')}"><a class="btn btn-outline" href="${prefix}/#heroWait">${escapeHtml(d['wait.join'])}</a></div>
  </section>` : ''}`;
}
const articleByline = (a, lang) => `<p class="article-by"><span class="article-author">${escapeHtml(a.authorName)}</span>${a.date ? ` · <time datetime="${escapeHtml(a.date)}">${escapeHtml(require('./articles').dateText(a.date, lang))}</time>` : ''}</p>`;

async function sendArticles(req, res) {
  const articles = require('./articles');
  const html = readPage('article.html');
  if (html === null) return notFoundHandler(req, res);
  await require('./launch').ensureFresh(5000);
  const lang = langOf(res);
  const list = await articles.published(lang);
  // (nothing to read in this language yet: there is no such page, so nobody, and no search engine, lands on an empty one)
  if (!list.length) return notFoundHandler(req, res);
  const d = dict(lang);
  const prefix = lang === 'ka' ? '/ka' : '';
  const n = await articles.counts();
  res.locals.pageLangs = articles.LANGS.filter((l) => n[l] > 0);
  const url = articleUrl(lang, '/advice-articles');
  const body = `
  <header class="article-head"><h1>${escapeHtml(d['articles.title'])}</h1><p class="legal-intro">${escapeHtml(d['articles.intro'])}</p></header>
  <ul class="article-list">${list.map((a) => `
    <li class="article-card">
      ${a.category ? `<p class="article-kicker">${escapeHtml(fieldName(a.category, lang))}</p>` : ''}
      <h2><a href="${prefix}/advice-articles/${a.slug}">${escapeHtml(a[lang].title)}</a></h2>
      <p>${escapeHtml(a[lang].intro)}</p>
      ${articleByline(a, lang)}
    </li>`).join('')}
  </ul>${articleEnd(lang, d, null)}`;
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'CollectionPage', url, inLanguage: lang, name: d['articles.title'], description: d['articles.intro'],
    hasPart: list.slice(0, 50).map((a) => ({ '@type': 'Article', headline: a[lang].title, url: articleUrl(lang, `/advice-articles/${a.slug}`) })) });
  ogFor(res, (g) => ({ title: g['articles.meta.title'], description: g['articles.intro'] }));
  sendHtml(res, 200, addToHead(fill(html, { ...baseVars('/advice-articles'), TITLE: escapeHtml(d['articles.meta.title']), DESCRIPTION: escapeHtml(d['articles.intro']), OG_TYPE: 'website',
    ROBOTS: 'index, follow', SERVER_LANG: '<meta name="wisecall-server-lang" content="1">', PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    CRUMBS: `<li><span aria-current="page">${escapeHtml(d['articles.title'])}</span></li>`, BODY: body }), ld));
}

async function sendArticle(req, res, slug) {
  const articles = require('./articles');
  const a = await articles.bySlug(slug);
  if (!a) return notFoundHandler(req, res);
  const html = readPage('article.html');
  if (html === null) return notFoundHandler(req, res);
  await require('./launch').ensureFresh(5000);
  const lang = langOf(res);
  const other = lang === 'ka' ? 'en' : 'ka';
  const prefix = lang === 'ka' ? '/ka' : '';
  // Not published: there is no such page, except for a verified admin looking at what they are about to publish.
  const preview = a.status !== 'published';
  if (preview) {
    const who = await require('./adminAuth').whoIsAsking(req);
    if (!who.verified) return notFoundHandler(req, res);
    res.set('Cache-Control', 'no-store');
    // (a draft is shown as far as it is written; one with nothing in this language yet is shown in the other)
    if (!a[lang].title && !a[lang].body) {
      if (a[other].title || a[other].body) return res.redirect(302, `${other === 'ka' ? '/ka' : ''}/advice-articles/${a.slug}`);
      return notFoundHandler(req, res);
    }
  } else if (!a.langs.includes(lang)) {
    // Written in the other language only (the language switch leads here): to this language's articles, or its home page. This address
    // is in no sitemap and no page names it.
    const n = await articles.counts();
    return res.redirect(302, n[lang] > 0 ? `${prefix}/advice-articles` : `${prefix}/`);
  }
  const d = dict(lang);
  const v = a[lang];
  res.locals.pageLangs = preview ? [lang] : a.langs;
  const path2 = `/advice-articles/${a.slug}`;
  const url = articleUrl(lang, path2);
  const category = a.category ? fieldName(a.category, lang) : '';
  const more = preview ? [] : (await articles.published(lang)).filter((x) => x.id !== a.id).slice(0, 3);
  const body = `${preview ? `
  <p class="launch-banner article-draft" role="status">${escapeHtml(d['articles.draft'])}</p>` : ''}
  <article class="help-article blog-article">
    <header class="article-head">
      ${category ? `<p class="article-kicker">${escapeHtml(category)}</p>` : ''}
      <h1>${escapeHtml(v.title)}</h1>
      ${v.intro ? `<p class="legal-intro article-intro">${escapeHtml(v.intro)}</p>` : ''}
      ${articleByline(a, lang)}
    </header>
    <div class="article-body">
${articles.bodyHtml(v.body)}
    </div>
  </article>${articleEnd(lang, d, a.category)}${more.length ? `
  <nav class="help-nav article-more" aria-labelledby="articleMoreTitle">
    <h2 id="articleMoreTitle">${escapeHtml(d['articles.more'])}</h2>
    <ul>${more.map((x) => `<li><a href="${prefix}/advice-articles/${x.slug}">${escapeHtml(x[lang].title)}</a></li>`).join('')}</ul>
  </nav>` : ''}`;
  // The article as data: the real author (as the owner typed the name), the dates, and where it sits on the site.
  const changed = new Date(a.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
  const org = { '@type': 'Organization', '@id': `${config.PUBLIC_URL}/#org`, name: 'Wisecall', url: `${config.PUBLIC_URL}/` };
  const ld = jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', '@id': `${url}#article`, headline: v.title, description: v.intro, inLanguage: lang, url, mainEntityOfPage: url,
      ...(a.date ? { datePublished: a.date, dateModified: changed > a.date ? changed : a.date } : {}),
      author: { '@type': 'Person', name: a.authorName }, publisher: org, ...(category ? { articleSection: category } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: d['expert.crumb.home'], item: articleUrl(lang, '/') },
      { '@type': 'ListItem', position: 2, name: d['articles.title'], item: articleUrl(lang, '/advice-articles') },
      { '@type': 'ListItem', position: 3, name: v.title, item: url }] }] });
  // (the link to the list only when the list exists: a preview of the first article has none yet)
  const hasList = !preview || (await articles.counts())[lang] > 0;
  sendHtml(res, 200, addToHead(fill(html, { ...baseVars(path2), TITLE: escapeHtml(`${v.title} — Wisecall`), DESCRIPTION: escapeHtml(shortText(v.intro, 160)), OG_TYPE: 'article',
    ROBOTS: preview ? 'noindex' : 'index, follow',
    // (an article in English only stays readable for somebody whose chosen language is Georgian: the page is not moved to /ka)
    SERVER_LANG: preview || a.langs.includes('ka') ? '<meta name="wisecall-server-lang" content="1">' : '',
    PREFIX: prefix, HOME: escapeHtml(d['expert.crumb.home']),
    CRUMBS: `<li>${hasList ? `<a href="${prefix}/advice-articles">${escapeHtml(d['articles.title'])}</a>` : `<span>${escapeHtml(d['articles.title'])}</span>`}</li><li><span aria-current="page">${escapeHtml(shortText(v.title, 40))}</span></li>`,
    BODY: body }), preview ? '' : ld));
}

async function sendPage(res, file, vars, status = 200) {
  const html = readPage(file);
  if (html === null) return false;
  sendHtml(res, status, fill(html, vars));
  return true;
}

// One "Meet our experts" card while it loads: the same lines as the real card (public/js/home-mentors.js)
const HOME_CARD_SKELETON = '<li class="lexpert lexpert-skeleton" aria-hidden="true"><span class="skeleton skeleton-avatar md lexpert-avatar"></span>' +
  '<span class="skeleton skeleton-line w60 strong"></span><span class="skeleton skeleton-line w90"></span>' +
  '<span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w60"></span><span class="skeleton skeleton-pill"></span>' +
  '<span class="skeleton skeleton-line w40"></span><span class="lexpert-foot"><span class="skeleton skeleton-line w40"></span><span class="skeleton skeleton-price"></span></span></li>';

function pageRoutes() {
  const router = express.Router();

  router.get(['/', '/index.html'], async (req, res, next) => {
    try {
      // Browse experts is its own page now (/experts.html, docs/CLAUDE-CODE-NEW-HOME.md): an old link to the home page with Browse's filters
      // (?field=, ?niche= from earlier emails, ?q=...) goes there with them. (A bare /#experts is moved by the page itself: the server never
      // sees the part after #.)
      const BROWSE = ['field', 'niche', 'chip', 'q', 'free', 'paid', 'country', 'years'];
      if (BROWSE.some((k) => req.query[k] !== undefined)) {
        const qs = new URLSearchParams();
        for (const k of BROWSE) if (typeof req.query[k] === 'string') qs.set(k, req.query[k].slice(0, 200));
        return res.redirect(302, `${langOf(res) === 'ka' ? '/ka' : ''}/experts.html?${qs}`);
      }
      let html = readPage('index.html');
      if (html === null) return next();
      // (before launch the last call to action and the experts' skeleton are left out: the hero's waiting-list form already asks for the
      // email; after launch, the hero form's skeleton)
      const gone = config.LAUNCH_MODE === 'prelaunch' ? 'after launch' : 'before launch';
      html = html.replace(new RegExp(`[ \\t]*<!-- ${gone} -->[\\s\\S]*?<!-- /${gone} -->\\r?\\n?`, 'g'), '');
      // "Meet our experts" arrives open when it will have someone (with the cards' skeletons), so nothing below it moves once the script
      // fills it in (public/js/home-mentors.js); otherwise it stays hidden. (The phone is always there: real answers or marked examples.)
      const mentors = await require('./homeMentors').anyShown();
      if (mentors) {
        html = html.replace('id="homeMentors" aria-labelledby="homeMentorsTitle" hidden>', 'id="homeMentors" aria-labelledby="homeMentorsTitle">')
          .replace('<ul class="lexpert-grid" id="homeMentorsList"></ul>', `<ul class="lexpert-grid" id="homeMentorsList" aria-busy="true">${HOME_CARD_SKELETON.repeat(3)}</ul>`);
      }
      sendHtml(res, 200, addToHead(fill(html, baseVars('/')), [homeJsonLd(langOf(res)), verificationTags()].filter(Boolean).join('\n')));
    } catch (e) { next(e); }
  });

  // The old address of a mentor's page (/expert.html?id=...) lives on: it moves to the profile, keeping the rest of the query
  // (the bank sends buyers back with ?booking=&status=).
  router.get('/expert.html', async (req, res, next) => {
    try {
      const { id, ...rest } = req.query;
      const { getUserById } = require('./models');
      const user = UUID_RE.test(String(id)) ? await getUserById(String(id)) : null;
      if (!user || !user.username) return sendProfile(res, null);
      const qs = new URLSearchParams(rest).toString();
      res.redirect(301, `/u/${user.username}${qs ? '?' + qs : ''}`);
    } catch (e) { next(e); }
  });

  // A help article: /help/<slug>.
  router.get(/^\/help\/([a-z0-9-]{1,80})\/?$/, (req, res, next) => {
    try { if (!sendHelp(res, req.params[0])) notFoundHandler(req, res); } catch (e) { next(e); }
  });
  router.get('/help', (req, res) => res.redirect(301, (res.locals.pageLang === 'ka' ? '/ka' : '') + '/help.html'));

  // "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md): /match, /ka/match and /en/match are one page, public/find-a-mentor.html (which is
  // also where "tell us who you need" lives, as before).
  router.get(/^\/match\/?$/, async (req, res, next) => {
    try { if (!(await sendPage(res, 'find-a-mentor.html', baseVars('/match')))) next(); } catch (e) { next(e); }
  });

  // What people are looking for.
  router.get(/^\/requests\/?$/, async (req, res, next) => {
    try { await sendRequestsBoard(req, res); } catch (e) { next(e); }
  });

  // Live sessions: the list, one session, and its room (the room page has its own security policy, see sendLiveRoom).
  router.get(/^\/live\/?$/, async (req, res, next) => {
    try { await sendLiveList(req, res); } catch (e) { next(e); }
  });
  router.get(/^\/live\/([a-z0-9-]{3,90})\/room\/?$/, async (req, res, next) => {
    try { await sendLiveRoom(req, res, req.params[0]); } catch (e) { next(e); }
  });
  router.get(/^\/live\/([a-z0-9-]{3,90})\/replay\/?$/, require('./auth').optionalAuth, async (req, res, next) => {
    try { await sendLiveReplay(req, res, req.params[0]); } catch (e) { next(e); }
  });
  router.get(/^\/live\/series\/([a-z0-9-]{3,90})\/?$/, require('./auth').optionalAuth, async (req, res, next) => {
    try { await sendLiveSeries(req, res, req.params[0]); } catch (e) { next(e); }
  });
  router.get(/^\/live\/([a-z0-9-]{3,90})\/?$/, require('./auth').optionalAuth, async (req, res, next) => {
    try { await sendLiveSession(req, res, req.params[0]); } catch (e) { next(e); }
  });

  // Public answers: the library, and one answer.
  router.get(/^\/answers\/?$/, async (req, res, next) => {
    try { await sendAnswers(req, res); } catch (e) { next(e); }
  });
  router.get(/^\/answers\/([a-z0-9-]{3,80})\/?$/, async (req, res, next) => {
    try { await sendAnswer(req, res, req.params[0]); } catch (e) { next(e); }
  });

  // "რჩევები": the articles, and one article.
  router.get(/^\/advice-articles\/?$/, async (req, res, next) => {
    try { await sendArticles(req, res); } catch (e) { next(e); }
  });
  router.get(/^\/advice-articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/, async (req, res, next) => {
    try { await sendArticle(req, res, req.params[0]); } catch (e) { next(e); }
  });

  // A page per field: /advice/<niche>.
  router.get(/^\/advice\/([a-z][a-z0-9_]{1,30})\/?$/, async (req, res, next) => {
    try { await sendAdvice(req, res, req.params[0]); } catch (e) { next(e); }
  });

  // A profile: /u/<username>. An old username moves to the new one.
  router.get(/^\/u\/([\w-]{1,60})\/?$/, async (req, res, next) => {
    try {
      const found = await require('./usernames').resolve(req.params[0]);
      if (found && found.redirectTo) {
        const qs = new URLSearchParams(req.query).toString();
        // (an old name keeps the language of the address it was asked at: /ka/u/old -> /ka/u/new, /en/u/old -> /en/u/new)
        const lang = res.locals.pageLang === 'ka' ? '/ka' : (res.locals.pageLang === 'en' ? '/en' : '');
        return res.redirect(301, `${lang}/u/${found.redirectTo}${qs ? '?' + qs : ''}`);
      }
      await sendProfile(res, found ? found.row : null, req.params[0]);
    } catch (e) { next(e); }
  });

  // The admin page. Who is asking is checked BEFORE anything of it is sent: nobody signed in goes to the login page, a signed-in person who
  // is not an admin gets a plain "no access" page, an admin who has not passed the second step (an authenticator app) gets the two-step
  // verification page instead, and only an admin who has passed it receives the admin panel (and, from the routes in index.js, its scripts).
  router.get('/admin.html', async (req, res, next) => {
    try {
      const { user, admin, verified } = await require('./adminAuth').whoIsAsking(req);
      res.set('Cache-Control', 'no-store');
      if (!user) return res.redirect(302, '/login.html?redirect=/admin.html');
      if (!admin) return void sendForbidden(res);
      if (!(await sendPage(res, verified ? 'admin.html' : 'admin-2fa.html', baseVars('/admin.html')))) next();
    } catch (e) { next(e); }
  });

  // The mentor application, one step at a time (docs/CLAUDE-CODE-MENTOR-SIGNUP.md #3). Somebody who is not signed in goes to the mentor's
  // sign-up first (it leads back here); the page itself is the same for everyone and fills in from the API.
  router.get('/apply.html', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const prefix = langOf(res) === 'ka' ? '/ka' : '';
      if (!(await require('./auth').tokenFrom(req))) return res.redirect(302, `${prefix}/signup.html?as=mentor`);
      if (!(await sendPage(res, 'apply.html', baseVars('/apply.html')))) next();
    } catch (e) { next(e); }
  });

  // The old place of the application, Settings -> Verification (docs/CLAUDE-CODE-ONE-APPLY-PATH.md): someone applying is sent to /apply.html
  // (at their step; back from the ID check, at step 5), so the links in emails already sent keep working. An approved mentor stays (the tab
  // has their ID check, licence and badges); nobody signed in, or someone who is not a mentor, gets the page as usual.
  router.get('/settings.html', async (req, res, next) => {
    try {
      if (req.query.tab !== 'verification') return next();
      const payload = await require('./auth').tokenFrom(req);
      const user = payload ? await require('./models').getUserById(payload.id) : null;
      if (!user || !['mentor', 'both'].includes(user.role) || ['verified', 'suspended'].includes(user.verificationStatus)) return next();
      const p = await require('./verification/experience').progressFor(user);
      const qs = new URLSearchParams();
      if (req.query.kyc === 'returned') { qs.set('step', '5'); qs.set('kyc', 'returned'); }
      else if (p.state === 'draft' && p.step) qs.set('step', String(p.step));
      res.set('Cache-Control', 'no-store');
      res.redirect(302, `${langOf(res) === 'ka' ? '/ka' : ''}/apply.html${qs.toString() ? '?' + qs : ''}`);
    } catch (e) { next(e); }
  });

  // The invite link for mentors we contact: /mentor and /ka/mentor (docs/CLAUDE-CODE-MENTOR-SIGNUP.md #4). Straight to the mentor's
  // sign-up, or to the application for somebody already signed in; a sign-up from it counts as source "invite" (server/attribution.js).
  router.get(/^\/mentor\/?$/, async (req, res, next) => {
    try {
      require('./attribution').markInvite(req, res);
      const prefix = langOf(res) === 'ka' ? '/ka' : '';
      res.set('Cache-Control', 'no-store');
      res.redirect(302, (await require('./auth').tokenFrom(req)) ? `${prefix}/apply.html` : `${prefix}/signup.html?as=mentor`);
    } catch (e) { next(e); }
  });

  router.get(/^\/([\w-]+)\.html$/, async (req, res, next) => {
    try {
      const name = req.params[0];
      // The error pages are served by the error handlers, not by their own address. (Asking for them
      // directly gets the normal "not found" page, never the raw file with its {{placeholders}}.)
      if (name === '403' || name === '404' || name === '500' || name === 'admin-2fa' || name === 'advice' || name === 'article' || name === 'answers' || name === 'answer' || name === 'requests' || name === 'live' || name === 'live-session' || name === 'live-room' || name === 'live-series' || name === 'live-replay') return notFoundHandler(req, res); // (sent only by their own routes)
      if (name === 'profile') return void (await sendProfile(res, null)); // (the page itself says when nobody is found)
      if (name === 'faq') {
        const html = readPage('faq.html');
        if (html === null) return next();
        const f = faqVars(langOf(res));
        return void sendHtml(res, 200, addToHead(fill(html, { ...baseVars('/faq.html'), ...f.vars }), f.head));
      }
      if (name === 'help') { if (!sendHelp(res, null)) next(); return; }
      if (name === 'how-we-verify') {
        if (!(await sendPage(res, 'how-we-verify.html', { ...baseVars('/how-we-verify.html'), ...verifyVars(langOf(res)) }))) next();
        return;
      }
      if (!(await sendPage(res, `${name}.html`, baseVars(`/${name}.html`)))) next();
    } catch (e) { next(e); }
  });

  return router;
}

// robots.txt and sitemap.xml are generated so they always carry the right domain.
function seoRoutes() {
  const router = express.Router();

  // The speculation rules the pages point to (server/speculation.js).
  router.get('/speculation-rules.json', (req, res) => {
    res.type('application/speculationrules+json').set('Cache-Control', 'public, max-age=3600').send(JSON.stringify(require('./speculation').RULES));
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
      'User-agent: *',
      'Disallow: /api/',
      'Disallow: /admin.html',
      'Disallow: /ka/admin.html',
      `Sitemap: ${config.PUBLIC_URL}/sitemap.xml`,
      ''
    ].join('\n'));
  });

  router.get('/llms.txt', async (req, res, next) => {
    try {
      await require('./launch').ensureFresh(5000);
      res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(llmsTxt());
    } catch (e) { next(e); }
  });

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const staticPages = [['/', 1.0], ['/about.html', 0.6], ['/faq.html', 0.6], ['/how-we-verify.html', 0.6], ['/become-a-mentor.html', 0.6], ['/help.html', 0.5], ['/contact.html', 0.4], ['/match', 0.6], ['/terms.html', 0.3], ['/privacy.html', 0.3]]
        .filter(([p]) => p === '/' || p === '/match' || fs.existsSync(path.join(PUBLIC, p)))
        // (a help article in both languages)
        .concat(require('./help').articles('en').filter((a) => require('./help').article('ka', a.slug)).map((a) => [`/help/${a.slug}`, 0.4]));
      // Before launch the profiles are not offered to visitors, so they are not offered to search engines either.
      await require('./launch').ensureFresh(5000);
      const rows = config.LAUNCH_MODE === 'prelaunch' ? [] : (await query(`SELECT username, GREATEST(created_at, COALESCE(photo_updated_at, created_at), COALESCE(verification_decided_at, created_at)) AS changed_at FROM users WHERE ${listableSql()} AND username IS NOT NULL AND profile_visibility = 'public' ORDER BY created_at DESC LIMIT 5000`)).rows;
      // A field's page, once it has a mentor people can ask.
      const fields = config.LAUNCH_MODE === 'prelaunch' ? [] : (await query(`SELECT DISTINCT unnest(niche || extra_niches) AS niche FROM users WHERE ${listableSql()} AND profile_visibility = 'public'`)).rows
        .map((r) => r.niche).filter((k) => require('./niches').isValid(k));
      // Published answers (only those: a withdrawn one is gone).
      const answers = config.LAUNCH_MODE === 'prelaunch' ? [] : await require('./publicAnswers').sitemapSlugs();
      // Live sessions people can still join (the list and each session).
      const live = !config.LIVE_ENABLED ? [] : (await query(`SELECT s.slug, s.updated_at FROM live_sessions s WHERE s.status IN ('published', 'live') AND s.starts_at > now() - interval '2 hours'
                                     AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.mentor_id AND ${listableSql('u')}) ORDER BY s.starts_at LIMIT 1000`)).rows;
      // The published articles ("რჩევები"), before launch too: they are what there is to read. Each in the languages it is written in.
      const articles = await require('./articles').published();
      // Each page in its languages (nearly always both), each naming the other (and Georgian as the default).
      const versions = (p, langs, extra) => {
        const en = config.PUBLIC_URL + p, ka = kaUrl(p);
        const alt = (langs.includes('en') ? `<xhtml:link rel="alternate" hreflang="en" href="${escapeHtml(en)}"/>` : '') + (langs.includes('ka') ? `<xhtml:link rel="alternate" hreflang="ka" href="${escapeHtml(ka)}"/>` : '') +
          `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(langs.includes('ka') ? ka : en)}"/>`;
        return [langs.includes('en') ? en : null, langs.includes('ka') ? ka : null].filter(Boolean).map((loc) => `<url><loc>${escapeHtml(loc)}</loc>${alt}${extra}</url>`);
      };
      const both = (p, extra) => versions(p, ['en', 'ka'], extra);
      const articleLangs = ['en', 'ka'].filter((l) => articles.some((a) => a.langs.includes(l)));
      const urls = [
        ...staticPages.flatMap(([p, prio]) => both(p, `<priority>${prio}</priority>`)),
        ...fields.flatMap((k) => both(`/advice/${k}`, '<priority>0.8</priority>')),
        ...rows.flatMap((r) => both(`/u/${r.username}`, `<lastmod>${new Date(r.changed_at).toISOString().slice(0, 10)}</lastmod><priority>0.7</priority>`)),
        ...answers.flatMap((a) => both(`/answers/${a.slug}`, `<lastmod>${new Date(a.published_at).toISOString().slice(0, 10)}</lastmod><priority>0.6</priority>`)),
        ...(answers.length ? both('/answers', '<priority>0.7</priority>') : []),
        ...live.flatMap((s) => both(`/live/${s.slug}`, `<lastmod>${new Date(s.updated_at).toISOString().slice(0, 10)}</lastmod><priority>0.6</priority>`)),
        ...(live.length ? both('/live', '<priority>0.7</priority>') : []),
        ...articles.flatMap((a) => versions(`/advice-articles/${a.slug}`, a.langs, `<lastmod>${new Date(Math.max(new Date(a.updatedAt), new Date(a.publishedAt || a.updatedAt))).toISOString().slice(0, 10)}</lastmod><priority>0.7</priority>`)),
        ...(articleLangs.length ? versions('/advice-articles', articleLangs, '<priority>0.7</priority>') : [])
      ];
      res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
    } catch (e) { next(e); }
  });

  return router;
}

// The HTML files are only ever sent by the routes above (which fill in their placeholders and, for the admin page, check who is asking).
// A spelling the routes do not recognise but the file server would decode into a page (/%61dmin.html) must not reach the raw file.
function blockRawHtml(req, res, next) {
  const p = require('./adminAuth').tidyPath(req.path);
  if (p === null || /\.html?$/.test(p)) return notFoundHandler(req, res);
  next();
}

// Nice-looking 404 / 500 pages for browsers; JSON for API callers.
function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/') || !req.accepts(['html', 'json'])?.startsWith('html')) {
    return res.status(404).json({ error: 'not_found' });
  }
  const html = readPage('404.html');
  if (html === null) return res.status(404).send('Not found');
  sendHtml(res, 404, fill(html, baseVars(req.path)));
}

// "You don't have access to this page", in the site's design (nothing of the page that was asked for is in it).
function sendForbidden(res) {
  const html = readPage('403.html');
  if (html === null) return res.status(403).send('Forbidden');
  res.set('Cache-Control', 'no-store'); // (what one person may not see must not be kept for the next)
  sendHtml(res, 403, fill(html, baseVars('/403.html')));
}

function errorPage(req, res) {
  const html = readPage('500.html');
  if (html === null) return res.status(500).send('Something went wrong');
  sendHtml(res, 500, fill(html, baseVars(req.path)));
}

module.exports = { pageRoutes, seoRoutes, blockRawHtml, notFoundHandler, errorPage, languagePrefix, localize, shortText, kaHref };
