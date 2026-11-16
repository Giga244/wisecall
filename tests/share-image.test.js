// The link preview. Georgian is the site's default language and the address people share is the bare one (https://wisecall.ge/), so a page
// WITHOUT a prefix is previewed like /ka/: public/og/og-ka.png and Georgian og:/twitter: title, description and alt text. Only /en/ pages are
// previewed in English (public/og/og-en.png). The picture's address is absolute, built from PUBLIC_URL, with its size (1200x630); the page
// itself (its <title>, its words) is not changed by this. The old public/og-image-1200x630.png stays as a fallback.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, resetDatabase, ROOT } = require('./helpers');

const SITE = 'https://wisecall.example';
const GEORGIAN = /[Ⴀ-ჿ]/;
const tag = (html, re) => (re.exec(html) || [])[1];
const metas = (html) => ({
  og: tag(html, /<meta property="og:image" content="([^"]*)">/), tw: tag(html, /<meta name="twitter:image" content="([^"]*)">/),
  w: tag(html, /<meta property="og:image:width" content="([^"]*)">/), h: tag(html, /<meta property="og:image:height" content="([^"]*)">/),
  alt: tag(html, /<meta property="og:image:alt" content="([^"]*)">/), twAlt: tag(html, /<meta name="twitter:image:alt" content="([^"]*)">/),
  title: tag(html, /<meta property="og:title" content="([^"]*)">/), twTitle: tag(html, /<meta name="twitter:title" content="([^"]*)">/),
  desc: tag(html, /<meta property="og:description" content="([^"]*)">/), twDesc: tag(html, /<meta name="twitter:description" content="([^"]*)">/),
  locale: tag(html, /<meta property="og:locale" content="([^"]*)">/), pageTitle: tag(html, /<title>([^<]*)<\/title>/)
});

describe('the link preview follows the language of the address: Georgian bare and under /ka/, English under /en/', () => {
  let srv;
  const get = async (p) => (await fetch(srv.base + p, { headers: { Accept: 'text/html' } })).text();
  before(async () => { await resetDatabase(); srv = await startServer(4896, { PUBLIC_URL: SITE }); });
  after(() => { if (srv) srv.proc.kill(); });

  test('the files are there: both 1200x630, and the old one is kept as the fallback', () => {
    for (const f of ['og/og-ka.png', 'og/og-en.png', 'og-image-1200x630.png']) {
      const png = fs.readFileSync(path.join(ROOT, 'public', f));
      assert.equal(png.readUInt32BE(16), 1200, f);
      assert.equal(png.readUInt32BE(20), 630, f);
    }
  });

  test('/, /ka/ and /en/: the picture (absolute, from PUBLIC_URL), its size, and the words of the preview', async () => {
    const [bare, ka, en] = [metas(await get('/')), metas(await get('/ka/')), metas(await get('/en/'))];
    for (const [m, file] of [[bare, 'og-ka.png'], [ka, 'og-ka.png'], [en, 'og-en.png']]) {
      assert.match(m.og, new RegExp(`^https://wisecall\\.example/og/${file.replace('.', '\\.')}(\\?v=[0-9a-f]{10})?$`));
      assert.equal(m.tw, m.og, 'twitter:image is the same picture');
      assert.equal(m.w, '1200'); assert.equal(m.h, '630');
      assert.ok(m.alt && m.alt === m.twAlt, 'alt text on og:image and twitter:image');
      assert.ok(m.title && m.title === m.twTitle && m.desc && m.desc === m.twDesc, 'og: and twitter: title and description agree');
    }
    // the bare address is previewed exactly as /ka/ is: Georgian picture, alt, title, description, locale
    for (const k of ['og', 'tw', 'alt', 'title', 'desc', 'locale']) assert.equal(bare[k], ka[k], `/ and /ka/ agree on ${k}`);
    assert.match(bare.alt, GEORGIAN); assert.match(bare.title, GEORGIAN); assert.match(bare.desc, GEORGIAN);
    assert.equal(bare.locale, 'ka_GE');
    // /en/ is English all through
    for (const k of ['alt', 'title', 'desc']) assert.doesNotMatch(en[k], GEORGIAN, `/en/ ${k} is English`);
    assert.equal(en.locale, 'en_US');
    // (the pictures the tags name are served, and are the right files)
    for (const [m, f] of [[bare, 'og-ka.png'], [en, 'og-en.png']]) {
      const u = new URL(m.og);
      const res = await fetch(srv.base + u.pathname + u.search);
      assert.equal(res.status, 200);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(path.join(ROOT, 'public', 'og', f)));
    }
  });

  test('only the preview is Georgian on a bare address: the page keeps its own <title> and language', async () => {
    const bare = metas(await get('/about.html'));
    assert.match(bare.pageTitle, /About Wisecall/);
    assert.match(await get('/about.html'), /<html lang="en"/);
    assert.match(bare.title, GEORGIAN);
    assert.match(bare.og, /\/og\/og-ka\.png/);
    assert.equal(bare.title, metas(await get('/ka/about.html')).title);
    assert.equal(metas(await get('/en/about.html')).title, bare.pageTitle, '/en/ keeps the English title for the preview too');
  });

  test('every page has the same preview tags once each, and the picture of its address', async () => {
    const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && !f.startsWith('mock-') && !/^(live-.*|profile|article|admin|admin-2fa|500|403)\.html$/.test(f));
    assert.ok(pages.length >= 15);
    for (const f of pages) {
      const url = f === 'index.html' ? '/' : `/${f}`;
      for (const [prefix, lang] of [['', 'ka'], ['/ka', 'ka'], ['/en', 'en']]) {
        const res = await fetch(srv.base + prefix + url, { headers: { Accept: 'text/html' }, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) continue; // (a page for somebody signed in sends a visitor to the sign-up: not a page of its own)
        const html = await res.text();
        assert.equal((html.match(/property="og:image"/g) || []).length, 1, `${prefix}${url} og:image once`);
        assert.equal((html.match(/property="og:image:(width|height|alt)"/g) || []).length, 3, `${prefix}${url} width, height, alt once each`);
        assert.equal((html.match(/name="twitter:image:alt"/g) || []).length, 1, `${prefix}${url} twitter alt once`);
        if (/rel="canonical"/.test(html)) assert.equal((html.match(/property="og:locale" /g) || []).length, 1, `${prefix}${url} og:locale once`); // (an error page names no canonical address and no alternates)
        const m = metas(html);
        assert.match(m.og, new RegExp(`/og/og-${lang}\\.png`), `${prefix}${url}`);
        assert.match(m.tw, new RegExp(`/og/og-${lang}\\.png`), `${prefix}${url} twitter`);
        assert.equal(GEORGIAN.test(m.alt), lang === 'ka', `${prefix}${url} alt text language`);
      }
    }
  });

  test('pages built from their own words (the lists, the help centre, a profile) are previewed in Georgian on a bare address too', async () => {
    let checked = 0;
    for (const p of ['/answers', '/requests', '/live', '/help.html', '/u/nobody-by-this-name']) {
      if ((await fetch(srv.base + p)).status !== 200 && !p.startsWith('/u/')) continue; // (a list that is switched off is not a page)
      checked++;
      const bare = metas(await get(p));
      const ka = metas(await get(`/ka${p}`));
      const en = metas(await get(`/en${p}`));
      assert.match(bare.og, /\/og\/og-ka\.png/, p);
      assert.match(bare.desc, GEORGIAN, `${p} description`);
      assert.equal(bare.desc, ka.desc, `${p}: the same words as /ka/`);
      assert.doesNotMatch(en.desc, GEORGIAN, `/en${p} description is English`);
      assert.match(en.og, /\/og\/og-en\.png/, `/en${p}`);
    }
    assert.ok(checked >= 3, 'the lists that are on were checked');
    // (the page itself, on the bare address, is still English)
    assert.match(await get('/help.html'), /<html lang="en"/);
  });
});
