const config = require('./config');

const buckets = new Map();
// Development and test runs that create many accounts from one address can raise the limits (RATE_LIMIT_MULTIPLIER=20).
// It is ignored in production.
const MULTIPLIER = config.IS_PROD ? 1 : Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1);

// Tiny in-memory limiter: at most `max` requests per `windowMs` per IP per route.
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const hit = buckets.get(key);
    if (!hit || now > hit.reset) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    hit.count += 1;
    if (hit.count > max * MULTIPLIER) {
      res.set('Retry-After', String(Math.ceil((hit.reset - now) / 1000)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { rateLimit };