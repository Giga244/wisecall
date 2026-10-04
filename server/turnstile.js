// Cloudflare Turnstile: the "are you a person?" check on the forms bots like (sign-up, login, forgot password, contact, the waiting
// list, "find me a mentor"). The page sends a token (turnstileToken in the body); the server asks Cloudflare once whether it is good (a
// token works only once). Off unless both keys are set (development and tests): then the pages load nothing and nothing is checked here.
// If Cloudflare cannot be reached the form is refused (503, "try again in a minute") rather than let through: see docs/DECISIONS.md.
const config = require('./config');

const TIMEOUT_MS = 8000;

// -> { ok: true } | { ok: false, code: 'human_check_failed' | 'human_check_unavailable' }
async function verify(token, ip) {
  if (!config.TURNSTILE_ENABLED) return { ok: true };
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, code: 'human_check_failed' };
  let res;
  try {
    res = await fetch(config.TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    console.error('[turnstile] could not reach Cloudflare:', e.message);
    return { ok: false, code: 'human_check_unavailable' };
  }
  if (!res.ok) {
    console.error('[turnstile] Cloudflare answered', res.status);
    return { ok: false, code: 'human_check_unavailable' };
  }
  const data = await res.json().catch(() => ({}));
  if (data.success === true) return { ok: true };
  const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
  // (a wrong secret key is our mistake, not the visitor's: it is logged, and the form says "try again later")
  if (codes.some((c) => /secret/.test(String(c)))) {
    console.error('[turnstile] the secret key was refused:', codes.join(', '));
    return { ok: false, code: 'human_check_unavailable' };
  }
  return { ok: false, code: 'human_check_failed' };
}

// Express middleware for one form: before the route, after its rate limit.
function requireHuman(req, res, next) {
  if (!config.TURNSTILE_ENABLED) return next();
  verify((req.body || {}).turnstileToken, req.ip).then((r) => {
    if (r.ok) return next();
    res.status(r.code === 'human_check_unavailable' ? 503 : 400).json({ error: r.code });
  }, next);
}

module.exports = { verify, requireHuman };
