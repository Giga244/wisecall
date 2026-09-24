const buckets = new Map();

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
    if (hit.count > max) {
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