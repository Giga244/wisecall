// "რჩევები", the articles written in Admin (docs/CLAUDE-CODE-SEO.md 5; server/articles.js): only an admin writes them, a new one is a
// draft, and nothing is public without Publish. A draft or an article taken down answers 404 and is not in the sitemap; a published one is
// written whole by the server (no script needed) with Article data naming the real author, in the languages it is written in, and is in
// the sitemap with those languages. Every page ends with the link to /match, and before launch with the waiting list. Nothing is seeded.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified } = require('./helpers');
const articles = require('../server/articles');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let live, pre, admin, user;
const page = (srv, p, c) => (c ? c.raw(p) : fetch(srv.base + p, { redirect: 'manual' }));
const html = async (srv, p, c) => (await page(srv, p, c)).text();
const robots = (h) => (/<meta name="robots" content="([^"]*)">/.exec(h) || [])[1];
const ld = (h) => JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h)[1]);

// (test words only: clearly not a real article, and never on the live site. The owner writes the real ones.)
const KA = {
  title: 'სატესტო სტატია: როგორ ავირჩიო პროფესია',
  intro: 'ეს სატესტო შესავალია: ორი წინადადება იმაზე, რას გაიგებს მკითხველი ამ სტატიიდან.',
  body: [
    'ეს სატესტო ტექსტის პირველი აბზაცია. ნამდვილ სტატიას საიტის მფლობელი დაწერს, აქ მხოლოდ ფორმას ვამოწმებთ.',
    '',
    '## პირველი ქვესათაური',
    'მეორე აბზაცი **მუქი სიტყვით** და ჩვეულებრივი ტექსტით, რომელიც რამდენიმე წინადადებას შეიცავს. კიდევ ერთი წინადადება სიგრძისთვის.',
    '',
    '- სიის პირველი პუნქტი',
    '- სიის მეორე პუნქტი',
    '',
    '### უფრო პატარა ქვესათაური',
    'ბოლო აბზაცი: <script>alert(1)</script> & "ბრჭყალები" ტექსტად რჩება.'
  ].join('\n')
};
const EN = {
  title: 'Test article: how do I choose a profession',
  intro: 'A test intro: two sentences about what the reader will learn from this article.',
  body: 'The first paragraph of the test text. The owner writes the real article; this only checks the form of the page.\n\n## A section\nA second paragraph with a few more words so that the text is long enough to be published at all, which takes two hundred characters.'
};
const draft = (over = {}) => ({ ka: KA, en: { title: '', intro: '', body: '' }, authorName: 'ავტორის სახელი', date: '2026-11-15', category: 'med', slug: '', ...over });

before(async () => {
  await resetDatabase();
  live = await startServer(4883, { RATE_LIMIT_MULTIPLIER: '50' });
  pre = await startServer(4884, { RATE_LIMIT_MULTIPLIER: '50', LAUNCH_MODE: 'prelaunch' });
  admin = await signupVerified(live.base, 'QA Admin', 'qa-admin@example.com');
  user = await signupVerified(live.base, 'Ordinary Person', 'person@example.com');
});
after(async () => { for (const s of [live, pre]) if (s) s.proc.kill(); await pool.end(); });

describe('nothing is seeded, and only an admin writes', () => {
  test('the table starts empty: no article, no list page, nothing in the sitemap, no link in the menu', async () => {
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM articles')).rows[0].n, 0);
    for (const p of ['/advice-articles', '/ka/advice-articles', '/ka/advice-articles/anything']) assert.equal((await page(live, p)).status, 404, p);
    assert.doesNotMatch(await html(live, '/sitemap.xml'), /advice-articles/);
    assert.deepEqual((await client(live.base).api('/config')).articles, { ka: false, en: false });
    // (no migration, script or test helper writes an article for the site: the only INSERT is the admin's own)
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '068_articles.sql'), 'utf8');
    assert.doesNotMatch(sql, /INSERT/i);
    assert.match(fs.readFileSync(path.join(ROOT, 'migrations', 'down', '068_articles.down.sql'), 'utf8'), /DROP TABLE IF EXISTS articles;/);
  });

  test('every article route is for admins only', async () => {
    const anon = client(live.base);
    for (const [who, status] of [[anon, 401], [user, 403]]) {
      assert.equal((await who.api('/admin/articles')).status, status);
      assert.equal((await who.api('/admin/articles', { method: 'POST', body: draft() })).status, status);
      assert.equal((await who.api('/admin/articles/00000000-0000-4000-8000-000000000000/publish', { method: 'POST' })).status, status);
      assert.equal((await who.api('/admin/articles/00000000-0000-4000-8000-000000000000', { method: 'DELETE' })).status, status);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM articles')).rows[0].n, 0);
  });
});

describe('a draft, then Publish', () => {
  let a;
  test('a new article is a draft with an address made from its Georgian title; a visitor gets 404, the sitemap does not have it', async () => {
    const r = await admin.api('/admin/articles', { method: 'POST', body: draft({ status: 'published' }) }); // (asking for "published" changes nothing)
    assert.equal(r.status, 201, r.text);
    a = r.article;
    assert.equal(a.status, 'draft');
    assert.equal(a.slug, 'satesto-statia-rogor-avirchio-profesia');
    assert.deepEqual(a.langs, ['ka']);
    assert.deepEqual(a.problems, []);
    for (const p of [`/ka/advice-articles/${a.slug}`, `/advice-articles/${a.slug}`, '/ka/advice-articles']) assert.equal((await page(live, p)).status, 404, p);
    assert.equal((await page(live, `/ka/advice-articles/${a.slug}`, user)).status, 404, 'a signed-in person who is not an admin');
    assert.doesNotMatch(await html(live, '/sitemap.xml'), /advice-articles/);
    assert.deepEqual((await client(live.base).api('/config')).articles, { ka: false, en: false });
  });

  test('the admin alone can look at the draft: a preview that says so and is never indexed or kept', async () => {
    const r = await page(live, `/ka/advice-articles/${a.slug}`, admin);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const h = await r.text();
    assert.equal(robots(h), 'noindex');
    assert.match(h, /<p class="launch-banner article-draft" role="status">მონახაზი: ეს სტატია ჯერ არ გამოქვეყნებულა\. მხოლოდ ადმინი ხედავს\.<\/p>/);
    assert.match(h, /<h1>სატესტო სტატია: როგორ ავირჩიო პროფესია<\/h1>/);
    assert.doesNotMatch(h, /application\/ld\+json/, 'no structured data for a page that does not exist for anybody else');
    // (written in Georgian only: the English address of the preview leads to the Georgian one)
    const en = await page(live, `/advice-articles/${a.slug}`, admin);
    assert.equal(en.status, 302);
    assert.equal(en.headers.get('location'), `/ka/advice-articles/${a.slug}`);
  });

  test('Publish needs a whole article: a full language and the author\'s name; what is missing is named', async () => {
    const half = (await admin.api('/admin/articles', { method: 'POST', body: draft({ ka: { title: 'ნახევრად დაწერილი', intro: '', body: 'მოკლე' }, authorName: '' }) })).article;
    assert.deepEqual(half.problems, ['ka_incomplete', 'author_required']);
    const no = await admin.api(`/admin/articles/${half.id}/publish`, { method: 'POST' });
    assert.equal(no.status, 400);
    assert.equal(no.error, 'not_ready');
    assert.deepEqual(no.problems, ['ka_incomplete', 'author_required']);
    const short = (await admin.api(`/admin/articles/${half.id}`, { method: 'PATCH', body: draft({ ka: { title: 'მოკლე', intro: 'მოკლე შესავალი', body: 'მოკლე ტექსტი' }, authorName: 'ა' }) })).article;
    assert.deepEqual(short.problems, ['ka_intro_short', 'ka_body_short', 'author_required']);
    assert.equal((await admin.api(`/admin/articles/${half.id}/publish`, { method: 'POST' })).status, 400);
    assert.equal((await pool.query(`SELECT status FROM articles WHERE id = $1`, [half.id])).rows[0].status, 'draft');
    // a draft can be deleted; then it is gone
    assert.equal((await admin.api(`/admin/articles/${half.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await admin.api(`/admin/articles/${half.id}`)).status, 404);
    // only a title is needed to keep a draft; without one there is nothing to save
    assert.equal((await admin.api('/admin/articles', { method: 'POST', body: draft({ ka: { title: '', intro: 'x', body: 'y' } }) })).error, 'title_required');
  });

  test('published: the page is whole without any script, in Georgian, with the author, the date and the sections', async () => {
    const r = await admin.api(`/admin/articles/${a.id}/publish`, { method: 'POST' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.article.status, 'published');
    const res = await page(live, `/ka/advice-articles/${a.slug}`);
    assert.equal(res.status, 200);
    const h = await res.text();
    const main = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
    assert.match(h, /<html lang="ka"/);
    assert.equal(robots(h), 'index, follow');
    assert.match(h, /<title>სატესტო სტატია: როგორ ავირჩიო პროფესია — Wisecall<\/title>/);
    assert.match(h, /<meta name="description" content="ეს სატესტო შესავალია: ორი წინადადება იმაზე, რას გაიგებს მკითხველი ამ სტატიიდან\.">/);
    assert.match(h, /<meta property="og:type" content="article">/);
    // the text itself, in the HTML the server sent
    assert.match(main, /<h1>სატესტო სტატია: როგორ ავირჩიო პროფესია<\/h1>/);
    assert.match(main, /<p class="legal-intro article-intro">ეს სატესტო შესავალია:/);
    assert.match(main, /<p>ეს სატესტო ტექსტის პირველი აბზაცია\./);
    assert.match(main, /<h2>პირველი ქვესათაური<\/h2>/);
    assert.match(main, /<strong>მუქი სიტყვით<\/strong>/);
    assert.match(main, /<ul><li>სიის პირველი პუნქტი<\/li><li>სიის მეორე პუნქტი<\/li><\/ul>/);
    assert.match(main, /<h3>უფრო პატარა ქვესათაური<\/h3>/);
    assert.match(main, /<span class="article-author">ავტორის სახელი<\/span> · <time datetime="2026-11-15">15 ნოემბერი 2026<\/time>/);
    assert.match(main, /<p class="article-kicker">მედიცინა და ჯანმრთელობა<\/p>/);
    // what the admin typed is text, never markup
    assert.match(main, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;ბრჭყალები&quot; ტექსტად რჩება\./);
    assert.doesNotMatch(main, /<script>alert/);
    assert.doesNotMatch(main, /article-draft/);
    // the page of the list exists now, and names the article
    const list = await html(live, '/ka/advice-articles');
    assert.match(list, /<h1>რჩევები<\/h1>/);
    assert.match(list, new RegExp(`<h2><a href="/ka/advice-articles/${a.slug}">სატესტო სტატია: როგორ ავირჩიო პროფესია</a></h2>`));
    assert.match(list, /<title>რჩევები სტუდენტებისთვის — Wisecall<\/title>/);
    assert.equal(robots(list), 'index, follow');
    assert.deepEqual((await client(live.base).api('/config')).articles, { ka: true, en: false });
  });

  test('Article data: the headline, the real author as typed, the dates, the publisher, the breadcrumbs', async () => {
    const h = await html(live, `/ka/advice-articles/${a.slug}`);
    const raw = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h)[1];
    assert.ok(!raw.includes('<'), 'nothing in the data can close the tag');
    const g = ld(h)['@graph'];
    const art = g.find((x) => x['@type'] === 'Article');
    assert.equal(art.headline, KA.title);
    assert.equal(art.description, KA.intro);
    assert.equal(art.inLanguage, 'ka');
    assert.deepEqual(art.author, { '@type': 'Person', name: 'ავტორის სახელი' });
    assert.equal(art.datePublished, '2026-11-15');
    assert.match(art.dateModified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(art.dateModified >= art.datePublished);
    assert.equal(art.publisher.name, 'Wisecall');
    assert.equal(art.url, `${live.base}/ka/advice-articles/${a.slug}`);
    assert.equal(art.aggregateRating, undefined);
    assert.equal(art.review, undefined);
    const crumbs = g.find((x) => x['@type'] === 'BreadcrumbList').itemListElement;
    assert.deepEqual(crumbs.map((c) => c.item), [`${live.base}/ka/`, `${live.base}/ka/advice-articles`, `${live.base}/ka/advice-articles/${a.slug}`]);
  });

  test('written in Georgian only: only the Georgian address exists, in the head and in the sitemap', async () => {
    const h = await html(live, `/ka/advice-articles/${a.slug}`);
    assert.match(h, new RegExp(`<link rel="canonical" href="${live.base}/ka/advice-articles/${a.slug}">`));
    assert.match(h, new RegExp(`<link rel="alternate" hreflang="ka" href="${live.base}/ka/advice-articles/${a.slug}">`));
    assert.match(h, new RegExp(`<link rel="alternate" hreflang="x-default" href="${live.base}/ka/advice-articles/${a.slug}">`));
    assert.doesNotMatch(h, /hreflang="en"/);
    assert.doesNotMatch(h, /og:locale:alternate/);
    // the English address is not a page (the language switch leads there): to the English home page, as there is no English article
    const en = await page(live, `/advice-articles/${a.slug}`);
    assert.equal(en.status, 302);
    assert.equal(en.headers.get('location'), '/');
    assert.equal((await page(live, '/advice-articles')).status, 404);
    const x = await html(live, '/sitemap.xml');
    const entry = new RegExp(`<url><loc>${live.base}/ka/advice-articles/${a.slug}</loc><xhtml:link rel="alternate" hreflang="ka" href="${live.base}/ka/advice-articles/${a.slug}"/><xhtml:link rel="alternate" hreflang="x-default" href="${live.base}/ka/advice-articles/${a.slug}"/><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`);
    assert.match(x, entry);
    assert.doesNotMatch(x, new RegExp(`<loc>${live.base}/advice-articles`), 'no English address');
    assert.match(x, new RegExp(`<loc>${live.base}/ka/advice-articles</loc>`));
  });

  test('with an English version too: both addresses, each naming the other', async () => {
    const r = await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ en: EN, slug: a.slug }) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.article.langs, ['ka', 'en']);
    const en = await html(live, `/advice-articles/${a.slug}`);
    assert.match(en, /<html lang="en"/);
    assert.match(en, /<h1>Test article: how do I choose a profession<\/h1>/);
    assert.match(en, /<time datetime="2026-11-15">15 November 2026<\/time>/);
    assert.match(en, new RegExp(`<link rel="alternate" hreflang="ka" href="${live.base}/ka/advice-articles/${a.slug}">`));
    assert.match(en, new RegExp(`<link rel="alternate" hreflang="en" href="${live.base}/advice-articles/${a.slug}">`));
    assert.equal(ld(en)['@graph'].find((x) => x['@type'] === 'Article').inLanguage, 'en');
    const x = await html(live, '/sitemap.xml');
    assert.match(x, new RegExp(`<loc>${live.base}/advice-articles/${a.slug}</loc><xhtml:link rel="alternate" hreflang="en"`));
    assert.match(x, new RegExp(`<loc>${live.base}/advice-articles</loc>`));
    assert.match(await html(live, '/advice-articles'), /<h1>Advice<\/h1>/);
  });

  test('every article page ends with the link to /match (at the article\'s field); before launch, with the waiting list too', async () => {
    const after = await html(live, `/ka/advice-articles/${a.slug}`);
    assert.match(after, /<section class="article-next" aria-labelledby="articleNextTitle">\s*<h2 id="articleNextTitle">არ იცი, ვის ჰკითხო\?<\/h2>/);
    assert.match(after, /<a class="btn btn-primary" href="\/ka\/match\?f=med">იპოვე შენი მენტორი · უფასოდ<\/a>/);
    assert.doesNotMatch(after, /article-wait|articleWait/, 'after launch there is no waiting list');
    // before launch (another server on the same database, as the live site is today)
    const before = await html(pre, `/ka/advice-articles/${a.slug}`);
    assert.match(before, /<a class="btn btn-primary" href="\/ka\/match\?f=med">იპოვე შენი მენტორი · უფასოდ<\/a>/);
    assert.match(before, /<section class="article-wait" aria-labelledby="articleWaitTitle">\s*<h2 id="articleWaitTitle">Wisecall მალე იხსნება<\/h2>/);
    assert.match(before, /<div id="articleWait" data-field="med"><a class="btn btn-outline" href="\/ka\/#heroWait">მოლოდინის სიაში ჩაწერა<\/a><\/div>/);
    assert.ok(before.indexOf('article-next') < before.indexOf('article-wait') && before.indexOf('</article>') < before.indexOf('article-next'), 'after the text');
    // the list page too; and before launch the article is in the sitemap while a field's page is not
    assert.match(await html(pre, '/ka/advice-articles'), /article-next[\s\S]*article-wait/);
    const x = await html(pre, '/sitemap.xml');
    assert.match(x, new RegExp(`<loc>${pre.base}/ka/advice-articles/${a.slug}</loc>`));
    assert.doesNotMatch(x, /\/advice\//);
    // (the page's own script only puts the form where the link is: the text never waits for it)
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'article.js'), 'utf8');
    assert.match(js, /WisecallWaitlist\.html\(box\.dataset\.field \|\| undefined\)/);
  });
});

describe('a published article stays whole, and its address stays', () => {
  let a;
  before(async () => { a = (await admin.api('/admin/articles')).articles.find((x) => x.status === 'published'); });

  test('it cannot be saved broken; nothing typed is ever cut', async () => {
    const broken = await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ ka: { ...KA, body: '' }, en: EN, slug: a.slug }) });
    assert.equal(broken.status, 400);
    assert.equal(broken.error, 'not_ready');
    assert.deepEqual(broken.problems, ['ka_incomplete']);
    assert.match(await html(live, `/ka/advice-articles/${a.slug}`), /<h2>პირველი ქვესათაური<\/h2>/, 'the page is as it was');
    const long = await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ ka: { ...KA, title: 'ა'.repeat(articles.LIMITS.titleMax + 1) }, en: EN, slug: a.slug }) });
    assert.equal(long.status, 400);
    assert.deepEqual([long.error, long.field, long.max], ['too_long', 'ka.title', articles.LIMITS.titleMax]);
    assert.equal((await pool.query('SELECT title_ka FROM articles WHERE id = $1', [a.id])).rows[0].title_ka, KA.title);
    // a long Georgian text is taken whole (three bytes a letter: the route has its own size limit)
    const body = ('ქართული ტექსტი, რომელიც გრძელია. '.repeat(900)).trim();
    assert.ok([...body].length > 25000 && [...body].length <= articles.LIMITS.bodyMax);
    const ok = await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ ka: { ...KA, body }, en: EN, slug: a.slug }) });
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    assert.equal(ok.article.ka.body, body);
    assert.equal((await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ en: EN, slug: a.slug }) })).status, 200);
  });

  test('the address no longer changes once public; another article cannot take it; bad addresses, dates and categories are refused', async () => {
    const moved = await admin.api(`/admin/articles/${a.id}`, { method: 'PATCH', body: draft({ en: EN, slug: 'another-address' }) });
    assert.deepEqual([moved.status, moved.error, moved.field], [400, 'slug_locked', 'slug']);
    const same = await admin.api('/admin/articles', { method: 'POST', body: draft({ slug: a.slug }) });
    assert.deepEqual([same.status, same.error], [409, 'slug_taken']);
    // the same title again: its own address, made unique
    const twin = (await admin.api('/admin/articles', { method: 'POST', body: draft() })).article;
    assert.equal(twin.slug, `${a.slug}-2`);
    for (const [over, code] of [[{ slug: 'Not A Slug' }, 'invalid_slug'], [{ slug: 'ქართული' }, 'invalid_slug'], [{ date: '2026-02-31' }, 'invalid_date'], [{ date: '2999-01-01' }, 'invalid_date'], [{ category: 'no-such-field' }, 'invalid_category']]) {
      assert.equal((await admin.api(`/admin/articles/${twin.id}`, { method: 'PATCH', body: draft(over) })).error, code, JSON.stringify(over));
    }
    // a draft's address can still be changed
    const renamed = await admin.api(`/admin/articles/${twin.id}`, { method: 'PATCH', body: draft({ slug: 'meore-statia' }) });
    assert.equal(renamed.article.slug, 'meore-statia');
    assert.equal(articles.slugify('რომელ ფაკულტეტზე ჩავაბარო?'), 'romel-fakultetze-chavabaro');
    assert.equal(articles.slugify('  Mixed ქართული & English!  '), 'mixed-kartuli-english');
    await admin.api(`/admin/articles/${twin.id}`, { method: 'DELETE' });
  });

  test('taken down: 404 again, out of the sitemap and the list; a published article cannot be deleted by mistake', async () => {
    const del = await admin.api(`/admin/articles/${a.id}`, { method: 'DELETE' });
    assert.deepEqual([del.status, del.error], [409, 'published']);
    assert.equal((await page(live, `/ka/advice-articles/${a.slug}`)).status, 200);
    const r = await admin.api(`/admin/articles/${a.id}/unpublish`, { method: 'POST' });
    assert.equal(r.article.status, 'draft');
    for (const p of [`/ka/advice-articles/${a.slug}`, `/advice-articles/${a.slug}`, '/ka/advice-articles', '/advice-articles']) assert.equal((await page(live, p)).status, 404, p);
    assert.doesNotMatch(await html(live, '/sitemap.xml'), /advice-articles/);
    assert.deepEqual((await client(live.base).api('/config')).articles, { ka: false, en: false });
    // published again: the same address, and the date it had
    const again = await admin.api(`/admin/articles/${a.id}/publish`, { method: 'POST' });
    assert.equal(again.article.slug, a.slug);
    assert.equal(again.article.date, '2026-11-15');
    assert.equal((await page(live, `/ka/advice-articles/${a.slug}`)).status, 200);
  });

  test('with no date typed, the date is the day of publishing (in Tbilisi)', async () => {
    const d = (await admin.api('/admin/articles', { method: 'POST', body: draft({ date: '', ka: { ...KA, title: 'სატესტო სტატია თარიღის გარეშე' } }) })).article;
    assert.equal(d.date, null);
    const p = (await admin.api(`/admin/articles/${d.id}/publish`, { method: 'POST' })).article;
    assert.equal(p.date, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' }));
    // the newest first on the list; each article names the others
    const list = await html(live, '/ka/advice-articles');
    assert.ok(list.indexOf('სატესტო სტატია თარიღის გარეშე') > 0);
    assert.match(await html(live, `/ka/advice-articles/${d.slug}`), /<nav class="help-nav article-more" aria-labelledby="articleMoreTitle">\s*<h2 id="articleMoreTitle">სხვა სტატიები<\/h2>/);
  });
});

describe('the admin form and the words', () => {
  test('the Articles tab is in the admin panel, with its own script; the form has no maxlength (nothing is cut) and asks before publishing', () => {
    const adminHtml = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
    assert.match(adminHtml, /<button class="chip" data-tab="articles" role="tab" data-i18n="admin\.tab\.articles">Articles<\/button>/);
    assert.match(adminHtml, /<script src="\/js\/admin-articles\.js"><\/script>/);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin-articles.js'), 'utf8');
    assert.doesNotMatch(js, /maxlength/);
    assert.match(js, /WisecallDialog\.confirm\(\{ message: t\('admin\.art\.publishConfirm'\)/);
    for (const name of ['kaTitle', 'kaIntro', 'kaBody', 'enTitle', 'enIntro', 'enBody', 'authorName', 'date', 'category', 'slug']) assert.ok(js.includes(`f.elements.${name}`), name);
    // (the admin script is an admin file: a visitor gets 403 for it, like the others)
    assert.ok(require('../server/adminAuth').isAdminFile('/js/admin-articles.js'));
  });

  test('every word of the form and the pages is in both languages', () => {
    const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', f), 'utf8'));
    const ka = read('admin-ka.json'), en = read('admin-en.json');
    const keys = Object.keys(ka).filter((k) => k.startsWith('admin.art.') || k === 'admin.tab.articles');
    assert.ok(keys.length > 50);
    for (const k of keys) assert.ok(en[k], `en ${k}`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin-articles.js'), 'utf8');
    for (const m of js.matchAll(/t\('(admin\.art\.[\w.]+)'\)/g)) assert.ok(ka[m[1]], m[1]);
    for (const code of ['incomplete', 'title_short', 'intro_short', 'body_short', 'no_language', 'author_required']) assert.ok(ka['admin.art.problem.' + code], code);
    for (const code of ['title_required', 'too_long', 'invalid_category', 'invalid_date', 'invalid_slug', 'slug_taken', 'slug_locked', 'not_ready', 'published', 'not_found']) assert.ok(ka['admin.art.err.' + code], code);
    for (const f of ['title', 'intro', 'body', 'authorName', 'date', 'category', 'slug']) assert.ok(ka['admin.art.field.' + f] && en['admin.art.field.' + f], f);
    const pka = read('ka.json'), pen = read('en.json');
    for (const k of ['articles.title', 'articles.intro', 'articles.meta.title', 'articles.more', 'articles.wait.title', 'articles.wait.body', 'articles.draft']) assert.ok(pka[k] && pen[k], k);
    // the link to them is in the menu, hidden until the server says there is an article in the page's language (the footer keeps its six links)
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'js', 'header.js'), 'utf8'), /<a href="\/advice-articles" data-i18n="articles\.title" data-articles hidden>/);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'js', 'nav.js'), 'utf8'), /link\.hidden = !\(cfg && cfg\.articles && cfg\.articles\[WisecallI18n\.getLang\(\) === 'ka' \? 'ka' : 'en'\]\);/);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', 'js', 'footer.js'), 'utf8'), /advice-articles/);
  });
});
