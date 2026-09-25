// Cache busting: every stylesheet, script, logo, icon and font is asked for with ?v=<hash of the file>, HTML is never kept, versioned files
// are kept for a year, and a file that changes gets a new address (so the old coral favicon can never be shown again).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, client } = require('./helpers');

const PUBLIC = path.join(ROOT, 'public');
let srv, base, visitor;
const sha = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 10);
const LOCAL = /^(?:https?:\/\/localhost:\d+)?(\/(?:(?:css|js|brand|fonts)\/[^\s"'?]+|favicon\.svg|favicon\.ico|apple-touch-icon\.png|icon-[\w-]+\.png|og-image[\w-]*\.png|site\.webmanifest))(\?v=([0-9a-f]{10}))?$/;

before(async () => { await resetDatabase(); srv = await startServer(4609); base = srv.base; visitor = client(base); });
after(() => { if (srv) srv.proc.kill(); });

// Every address in a page (or script, or stylesheet) that points at one of our files.
function addresses(text) {
  const found = [];
  for (const m of text.matchAll(/(?:src|href|content|srcset)="([^"]+)"/g)) { const a = LOCAL.exec(m[1]); if (a) found.push({ url: a[1], v: a[3] || null, raw: m[1] }); }
  return found;
}

describe('addresses carry the version of the file', () => {
  test('on every page, every stylesheet, script, logo, icon, font and share picture has ?v=<hash>, and the hash is the file\'s own', async () => {
    const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && !/^(admin|admin-2fa|403|404|500)\.html$/.test(f)).map((f) => (f === 'index.html' ? '/' : `/${f}`));
    const seen = new Map();
    for (const p of [...pages, '/no-such-page']) {
      const html = (await visitor(p, { headers: { Accept: 'text/html' } })).text;
      const list = addresses(html);
      assert.ok(list.length >= 6, `${p} names ${list.length} of our files`);
      for (const a of list) {
        assert.ok(a.v, `${p}: ${a.raw} has no version`);
        seen.set(a.url, a.v);
      }
    }
    // the icons of the head, by name
    for (const u of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest', '/css/style.css', '/js/theme-init.js', '/js/header.js', '/og-image-1200x630.png']) assert.ok(seen.has(u), `${u} is named with a version somewhere`);
    // the version really is the hash of what is served at that address
    for (const [url, v] of seen) {
      const res = await fetch(`${base}${url}?v=${v}`);
      assert.equal(res.status, 200, url);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(sha(body), v, `${url}: the version is the hash of the file as served`);
    }
  });

  test('a script or stylesheet that names another file names it with its version (the logo in header.js, the fonts in style.css, the icons in the manifest)', async () => {
    const header = (await visitor('/js/header.js')).text;
    assert.match(header, /src="\/brand\/wisecall-logo\.svg\?v=[0-9a-f]{10}"/);
    assert.match(header, /srcset="\/brand\/wisecall-mark\.svg\?v=[0-9a-f]{10}"/);
    assert.match(header, /src="\/brand\/wisecall-logo-on-dark-transparent\.svg\?v=[0-9a-f]{10}"/);
    const css = (await visitor('/css/style.css')).text;
    assert.equal((css.match(/url\('\/fonts\/[\w-]+\.woff2\?v=[0-9a-f]{10}'\)/g) || []).length, 4, 'all four font files');
    assert.doesNotMatch(css, /public\/js\/theme-init\.js\?v=/, 'a file path written inside a comment is left alone');
    const manifest = JSON.parse((await visitor('/site.webmanifest')).text);
    assert.equal(manifest.icons.length, 3);
    for (const icon of manifest.icons) assert.match(icon.src, /^\/icon-[\w-]+\.png\?v=[0-9a-f]{10}$/, icon.src);
    const i18n = (await visitor('/js/i18n.js')).text;
    assert.match(i18n, /'\/js\/dev-overflow\.js\?v=[0-9a-f]{10}'/, 'a script added by another script');
  });

  test('a stylesheet or script changes version when a file it names changes; an address that already has a query, or names no file, is left alone', async () => {
    const dir = path.join(PUBLIC, 'js');
    const style = path.join(PUBLIC, 'css', 'zz-assets-test.css');
    const a = path.join(dir, 'zz-assets-a.js'), b = path.join(dir, 'zz-assets-b.js');
    try {
      fs.writeFileSync(a, "console.log('a');");
      fs.writeFileSync(b, "import('/js/zz-assets-a.js'); // see /js/zz-assets-missing.js and /js/zz-assets-a.js?x=1 and https://example.com/js/zz-assets-a.js and public/js/zz-assets-a.js and finally /js/zz-assets-a.js.");
      fs.writeFileSync(style, "@font-face { src: url('/fonts/nunito-latin.woff2'); } .x { background: url('/brand/wisecall-mark.svg'); }");
      const first = (await visitor('/js/zz-assets-b.js')).text;
      const va = /zz-assets-a\.js\?v=([0-9a-f]{10})'/.exec(first);
      assert.ok(va, first);
      assert.match(first, /\/js\/zz-assets-missing\.js\b(?!\?v=)/, 'no such file: no version');
      assert.match(first, /zz-assets-a\.js\?x=1/, 'an existing query is kept');
      assert.doesNotMatch(first, /https:\/\/example\.com\/js\/zz-assets-a\.js\?v=/, 'another site\'s address is not ours');
      assert.doesNotMatch(first, /public\/js\/zz-assets-a\.js\?v=/, 'a longer path is not ours');
      assert.match(first, /zz-assets-a\.js\?v=[0-9a-f]{10}\.$/, 'the full stop that ends a sentence stays after the address');
      const bBefore = sha(first);
      // the file it names changes -> its own version changes -> the script that names it changes too
      fs.writeFileSync(a, "console.log('a, changed');");
      const second = (await visitor('/js/zz-assets-b.js')).text;
      const va2 = /zz-assets-a\.js\?v=([0-9a-f]{10})'/.exec(second);
      assert.notEqual(va2[1], va[1], 'a changed file has a new version');
      assert.notEqual(sha(second), bBefore, 'and so does the file that names it');
      const css = (await visitor('/css/zz-assets-test.css')).text;
      assert.match(css, /url\('\/fonts\/nunito-latin\.woff2\?v=[0-9a-f]{10}'\)/);
      assert.match(css, /url\('\/brand\/wisecall-mark\.svg\?v=[0-9a-f]{10}'\)/);
    } finally {
      for (const f of [a, b, style]) { try { fs.unlinkSync(f); } catch (e) { /* not there */ } }
    }
  });

  test('two files that name each other do not send the server round in circles', async () => {
    const a = path.join(PUBLIC, 'js', 'zz-loop-a.js'), b = path.join(PUBLIC, 'js', 'zz-loop-b.js');
    try {
      fs.writeFileSync(a, "load('/js/zz-loop-b.js');");
      fs.writeFileSync(b, "load('/js/zz-loop-a.js');");
      const r = await visitor('/js/zz-loop-a.js');
      assert.equal(r.status, 200);
      assert.match(r.text, /zz-loop-b\.js/);
    } finally { for (const f of [a, b]) { try { fs.unlinkSync(f); } catch (e) { /* not there */ } } }
  });
});

describe('how long each thing is kept', () => {
  const cc = async (url, headers) => (await visitor(url, { headers })).headers.get('cache-control');

  test('HTML is never kept: pages, the profile page, the 404 page; the admin page and the no-access page not even stored', async () => {
    for (const p of ['/', '/login.html', '/terms.html', '/u/nobody-here']) assert.equal(await cc(p, { Accept: 'text/html' }), 'no-cache', p);
    assert.equal(await cc('/no-such-page', { Accept: 'text/html' }), 'no-cache');
    assert.equal(await cc('/admin.html'), 'no-store');
  });

  test('a file asked for with its current version is kept for a year and never rechecked', async () => {
    const html = (await visitor('/')).text;
    const list = addresses(html).filter((a) => a.v);
    const kinds = new Set();
    for (const a of list) {
      if (/^\/(favicon\.ico|site\.webmanifest)$/.test(a.url)) continue; // (the next test)
      assert.equal(await cc(`${a.url}?v=${a.v}`), 'public, max-age=31536000, immutable', a.url);
      kinds.add(path.extname(a.url));
    }
    for (const k of ['.css', '.js', '.svg', '.png', '.woff2']) assert.ok(kinds.has(k), `a ${k} file was checked`);
  });

  test('the manifest and favicon.ico are kept for a day, with or without a version (browsers ask for them by themselves)', async () => {
    for (const u of ['/favicon.ico', '/site.webmanifest']) {
      assert.equal(await cc(u), 'public, max-age=86400', u);
      const v = addresses((await visitor('/')).text).find((a) => a.url === u).v;
      assert.equal(await cc(`${u}?v=${v}`), 'public, max-age=86400', `${u} with its version`);
    }
  });

  test('a file asked for without a version is kept for a day; with an out-of-date version it is asked again; the dictionaries always', async () => {
    assert.equal(await cc('/brand/wisecall-logo.svg'), 'public, max-age=86400');
    assert.equal(await cc('/css/style.css'), 'no-cache');
    assert.equal(await cc('/js/header.js?v=0000000000'), 'no-cache');
    assert.equal(await cc('/brand/wisecall-logo.svg?v=0000000000'), 'no-cache');
    assert.equal(await cc('/i18n/en.json'), 'no-cache');
    assert.equal(await cc('/i18n/ka.json'), 'no-cache');
  });

  test('an unchanged script or dictionary is answered "not modified" to a browser that already has it', async () => {
    // (a raw request: fetch() adds "Cache-Control: no-cache" to a conditional request, which is not what a browser revalidating a file sends)
    const http = require('http');
    const get = (p, headers) => new Promise((resolve, reject) => {
      http.get({ host: 'localhost', port: new URL(base).port, path: p, headers }, (res) => { let n = 0; res.on('data', (d) => { n += d.length; }); res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag, bytes: n })); }).on('error', reject);
    });
    const first = await get('/js/header.js', {});
    assert.equal(first.status, 200);
    assert.match(first.etag, /^"[0-9a-f]{10}"$/);
    assert.deepEqual(await get('/js/header.js', { 'If-None-Match': first.etag }), { status: 304, etag: first.etag, bytes: 0 });
    const dict = await get('/i18n/en.json', {});
    assert.equal((await get('/i18n/en.json', { 'If-None-Match': dict.etag })).status, 304);
    assert.equal((await get('/js/header.js', { 'If-None-Match': '"0000000000"' })).status, 200, 'another version is sent in full');
  });

  test('the admin scripts are never kept by a shared cache', async () => {
    const admin = client(base);
    const su = await admin.api('/auth/signup', { method: 'POST', body: { name: 'Qa Admin', email: 'qa-admin@example.com', password: 'test-pass-12345' } });
    await admin.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } });
    assert.equal((await admin('/js/admin.js')).headers.get('cache-control'), 'private, no-cache');
  });
});
