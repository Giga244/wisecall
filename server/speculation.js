// Speculation rules: the browser fetches a page a moment before it is opened, so moving around feels instant. Sent as an HTTP
// header (Speculation-Rules) that points to /speculation-rules.json, so the pages need no inline script (the content-security policy
// stays strict). Browsers without speculation rules ignore it.
//   prefetch   every link to a page of this site, when the pointer rests on it or presses it ("moderate"), except anything that
//              is not a plain page: the API, the admin panel, the mock bank, links that unsubscribe or unfollow, verify or reset
//              (they carry a token), the live room, and links with a token, a status or a booking in them (a bank's answer)
//   prerender  only the most common next pages, the same way: the home page and Browse experts, a mentor's profile, Sign up
// Neither is counted as a page view when it is fetched (server/analytics.js); public/js/motion.js counts it when it is opened.
const NOT_A_PAGE = [
  'a[href*="/api/"]', 'a[href*="/admin"]', 'a[href*="/mock-"]', 'a[href*="unsubscribe"]', 'a[href*="unfollow"]', 'a[href*="verify-email"]',
  'a[href*="reset-password"]', 'a[href*="live-room"]', 'a[href*="live-claim"]', 'a[href*="logout"]',
  'a[href*="token="]', 'a[href*="status="]', 'a[href*="booking="]', 'a[href*="code="]',
  '[target="_blank"]', '[download]', '[rel~="nofollow"]', '[data-no-prefetch]'
].join(', ');

const RULES = {
  prefetch: [{
    source: 'document',
    where: { and: [{ href_matches: '/*' }, { not: { selector_matches: NOT_A_PAGE } }] },
    eagerness: 'moderate'
  }],
  prerender: [{
    source: 'document',
    where: { and: [
      { href_matches: ['/', '/index.html', '/index.html#*', '/ka/', '/ka/index.html', '/ka/index.html#*', '/u/*', '/ka/u/*', '/signup.html', '/ka/signup.html'] },
      { not: { selector_matches: NOT_A_PAGE } }
    ] },
    eagerness: 'moderate'
  }]
};

module.exports = { RULES, HEADER: '"/speculation-rules.json"' };
