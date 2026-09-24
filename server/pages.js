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

const PUBLIC = path.join(__dirname, '..', 'public');
const UUID_RE = /^[0-9a-f-]{36}$/i;
const cache = new Map();

function readPage(file) {
  if (cache.has(file)) return cache.get(file);
  const full = path.join(PUBLIC, file);
  const html = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  if (config.IS_PROD) cache.set(file, html);
  return html;
}

function fill(html, vars) {
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function baseVars(canonicalPath) {
  return { PUBLIC_URL: config.PUBLIC_URL, CANONICAL_URL: config.PUBLIC_URL + canonicalPath };
}

// A public mentor's name and role for the page <title>; null when they aren't listed.
async function expertMeta(id) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await query(
    `SELECT name, role_title, bio, price FROM users WHERE id = $1 AND ${listableSql()}`, [id]
  );
  return rows[0] || null;
}

async function sendPage(res, file, vars, status = 200) {
  const html = readPage(file);
  if (html === null) return false;
  res.status(status).type('html').send(fill(html, vars));
  return true;
}

function pageRoutes() {
  const router = express.Router();

  router.get(['/', '/index.html'], async (req, res, next) => {
    try { if (!(await sendPage(res, 'index.html', baseVars('/')))) next(); } catch (e) { next(e); }
  });

  router.get('/expert.html', async (req, res, next) => {
    try {
      const html = readPage('expert.html');
      if (html === null) return next();
      const m = await expertMeta(req.query.id);
      const vars = baseVars('/expert.html');
      if (m) {
        vars.CANONICAL_URL = `${config.PUBLIC_URL}/expert.html?id=${req.query.id}`;
        vars.TITLE = escapeHtml(`${m.name}, ${m.role_title} — Wisecall`);
        vars.DESCRIPTION = escapeHtml(`Ask ${m.name} (${m.role_title}) a question on Wisecall for ${m.price} GEL. ${(m.bio || '').slice(0, 120)}`.trim());
      } else {
        vars.TITLE = 'Expert — Wisecall';
        vars.DESCRIPTION = 'Ask a verified expert a question on Wisecall and get a real, paid answer.';
      }
      res.type('html').send(fill(html, vars));
    } catch (e) { next(e); }
  });

  router.get(/^\/([\w-]+)\.html$/, async (req, res, next) => {
    try {
      const name = req.params[0];
      // The error pages are served by the error handlers, not by their own address.
      if (name === '404' || name === '500') return next();
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
      'Disallow: /reset-password.html',
      'Disallow: /forgot-password.html',
      `Sitemap: ${config.PUBLIC_URL}/sitemap.xml`,
      ''
    ].join('\n'));
  });

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const staticPages = [['/', 1.0], ['/about.html', 0.6], ['/contact.html', 0.4], ['/terms.html', 0.3], ['/privacy.html', 0.3], ['/signup.html', 0.5], ['/login.html', 0.3]];
      const { rows } = await query(`SELECT id, created_at FROM users WHERE ${listableSql()} ORDER BY created_at DESC LIMIT 5000`);
      const urls = [
        ...staticPages.map(([p, prio]) => `<url><loc>${escapeHtml(config.PUBLIC_URL + p)}</loc><priority>${prio}</priority></url>`),
        ...rows.map((r) => `<url><loc>${escapeHtml(`${config.PUBLIC_URL}/expert.html?id=${r.id}`)}</loc><lastmod>${new Date(r.created_at).toISOString().slice(0, 10)}</lastmod><priority>0.7</priority></url>`)
      ];
      res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
    } catch (e) { next(e); }
  });

  return router;
}

// Nice-looking 404 / 500 pages for browsers; JSON for API callers.
function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/') || !req.accepts(['html', 'json'])?.startsWith('html')) {
    return res.status(404).json({ error: 'not_found' });
  }
  const html = readPage('404.html');
  if (html === null) return res.status(404).send('Not found');
  res.status(404).type('html').send(fill(html, baseVars(req.path)));
}

function errorPage(req, res) {
  const html = readPage('500.html');
  if (html === null) return res.status(500).send('Something went wrong');
  res.status(500).type('html').send(fill(html, baseVars(req.path)));
}

module.exports = { pageRoutes, seoRoutes, notFoundHandler, errorPage };
