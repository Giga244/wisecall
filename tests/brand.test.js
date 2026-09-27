// The brand files (brand/wisecall-logo-pack) are used exactly as delivered, in the places the brand brief lists.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { ROOT, resetDatabase, startServer } = require('./helpers');

const PACK = path.join(ROOT, 'brand', 'wisecall-logo-pack');
const PUB = path.join(ROOT, 'public');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let srv, base;

before(async () => { await resetDatabase(); srv = await startServer(4604); base = srv.base; });
after(() => { if (srv) srv.proc.kill(); });

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'e2e', 'brand'].includes(e.name) && dir === ROOT) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', 'results', 'report', '.tmp'].includes(e.name)) walk(p, out); } else out.push(p);
  }
  return out;
};

describe('the brand files are used as they are', () => {
  test('the pack is in the project, complete', () => {
    for (const f of ['logo/wisecall-logo.svg', 'logo/wisecall-logo-on-dark-transparent.svg', 'logo/wisecall-logo-white-transparent.svg', 'logo/wisecall-logo-navy.svg', 'logo/wisecall-logo-stacked.svg', 'logo/wisecall-mark.svg',
      'icons/favicon.svg', 'icons/favicon.ico', 'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
      'social/og-image-1200x630.png', 'social/profile-picture-1080.png']) assert.ok(fs.existsSync(path.join(PACK, f)), `${f} is missing from brand/wisecall-logo-pack`);
  });

  test('the copies on the site are byte for byte the files in the pack (nothing redrawn, nothing recoloured)', () => {
    const pairs = [
      ...['wisecall-logo.svg', 'wisecall-logo-on-dark-transparent.svg', 'wisecall-logo-white-transparent.svg', 'wisecall-logo-navy.svg', 'wisecall-logo-stacked.svg', 'wisecall-mark.svg'].map((f) => [`logo/${f}`, `brand/${f}`]),
      ...['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map((f) => [`icons/${f}`, f]),
      ['social/og-image-1200x630.png', 'og-image-1200x630.png']
    ];
    for (const [from, to] of pairs) assert.equal(sha(path.join(PUB, to)), sha(path.join(PACK, from)), `public/${to} differs from ${from}`);
  });

  test('the sizes are right: icons, share picture, and the email logo (a scaled copy of the pack\'s PNG, at most 2 x 320px)', async () => {
    const dims = async (f) => { const m = await sharp(path.join(PUB, f)).metadata(); return `${m.width}x${m.height}`; };
    assert.equal(await dims('apple-touch-icon.png'), '180x180');
    assert.equal(await dims('icon-192.png'), '192x192');
    assert.equal(await dims('icon-512.png'), '512x512');
    assert.equal(await dims('icon-maskable-512.png'), '512x512');
    assert.equal(await dims('og-image-1200x630.png'), '1200x630');
    const email = await sharp(path.join(PUB, 'brand', 'wisecall-logo-email.png')).metadata();
    assert.equal(email.format, 'png');
    assert.ok(email.width <= 640 && email.width >= 320, `email logo is ${email.width}px wide`);
    const original = await sharp(path.join(PACK, 'logo', 'wisecall-logo.png')).metadata();
    assert.ok(Math.abs(email.width / email.height - original.width / original.height) < 0.01, 'same proportions as the pack\'s logo');
  });

  test('nothing points at the old logo, the old favicon or the old share picture any more', () => {
    assert.ok(!fs.existsSync(path.join(PUB, 'og-image.png')), 'the old og-image.png is gone');
    assert.ok(!/<text[^>]*>W<\/text>/.test(fs.readFileSync(path.join(PUB, 'favicon.svg'), 'utf8')), 'the old coral "W" favicon is gone');
    const offenders = [];
    for (const f of walk(ROOT).filter((p) => /\.(html|css|js|json|md|webmanifest)$/.test(p) && !/package-lock|[\\/]i18n[\\/]/.test(p))) {
      if (f === __filename) continue;
      const t = fs.readFileSync(f, 'utf8');
      if (/og-image\.png|>Wisecall<span class="dot">|class="dot">\.<|#2b2440/i.test(t)) offenders.push(path.relative(ROOT, f));
    }
    assert.deepEqual(offenders, [], 'old brand references');
  });

  test('the brand colours in the stylesheet are the logo\'s: coral #FF6F59, navy #25213B, mint #DDF3EA, sun #FFE7A3', () => {
    const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
    for (const [token, hex] of [['--accent', '#ff6f59'], ['--ink', '#25213b'], ['--mint', '#ddf3ea'], ['--sun', '#ffe7a3']]) {
      assert.match(css, new RegExp(`${token}:\\s*${hex}\\b`, 'i'), `${token} should be ${hex}`);
    }
  });
});

describe('every page carries the icons, the manifest and the theme colour', () => {
  const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html') && !/^(500|404|403)\.html$/.test(f));

  test('the same tags, once each, on every page (added by the server from one file)', async () => {
    assert.ok(pages.length >= 15);
    for (const f of [...pages, '404.html']) {
      const url = f === 'index.html' ? '/' : (f === '404.html' ? '/no-such-page-here' : `/${f}`);
      const html = await (await fetch(base + url, { headers: { Accept: 'text/html' } })).text();
      // (every address of one of our files carries ?v=<hash of the file>, see assets.test.js)
      for (const tag of [/<link rel="icon" href="\/favicon\.ico\?v=[0-9a-f]{10}" sizes="48x48">/g, /<link rel="icon" href="\/favicon\.svg\?v=[0-9a-f]{10}" type="image\/svg\+xml">/g, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=[0-9a-f]{10}">/g, /<link rel="manifest" href="\/site\.webmanifest\?v=[0-9a-f]{10}">/g, /<meta name="theme-color" content="#F4FBF8" media="\(prefers-color-scheme: light\)">/g, /<meta name="theme-color" content="#15131F" media="\(prefers-color-scheme: dark\)">/g, /<meta name="color-scheme" content="light dark">/g, /<script src="\/js\/theme-init\.js\?v=[0-9a-f]{10}"><\/script>/g]) {
        assert.equal((html.match(tag) || []).length, 1, `${f}: ${tag}`);
      }
      assert.equal((html.match(/rel="icon"/g) || []).length, 2, `${f}: exactly two icon links`);
      if (f !== 'mock-bank.html' && f !== 'mock-kyc.html') {
        assert.match(html, /og:image" content="[^"]*\/og-image-1200x630\.png(\?v=[0-9a-f]{10})?"/, `${f} og:image`);
        assert.match(html, /og:image:width" content="1200"/);
        assert.match(html, /og:image:height" content="630"/);
        assert.match(html, /og:image:alt" content="Wisecall — Advice from people who've already done it\."/);
      }
    }
  });

  test('the icon files are served (the .ico is a real file now, not a redirect)', async () => {
    for (const [p, type] of [['/favicon.ico', /icon/], ['/favicon.svg', /svg/], ['/apple-touch-icon.png', /png/], ['/icon-192.png', /png/], ['/icon-512.png', /png/], ['/icon-maskable-512.png', /png/], ['/brand/wisecall-logo.svg', /svg/], ['/brand/wisecall-logo-email.png', /png/], ['/og-image-1200x630.png', /png/]]) {
      const r = await fetch(base + p, { redirect: 'manual' });
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), type, p);
    }
  });

  test('the web app manifest: valid, right type, right icons, allowed by the content-security policy', async () => {
    const r = await fetch(`${base}/site.webmanifest`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
    const m = await r.json();
    assert.equal(m.name, 'Wisecall');
    assert.equal(m.short_name, 'Wisecall');
    assert.equal(m.start_url, '/');
    assert.equal(m.display, 'standalone');
    assert.equal(m.background_color, '#F4FBF8');
    assert.equal(m.theme_color, '#25213B');
    assert.deepEqual(m.icons.map((i) => [i.src.replace(/\?v=[0-9a-f]{10}$/, ''), i.sizes, i.purpose || 'any']), [['/icon-192.png', '192x192', 'any'], ['/icon-512.png', '512x512', 'any'], ['/icon-maskable-512.png', '512x512', 'maskable']]);
    for (const i of m.icons) assert.equal((await fetch(base + i.src)).status, 200);
    assert.match(r.headers.get('content-security-policy'), /manifest-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;|$)/, 'scripts are still only ours');
  });

  test('the home page has the organisation data for search engines, with the symbol as its logo', async () => {
    const html = await (await fetch(base + '/')).text();
    const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    assert.ok(m);
    const ld = JSON.parse(m[1])['@graph'].find((x) => x['@type'] === 'Organization'); // (with the WebSite, in one graph)
    assert.equal(ld['@type'], 'Organization');
    assert.equal(ld.name, 'Wisecall');
    assert.match(ld.logo, new RegExp(`^${base.replace(/[.:\/]/g, '\\$&')}/brand/wisecall-mark\\.svg(\\?v=[0-9a-f]{10})?$`));
  });
});

describe('the logo in the header, the menu, the footer and the emails', () => {
  const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

  test('the header, menu and footer draw the logo image (with its size), not text; the symbol alone under 360px', () => {
    const header = read('js/header.js'), footer = read('js/footer.js');
    assert.match(header, /src="\/brand\/wisecall-logo\.svg" alt="Wisecall" width="149" height="36"/);
    assert.match(header, /<source media="\(max-width: 359px\)" srcset="\/brand\/wisecall-mark\.svg">/);
    assert.match(header, /wisecall-logo-on-dark-transparent\.svg/, 'the logo for dark backgrounds is there');
    assert.equal((header.match(/WisecallBrand\.logoHtml\(\)/g) || []).length, 2, 'the header and the menu use it');
    assert.match(footer, /WisecallBrand\.logoHtml\(\{ full: true \}\)/, 'the footer has room for the whole logo');
    for (const t of [header, footer]) assert.doesNotMatch(t, /Wisecall<span class="dot">/);
    const css = read('css/style.css');
    assert.match(css, /\.logo img \{ display: block; height: 36px; width: auto; \}/);
    assert.match(css, /@media \(max-width: 1023px\) \{ \.logo img \{ height: 30px; \} \}/);
    assert.match(css, /@media \(max-width: 639px\) \{ \.logo img \{ height: 28px; \} \}/);
  });

  test('the pages\' script draws it into a real link to the home page with a name', async () => {
    // (the browser tests look at the result; here the markup the script builds)
    const header = read('js/header.js');
    assert.match(header, /<a href="\/index\.html" class="logo">\$\{WisecallBrand\.logoHtml\(\)\}<\/a>/);
  });

  test('emails carry the logo as a PNG on an absolute address (mail apps block SVG)', () => {
    const { render } = require('../server/mail/templates');
    for (const lang of ['en', 'ka']) {
      const { html } = render('verify', lang, { code: '123456' });
      assert.match(html, /<img src="https?:\/\/[^"]+\/brand\/wisecall-logo-email\.png" width="200" height="48" alt="Wisecall"/, lang);
      assert.doesNotMatch(html, /Wisecall<span/);
    }
  });
});
