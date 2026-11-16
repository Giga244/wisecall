// Search engines and link previews: a Georgian address per page (/ka/...) with lang="ka", Georgian title and description, canonical and
// hreflang links both ways; a listed mentor's profile readable in the HTML itself (no API call needed) with structured data; a sitemap
// with both languages; error pages without a canonical address; sign-up and log-in not in search results.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');

let srv, base, username;
const get = (p) => fetch(base + p, { redirect: 'manual' });
const html = async (p) => (await get(p)).text();

before(async () => {
  await resetDatabase();
  srv = await startServer(4715, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const m = await signupVerified(base, 'Tamar Lomidze', 'tamar@example.com');
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Marketing lead', niche: 'marketing', price: 25, sampleAnswer: SAMPLE, bio: 'I help small shops <b>grow</b> online. "Quotes" & ampersands.' } });
  await approveMentor(admin, m);
  await addPayoutDetails(m, undefined, 'Tamar Lomidze');
  username = (await m.api('/me')).user.username;
});
after(() => srv && srv.proc.kill());

describe('a Georgian address for every page', () => {
  test('/ka/ is the home page in Georgian: lang, title, description, canonical, hreflang, og:locale', async () => {
    const h = await html('/ka/');
    assert.match(h, /<html lang="ka"/);
    assert.match(h, /<title>Wisecall — ჰკითხე გადამოწმებულ ექსპერტებს<\/title>/);
    assert.match(h, /name="description" content="გადაიხადე/);
    assert.match(h, new RegExp(`<link rel="canonical" href="${base}/ka/">`));
    assert.match(h, new RegExp(`hreflang="en" href="${base}/"`));
    assert.match(h, new RegExp(`hreflang="x-default" href="${base}/ka/"`));
    assert.match(h, /property="og:locale" content="ka_GE"/);
    assert.equal((await get('/ka')).status, 301);
  });

  test('the English page names the Georgian one, and stays English', async () => {
    const h = await html('/about.html');
    assert.match(h, /<html lang="en"/);
    assert.match(h, /<title>About Wisecall — how it works<\/title>/);
    assert.match(h, new RegExp(`hreflang="ka" href="${base}/ka/about.html"`));
    assert.match(h, /property="og:locale" content="ka_GE"/, "a bare address is previewed in Georgian"); assert.match(await html("/en/about.html"), /property="og:locale" content="en_US"/);
    assert.match(await html('/ka/about.html'), /<title>Wisecall-ის შესახებ — როგორ მუშაობს<\/title>/);
  });

  test('/ka/ does not open the API or anything else under another name', async () => {
    assert.equal((await get('/ka/api/config')).status, 404);
  });
});

describe('a mentor profile without scripts', () => {
  test('the name, role, bio and price are in the HTML (escaped); structured data names the person and the offer', async () => {
    const h = await html(`/u/${username}`);
    assert.match(h, /<h1>Tamar Lomidze<\/h1>/);
    assert.match(h, /Marketing lead/);
    // (in the page's final layout; the photo, badges, stats and the box for a question as skeletons, hidden from screen readers, with
    // one "Loading…" for them)
    assert.match(h, /<article class="profile-card profile-ssr">/);
    for (const part of h.match(/<[a-z]+ [^>]*data-skeleton[^>]*>/g)) {
      if (!/role="status"/.test(part)) assert.match(part, /aria-hidden="true"/, part);
    }
    assert.equal((h.match(/role="status" data-i18n="experts\.loading" data-skeleton>Loading…</g) || []).length, 1);
    assert.match(h, /I help small shops &lt;b&gt;grow&lt;\/b&gt; online\. &quot;Quotes&quot; &amp; ampersands\./);
    assert.match(h, /25 GEL per question/);
    const ld = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h);
    assert.ok(ld, 'JSON-LD is there');
    const data = JSON.parse(ld[1]);
    const types = data['@graph'].map((x) => x['@type']);
    assert.deepEqual(types.sort(), ['BreadcrumbList', 'Person', 'ProfilePage', 'Service']);
    const service = data['@graph'].find((x) => x['@type'] === 'Service');
    assert.equal(service.offers.priceCurrency, 'GEL');
    assert.equal(service.aggregateRating, undefined, 'no rating without real reviews');
    assert.ok(!ld[1].includes('<'), 'nothing in the data can close the tag');
  });

  test('in Georgian the description is Georgian and cut at a word', async () => {
    const h = await html(`/ka/u/${username}`);
    assert.match(h, /<html lang="ka"/);
    assert.match(h, /name="description" content="დაუსვი კითხვა: Tamar Lomidze \(Marketing lead\), 25 ₾\./);
    assert.match(h, /<span class="muted small">ფასი<\/span><strong>25 ₾ ერთ კითხვაზე<\/strong>/); // (a label over the value, as the page script shows it)
    assert.match(h, new RegExp(`<link rel="canonical" href="${base}/ka/u/${username}">`));
  });
});

describe('the home page, sitemap, robots and small pages', () => {
  test('the home page describes the organisation and the site', async () => {
    const h = await html('/');
    const data = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h)[1]);
    assert.deepEqual(data['@graph'].map((x) => x['@type']), ['Organization', 'WebSite']);
  });

  test('the sitemap lists both languages with alternates, and leaves out sign-up and log-in', async () => {
    const x = await html('/sitemap.xml');
    assert.match(x, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.match(x, new RegExp(`<loc>${base}/ka/about.html</loc>`));
    assert.match(x, new RegExp(`<loc>${base}/u/${username}</loc>`));
    assert.match(x, new RegExp(`<loc>${base}/ka/u/${username}</loc>`));
    assert.match(x, /hreflang="x-default"/);
    assert.doesNotMatch(x, /signup\.html|login\.html/);
  });

  test('robots.txt keeps the API and the admin page out, and lets crawlers see the noindex pages', async () => {
    const r = await html('/robots.txt');
    assert.match(r, /Disallow: \/api\//);
    assert.match(r, /Disallow: \/admin\.html/);
    assert.doesNotMatch(r, /Disallow: \/dashboard\.html/);
    assert.match(await html('/signup.html'), /<meta name="robots" content="noindex, follow">/);
  });

  test('error pages have no canonical address', async () => {
    const h = await html('/no-such-page');
    assert.doesNotMatch(h, /rel="canonical"/);
    assert.match(h, /<html lang="en"/);
  });
});
