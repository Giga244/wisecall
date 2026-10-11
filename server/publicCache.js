// The public lists every home page view asks for (/api/config, /api/experts, /api/live, /api/answers) are the same for every visitor
// who is not signed in: their JSON is kept for PUBLIC_CACHE_SECONDS (30 in production, 0 = off elsewhere) and sent with
// "Cache-Control: public, max-age" so browsers and the CDN can keep it too (docs/TODO-REHEARSAL.md R-5). Signed-in requests, other
// methods and anything but a 200 are never cached.
const config = require('./config');
const { COOKIE_NAME } = require('./auth');

const SECONDS = process.env.PUBLIC_CACHE_SECONDS !== undefined && process.env.PUBLIC_CACHE_SECONDS !== ''
  ? Math.max(0, Number(process.env.PUBLIC_CACHE_SECONDS) || 0) : (config.IS_PROD ? 30 : 0);
const MAX_KEYS = 1000;
const cache = new Map(); // address -> { body, until }

function publicCache() {
  return (req, res, next) => {
    if (!SECONDS || req.method !== 'GET' || (req.cookies && req.cookies[COOKIE_NAME])) return next();
    const key = req.originalUrl;
    const hit = cache.get(key);
    res.set('Cache-Control', `public, max-age=${SECONDS}`);
    res.set('Vary', 'Cookie');
    if (hit && Date.now() < hit.until) return res.type('json').send(hit.body);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (cache.size >= MAX_KEYS) cache.clear();
        cache.set(key, { body: JSON.stringify(body), until: Date.now() + SECONDS * 1000 });
      }
      return json(body);
    };
    next();
  };
}
// (an admin changed what the lists show, e.g. the fields: start afresh)
const clear = () => cache.clear();

module.exports = { publicCache, clear, SECONDS };
