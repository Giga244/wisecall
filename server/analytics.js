// Privacy-friendly visitor statistics with Plausible (https://plausible.io): no cookies, no script in the pages (so the Content-Security-
// Policy stays strict), nothing personal. The server itself tells Plausible about a page view or an event; Plausible counts unique
// visitors from a daily-changing hash of the address and browser it is given, and does not keep the address. Off while PLAUSIBLE_DOMAIN
// is empty. A visitor whose browser asks not to be tracked (Do Not Track or Global Privacy Control) is not counted.
//   pageview                           every public page that is sent (not the admin pages), or that the browser had fetched ahead
//                                      and then opened (counted then, not when it was fetched)
//   signup, mentor_application_started, mentor_application_submitted, waitlist_join, question_paid, question_free
// Only the page's path is sent, never its query (a reset link carries a token), and events carry no personal data at all.
const config = require('./config');

const TIMEOUT_MS = 2000;
let warned = false;

const enabled = () => Boolean(config.PLAUSIBLE_DOMAIN);
const optedOut = (req) => Boolean(req && (req.get('dnt') === '1' || req.get('sec-gpc') === '1'));

function send(name, { path = '/', req = null, props } = {}) {
  if (!enabled() || optedOut(req)) return Promise.resolve(false);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': (req && req.get('user-agent')) || 'Wisecall server' };
  if (req && req.ip) headers['X-Forwarded-For'] = req.ip;
  const body = { name, domain: config.PLAUSIBLE_DOMAIN, url: config.PUBLIC_URL + String(path).split('?')[0], ...(props ? { props } : {}) };
  const referrer = req && req.get('referer');
  if (referrer && !referrer.startsWith(config.PUBLIC_URL)) body.referrer = referrer.split('?')[0];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(config.PLAUSIBLE_API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    .then((r) => r.ok)
    .catch((e) => { if (!warned) { warned = true; console.warn('[analytics] Plausible did not answer:', e.message); } return false; })
    .finally(() => clearTimeout(timer));
}

// A page fetched ahead by the browser (speculation rules: on hover, or prepared for a likely next click) is not a visit yet; the page
// counts itself when somebody really opens it (pageviewOf below, called by public/js/motion.js).
const ahead = (req) => /prefetch|prerender/i.test((req && (req.get('sec-purpose') || req.get('purpose'))) || '');

// A page was sent to a browser.
function pageview(req) {
  const p = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  if (/^\/(ka\/)?admin/.test(p) || ahead(req)) return Promise.resolve(false);
  return send('pageview', { path: p, req });
}

// A page that was fetched ahead was opened: its path as the page reports it (only a plain path of this site).
function pageviewOf(req, path) {
  const p = String(path || '');
  if (!/^\/[\w\-./]{0,200}$/.test(p) || p.includes('..') || /^\/(ka\/)?(admin|api)/.test(p)) return Promise.resolve(false);
  return send('pageview', { path: p, req });
}

// Something happened. `req` (when there is one) is only used to count the visitor; `props` must never hold personal data.
const event = (name, req, props) => send(name, { path: req ? (req.originalUrl || '/').split('?')[0] : '/', req, props });

module.exports = { enabled, pageview, pageviewOf, ahead, event };
