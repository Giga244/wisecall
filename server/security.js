// Security headers, CSRF protection and request logging.
const config = require('./config');

// Scripts may only come from our own files (no inline scripts, no eval), and Cloudflare's "are you a person?" check when it is on. Styles allow inline
// attributes. Fonts are served from this site. Nothing else can load or embed anything.
function buildCsp({ frameSrc, frameAncestors, mediaSrc } = {}) {
  const frames = [...(config.TURNSTILE_ENABLED ? ['https://challenges.cloudflare.com'] : []), ...(frameSrc ? [frameSrc] : [])];
  return [
  "default-src 'self'",
  "script-src 'self'" + (config.TURNSTILE_ENABLED ? ' https://challenges.cloudflare.com' : ''),
  ...(frames.length ? ['frame-src ' + frames.join(' ')] : []),
  ...(mediaSrc ? ["media-src 'self' " + mediaSrc] : []),
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "manifest-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors " + (frameAncestors || "'none'"),
  "base-uri 'self'",
  "object-src 'none'",
  ...(config.IS_PROD ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}
const CSP = buildCsp();
// The live-session room (server/pages.js) is the only page that may frame the video provider's call; the replay page the only one that
// may play the provider's video file (or, with the fake provider, frame its page).
const cspWith = ({ frameSrc, frameAncestors, mediaSrc }) => buildCsp({ frameSrc, frameAncestors, mediaSrc });

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  if (config.IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// CSRF protection for anything that changes data. The login cookie is SameSite=Lax already;
// on top of that every state-changing API request must (1) carry our custom header, which a
// browser will not let another website add without our permission, and (2) if it names an
// Origin, that Origin must be this site.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'wisecall') return res.status(403).json({ error: 'csrf_blocked' });
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch (e) { /* malformed */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'csrf_blocked' });
  }
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'csrf_blocked' });
  next();
}

// One line per request: method, path (never the query string, which can hold tokens), status, time.
function requestLogger(req, res, next) {
  if (req.path === '/healthz') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (res.statusCode < 400 && /\.(css|js|svg|png|ico|json|woff2?)$/.test(req.path)) return; // skip asset noise
    console.log(`[req] ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
}

module.exports = { securityHeaders, csrfGuard, requestLogger, cspWith, CSP };
