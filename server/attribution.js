// Where visitors come from (PART 9). On the first visit to a page a first-party cookie (wc_src, 30 days) keeps ONLY utm_source /
// utm_medium / utm_campaign, the referring site's DOMAIN and the path of the page they landed on: no full address, nothing about the
// person, no third party. It is copied onto the account at sign-up (email or Google), onto each question when it is started (the first paid
// one is what the admin overview counts) and onto a mentor application.
//   - A Facebook or Instagram visit counts as one without utm_* tags: an fbclid in the address (the ad's click id: the value is never kept)
//     or a referrer from facebook.com / instagram.com (m., l. and the rest): source "facebook" or "instagram".
//   - A visit with none of these is "direct", so an account says "direct" when the person came straight in and nothing (null) only when
//     it is unknown (a browser that asks not to be tracked, Do Not Track or Global Privacy Control, gets no cookie; cookies cleared).
//   - The first source counts and a later one does not replace it, except a first visit that was "direct": the next real source does.
const config = require('./config');

const COOKIE = 'wc_src';
const MAX_AGE_MS = 30 * 86400 * 1000;
const FIELDS = ['source', 'medium', 'campaign'];
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
// Facebook and Instagram, from the referring domain (facebook.com, m.facebook.com, l.facebook.com, instagram.com, l.instagram.com, ...).
const socialOf = (ref) => (!ref ? null : /(^|\.)facebook\.com$/.test(ref) ? 'facebook' : /(^|\.)instagram\.com$/.test(ref) ? 'instagram' : /(^|\.)tiktok\.com$/.test(ref) ? 'tiktok' : null);
// The page they landed on: its path only (the Georgian /ka/... included), never the query.
const landingOf = (p) => (typeof p === 'string' && /^\/[A-Za-z0-9._~/-]{0,99}$/.test(p) ? p : null);

// Where this visit comes from: { source?, medium?, campaign?, referrer?, landing }. Always something: "direct" when there is nothing else.
function fromRequest(req) {
  const q = req.query || {};
  const out = {};
  for (const f of FIELDS) { const v = clip(q['utm_' + f]); if (v) out[f] = v; }
  let ref = null;
  try { ref = domain(new URL(req.get('referer') || '').hostname); } catch (e) { ref = null; }
  if (ref && (ownHosts().has(ref) || ref === domain(req.hostname))) ref = null; // (a page of this site is not a source)
  if (ref) out.referrer = ref;
  // (Facebook and Instagram without tags: the fbclid only says it was them, its value is never kept)
  // (?ref=tiktok, ?ref=instagram ...: the short tag in a bio link or a post; utm_source wins when both are there)
  if (!out.source && clip(q.ref)) out.source = clip(q.ref).toLowerCase();
  if (!out.source) out.source = socialOf(ref) || (q.fbclid ? 'facebook' : undefined);
  if (!out.source && !out.referrer && !out.medium && !out.campaign) out.source = 'direct';
  if (!out.source) delete out.source;
  const landing = landingOf(req.path);
  if (landing) out.landing = landing;
  return out;
}

// Middleware for page requests: sets the cookie on the first visit (and replaces a "direct" one when a real source comes later).
function capture(req, res, next) {
  if (!config.ATTRIBUTION_COOKIE || req.method !== 'GET' || req.path.startsWith('/api/') || !isPage(req.path) || optedOut(req)) return next();
  if (INVITE_PATH.test(req.path)) return next(); // (the invite link sets its own: markInvite)
  const had = req.cookies && req.cookies[COOKIE] ? read(req) : null;
  if (had && had.source !== 'direct') return next();
  const src = fromRequest(req);
  if (had && src.source === 'direct') return next();
  res.cookie(COOKIE, Buffer.from(JSON.stringify(src)).toString('base64url'), {
    maxAge: MAX_AGE_MS, httpOnly: true, sameSite: 'lax', secure: config.IS_PROD, path: '/'
  });
  next();
}

// The invite link for mentors we contact (/mentor, /ka/mentor: docs/CLAUDE-CODE-MENTOR-SIGNUP.md #4): a sign-up through it says source
// "invite", whatever came before (utm tags on the link, e.g. a campaign, are kept). Not for a browser that asks not to be tracked.
const INVITE_PATH = /^\/(ka\/)?mentor\/?$/;
function markInvite(req, res) {
  if (!config.ATTRIBUTION_COOKIE || optedOut(req)) return;
  const src = { ...fromRequest(req), source: 'invite' };
  const landing = landingOf(String(req.originalUrl || '').split('?')[0].replace(/\/$/, ''));
  if (landing) src.landing = landing;
  res.cookie(COOKIE, Buffer.from(JSON.stringify(src)).toString('base64url'), { maxAge: MAX_AGE_MS, httpOnly: true, sameSite: 'lax', secure: config.IS_PROD, path: '/' });
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
  const landing = landingOf(v.landing);
  if (landing) out.landing = landing;
  return out;
}

// Sign-ups per source, counts only (the admin overview): the campaign source, else the referring site, "direct", or "unknown" (no cookie).
async function signupsBySource() {
  const { query } = require('./db');
  const { rows } = await query(
    `SELECT COALESCE(signup_source->>'source', CASE WHEN signup_source ? 'referrer' THEN 'site: ' || (signup_source->>'referrer') END, 'unknown') AS source,
            count(*)::int AS signups
       FROM users WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`);
  return rows;
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

module.exports = { COOKIE, capture, markInvite, read, fromRequest, bySource, signupsBySource, clip };
