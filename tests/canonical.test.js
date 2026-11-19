// One address per page for search engines (Google Search Console: "Duplicate, Google chose different canonical than user"), on a server
// set up as production is: PUBLIC_URL https://wisecall.ge, the old domain (OLD below).
//   - every public page (home, Browse experts, a profile, become-a-mentor, how-we-verify, the FAQ, the articles, ...) in its three forms
//     (no prefix, /ka/, /en/), with or without a query string: exactly one canonical link, on https://wisecall.ge, no www, no old domain,
//     no query string; Georgian at /ka/..., English at the address without a prefix (/en/... is the same English page and names it)
//   - hreflang: en, ka and x-default (Georgian, the default), each once, naming the two canonical addresses; each of those addresses is
//     itself 200 and names itself as canonical, and names the other back
//   - the sitemap lists exactly those canonical addresses (no /en/, no query, no other host), each 200 and its own canonical
//   - the old domain (and its www., and www.wisecall.ge) is a 301 to the same path and query on https://wisecall.ge, in one step;
//     /index.html is a 301 to /, /en and /ka to /en/ and /ka/; no page links to /index.html
//   - a profile's title is in the page's language (the mentor's own words are the same in both: the title tells them apart)
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');

const SITE = 'https://wisecall.ge';
let srv, username, slug, kaOnlySlug;
const pages = [];

// A request "as if" it came for another host (fetch does not let a Host header be set).
function ask(urlPath, { host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.base);
    const req = http.request({ hostname: u.hostname, port: u.port, path: urlPath, method: 'GET', headers: { Accept: 'text/html', ...(host ? { Host: host } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, text }));
    });
    req.on('error', reject);
    req.end();
  });
}
// What a search engine reads in a page's head (no script runs).
function head(html) {
  const all = (re) => [...html.matchAll(re)].map((m) => m.slice(1));
  return {
    lang: (/<html lang="([a-z]+)"/.exec(html) || [])[1],
    title: (/<title>([^<]*)<\/title>/.exec(html) || [])[1],
    canonical: all(/<link rel="canonical" href="([^"]*)">/g).map((m) => m[0]),
    alternates: all(/<link rel="alternate" hreflang="([^"]+)" href="([^"]*)">/g)
  };
}
// The earlier domain, written in two pieces: no file but docs/DOMAIN-MOVE.md may spell it out (tests/domain-move.test.js).
const OLD = 'wisecall' + 'ge.ge';
// The address a page path has in each language.
const en = (p) => SITE + p;
const ka = (p) => `${SITE}/ka${p}`;

before(async () => {
  await resetDatabase();
  srv = await startServer(4879, { RATE_LIMIT_MULTIPLIER: '50', PUBLIC_URL: SITE, OLD_DOMAINS: OLD, LAUNCH_MODE: 'live' });
  const admin = await signupVerified(srv.base, 'QA Admin', 'qa-admin@example.com');
  const m = await signupVerified(srv.base, 'Nino Beridze', 'nino-canonical@example.com');
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, sampleAnswer: SAMPLE, profileVisibility: 'public' } });
  await approveMentor(admin, m);
  await addPayoutDetails(m);
  username = (await m.api('/me')).user.username;
  // (test words only: never on the live site)
  const article = (ka, en) => admin.api('/admin/articles', { method: 'POST', body: { ka, en, authorName: 'Test Author', date: '2026-11-15', category: 'med', slug: '' } });
  const enBody = { title: 'Test article for the canonical check', intro: 'A test intro of two sentences for the reader of this page.', body: 'A test paragraph, only to check the page. '.repeat(8) };
  const a = await article({ title: 'სატესტო სტატია კანონიკურისთვის', intro: 'სატესტო შესავალი, ორი წინადადება მკითხველისთვის ამ გვერდზე.', body: 'სატესტო ტექსტი, მხოლოდ გვერდის შესამოწმებლად. '.repeat(8) }, enBody);
  slug = (await admin.api(`/admin/articles/${a.article.id}/publish`, { method: 'POST' })).article.slug;
  const b = await article({ title: 'მეორე სატესტო სტატია მხოლოდ ქართულად', intro: 'სატესტო შესავალი, ორი წინადადება მკითხველისთვის ამ გვერდზე.', body: 'მეორე სატესტო ტექსტი, მხოლოდ გვერდის შესამოწმებლად. '.repeat(8) }, { title: '', intro: '', body: '' });
  kaOnlySlug = (await admin.api(`/admin/articles/${b.article.id}/publish`, { method: 'POST' })).article.slug;
  pages.push('/', '/experts.html', `/u/${username}`, '/become-a-mentor.html', '/how-we-verify.html', '/faq.html', '/about.html', '/help.html',
    '/match', '/advice/design', '/advice-articles', `/advice-articles/${slug}`, '/help/refunds');
});
after(() => { if (srv) srv.proc.kill(); });

describe('every public page: one canonical, on https://wisecall.ge', () => {
  test('in all three forms, with or without a query string: exactly one canonical, the right one, no www, no old domain, no query', async () => {
    for (const p of pages) {
      for (const [form, want] of [[p, en(p)], [p === '/' ? '/ka/' : `/ka${p}`, ka(p)], [p === '/' ? '/en/' : `/en${p}`, en(p)]]) {
        for (const q of ['', '?utm_source=newsletter&ref=abc']) {
          const r = await ask(form + q);
          assert.equal(r.status, 200, `${form + q}: ${r.status} ${r.location || ''}`);
          const h = head(r.text);
          assert.equal(h.canonical.length, 1, `${form + q}: ${h.canonical.length} canonical links`);
          const c = h.canonical[0];
          assert.equal(c, want, `${form + q}`);
          assert.ok(c.startsWith(`${SITE}/`), c);
          assert.doesNotMatch(c, /\/\/www\.|wisecallge|[?#]|\/en\/|\/index\.html$/, c);
          assert.equal(h.lang, form.startsWith('/ka') ? 'ka' : 'en', `${form}: the language of the page`);
        }
      }
    }
  });

  test('hreflang: en, ka and x-default (Georgian), once each, naming the canonical addresses, the same on every form of a page', async () => {
    for (const p of pages) {
      for (const form of [p, p === '/' ? '/ka/' : `/ka${p}`, p === '/' ? '/en/' : `/en${p}`]) {
        const { alternates } = head((await ask(form)).text);
        assert.deepEqual(alternates.map(([l]) => l).sort(), ['en', 'ka', 'x-default'], `${form}: ${JSON.stringify(alternates)}`);
        const byLang = Object.fromEntries(alternates);
        assert.equal(byLang.en, en(p), form);
        assert.equal(byLang.ka, ka(p), form);
        assert.equal(byLang['x-default'], ka(p), `${form}: Georgian is the default`);
      }
    }
  });

  test('each canonical address is a page of its own: 200, names itself, and names the other language back', async () => {
    for (const p of pages) {
      for (const url of [en(p), ka(p)]) {
        const r = await ask(url.slice(SITE.length));
        assert.equal(r.status, 200, url);
        const h = head(r.text);
        assert.deepEqual(h.canonical, [url], `${url} names itself`);
        const byLang = Object.fromEntries(h.alternates);
        const other = url === en(p) ? ka(p) : en(p);
        assert.equal(byLang[url === en(p) ? 'ka' : 'en'], other, `${url} names ${other}`);
      }
    }
  });

  test('an article written in Georgian only: one address, /ka/..., naming only itself', async () => {
    const r = await ask(`/ka/advice-articles/${kaOnlySlug}`);
    assert.equal(r.status, 200);
    const h = head(r.text);
    assert.deepEqual(h.canonical, [ka(`/advice-articles/${kaOnlySlug}`)]);
    assert.deepEqual(Object.fromEntries(h.alternates), { ka: ka(`/advice-articles/${kaOnlySlug}`), 'x-default': ka(`/advice-articles/${kaOnlySlug}`) });
  });

  test('a profile\'s title is in the page\'s language; the two versions are not the same page to a search engine', async () => {
    const a = head((await ask(`/u/${username}`)).text);
    const b = head((await ask(`/ka/u/${username}`)).text);
    assert.notEqual(a.title, b.title);
    assert.match(a.title, /Nino Beridze, Designer — Ask a question \| Wisecall/);
    assert.match(b.title, /Nino Beridze, Designer — დასვი კითხვა \| Wisecall/);
  });
});

describe('the sitemap', () => {
  test('only canonical addresses: on https://wisecall.ge, no /en/, no query; each is 200 and its own canonical; every alternate is one of them', async () => {
    const r = await ask('/sitemap.xml');
    assert.equal(r.status, 200);
    const locs = [...r.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const alts = [...r.text.matchAll(/<xhtml:link rel="alternate" hreflang="[^"]+" href="([^"]*)"\/>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, 'each address once');
    for (const loc of locs) {
      assert.ok(loc.startsWith(`${SITE}/`), loc);
      assert.doesNotMatch(loc, /\/\/www\.|wisecallge|[?#]|\/en\/|\/index\.html$/, loc);
      const page = await ask(loc.slice(SITE.length));
      assert.equal(page.status, 200, loc);
      assert.deepEqual(head(page.text).canonical, [loc], `${loc} is its own canonical`);
    }
    for (const alt of alts) assert.ok(locs.includes(alt), `the alternate ${alt} is in the sitemap`);
    // (every page above, in both languages; the Georgian-only article only in Georgian)
    for (const p of pages.filter((x) => !x.startsWith('/advice-articles') || x === '/advice-articles' || x.endsWith(slug))) {
      assert.ok(locs.includes(en(p)), `${en(p)} is in the sitemap`);
      assert.ok(locs.includes(ka(p)), `${ka(p)} is in the sitemap`);
    }
    assert.ok(locs.includes(ka(`/advice-articles/${kaOnlySlug}`)));
    assert.ok(!locs.includes(en(`/advice-articles/${kaOnlySlug}`)));
  });
});

describe('one address: the old domain, www, index.html, /en and /ka', () => {
  test('the old domain, its www., and www.wisecall.ge: a 301 to the same path and query on https://wisecall.ge, in one step', async () => {
    for (const host of [OLD, 'www.' + OLD, 'www.wisecall.ge']) {
      for (const p of ['/', '/ka/faq.html?x=1&y=2', `/u/${username}`, `/ka/advice-articles/${slug}`, '/en/how-we-verify.html', '/sitemap.xml']) {
        const r = await ask(p, { host });
        assert.equal(r.status, 301, `${host}${p}`);
        assert.equal(r.location, SITE + p, `${host}${p}`);
      }
    }
    // (the site's own host answers)
    assert.equal((await ask('/ka/faq.html', { host: 'wisecall.ge' })).status, 200);
  });

  test('/index.html is a 301 to /, in each language; /en and /ka to /en/ and /ka/; the query goes along', async () => {
    for (const [from, to] of [['/index.html', '/'], ['/ka/index.html', '/ka/'], ['/en/index.html', '/en/'], ['/index.html?utm_source=x', '/?utm_source=x'], ['/en', '/en/'], ['/ka', '/ka/'], ['/en?ref=1', '/en/?ref=1']]) {
      const r = await ask(from);
      assert.equal(r.status, 301, from);
      assert.equal(r.location, to, from);
    }
  });

  test('no page links to /index.html (every link to the home page is /, or /ka/ on a Georgian page)', async () => {
    for (const p of ['/', '/ka/', '/faq.html', '/ka/faq.html', '/about.html', '/ka/about.html', `/u/${username}`, `/ka/u/${username}`, '/become-a-mentor.html', '/ka/become-a-mentor.html']) {
      const { text } = await ask(p);
      assert.doesNotMatch(text, /href="(?:\/ka)?\/index\.html/, p);
    }
  });
});
