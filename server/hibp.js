// "Has this password appeared in a data breach?" (Have I Been Pwned, k-anonymity): only the first 5 characters of the password's SHA-1
// are sent; the service answers with every known hash that starts with them, and the match is made here. The password never leaves
// the server. Off unless config.HIBP_CHECK; if the service is slow or down, the password is accepted (a sign-up must not depend on it).
const crypto = require('crypto');
const config = require('./config');

const TIMEOUT_MS = 2500;

// -> how many times the password was seen in breaches (0 = not found, or the check is off / did not answer).
async function breachCount(password) {
  if (!config.HIBP_CHECK || typeof password !== 'string' || !password) return 0;
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(config.HIBP_API_URL + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Wisecall' }, signal: ctrl.signal });
    if (!res.ok) return 0;
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0; // (padding lines have a count of 0)
    }
    return 0;
  } catch (e) {
    console.warn('[hibp] the breached-password check did not answer; the password is accepted:', e.message);
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { breachCount };
