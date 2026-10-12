// Moving between pages and within them: cross-document view transitions (the header and footer stay, the content fades and rises;
// nothing moves with reduced motion; a light fade where the browser has no view transitions), the speculation rules that fetch the next
// page ahead (never the API, the admin panel, payments or links that change something), page views counted only for pages really
// opened, and the answers and dialog that open and close smoothly.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resetDatabase, startServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

describe('page transitions', () => {
  test('cross-document view transitions: the header and footer stay still, the content fades out (0.12s) and in, rising 10px (0.22s)', () => {
    const s = read('public/css/style.css');
    assert.match(s, /@view-transition \{ navigation: auto; \}/);
    assert.match(s, /#siteHeader \{ view-transition-name: site-header; \}/);
    assert.match(s, /\.footer \{ view-transition-name: site-footer; \}/);
    assert.match(s, /::view-transition-old\(site-header\), ::view-transition-old\(site-footer\) \{ display: none; \}/);
    assert.match(s, /::view-transition-old\(root\) \{ animation: page-out 0\.12s ease-in both; \}/);
    assert.match(s, /::view-transition-new\(root\) \{ animation: page-in 0\.22s var\(--ease-out\) both; \}/);
    assert.match(s, /@keyframes page-in \{ from \{ opacity: 0; transform: translateY\(10px\); \} \}/);
  });

  test('reduced motion: an instant switch; no view transitions: a light fade of the content on load only (from 35%, never blank)', () => {
    const s = read('public/css/style.css');
    assert.match(s, /@media \(prefers-reduced-motion: reduce\) \{\n  @view-transition \{ navigation: none; \}\n  ::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{ animation: none !important; \}/);
    assert.match(s, /@keyframes page-fade \{ from \{ opacity: 0\.35; \} \}\nhtml\.motion\.page-fade #main \{ animation: page-fade 0\.2s var\(--ease-out\); \}/);
    assert.match(read('public/js/theme-init.js'), /if \(!calm && !\('CSSViewTransitionRule' in window\)\) root\.classList\.add\('page-fade'\);/);
  });

  test('the home page\'s answers fade in and out (0.2s), the FAQ page\'s and the confirmation dialog too, all only with motion', () => {
    const home = read('public/css/home.css');
    assert.match(home, /html\.motion \.faq-a:not\(\[hidden\]\) \{ animation: faq-open 0\.2s var\(--ease-out\); \}/);
    assert.match(home, /html\.motion \.faq-a\.is-closing \{ animation: faq-close 0\.16s ease-in forwards; \}/);
    assert.match(read('public/js/home.js'), /panel\.classList\.add\('is-closing'\);\n\s*setTimeout\(\(\) => \{/);
    const s = read('public/css/style.css');
    assert.match(s, /html\.motion details\.faq-item::details-content \{ height: 0; opacity: 0;[^}]*transition: height 0\.2s/);
    assert.match(s, /@starting-style \{\n  html\.motion \.wc-dialog\[open\] \{ opacity: 0; transform: translateY\(8px\) scale\(0\.98\); \}/);
  });
});

describe('speculation rules and page views', () => {
  const { RULES, HEADER } = require('../server/speculation');
  const analytics = require('../server/analytics');

  test('prefetch: links to this site\'s pages on hover or press; never the API, admin, payments, or links that change something', () => {
    assert.equal(HEADER, '"/speculation-rules.json"');
    const [rule] = RULES.prefetch;
    assert.equal(rule.eagerness, 'moderate');
    assert.deepEqual(rule.where.and[0], { href_matches: '/*' });
    const not = rule.where.and[1].not.selector_matches;
    for (const s of ['/api/', '/admin', '/mock-', 'unsubscribe', 'unfollow', 'verify-email', 'reset-password', 'live-room', 'logout', 'token=', 'status=', 'booking=']) {
      assert.ok(not.includes(`a[href*="${s}"]`), s);
    }
    assert.match(not, /\[target="_blank"\]/);
  });

  test('prerender: only the most common next pages (home and Browse experts, a mentor\'s profile, Sign up), and never the excluded links', () => {
    const [rule] = RULES.prerender;
    assert.deepEqual(rule.where.and[0].href_matches, ['/', '/index.html', '/index.html#*', '/ka/', '/ka/index.html', '/ka/index.html#*', '/u/*', '/ka/u/*', '/signup.html', '/ka/signup.html']);
    assert.equal(rule.where.and[1].not.selector_matches, RULES.prefetch[0].where.and[1].not.selector_matches);
  });

  test('a page fetched ahead is not counted when it is fetched; a page reports itself (a plain path of this site only)', () => {
    const req = (purpose) => ({ get: (h) => (h === 'sec-purpose' ? purpose : undefined) });
    assert.equal(analytics.ahead(req('prefetch')), true);
    assert.equal(analytics.ahead(req('prefetch;prerender')), true);
    assert.equal(analytics.ahead(req(undefined)), false);
    assert.match(read('public/js/motion.js'), /nav\.deliveryType === 'navigational-prefetch' \|\| nav\.activationStart > 0/);
    assert.match(read('public/js/motion.js'), /if \(document\.prerendering\) document\.addEventListener\('prerenderingchange', countIfAhead, \{ once: true \}\);/);
  });

  describe('on a running server', () => {
    let srv;
    before(async () => { await resetDatabase(); srv = await startServer(4733); });
    after(() => srv && srv.proc.kill());

    test('every page names the rules; the rules are served as speculation rules; the API answers carry no rules', async () => {
      for (const p of ['/', '/ka/', '/faq.html', '/become-a-mentor.html', '/no-such-page']) {
        assert.equal((await fetch(srv.base + p)).headers.get('speculation-rules'), '"/speculation-rules.json"', p);
      }
      const r = await fetch(srv.base + '/speculation-rules.json');
      assert.match(r.headers.get('content-type'), /^application\/speculationrules\+json/);
      assert.deepEqual(await r.json(), RULES);
      assert.equal((await fetch(srv.base + '/api/config')).headers.get('speculation-rules'), null);
    });

    test('a page that was fetched ahead reports itself (204); the request needs the site\'s own header like every other', async () => {
      const post = (headers) => fetch(srv.base + '/api/stats/pageview', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ path: '/u/someone' }) });
      assert.equal((await post({ 'X-Requested-With': 'wisecall' })).status, 204);
      assert.equal((await post({})).status, 403);
    });
  });
});
