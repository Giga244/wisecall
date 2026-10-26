// Fixes from the live-site walkthrough (docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md): every help article in Georgian; links on Georgian pages
// lead to Georgian pages; no link to live sessions in the footer; no calls or video in what we tell people; a mentor who answers for free
// is listed without a bank account and asked for one only when they set a price; askers are told some mentors answer for free.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

const HELP = path.join(ROOT, 'docs', 'help');
const dict = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', `${l}.json`), 'utf8'));
const georgianShare = (s) => {
  const geo = (s.match(/[ა-ჿ]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  return geo / Math.max(1, geo + lat);
};
let srv, base;
const html = async (p) => (await fetch(base + p)).text();

before(async () => {
  await resetDatabase();
  srv = await startServer(4776, { LIVE_SESSIONS: 'off' });
  base = srv.base;
});
after(() => { if (srv) srv.proc.kill(); });

describe('1. the help centre in Georgian', () => {
  test('every help article has a Georgian version, written in Georgian (title and body)', () => {
    const en = fs.readdirSync(path.join(HELP, 'en')).filter((f) => f.endsWith('.md'));
    const ka = new Set(fs.readdirSync(path.join(HELP, 'ka')));
    assert.ok(en.length >= 17);
    for (const f of en) {
      assert.ok(ka.has(f), `docs/help/ka/${f} is missing`);
      const text = fs.readFileSync(path.join(HELP, 'ka', f), 'utf8');
      const title = text.split(/\r?\n/)[0];
      assert.ok(georgianShare(title) > 0.8, `${f}: the title is not in Georgian: ${title}`);
      assert.ok(georgianShare(text) > 0.9, `${f}: the body is not in Georgian`);
    }
  });

  test('/ka/help.html and every article are Georgian, with Georgian links', async () => {
    const list = await html('/ka/help.html');
    assert.match(list, /<h1[^>]*>დახმარების ცენტრი<\/h1>/);
    const links = [...list.matchAll(/<a href="(\/ka\/help\/[a-z0-9-]+)">([^<]+)<\/a>/g)];
    assert.ok(links.length >= 17, 'all the articles are listed');
    for (const [, href, title] of links) {
      assert.ok(georgianShare(title) > 0.8, `${href}: ${title}`);
      const page = await html(href);
      const body = /<article class="help-article">([\s\S]*?)<\/article>/.exec(page)[1].replace(/<[^>]+>/g, ' ');
      assert.ok(georgianShare(body) > 0.9, `${href} is not in Georgian`);
    }
    // the pricing article covers free answers in both languages
    assert.match(await html('/ka/help/how-payment-works'), /უფასო კითხვები/);
    assert.match(await html('/help/how-payment-works'), /Free questions/);
  });

  test('a visitor who chose Georgian and opens an English address of a server-written page is sent to its Georgian address', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
    assert.match(js, /lang === 'ka' && !onKaPath\(\) && document\.querySelector\('meta\[name="wisecall-server-lang"\]'\)\) \{\s*location\.replace\('\/ka' \+ path\(\)/);
    for (const page of ['help', 'answers', 'answer', 'advice', 'requests']) {
      assert.match(fs.readFileSync(path.join(ROOT, 'public', `${page}.html`), 'utf8'), /<meta name="wisecall-server-lang" content="1">/, page);
    }
  });
});

describe('2. links on Georgian pages', () => {
  const { kaHref } = require('../server/pages');
  test('a page link gets /ka; files, the API and Georgian addresses do not', () => {
    for (const [from, to] of [['/answers', '/ka/answers'], ['/', '/ka/'], ['/help.html', '/ka/help.html'], ['/index.html#experts', '/ka/index.html#experts'],
      ['/signup.html?as=mentor', '/ka/signup.html?as=mentor'], ['/u/nino', '/ka/u/nino'], ['/help/refunds', '/ka/help/refunds'], ['/advice/law', '/ka/advice/law'],
      ['/ka/answers', '/ka/answers'], ['/ka', '/ka'], ['/css/style.css?v=1', '/css/style.css?v=1'], ['/js/i18n.js', '/js/i18n.js'], ['/api/receipts/x.pdf', '/api/receipts/x.pdf'],
      ['/og-image-1200x630.png', '/og-image-1200x630.png'], ['/sitemap.xml', '/sitemap.xml'], ['//cdn.example.com/x', '//cdn.example.com/x'], ['https://example.com/', 'https://example.com/'],
      ['mailto:a@b.ge', 'mailto:a@b.ge'], ['#top', '#top']]) {
      assert.equal(kaHref(from), to, from);
    }
    // the browser uses the same rule
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
    const server = fs.readFileSync(path.join(ROOT, 'server', 'pages.js'), 'utf8');
    const rule = (src) => /const KA_SKIP = (\/.*\/);/.exec(src)[1];
    assert.equal(rule(js), rule(server));
  });

  test('every link in the Georgian pages the server sends leads to a Georgian page', async () => {
    for (const p of ['/ka/', '/ka/about.html', '/ka/faq.html', '/ka/help.html', '/ka/help/refunds', '/ka/become-a-mentor.html', '/ka/how-we-verify.html',
      '/ka/answers', '/ka/contact.html', '/ka/terms.html', '/ka/privacy.html', '/ka/advice/law', '/ka/find-a-mentor.html', '/ka/login.html', '/ka/signup.html']) {
      const page = await html(p);
      const english = [...page.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)].map((m) => m[1]).filter((h) => h !== require('../server/pages').kaHref(h) || (/^\/(?!ka\b)/.test(h) && !/^\/(api|js|css|fonts)\//.test(h) && !/\.(png|svg|ico|xml|txt|pdf|webmanifest)(\?|$)/.test(h)));
      assert.deepEqual(english, [], p);
    }
    // ... and an English page keeps English links
    assert.match(await html('/about.html'), /<a href="\/contact\.html"/);
  });
});

describe('3. no live sessions in the footer', () => {
  test('the footer has no link to /live', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'footer.js'), 'utf8');
    assert.doesNotMatch(js, /href="\/live|footerLive/);
  });
});

describe('4. no calls, video or meetings in what we tell people', () => {
  // (the emergency advice to call 112 stays: it is not a call with us)
  const EN = /\bvideo\b|\bmeetings?\b|\bmeet (?:you|a mentor|on)\b|\bcalls?\b(?!\s+(?:112|\*\*112|the emergency))/i;
  const KA = /ვიდეო|შეხვედრ|ზარი|ზარით|ზარს|ზარზე/;
  const words = (v) => (typeof v === 'string' ? [v] : (v && typeof v === 'object' ? Object.values(v).flatMap(words) : []));
  test('the help articles (live sessions are switched off and hidden)', () => {
    for (const [l, re] of [['en', EN], ['ka', KA]]) {
      for (const f of fs.readdirSync(path.join(HELP, l)).filter((x) => x.endsWith('.md') && !x.includes('live-sessions'))) {
        const lines = fs.readFileSync(path.join(HELP, l, f), 'utf8').split(/\r?\n/).filter((s) => re.test(s) && !/112/.test(s));
        assert.deepEqual(lines, [], `${l}/${f}`);
      }
    }
  });
  test('the public pages: about, how we verify, the mentors\' page, the FAQ, the home page, the meta texts', () => {
    const PUBLIC = /^(legal\.about|hv\.|faq\.|mentors\.|how\.|hero\.|meta\.(?!live)|home\.|wait\.|vt\.level\.)/;
    for (const [l, re] of [['en', EN], ['ka', KA]]) {
      const d = dict(l);
      const hits = Object.entries(d).filter(([k]) => PUBLIC.test(k)).flatMap(([k, v]) => words(v).filter((s) => re.test(s) && !/112/.test(s)).map((s) => `${k}: ${s}`));
      assert.deepEqual(hits, [], l);
    }
    assert.match(dict('ka')['legal.about.sections'][2].p[1], /ერთი დამატებითი დოკუმენტიც/);
    assert.match(dict('en')['hv.4.body'], /one more document/);
  });
});

describe('5. a mentor who answers for free needs no bank account', () => {
  let admin;
  before(async () => { admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com'); });
  const listed = async (id) => (await client(base).api('/experts')).experts.some((e) => e.id === id);

  test('approved at price 0 with no payout details: listed; a price makes them ask for payout details and leave the list until they add them', async () => {
    const m = await signupVerified(base, 'Free Fiona', 'fiona@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Beekeeper', niche: 'business', price: 0, proofUrl: 'https://linkedin.com/in/fiona', sampleAnswer: SAMPLE } });
    const id = await approveMentor(admin, m);
    let me = (await m.api('/me')).user;
    assert.equal(me.hasPayoutDetails, false);
    assert.equal(me.needsPayout, false, 'nothing to ask for while free');
    assert.equal(me.isListedMentor, true);
    assert.ok(await listed(id), 'in Browse experts with no bank account');
    // a price: asked for payout details now, and off the list until they are saved (a paid question must be payable)
    const r = await m.api('/me', { method: 'PATCH', body: { price: 25 } });
    assert.equal(r.status, 200);
    assert.equal(r.payoutNeeded, true);
    assert.equal(r.user.needsPayout, true);
    assert.equal(await listed(id), false);
    await addPayoutDetails(m);
    assert.ok(await listed(id));
    me = (await m.api('/me')).user;
    assert.equal(me.needsPayout, false);
    // back to free, then a price again: payout details are already there, nothing to ask
    await m.api('/me', { method: 'PATCH', body: { price: 0 } });
    const again = await m.api('/me', { method: 'PATCH', body: { price: 30 } });
    assert.equal(again.payoutNeeded, undefined);
    assert.ok(await listed(id));
  });

  test('a paid mentor still needs payout details to be listed', async () => {
    const m = await signupVerified(base, 'Paid Paul', 'paul@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Accountant', niche: 'business', price: 30, proofUrl: 'https://linkedin.com/in/paul', sampleAnswer: SAMPLE } });
    const id = await approveMentor(admin, m);
    assert.equal(await listed(id), false);
    assert.equal((await m.api('/me')).user.needsPayout, true);
  });

  test('the approval email of a free mentor does not ask for a bank account; the texts say a bank account is needed only with a price', () => {
    const { render } = require('../server/mail/templates');
    for (const l of ['en', 'ka']) {
      const free = render('mentorApproved', l, { free: true }).text;
      assert.doesNotMatch(free, /IBAN/);
      assert.match(render('mentorApproved', l, {}).text, /IBAN/);
    }
    assert.match(render('mentorApproved', 'en', { free: true }).text, /you need no bank account/);
    assert.match(dict('en')['mentors.how.3.body'], /if you charge a price, add your bank account first/);
    assert.match(dict('ka')['mentors.how.3.body'], /თუ ფასს აწესებ, ჯერ საბანკო ანგარიში დაამატე/);
    for (const l of ['en', 'ka']) assert.match(fs.readFileSync(path.join(HELP, l, '05-become-a-mentor.md'), 'utf8'), l === 'en' ? /answers for free needs no bank account/ : /უფასოდ პასუხობს, საბანკო ანგარიში არ სჭირდება/);
  });
});

describe('6. askers are told some mentors answer for free', () => {
  test('the home page, the FAQ, About, the meta description and Terms section 1, in English and Georgian', async () => {
    for (const [l, line] of [['en', 'Some mentors answer for free.'], ['ka', 'ზოგი მენტორი უფასოდ პასუხობს.']]) {
      const d = dict(l);
      for (const k of ['how.short.2.body', 'faq.2.a', 'meta.index.description']) assert.ok(d[k].includes(line), `${l} ${k}`);
      assert.ok(d['legal.about.sections'][3].p[0].includes(line), `${l} about`);
    }
    assert.match(dict('en')['legal.terms.sections'][0].p[0], /pay the mentor’s price to ask a question, or nothing if the mentor answers for free/);
    assert.match(dict('ka')['legal.terms.sections'][0].p[0], /მენტორის დადგენილ ფასს იხდის, ან არაფერს, თუ მენტორი უფასოდ პასუხობს/);
    const home = await html('/ka/');
    assert.match(home, /<meta name="description" content="[^"]*ზოგი მენტორი უფასოდ პასუხობს\./);
    assert.match(home, /ზოგი მენტორი უფასოდ პასუხობს\./);
    assert.match(await html('/'), /<meta name="description" content="[^"]*Some mentors answer for free\./);
  });
});
