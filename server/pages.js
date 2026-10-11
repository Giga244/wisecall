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
const kaUrl = (enPath) => `${config.PUBLIC_URL}/ka${enPath === '/' ? '/' : enPath}`;
const pageKeyOf = (p) => (p === '/' || p === '/index.html' ? 'index' : (/^\/([\w-]+)\.html$/.exec(p) || [])[1] || null);

function languagePrefix(req, res, next) {
  if (req.path === '/ka') return res.redirect(301, '/ka/' + (req.url.slice(3) || ''));
  if (req.path.startsWith('/ka/') && !req.path.startsWith('/ka/api/')) {
    res.locals.pageLang = 'ka';
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

// The head of a page in its language, with its alternates. Pages without a canonical address (error pages) only get <html lang>.
function localize(html, lang) {
  html = html.replace(/<html lang="[a-z-]+"/, () => `<html lang="${lang}"`);
  html = translateBody(html, lang);
  const canon = /<link rel="canonical" href="([^"]*)">/.exec(html);
  if (!canon) return html;
  const enUrl = canon[1];
  const enPath = enUrl.startsWith(config.PUBLIC_URL) ? (enUrl.slice(config.PUBLIC_URL.length) || '/') : enUrl;
  const ka = kaUrl(enPath);
  const d = dict(lang);
  const key = pageKeyOf(enPath);
  const title = key && d[`meta.${key}.title`];
  const description = key && d[`meta.${key}.description`];
  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
      .replace(/(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*(")/g, (m, a, b) => a + escapeHtml(title) + b);
  }
  if (description) {
    html = html.replace(/(<meta (?:name="description"|(?:property|name)="(?:og|twitter):description") content=")[^"]*(")/g, (m, a, b) => a + escapeHtml(description) + b);
  }
  if (lang === 'ka') {
    html = html.replace(canon[0], () => `<link rel="canonical" href="${escapeHtml(ka)}">`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, (m, a, b) => a + escapeHtml(ka) + b);
  }
  const tags = [
    `<link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}">`,
    `<link rel="alternate" hreflang="ka" href="${escapeHtml(ka)}">`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(ka)}">`,
    `<meta property="og:locale" content="${lang === 'ka' ? 'ka_GE' : 'en_US'}">`,
    `<meta property="og:locale:alternate" content="${lang === 'ka' ? 'en_US' : 'ka_GE'}">`
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
  if (status === 200 && res.req) require('./analytics').pageview(res.req); // (off unless PLAUSIBLE_DOMAIN is set)
  res.status(status).type('html').send(localize(html, langOf(res)));
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
      ? (lang === 'ka' ? `დაუსვი კითხვა: ${u.name} (${u.roleTitle}), ${u.price} ₾. ${profile.bio || ''}` : `Ask ${u.name} (${u.roleTitle}) a question on Wisecall for ${u.price} GEL. ${profile.bio || ''}`)
      : `${u.name} — Wisecall. ${profile.headline || profile.bio || ''}`;
    vars.DESCRIPTION = escapeHtml(shortText(text));
    if (u.photoUpdatedAt) vars.OG_IMAGE = config.PUBLIC_URL + require('./util').photoUrl(u);
    const stats = listable ? (await require('./models').mentorStatsFor([u.id]))[u.id] : null;
    vars.PROFILE_SSR = profileSsr(profile, stats, listable ? u : null, lang);
    // (worksFor, alumniOf, knowsAbout, knowsLanguage: only from the sections everyone may see)
    const extra = await require('./profileSections').jsonLdFields(u);
    if (listable) extraHead = profileJsonLd({ ...u, bio: profile.bio }, stats, lang, extra);
    else if (Object.keys(extra).length) extraHead = personJsonLd(u, lang, extra);
  } else {
    vars.TITLE = lang === 'ka' ? 'პროფილი — Wisecall' : 'Profile — Wisecall';
    vars.DESCRIPTION = lang === 'ka' ? 'პროფილი Wisecall-ზე, სადაც ადამიანები გადამოწმებულ ექსპერტებს კითხვებს უსვამენ.' : 'A profile on Wisecall, where people ask verified experts and get real, paid answers.';
  }
  vars.ROBOTS = listable && isPublic ? 'index, follow' : 'noindex';
  const page = fill(html, vars);
  sendHtml(res, u || asked === undefined ? 200 : 404, extraHead ? addToHead(page, extraHead) : page);
  return true;
}

// What stands in the profile area until the page script has drawn the profile (a private or unknown profile shows only this).
const SKELETON = `<div class="expert-layout" aria-hidden="true">
      <div class="profile-card">
        <div class="profile-head">
          <span class="skeleton skeleton-avatar"></span>
          <div style="flex:1"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line w60"></span></div>
        </div>
        <span class="skeleton skeleton-line w80" style="margin-top:24px"></span>
      </div>
      <div class="ask-side"><div class="skeleton-card"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w80"></span><span class="skeleton skeleton-line w60"></span></div></div>
    </div>`;

// A public profile as plain HTML (only what the public profile shows; every value escaped).
function profileSsr(p, stats, mentor, lang) {
  const ka = lang === 'ka';
  const facts = [
    p.city ? `<li>${escapeHtml(p.city)}</li>` : '',
    (p.languages || []).length ? `<li>${escapeHtml(p.languages.join(', '))}</li>` : '',
    mentor ? `<li>${escapeHtml(ka ? `ფასი: ${mentor.price} ₾ ერთ კითხვაზე` : `${mentor.price} GEL per question`)}</li>` : '',
    stats && stats.reviewCount ? `<li>${escapeHtml(ka ? `★ ${stats.ratingAvg} (${stats.reviewCount} შეფასება)` : `★ ${stats.ratingAvg} (${stats.reviewCount} reviews)`)}</li>` : ''
  ].join('');
  const role = mentor ? mentor.roleTitle : p.headline;
  // The rich sections everyone may see, as plain text for search engines and link previews (the page script draws them properly).
  const s = p.sections || {};
  const when = (d) => (d ? (d.month ? `${d.month}/${d.year}` : String(d.year)) : '');
  const parts = [
    (s.experience || []).length ? `<h2>${ka ? 'გამოცდილება' : 'Experience'}</h2><ul>${s.experience.flatMap((g) => g.items).map((i) => `<li>${escapeHtml(i.title)} — ${escapeHtml(i.organisation)} (${escapeHtml(when(i.start))} – ${escapeHtml(i.current ? (ka ? 'დღემდე' : 'now') : when(i.end || i.start))})</li>`).join('')}</ul>` : '',
    (s.education || []).length ? `<h2>${ka ? 'განათლება' : 'Education'}</h2><ul>${s.education.map((e) => `<li>${escapeHtml([e.school, e.degree, e.field].filter(Boolean).join(', '))}</li>`).join('')}</ul>` : '',
    (s.skills || []).length ? `<h2>${ka ? 'უნარები' : 'Skills'}</h2><p>${escapeHtml(s.skills.join(', '))}</p>` : ''
  ].join('');
  return `<article class="profile-card profile-ssr">
      <div class="profile-head"><div>
        <h1>${escapeHtml(p.name)}</h1>
        ${role ? `<p class="profile-headline">${escapeHtml(role)}</p>` : ''}
      </div></div>
      ${p.bio ? `<p class="profile-bio">${escapeHtml(p.bio)}</p>` : ''}
      ${facts ? `<ul class="profile-facts">${facts}</ul>` : ''}
      ${parts}
    </article>`;
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

// The home page: who runs the site, and the site itself.
function homeJsonLd(lang) {
  const url = lang === 'ka' ? kaUrl('/') : `${config.PUBLIC_URL}/`;
  const d = dict(lang);
  const org = { '@type': 'Organization', '@id': `${config.PUBLIC_URL}/#org`, name: 'Wisecall', url: `${config.PUBLIC_URL}/`, logo: config.PUBLIC_URL + assets.rewrite('/brand/wisecall-mark.svg'),
    description: "Advice from people who've already done it.",
    ...(config.LEGAL_NAME ? { legalName: config.LEGAL_NAME } : {}), ...(config.SUPPORT_EMAIL ? { email: config.SUPPORT_EMAIL } : {}),
    sameAs: Object.values(config.SOCIAL_URLS || {}).filter(Boolean) };
  const site = { '@type': 'WebSite', '@id': `${config.PUBLIC_URL}/#site`, name: 'Wisecall', url, inLanguage: lang === 'ka' ? 'ka' : 'en', publisher: { '@id': org['@id'] },
    description: d['meta.index.description'] || '' };
  return jsonLd({ '@context': 'https://schema.org', '@graph': [org, site] });
}

// ---- Public answers (server/publicAnswers.js) -------------------------------------------------------------------------------------------
// /answers: the published answers (search, field, newest or most helpful), and /answers/<slug>: one of them, with the mentor and three
// related answers. Written in the page's language for search engines and link previews; only published answers exist here (a withdrawn
// one is 410 Gone, anything else 404), and a search result page is not indexed.
const paText = (text) => escapeHtml(String(text || '')).replace(/\n/g, '<br>');
function answerCard(a, prefix, d) {
  return `<article class="answer-card">
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
    <p class="muted small">${escapeHtml(d['answers.asker'])}</p>
    ${a.regulated ? `<p class="advice-regulated">${escapeHtml(d['answers.regulated'])}</p>` : ''}
    <div class="answer-full-a">${paText(a.answer)}</div>
    <p class="answer-helpful"><button type="button" class="btn btn-outline btn-sm" id="helpfulBtn" data-slug="${escapeHtml(a.slug)}">${escapeHtml(d['answers.helpful'])}</button>
      <span class="muted small" id="helpfulCount" aria-live="polite">${escapeHtml((d['answers.helpfulCount'] || '{n}').replace('{n}', a.helpful))}</span></p>
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
    `SELECT name, username, role_title, custom_niche, price FROM users WHERE ${listableSql()} AND niche = $1 AND username IS NOT NULL AND profile_visibility = 'public'
      ORDER BY created_at DESC LIMIT 60`, [key])).rows : [];
  const lang = langOf(res);
  const ka = lang === 'ka';
  const name = niches.nameOf(key, lang);
  const h1 = ka ? `რჩევა: ${name} — მათგან, ვისაც ეს გაუვლია` : `Advice on ${name} from people who have done it`;
  const intro = ka
    ? `დაუსვი კითხვა გადამოწმებულ მენტორს (${name}) და მიიღე ნამდვილი, წერილობითი პასუხი. Wisecall-ის ყველა მენტორმა გაიარა პირადობის შემოწმება და გამოცდილების განხილვა.`
    : `Ask a verified mentor your question about ${name} and get a real, written answer. Every mentor on Wisecall passed an ID check and a review of their experience.`;
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
      ? rows.map((r) => `<a class="expert-card" href="/u/${encodeURIComponent(r.username)}"><div class="card-top"><div><div class="card-name">${escapeHtml(r.name)}</div><div class="card-role">${escapeHtml([r.role_title, r.custom_niche].filter(Boolean).join(' · '))}</div></div></div><div class="card-bottom"><span class="price">${escapeHtml(String(r.price))} ₾</span></div></a>`).join('')
      : `<p class="muted">${escapeHtml(live ? (ka ? `${name}: მენტორები ჯერ არ არიან.` : `No mentors in ${name} yet.`) : (ka ? 'Wisecall მალე გაიხსნება.' : 'Wisecall opens soon.'))}</p>`,
    OTHER_NICHES: niches.active().filter((x) => x.key !== key).map((x) => `<li><a class="niche-chip" href="${ka ? '/ka' : ''}/advice/${x.key}"><span>${escapeHtml(ka ? x.ka : x.en)}</span></a></li>`).join('')
  };
  sendHtml(res, 200, fill(html, vars));
  return true;
}

async function sendPage(res, file, vars, status = 200) {
  const html = readPage(file);
  if (html === null) return false;
  sendHtml(res, status, fill(html, vars));
  return true;
}

function pageRoutes() {
  const router = express.Router();

  router.get(['/', '/index.html'], async (req, res, next) => {
    try {
      let html = readPage('index.html');
      if (html === null) return next();
      // (before launch the last call to action is left out: the waiting-list card already asks for the email)
      if (config.LAUNCH_MODE === 'prelaunch') html = html.replace(/<!-- after launch -->[\s\S]*?<!-- \/after launch -->\r?\n?/g, '');
      sendHtml(res, 200, addToHead(fill(html, baseVars('/')), homeJsonLd(langOf(res))));
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
        return res.redirect(301, `/u/${found.redirectTo}${qs ? '?' + qs : ''}`);
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

  router.get(/^\/([\w-]+)\.html$/, async (req, res, next) => {
    try {
      const name = req.params[0];
      // The error pages are served by the error handlers, not by their own address. (Asking for them
      // directly gets the normal "not found" page, never the raw file with its {{placeholders}}.)
      if (name === '403' || name === '404' || name === '500' || name === 'admin-2fa' || name === 'advice' || name === 'answers' || name === 'answer' || name === 'requests' || name === 'live' || name === 'live-session' || name === 'live-room' || name === 'live-series' || name === 'live-replay') return notFoundHandler(req, res); // (sent only by their own routes)
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

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const staticPages = [['/', 1.0], ['/about.html', 0.6], ['/faq.html', 0.6], ['/how-we-verify.html', 0.6], ['/become-a-mentor.html', 0.6], ['/help.html', 0.5], ['/contact.html', 0.4], ['/find-a-mentor.html', 0.4], ['/terms.html', 0.3], ['/privacy.html', 0.3]]
        .filter(([p]) => p === '/' || fs.existsSync(path.join(PUBLIC, p)))
        // (a help article in both languages)
        .concat(require('./help').articles('en').filter((a) => require('./help').article('ka', a.slug)).map((a) => [`/help/${a.slug}`, 0.4]));
      // Before launch the profiles are not offered to visitors, so they are not offered to search engines either.
      await require('./launch').ensureFresh(5000);
      const rows = config.LAUNCH_MODE === 'prelaunch' ? [] : (await query(`SELECT username, GREATEST(created_at, COALESCE(photo_updated_at, created_at), COALESCE(verification_decided_at, created_at)) AS changed_at FROM users WHERE ${listableSql()} AND username IS NOT NULL AND profile_visibility = 'public' ORDER BY created_at DESC LIMIT 5000`)).rows;
      // A field's page, once it has a mentor people can ask.
      const fields = config.LAUNCH_MODE === 'prelaunch' ? [] : (await query(`SELECT DISTINCT niche FROM users WHERE ${listableSql()} AND profile_visibility = 'public'`)).rows
        .map((r) => r.niche).filter((k) => require('./niches').isValid(k));
      // Published answers (only those: a withdrawn one is gone).
      const answers = config.LAUNCH_MODE === 'prelaunch' ? [] : await require('./publicAnswers').sitemapSlugs();
      // Live sessions people can still join (the list and each session).
      const live = !config.LIVE_ENABLED ? [] : (await query(`SELECT s.slug, s.updated_at FROM live_sessions s WHERE s.status IN ('published', 'live') AND s.starts_at > now() - interval '2 hours'
                                     AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.mentor_id AND ${listableSql('u')}) ORDER BY s.starts_at LIMIT 1000`)).rows;
      // Each page in both languages, each naming the other (and Georgian as the default).
      const both = (p, extra) => {
        const en = config.PUBLIC_URL + p, ka = kaUrl(p);
        const alt = `<xhtml:link rel="alternate" hreflang="en" href="${escapeHtml(en)}"/><xhtml:link rel="alternate" hreflang="ka" href="${escapeHtml(ka)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(ka)}"/>`;
        return [en, ka].map((loc) => `<url><loc>${escapeHtml(loc)}</loc>${alt}${extra}</url>`);
      };
      const urls = [
        ...staticPages.flatMap(([p, prio]) => both(p, `<priority>${prio}</priority>`)),
        ...fields.flatMap((k) => both(`/advice/${k}`, '<priority>0.8</priority>')),
        ...rows.flatMap((r) => both(`/u/${r.username}`, `<lastmod>${new Date(r.changed_at).toISOString().slice(0, 10)}</lastmod><priority>0.7</priority>`)),
        ...answers.flatMap((a) => both(`/answers/${a.slug}`, `<lastmod>${new Date(a.published_at).toISOString().slice(0, 10)}</lastmod><priority>0.6</priority>`)),
        ...(answers.length ? both('/answers', '<priority>0.7</priority>') : []),
        ...live.flatMap((s) => both(`/live/${s.slug}`, `<lastmod>${new Date(s.updated_at).toISOString().slice(0, 10)}</lastmod><priority>0.6</priority>`)),
        ...(live.length ? both('/live', '<priority>0.7</priority>') : [])
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

module.exports = { pageRoutes, seoRoutes, blockRawHtml, notFoundHandler, errorPage, languagePrefix, localize, shortText };
