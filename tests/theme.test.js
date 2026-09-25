// The dark theme: every colour is a token, every pair of tokens is readable, the theme is set before the page paints, the choice is kept
// on the account, and every text is in English and Georgian.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified } = require('./helpers');
const contrast = require('../scripts/check-contrast');
const colors = require('../scripts/check-colors');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let srv, base;
before(async () => { await resetDatabase(); srv = await startServer(4605); base = srv.base; });
after(() => { if (srv) srv.proc.kill(); });

describe('colours are tokens', () => {
  test('no colour is written into a stylesheet, a script that builds HTML, or a page (only the tokens have hex values)', () => {
    assert.deepEqual(colors.find().map((f) => `${f.file}:${f.line} ${f.colors.join(' ')}`), []);
  });

  test('the dark palette redefines the tokens (deep violet surfaces, the same coral and mint), with color-scheme for native controls', () => {
    const css = read('public/css/style.css');
    const { light, dark } = contrast.load();
    assert.match(css, /:root \{[^}]*color-scheme: light;/s);
    assert.match(css, /\[data-theme="dark"\] \{[^}]*color-scheme: dark;/s);
    for (const [token, value] of [['--bg', '#15131f'], ['--card', '#1f1c2e'], ['--raised', '#29253b'], ['--border', '#34304a'], ['--ink', '#f3f1fa'], ['--ink-soft', '#b7b3c8'], ['--accent', '#ff7a66'], ['--navy', '#0f0d18'], ['--mint-soft', '#1e3a33'], ['--sun-soft', '#6b5a1e']]) {
      assert.equal(dark[token], value, `dark ${token}`);
    }
    assert.equal(light['--bg'], '#eaf6f1');
    assert.equal(light['--accent'], '#ff6f59');
    // the tokens that make the two themes different are really different
    const mustDiffer = ['--bg', '--card', '--raised', '--field', '--border', '--ink', '--ink-soft', '--navy', '--inverse', '--on-inverse', '--mint-soft', '--sun-soft', '--sun-ink', '--pink-soft', '--lav-soft', '--gray-soft', '--skeleton-a', '--blob-peach', '--on-accent', '--accent-text', '--red-strong'];
    for (const k of mustDiffer) assert.notEqual(light[k], dark[k], `${k} is the same in both themes`);
  });

  test('every text and background pair meets WCAG AA in both themes (4.5:1 for text, 3:1 for outlines)', () => {
    const { failures, rows } = contrast.check();
    assert.deepEqual(failures.map((f) => `${f.theme}: ${f.fg} on ${f.bg} = ${Number.isNaN(f.got) ? f.note : f.got.toFixed(2)} (needs ${f.min}): ${f.what}`), []);
    assert.ok(rows.length >= 80);
  });

  test('the theme fade is short, only touches colours, and is switched off for reduced motion', () => {
    const css = read('public/css/style.css');
    assert.match(css, /html\.theme-switching[^{]*\{\s*transition: background-color 0\.25s ease, color 0\.25s ease, border-color 0\.25s ease, fill 0\.25s ease, stroke 0\.25s ease !important;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\* \{ animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/);
  });
});

describe('the theme is set before the page paints', () => {
  test('every page loads /js/theme-init.js in the <head>, as a plain external script (no defer, no async), with the two theme-color tags', async () => {
    const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && !/^(403|404|500)\.html$/.test(f));
    for (const f of [...pages, '404.html']) {
      const html = await (await fetch(base + (f === 'index.html' ? '/' : f === '404.html' ? '/nope-nothing-here' : `/${f}`), { headers: { Accept: 'text/html' } })).text();
      const head = html.slice(0, html.indexOf('</head>'));
      assert.match(head, /<script src="\/js\/theme-init\.js\?v=[0-9a-f]{10}"><\/script>/, `${f}: theme-init.js is in the head, not deferred`);
      assert.match(head, /<meta name="color-scheme" content="light dark">/, f);
      assert.match(head, /<meta name="theme-color" content="#F4FBF8" media="\(prefers-color-scheme: light\)">/, f);
      assert.match(head, /<meta name="theme-color" content="#15131F" media="\(prefers-color-scheme: dark\)">/, f);
      assert.ok(head.indexOf('theme-init.js') < html.indexOf('<body'), `${f}: before anything is drawn`);
    }
  });

  test('the script follows the device by default, remembers a choice safely, and uses no inline code (the content-security policy is unchanged)', async () => {
    const js = read('public/js/theme-init.js');
    assert.match(js, /prefers-color-scheme: dark/);
    assert.match(js, /try \{ var v = localStorage\.getItem\(KEY\)/, 'reading storage is wrapped in try/catch');
    assert.match(js, /try \{ localStorage\.setItem\(KEY, pref\); \}/, 'writing storage is wrapped in try/catch');
    assert.match(js, /'wisecall_theme'/);
    assert.match(js, /media\.addEventListener\('change', follow\)/, 'System mode follows the device live');
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline.*script|script-src[^;]*unsafe/);
  });

  test('the header has an accessible theme menu (a button with a name that opens a menu of three radio items), and the phone menu has the same choices', () => {
    const header = read('public/js/header.js');
    assert.match(header, /id="themeBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="themeMenu" aria-label="Theme" data-i18n-aria="theme\.button"/);
    assert.match(header, /role="menu"/);
    assert.match(header, /role="menuitemradio" aria-checked="false" data-theme-choice=/);
    assert.match(header, /role="radiogroup"/);
    assert.match(header, /role="radio" aria-checked="false" data-theme-choice=/);
    assert.match(header, /Escape/);
    assert.match(header, /ArrowDown/);
  });

  test('the logo made for dark backgrounds is used on dark pages, the navy and coral one on light pages', () => {
    const header = read('public/js/header.js');
    assert.match(header, /dark\) return '<img class="logo-img" src="\/brand\/wisecall-logo-on-dark-transparent\.svg"/);
    assert.match(header, /wisecall:theme-changed/);
  });
});

describe('the choice is kept on the account', () => {
  test('a person can choose System, Light or Dark; nothing else; it comes back with their profile; nobody else can change it', async () => {
    const me = await signupVerified(base, 'Dara Darkmode', 'dara@example.com');
    assert.equal((await me.api('/me')).user.theme, null, 'never chosen');
    for (const theme of ['dark', 'light', 'system', null]) {
      const r = await me.api('/me', { method: 'PATCH', body: { theme } });
      assert.equal(r.status, 200, String(theme));
      assert.equal(r.user.theme, theme);
    }
    await me.api('/me', { method: 'PATCH', body: { theme: 'dark' } });
    assert.equal((await me.api('/me')).user.theme, 'dark');
    for (const bad of ['blue', '', 'DARK', 1, ['dark'], { a: 1 }]) {
      const r = await me.api('/me', { method: 'PATCH', body: { theme: bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await me.api('/me')).user.theme, 'dark', 'refused values changed nothing');
    const anon = require('./helpers').client(base);
    assert.equal((await anon.api('/me', { method: 'PATCH', body: { theme: 'light' } })).status, 401);
    assert.equal((await anon.api('/users/dara-darkmode')).profile.theme, undefined, 'the public profile does not carry it');
  });

  test('a new device adopts the account\'s theme (the header script asks who is signed in and applies theirs)', () => {
    const nav = read('public/js/nav.js');
    assert.match(nav, /WisecallTheme\.adopt\(user\)/);
    const js = read('public/js/theme-init.js');
    assert.match(js, /adopt: function \(user\)/);
    assert.match(js, /fetch\('\/api\/me', \{ method: 'PATCH'/);
  });
});

describe('texts', () => {
  test('the theme texts are in English and Georgian', () => {
    const en = JSON.parse(read('public/i18n/en.json')), ka = JSON.parse(read('public/i18n/ka.json'));
    for (const k of ['theme.button', 'theme.label', 'theme.system', 'theme.light', 'theme.dark', 'settings.appearance.title', 'settings.appearance.body']) {
      assert.ok(en[k] && ka[k], k);
      assert.notEqual(en[k], ka[k], `${k} is not translated`);
    }
  });
});
