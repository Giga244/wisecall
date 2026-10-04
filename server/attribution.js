// Where visitors come from (PART 9). On the first visit to a page with utm_* parameters, or from another website, a first-party cookie
// (wc_src, 30 days) keeps utm_source / utm_medium / utm_campaign / utm_content and the referring site's DOMAIN only: no address, no
// path, nothing about the person, no third party. The first visit counts (a later campaign does not replace it). It is copied onto the
// account at sign-up, onto each question when it is started (the first paid one is what the admin overview counts) and onto a mentor
// application. A browser that asks not to be tracked (Do Not Track or Global Privacy Control) gets no cookie.
const config = require('./config');

const COOKIE = 'wc_src';
const MAX_AGE_MS = 30 * 86400 * 1000;
const FIELDS = ['source', 'medium', 'campaign', 'content'];
// (letters, digits, spaces and . _ - + : only, 60 characters: a campaign name, never an address or an email)
const clip = (v) => {
  const s = String(v === undefined || v === null ? '' : v).normalize('NFC').replace(/[^\p{L}\p{N} ._+:-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || null;
};
const domain = (v) => {
  const s = String(v || '').toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9.-]{1,100}$/.test(s) && s.includes('.') ? s : null;
};
const ownHosts = () => {
  const out = new Set(['localhost', '127.0.0.1']);
  try { out.add(new URL(config.PUBLIC_URL).hostname.replace(/^www\./, '')); } catch (e) { /* not a URL */ }
  return out;
};
const optedOut = (req) => req.get('dnt') === '1' || req.get('sec-gpc') === '1';
const isPage = (p) => p === '/' || /\.html$/.test(p) || !/\.[a-z0-9]+$/i.test(p);

// The campaign and the referring domain of this request, or null when there is neither.
function fromRequest(req) {
  const q = req.query || {};
  const out = {};
  for (const f of FIELDS) { const v = clip(q['utm_' + f]); if (v) out[f] = v; }
  let ref = null;
  try { ref = domain(new URL(req.get('referer') || '').hostname); } catch (e) { ref = null; }
  if (ref && !ownHosts().has(ref) && ref !== domain(req.hostname)) out.referrer = ref;
  if (!Object.keys(out).length) return null;
  out.at = new Date().toISOString().slice(0, 10);
  return out;
}

// Middleware for page requests: sets the cookie once.
function capture(req, res, next) {
  if (!config.ATTRIBUTION_COOKIE || req.method !== 'GET' || req.path.startsWith('/api/') || !isPage(req.path) || (req.cookies && req.cookies[COOKIE]) || optedOut(req)) return next();
  const src = fromRequest(req);
  if (src) {
    res.cookie(COOKIE, Buffer.from(JSON.stringify(src)).toString('base64url'), {
      maxAge: MAX_AGE_MS, httpOnly: true, sameSite: 'lax', secure: config.IS_PROD, path: '/'
    });
  }
  next();
}

// What the cookie says (checked again: the cookie is the visitor's own), or null.
function read(req) {
  const raw = req.cookies && req.cookies[COOKIE];
  if (!raw || raw.length > 1000) return null;
  let v;
  try { v = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const f of FIELDS) { const c = clip(v[f]); if (c) out[f] = c; }
  const ref = domain(v.referrer);
  if (ref) out.referrer = ref;
  if (!Object.keys(out).length) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v.at || ''))) out.at = v.at;
  return out;
}

// Per source and campaign: sign-ups, mentor applications and first paid questions (for the admin overview).
async function bySource() {
  const { query } = require('./db');
  const { rows } = await query(
    `WITH s AS (
       SELECT signup_source AS src, 'signup' AS kind FROM users WHERE signup_source IS NOT NULL AND deleted_at IS NULL
       UNION ALL
       SELECT application_source, 'application' FROM users WHERE application_source IS NOT NULL
       UNION ALL
       SELECT src, 'paid' FROM (SELECT DISTINCT ON (seeker_id) source AS src FROM bookings WHERE paid_at IS NOT NULL ORDER BY seeker_id, paid_at) f
        WHERE src IS NOT NULL)
     SELECT COALESCE(src->>'source', CASE WHEN src ? 'referrer' THEN 'site: ' || (src->>'referrer') END, '-') AS source,
            COALESCE(src->>'campaign', '') AS campaign,
            count(*) FILTER (WHERE kind = 'signup')::int AS signups,
            count(*) FILTER (WHERE kind = 'application')::int AS applications,
            count(*) FILTER (WHERE kind = 'paid')::int AS paid
       FROM s GROUP BY 1, 2 ORDER BY 3 DESC, 5 DESC, 1 LIMIT 40`);
  return rows;
}

module.exports = { COOKIE, capture, read, fromRequest, bySource, clip };
