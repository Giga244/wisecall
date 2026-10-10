// The FAQ and "How we verify mentors" pages (written in by the server in the page's language, the FAQ also as FAQPage data), the
// footer's settings (the seller's legal details, card logos once payments are live) and the About page's founder section.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startServer, client } = require('./helpers');

let srv, base;
const html = async (p) => (await fetch(base + p)).text();

before(async () => {
  await resetDatabase();
  srv = await startServer(4716, {
    LEGAL_NAME: 'Wisecall LLC', LEGAL_ID: '400000000', LEGAL_ADDRESS: 'Tbilisi, Test street 1',
    FOUNDER_NAME: 'Test Founder', FOUNDER_ROLE: 'Founder', FOUNDER_STORY_EN: 'I started Wisecall because <good> advice is hard to find.', FOUNDER_PHOTO: 'https://evil.example/x.jpg'
  });
  base = srv.base;
});
after(() => srv && srv.proc.kill());

describe('the FAQ page', () => {
  test('every question is in the HTML, in groups, with the site settings filled in, and as FAQPage data', async () => {
    const h = await html('/faq.html');
    assert.match(h, /<h1 data-i18n="faq.page.title">Questions and answers<\/h1>/);
    assert.match(h, /How does Wisecall work\?/);
    assert.match(h, /Can I ask a follow-up question\?/);
    assert.doesNotMatch(h, /\{answerDays\}|\{disputeDays\}|\{priceMin\}|\{\{/);
    const ld = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h)[1]);
    assert.equal(ld['@type'], 'FAQPage');
    assert.equal(ld.mainEntity.length, (h.match(/<details class="faq-item"/g) || []).length);
    assert.ok(ld.mainEntity.length >= 14);
  });

  test('in Georgian at /ka/faq.html', async () => {
    const h = await html('/ka/faq.html');
    assert.match(h, /<html lang="ka"/);
    assert.match(h, /როგორ მუშაობს Wisecall\?/);
    assert.match(h, /<title>კითხვები და პასუხები — Wisecall<\/title>/);
  });
});

describe('the "How we verify mentors" page', () => {
  test('the steps, the badges and the regulated fields with links to their pages', async () => {
    const h = await html('/how-we-verify.html');
    assert.match(h, /A real person/);
    assert.match(h, /<a href="\/advice\/medicine">Medicine<\/a>/);
    assert.doesNotMatch(h, /\{date\}|\{\{/);
    const ka = await html('/ka/how-we-verify.html');
    assert.match(ka, /<a href="\/ka\/advice\/medicine">მედიცინა<\/a>/);
  });

  test('both pages are in the sitemap', async () => {
    const x = await html('/sitemap.xml');
    assert.match(x, /\/faq\.html<\/loc>/);
    assert.match(x, /\/how-we-verify\.html<\/loc>/);
  });
});

describe('every page arrives in its language (nothing is swapped after the first paint)', () => {
  const ka = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('the Georgian home: its texts and placeholder in Georgian, the Georgian font preloaded', async () => {
    const h = await html('/ka/');
    assert.match(h, new RegExp(`<span data-i18n="hero.title1">${esc(ka['hero.title1'])}</span>`));
    assert.match(h, new RegExp(`data-i18n-placeholder="home.search.placeholder" placeholder="${esc(ka['home.search.placeholder'])}"`));
    assert.match(h, /<link rel="preload" href="\/fonts\/noto-sans-georgian\.woff2\?v=[0-9a-f]+" as="font" type="font\/woff2" crossorigin>/);
    assert.doesNotMatch(await html('/'), /noto-sans-georgian/);
  });

  test('numbers from the settings are filled in; a text with a date or a name keeps the page\'s own words', async () => {
    const note = esc(ka['hero.note']).replace('\\{answerDays\\}', '\\d+');
    assert.match(await html('/ka/'), new RegExp(`data-i18n="hero.note">${note}</span>`));
    const h = await html('/ka/how-we-verify.html');
    assert.doesNotMatch(h, /\{[A-Za-z]+\}/);
    assert.match(h, /<span data-i18n="badge.id.tip">[^<{]+<\/span>/);
  });
});

describe('settings the pages read', () => {
  test('the legal details, card logos only when payments are live, and the founder (a picture from elsewhere is refused)', async () => {
    const cfg = await client(base).api('/config');
    assert.deepEqual(cfg.legal, { name: 'Wisecall LLC', id: '400000000', address: 'Tbilisi, Test street 1' });
    assert.equal(typeof cfg.paymentsLive, 'boolean');
    assert.equal(cfg.founder.name, 'Test Founder');
    assert.equal(cfg.founder.photo, '', 'only a picture on this site');
    assert.equal(cfg.founder.story.en, 'I started Wisecall because <good> advice is hard to find.', 'plain text: the page sets it as text');
  });
});

describe('the help centre', () => {
  test('the list and an article, in both languages; nothing unsettled is published; unknown articles are 404', async () => {
    const list = await html('/help.html');
    assert.match(list, /<a href="\/help\/refunds">Refunds<\/a>/);
    assert.match(list, /how-mentors-get-paid/, 'article 07 is published since withdrawals were built (PART 5)');
    // An article with a [CHECK] note (a fact not settled yet) waits: exactly the files without one are published.
    const fsx = require('fs');
    const dir = require('path').join(__dirname, '..', 'docs', 'help', 'en');
    const settled = fsx.readdirSync(dir).filter((f) => f.endsWith('.md') && !fsx.readFileSync(require('path').join(dir, f), 'utf8').includes('[CHECK'));
    assert.equal(require('../server/help').articles('en').length, settled.length);
    const a = await html('/help/refunds');
    assert.match(a, /<title>Refunds — Wisecall<\/title>/);
    assert.match(a, /<strong>full price<\/strong>/);
    assert.doesNotMatch(a, /\[CHECK/);
    const ka = await html('/ka/help/refunds');
    assert.match(ka, /<html lang="ka"/);
    assert.match(ka, /<h1>თანხის დაბრუნება<\/h1>/);
    assert.equal((await fetch(base + '/help/no-such-article')).status, 404);
    assert.match(await html('/sitemap.xml'), /\/ka\/help\/refunds<\/loc>/);
  });
});
