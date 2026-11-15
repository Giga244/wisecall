// SEO and AI visibility, stage 1 (docs/CLAUDE-CODE-SEO.md): /llms.txt (its addresses from PUBLIC_URL, its facts from the settings), the
// search engines' verification tags (only when their codes are set, only on the home page), /match's own title and description, the home
// page's description before launch, a unique title and description on every page of the sitemap, the organisation's other names and
// social pages in the structured data, and the name in Georgian letters on the About page. (The articles: tests/articles.test.js.)
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, resetDatabase, startServer } = require('./helpers');

const SOCIAL = { SOCIAL_INSTAGRAM: 'https://www.instagram.com/wisecallge/', SOCIAL_TIKTOK: 'https://www.tiktok.com/@wisecall.ge', SOCIAL_FACEBOOK: 'https://www.facebook.com/Wisecall.ge' };
let live, pre;
const get = (srv, p) => fetch(srv.base + p, { redirect: 'manual' });
const html = async (srv, p) => (await get(srv, p)).text();
const head = (h) => ({
  title: (/<title>([^<]*)<\/title>/.exec(h) || [])[1],
  description: (/<meta name="description" content="([^"]*)">/.exec(h) || [])[1],
  robots: (/<meta name="robots" content="([^"]*)">/.exec(h) || [])[1]
});
const unescape = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const jsonLd = (h) => JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(h)[1]);

before(async () => {
  await resetDatabase();
  // "live": open, other numbers than the usual ones (5 days, the mentor keeps 70%), no support address, no verification codes.
  live = await startServer(4881, { RATE_LIMIT_MULTIPLIER: '50', ANSWER_DEADLINE_DAYS: '5', PLATFORM_FEE_PERCENT: '30' });
  // "pre": before launch, as the live site is today: the support address, the social pages and both verification codes set.
  pre = await startServer(4882, { RATE_LIMIT_MULTIPLIER: '50', LAUNCH_MODE: 'prelaunch', SUPPORT_EMAIL: 'support@wisecallge.ge', ...SOCIAL,
    GOOGLE_SITE_VERIFICATION: 'g00gle-Code_123456', BING_SITE_VERIFICATION: 'B1NGC0DE4567890' });
});
after(() => { for (const s of [live, pre]) if (s) s.proc.kill(); });

describe('/llms.txt', () => {
  test('before launch: exactly the text of the brief, the addresses from PUBLIC_URL', async () => {
    const r = await get(pre, '/llms.txt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/plain/);
    const u = pre.base;
    assert.equal(await r.text(), [
      '# Wisecall',
      '',
      '> Wisecall (უაისქოლი) is a Georgian platform where students and young people ask verified experts questions about their field, studies and career, and get a written answer.',
      '',
      `- Site: ${u} (Georgian: ${u}/ka/)`,
      '- Status: opening soon; a waitlist is open now.',
      '- Languages: Georgian and English.',
      '- How it works: choose an expert in your field, write your question, get a written answer within 7 days or your money back.',
      '- Mentors: adults, ID-verified; they set their own price or answer for free, and keep 80%.',
      '- Askers: 16 and older. Written only, no calls; personal contacts are protected.',
      '- Contact: support@wisecallge.ge',
      '',
      '## Pages',
      `- [How we verify mentors](${u}/ka/how-we-verify.html)`,
      `- [Find your mentor (matching)](${u}/ka/match)`,
      `- [Become a mentor](${u}/ka/become-a-mentor.html)`,
      `- [FAQ](${u}/ka/faq.html)`,
      `- [Help center](${u}/ka/help.html)`,
      `- [About](${u}/ka/about.html)`,
      ''
    ].join('\n'));
    // every page it names exists
    for (const p of ['/ka/how-we-verify.html', '/ka/match', '/ka/become-a-mentor.html', '/ka/faq.html', '/ka/help.html', '/ka/about.html']) assert.equal((await get(pre, p)).status, 200, p);
  });

  test('the facts follow the settings: the days to answer, the mentor\'s share, the askers\' age; open after launch; no contact line without an address', async () => {
    const t = await html(live, '/llms.txt');
    assert.match(t, /get a written answer within 5 days or your money back\./);
    assert.match(t, /and keep 70%\./);
    assert.match(t, new RegExp(`- Askers: ${require('../server/ageGate').MIN_ASKER_AGE} and older\\.`));
    assert.match(t, /- Status: open\.\n/);
    assert.doesNotMatch(t, /waitlist|Contact:/);
    assert.match(t, new RegExp(`- Site: ${live.base} \\(Georgian: ${live.base}/ka/\\)`));
    // (read from the settings, not typed in: the numbers of the usual settings are nowhere in the code that writes it)
    const src = fs.readFileSync(path.join(ROOT, 'server', 'pages.js'), 'utf8');
    const fn = src.slice(src.indexOf('function llmsTxt()'), src.indexOf('function llmsTxt()') + 2200);
    assert.match(fn, /config\.ANSWER_DEADLINE_DAYS/);
    assert.match(fn, /100 - config\.PLATFORM_FEE_PERCENT/);
    assert.match(fn, /require\('\.\/ageGate'\)\.MIN_ASKER_AGE/);
    assert.doesNotMatch(fn, /within 7 days|keep 80%|Askers: 16/);
  });

  test('robots.txt still lets every crawler read the site, llms.txt included', async () => {
    const r = await html(pre, '/robots.txt');
    assert.match(r, /^User-agent: \*\nDisallow: \/api\/\nDisallow: \/admin\.html\nDisallow: \/ka\/admin\.html\nSitemap: /);
    assert.doesNotMatch(r, /llms|GPTBot|ClaudeBot/);
  });
});

describe('search engine verification', () => {
  test('with the codes set: both tags on the home page, in both languages, once; nowhere else', async () => {
    for (const p of ['/', '/ka/', '/index.html']) {
      const h = await html(pre, p);
      assert.equal((h.match(/<meta name="google-site-verification" content="g00gle-Code_123456">/g) || []).length, 1, p);
      assert.equal((h.match(/<meta name="msvalidate\.01" content="B1NGC0DE4567890">/g) || []).length, 1, p);
      assert.ok(h.indexOf('google-site-verification') < h.indexOf('</head>'), 'in the head');
    }
    for (const p of ['/about.html', '/ka/match', '/ka/faq.html']) assert.doesNotMatch(await html(pre, p), /google-site-verification|msvalidate/, p);
  });

  test('with no code: no tag at all', async () => {
    for (const p of ['/', '/ka/']) assert.doesNotMatch(await html(live, p), /google-site-verification|msvalidate/, p);
  });

  test('a value that is not a code (markup, spaces) is not put in the page', () => {
    const read = (value) => execFileSync(process.execPath, ['-e', "const c = require('./server/config'); process.stdout.write(JSON.stringify([c.GOOGLE_SITE_VERIFICATION, c.BING_SITE_VERIFICATION]))"],
      { cwd: ROOT, env: { ...process.env, NODE_ENV: '', GOOGLE_SITE_VERIFICATION: value, BING_SITE_VERIFICATION: value }, encoding: 'utf8' });
    assert.equal(read('"><script>alert(1)</script>'), '["",""]');
    assert.equal(read('two words'), '["",""]');
    assert.equal(read('  abcDEF_123-xyz=  '), '["abcDEF_123-xyz=","abcDEF_123-xyz="]');
    // (they are in every visitor's page: public values, not secrets; docs/SECRETS.md)
    const src = fs.readFileSync(path.join(ROOT, 'server', 'secrets.js'), 'utf8');
    assert.match(src, /const PUBLIC = \[[^\]]*'GOOGLE_SITE_VERIFICATION', 'BING_SITE_VERIFICATION'\]/);
    for (const f of ['.env.example', 'DEPLOY.md', 'docs/SECRETS.md']) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.match(text, /GOOGLE_SITE_VERIFICATION/, f);
      assert.match(text, /BING_SITE_VERIFICATION/, f);
    }
  });
});

describe('titles and descriptions', () => {
  test('/match has its own, in both languages (and its other addresses are the same page)', async () => {
    const config = require('../server/matchConfig');
    for (const p of ['/ka/match', '/ka/find-a-mentor.html']) {
      const m = head(await html(live, p));
      assert.equal(m.title, 'იპოვე შენი მენტორი — Wisecall', p);
      assert.equal(m.description, 'მოგვიყევი შენ შესახებ და უფასოდ შეგირჩევთ 3 გადამოწმებულ მენტორს, ვინც შენსავით დაიწყო.', p);
    }
    for (const p of ['/match', '/en/match']) {
      const m = head(await html(live, p));
      assert.equal(m.title, 'Find your mentor — Wisecall', p);
      assert.equal(unescape(m.description), "Tell us about yourself and we'll pick 3 verified mentors who started like you. Free.", p);
    }
    assert.equal(config.top, 3, 'the description says 3: the number of mentors the matching shows');
    const h = await html(live, '/ka/match');
    assert.match(h, /<meta property="og:title" content="იპოვე შენი მენტორი — Wisecall">/);
    assert.match(h, /<meta property="og:description" content="მოგვიყევი შენ შესახებ/);
  });

  test('the home page before launch does not talk about paying; after launch its usual words are back', async () => {
    const ka = head(await html(pre, '/ka/'));
    assert.equal(ka.description, 'ჰკითხე მას, ვინც ეს გზა უკვე გაიარა: შენი სფეროს გადამოწმებული ექსპერტი წერილობით გიპასუხებს 7 დღეში. Wisecall მალე იხსნება — ჩაეწერე მოლოდინის სიაში.');
    assert.equal(ka.title, 'Wisecall — ჰკითხე გადამოწმებულ ექსპერტებს');
    const en = head(await html(pre, '/'));
    assert.equal(en.description, 'Ask someone who has already walked this path: a verified expert in your field answers in writing within 7 days. Wisecall opens soon — join the waitlist.');
    for (const d of [ka.description, en.description]) { assert.ok(d.length <= 160, `${d.length} characters`); assert.doesNotMatch(d, /გადაიხადე|Pay per/); }
    // (the share tags and the site's structured data say the same)
    const h = await html(pre, '/ka/');
    assert.match(h, /<meta property="og:description" content="ჰკითხე მას, ვინც ეს გზა უკვე გაიარა:/);
    assert.equal(jsonLd(h)['@graph'].find((x) => x['@type'] === 'WebSite').description, ka.description);
    // after launch (and with 5 days set: the number comes from the settings where the text names it)
    assert.match(head(await html(live, '/ka/')).description, /^გადაიხადე ერთ კითხვაში/);
    assert.match(head(await html(live, '/')).description, /^Pay per question/);
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', 'ka.json'), 'utf8'));
    assert.match(dict['meta.index.description.prelaunch'], /\{answerDays\} დღეში/);
  });

  test('every page of the sitemap answers 200 and has a title and a description no other page has, in both languages', async () => {
    for (const srv of [pre, live]) {
      const locs = [...(await html(srv, '/sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      assert.ok(locs.length >= 20, `${locs.length} pages`);
      assert.equal(new Set(locs).size, locs.length, 'no address twice');
      const titles = new Map(), descriptions = new Map();
      for (const loc of locs) {
        const r = await fetch(loc, { redirect: 'manual' });
        assert.equal(r.status, 200, loc);
        const m = head(await r.text());
        assert.ok(m.title && m.title.trim().length >= 10, `${loc}: a title`);
        assert.ok(m.description && m.description.trim().length >= 30, `${loc}: a description`);
        assert.ok(!/noindex/.test(m.robots || ''), `${loc}: a page in the sitemap may be indexed`);
        assert.ok(!titles.has(m.title), `${loc} has the title of ${titles.get(m.title)}: ${m.title}`);
        assert.ok(!descriptions.has(m.description), `${loc} has the description of ${descriptions.get(m.description)}`);
        titles.set(m.title, loc);
        descriptions.set(m.description, loc);
        // (what a search result can show: a title that is not cut far, a description of about 160 characters)
        assert.ok(unescape(m.title).length <= 70, `${loc}: the title is ${unescape(m.title).length} characters`);
        // (about 160. The longest today: the English home page after launch, 168 characters; told to the owner, whose text it is)
        assert.ok(unescape(m.description).length <= 170, `${loc}: the description is ${unescape(m.description).length} characters`);
      }
    }
  });

  test('before launch a field\'s page is not in the sitemap, and is not indexed', async () => {
    const x = await html(pre, '/sitemap.xml');
    assert.doesNotMatch(x, /\/advice\//);
    assert.match(x, /\/match<\/loc>/);
    assert.equal(head(await html(pre, '/ka/advice/design')).robots, 'noindex');
  });
});

describe('the brand: who Wisecall is', () => {
  test('the organisation on /ka/: its other names, what it is (in Georgian), the country, the languages, the social pages', async () => {
    const org = jsonLd(await html(pre, '/ka/'))['@graph'].find((x) => x['@type'] === 'Organization');
    assert.equal(org.name, 'Wisecall');
    assert.deepEqual(org.alternateName, ['უაისქოლი', 'Wisecall Georgia']);
    assert.equal(org.description, 'Wisecall (უაისქოლი) ქართული პლატფორმაა, სადაც სტუდენტები და ახალგაზრდები გადამოწმებულ ექსპერტებს უსვამენ კითხვებს სფეროზე, სწავლასა და კარიერაზე და წერილობით პასუხს იღებენ.');
    assert.equal(org.areaServed, 'GE');
    assert.deepEqual(org.knowsLanguage, ['ka', 'en']);
    assert.equal(org.email, 'support@wisecallge.ge');
    assert.deepEqual([...org.sameAs].sort(), Object.values(SOCIAL).sort(), 'Instagram, TikTok and Facebook');
    // in English: the same organisation, described in English
    const en = jsonLd(await html(pre, '/'))['@graph'].find((x) => x['@type'] === 'Organization');
    assert.match(en.description, /^Wisecall \(უაისქოლი\) is a Georgian platform where students and young people ask verified experts/);
    assert.deepEqual(en.alternateName, org.alternateName);
    assert.equal(en['@id'], org['@id']);
  });

  test('Instagram, TikTok and Facebook are Wisecall\'s own pages unless a setting changes or hides one', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    for (const url of Object.values(SOCIAL)) assert.ok(src.includes(`'${url}'`), url);
  });

  test('the About page (Georgian) says the name once in Georgian letters, in the text people read', async () => {
    const h = await html(pre, '/ka/about.html');
    const main = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
    assert.equal((main.match(/Wisecall \(უაისქოლი\)/g) || []).length, 1);
    assert.match(main, /<p class="legal-intro" data-i18n="legal\.about\.intro">Wisecall \(უაისქოლი\) აძლევს დამწყებ ადამიანებს/);
    assert.doesNotMatch(main, /hidden[^>]*>[^<]*უაისქოლი/);
  });
});
