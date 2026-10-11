// Error monitoring with Sentry (https://sentry.io), without its SDK: an error is sent as one small "envelope" to the project named by
// SENTRY_DSN. Off while SENTRY_DSN is empty. What is sent: the error's type, its message and stack with personal data removed (email
// addresses, IBANs, card-like and other long numbers, anything that looks like a token), the route pattern (never the real address with
// its ids or query), the HTTP method and status, the release and the environment. Never: the request body, headers, cookies, the IP
// address, the user or any database values.
const crypto = require('crypto');
const config = require('./config');

const TIMEOUT_MS = 3000;
const MAX_PER_MINUTE = 20; // (an error storm must not become a flood of reports)
let sentThisMinute = 0;
let minute = 0;

function parseDsn(dsn) {
  const m = /^(https?):\/\/([^:@/]+)@([^/]+)\/(\d+)$/.exec(String(dsn || '').trim());
  if (!m) return null;
  return { key: m[2], url: `${m[1]}://${m[3]}/api/${m[4]}/envelope/` };
}

// Removes what could identify a person from a text.
function scrub(text) {
  return String(text || '')
    .replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g, '[iban]')
    .replace(/\b\d(?:[ -]?\d){8,}\b/g, '[number]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .slice(0, 2000);
}

// Stack lines -> Sentry frames (oldest first), file paths relative to the app.
function frames(stack) {
  const root = require('path').join(__dirname, '..');
  return String(stack || '').split('\n').slice(1, 40).map((line) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m) return null;
    return { function: m[1] || '?', filename: m[2].replace(root, '').replace(/\\/g, '/'), lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node_modules|node:/.test(m[2]) };
  }).filter(Boolean).reverse();
}

// -> the event that would be sent (exported for the tests).
function buildEvent(err, { method, route, status } = {}) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    environment: config.IS_PROD ? 'production' : 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    exception: { values: [{ type: (err && err.name) || 'Error', value: scrub(err && err.message), stacktrace: { frames: frames(err && err.stack) } }] },
    tags: { ...(method ? { method } : {}), ...(route ? { route } : {}), ...(status ? { status: String(status) } : {}) }
  };
}

function report(err, context = {}) {
  const dsn = parseDsn(config.SENTRY_DSN);
  if (!dsn) return Promise.resolve(false);
  const now = Math.floor(Date.now() / 60000);
  if (now !== minute) { minute = now; sentThisMinute = 0; }
  if (++sentThisMinute > MAX_PER_MINUTE) return Promise.resolve(false);
  const event = buildEvent(err, context);
  const body = `${JSON.stringify({ event_id: event.event_id, sent_at: event.timestamp })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(dsn.url, {
    method: 'POST', body, signal: ctrl.signal,
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=wisecall/1.0` }
  }).then((r) => r.ok).catch(() => false).finally(() => clearTimeout(timer));
}

// The route of a request as a pattern ("/api/bookings/:id/answer"): ids, usernames, numbers and anything with an @ are replaced, and the
// query is dropped, so the real address (and who it was about) never leaves the server.
function routeOf(req) {
  if (!req) return undefined;
  return String(req.originalUrl || req.url || '').split('?')[0]
    .replace(/^\/ka(?=\/)/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/u\/[^/]+/, '/u/:username')
    .replace(/\/users\/[^/]+/, '/users/:username') // (the profile API: /api/users/<username>, its report; docs/REVIEW-2.md #10)
    .split('/').map((seg) => (/@|%40/.test(seg) ? ':x' : seg.replace(/\d{4,}/g, ':n'))).join('/')
    .slice(0, 200);
}

module.exports = { report, buildEvent, scrub, parseDsn, routeOf };
