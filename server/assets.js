// Cache busting. Every stylesheet, script, logo, icon and font is asked for as  /js/app.js?v=<hash of the file's content>, so an update
// shows at once (a changed file has a new address) while an unchanged one is kept by the browser for a year. The addresses are written
// into the pages, styles, scripts and the web app manifest when they are sent, so nothing has to be edited by hand or built ahead.
//
//   HTML                          no-cache (always asked again; the answer is a small 304 when nothing changed)
//   /x.ext?v=<current hash>       public, max-age=1 year, immutable
//   the manifest, favicon.ico     1 day (browsers ask for them by themselves, without a version)
//   any other address of a file   1 day, or no-cache when the ?v= is not the current one
//   the language dictionaries     no-cache (they change with every release)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const PUBLIC = path.join(__dirname, '..', 'public');
const YEAR = 31536000;
const DAY = 86400;

// What is versioned: files under these folders, and these files at the root. (The lookbehind keeps "public/js/x" in a comment and
// "https://site/css/x" alone: the address must not continue a longer path.)
const REF = /(?<![\w.\-/])(?:\/(?:css|js|brand|fonts)\/[\w.\-/]+|\/(?:favicon\.svg|favicon\.ico|apple-touch-icon\.png|icon-[\w-]+\.png|og-image[\w-]*\.png|site\.webmanifest))/g;
const FILE_TYPES = /\.(css|js|svg|png|jpe?g|webp|woff2|ico|webmanifest)$/i;
const TEXT_TYPES = /\.(css|js|webmanifest)$/i;

const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 10);
const inside = (file) => file.startsWith(PUBLIC + path.sep);

// Text files carry addresses of other files (a stylesheet its fonts, a script the logo), so their content is rewritten before it is hashed
// or sent: a font that changes changes the stylesheet's version too. Cached for good in production, where files never change under a
// running server; checked against the file's date in development.
const memo = new Map(); // "/js/app.js" -> { sig, body, v }
function render(urlPath, seen) {
  const file = path.join(PUBLIC, urlPath);
  if (!inside(file)) return null;
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return null; }
  if (!stat.isFile()) return null;
  const hit = memo.get(urlPath);
  const sig = `${stat.mtimeMs}:${stat.size}`;
  // (a text file also depends on the files it names, which the date of the file itself does not show: in development it is redone)
  if (hit && (config.IS_PROD || (hit.sig === sig && !TEXT_TYPES.test(urlPath)))) return hit;
  let body = null;
  let v;
  if (TEXT_TYPES.test(urlPath)) {
    if (seen && seen.has(urlPath)) return { body: null, v: null }; // two files that name each other: leave the address as it is
    body = rewrite(fs.readFileSync(file, 'utf8'), new Set([...(seen || []), urlPath]));
    v = hash(body);
  } else {
    v = hash(fs.readFileSync(file));
  }
  const made = { sig, body, v };
  memo.set(urlPath, made);
  return made;
}

// The version of one file, or null when there is no such file.
function versionOf(urlPath, seen) {
  const r = FILE_TYPES.test(urlPath) ? render(urlPath, seen) : null;
  return r ? r.v : null;
}

// Adds ?v=<hash> to every address of a versioned file in a page, script, stylesheet or manifest.
function rewrite(text, seen) {
  return String(text).replace(REF, (match, offset, whole) => {
    if (whole[offset + match.length] === '?') return match; // it already has a query
    const trailing = (match.match(/[.\-/]+$/) || [''])[0]; // punctuation after the address in a sentence
    const address = trailing ? match.slice(0, -trailing.length) : match;
    const v = versionOf(address, seen);
    return v ? `${address}?v=${v}${trailing}` : match;
  });
}

// Serves the stylesheets, scripts and the manifest with their addresses rewritten.
function serveText(req, res, next) {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !/^\/(?:css\/[\w.-]+\.css|js\/[\w.-]+\.js|site\.webmanifest)$/.test(req.path)) return next();
  const made = render(req.path);
  if (!made || made.body === null) return next();
  const isManifest = req.path === '/site.webmanifest';
  const isAdminFile = /^\/js\/admin/.test(req.path); // (behind the admin check in adminAuth.js: never kept by a shared cache)
  res.set('ETag', `"${made.v}"`);
  if (isManifest) res.set('Cache-Control', `public, max-age=${DAY}`);
  else if (isAdminFile) res.set('Cache-Control', 'private, no-cache');
  else if (req.query.v === made.v) res.set('Cache-Control', `public, max-age=${YEAR}, immutable`);
  else res.set('Cache-Control', 'no-cache');
  if (req.fresh) return void res.status(304).end();
  res.type(isManifest ? 'application/manifest+json' : path.extname(req.path)).send(made.body);
}

// The headers of the files sent as they are (pictures, icons, fonts, dictionaries).
function staticHeaders(res, file) {
  const url = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
  const asked = res.req && res.req.query && res.req.query.v;
  if (url === '/favicon.ico') res.set('Cache-Control', `public, max-age=${DAY}`);
  else if (/\.json$/i.test(url)) res.set('Cache-Control', 'no-cache');
  else if (asked) res.set('Cache-Control', asked === versionOf(url) ? `public, max-age=${YEAR}, immutable` : 'no-cache');
  else res.set('Cache-Control', `public, max-age=${DAY}`);
}

module.exports = { rewrite, versionOf, serveText, staticHeaders };
