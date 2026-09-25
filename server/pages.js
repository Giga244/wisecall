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
  }
  if (config.IS_PROD) cache.set(file, html);
  return html;
}

// HTML is always asked for again (the answer is a small 304 when nothing changed), so a new release shows at once; the files it names
// carry a version in their address and are kept for a year.
function sendHtml(res, status, html) {
  if (!res.get('Cache-Control')) res.set('Cache-Control', 'no-cache');
  res.status(status).type('html').send(html);
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
  const vars = baseVars(u ? `/u/${u.username}` : '/profile.html');
  if (u && isPublic) {
    const title = listable ? `${u.name}, ${u.roleTitle} — Wisecall` : `${u.name} — Wisecall`;
    vars.TITLE = escapeHtml(title);
    vars.DESCRIPTION = escapeHtml((listable ? `Ask ${u.name} (${u.roleTitle}) a question on Wisecall for ${u.price} GEL. ${(u.bio || '').slice(0, 120)}` : `${u.name} on Wisecall. ${u.headline || u.bio || ''}`).trim().slice(0, 300));
  } else {
    vars.TITLE = 'Profile — Wisecall';
    vars.DESCRIPTION = 'A profile on Wisecall, where people ask verified experts and get real, paid answers.';
  }
  vars.ROBOTS = listable && isPublic ? 'index, follow' : 'noindex';
  sendHtml(res, u || asked === undefined ? 200 : 404, fill(html, vars));
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
    try { if (!(await sendPage(res, 'index.html', baseVars('/')))) next(); } catch (e) { next(e); }
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
  // is not an admin gets a plain "no access" page, and only an admin receives the admin page (and, from the routes in index.js, its scripts).
  router.get('/admin.html', async (req, res, next) => {
    try {
      const { user, admin } = await require('./adminAuth').whoIsAsking(req);
      res.set('Cache-Control', 'no-store');
      if (!user) return res.redirect(302, '/login.html?redirect=/admin.html');
      if (!admin) return void sendForbidden(res);
      if (!(await sendPage(res, 'admin.html', baseVars('/admin.html')))) next();
    } catch (e) { next(e); }
  });

  router.get(/^\/([\w-]+)\.html$/, async (req, res, next) => {
    try {
      const name = req.params[0];
      // The error pages are served by the error handlers, not by their own address. (Asking for them
      // directly gets the normal "not found" page, never the raw file with its {{placeholders}}.)
      if (name === '403' || name === '404' || name === '500') return notFoundHandler(req, res);
      if (name === 'profile') return void (await sendProfile(res, null)); // (the page itself says when nobody is found)
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
      'Disallow: /dashboard.html',
      'Disallow: /settings.html',
      'Disallow: /verify-email.html',
      'Disallow: /choose-username.html',
      'Disallow: /reset-password.html',
      'Disallow: /forgot-password.html',
      'Disallow: /waitlist-unsubscribe.html',
      `Sitemap: ${config.PUBLIC_URL}/sitemap.xml`,
      ''
    ].join('\n'));
  });

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const staticPages = [['/', 1.0], ['/about.html', 0.6], ['/contact.html', 0.4], ['/terms.html', 0.3], ['/privacy.html', 0.3], ['/signup.html', 0.5], ['/login.html', 0.3]];
      // Before launch the profiles are not offered to visitors, so they are not offered to search engines either.
      await require('./launch').ensureFresh(5000);
      const rows = config.LAUNCH_MODE === 'prelaunch' ? [] : (await query(`SELECT username, created_at FROM users WHERE ${listableSql()} AND username IS NOT NULL AND profile_visibility = 'public' ORDER BY created_at DESC LIMIT 5000`)).rows;
      const urls = [
        ...staticPages.map(([p, prio]) => `<url><loc>${escapeHtml(config.PUBLIC_URL + p)}</loc><priority>${prio}</priority></url>`),
        ...rows.map((r) => `<url><loc>${escapeHtml(`${config.PUBLIC_URL}/u/${r.username}`)}</loc><lastmod>${new Date(r.created_at).toISOString().slice(0, 10)}</lastmod><priority>0.7</priority></url>`)
      ];
      res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
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

module.exports = { pageRoutes, seoRoutes, blockRawHtml, notFoundHandler, errorPage };
