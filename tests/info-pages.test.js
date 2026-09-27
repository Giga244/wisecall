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
    assert.doesNotMatch(list, /how-mentors-get-paid/, 'an article with a [CHECK] note waits');
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
