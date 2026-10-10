// Live sessions switched off (LIVE_SESSIONS=off, the default in production): the feature does not exist for users. Its pages
// (/live, /live/<slug>, the room, series, replays, /live-*.html, the unfollow page, also under /ka) and its API (/api/live..., the
// cover pictures and share images) answer "not found", exactly like an address that never existed. The code and the data stay;
// LIVE_SESSIONS=on brings everything back. Admins keep a read-only Live tab (server/routes/admin.js refuses its actions).
const config = require('../config');

const PAGE = /^\/(ka\/)?(?:live(?:\/|$)|live-[\w-]+\.html$|unfollow\.html$)/;
const API = /^\/api\/live(?:-covers|-share)?(?:\/|$)/;

const enabled = () => config.LIVE_ENABLED;

function gate(req, res, next) {
  if (enabled()) return next();
  if (API.test(req.path)) return res.status(404).json({ error: 'not_found' });
  const page = PAGE.exec(req.path);
  if (!page) return next();
  if (page[1]) res.locals.pageLang = 'ka';
  return require('../pages').notFoundHandler(req, res);
}

// The parts of a static page that only make sense with live sessions sit between <!-- live --> and <!-- /live --> (the home page's
// section, the dashboard's tab and its script): with the feature off they are taken out before the page is sent.
const stripLive = (html) => (enabled() ? html : html.replace(/[ \t]*<!-- live -->[\s\S]*?<!-- \/live -->[ \t]*(\r?\n)?/g, ''));

module.exports = { gate, enabled, stripLive, PAGE, API };
