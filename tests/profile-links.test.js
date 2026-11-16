// Profile links never block a mentor. An associate professor wrote her ResearchGate, ORCID and LinkedIn links on step 2 of the application
// and could not go on: the ORCID iD in the address (0000-0002-1825-0097) was read as a phone number, so the link was refused as "a contact
// link", and with it the whole step. And, once sent, the automatic check called ResearchGate "a dead link", because it answers 403 to
// every robot. So:
//   - a link is refused only when it is clearly not one (not an address, another scheme) or clearly a way to be contacted (a messenger,
//     a payment page, an email address, a phone number written as one); a run of digits in an address is an id
//   - known profile sites (LinkedIn, ResearchGate, ORCID, Google Scholar, Academia.edu, Publons / Web of Science, Behance, Dribbble,
//     GitHub) are accepted by their address alone and never opened by the server
//   - a site that does not answer, or refuses a robot, is "couldn't check automatically" for the admin, never "dead", and never holds
//     the mentor back; only a page the site itself says is gone (404, 410), or a name that does not exist, is a dead link
//   - step 4 takes a link pasted without "https://"
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, wait } = require('./helpers');
const { createFakeWeb } = require('./fakeAnthropic');
const mentorStory = require('../server/mentorStory');
const linkCheck = require('../server/verification/linkCheck');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const web = createFakeWeb();
let srv, base, admin, closedPort;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HER_LINKS = ['https://www.researchgate.net/profile/Nino-Kiknadze-2', 'https://orcid.org/0000-0002-1825-0097', 'https://www.linkedin.com/in/nino-kiknadze-12345678/'];
const PATH = {
  pathStart: 'I grew up in Kutaisi and came to Tbilisi to study psychology with no idea that it could become a profession for me.',
  pathHow: 'I worked as a school psychologist during my studies, then wrote my thesis on how teenagers choose what to study and stayed to teach.',
  pathNow: 'I am an associate professor now. I teach educational psychology and supervise students who are choosing their first research topic.'
};
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); }
}
const links = (list) => mentorStory.parse({ workLinks: list }, { draft: true, current: {} });

before(async () => {
  await resetDatabase();
  await web.start();
  // (a port nothing listens on: a site that does not answer)
  closedPort = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  srv = await startServer(4895, { RATE_LIMIT_MULTIPLIER: '50', LINK_CHECK_ALLOW_PRIVATE: '1', RDAP_BASE_URL: web.url('/rdap/') });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await web.stop(); await pool.end(); });

describe('step 2, the links of "My path": only what is clearly not a link, or clearly a contact, is refused', () => {
  test('her three links are kept exactly as she wrote them', () => {
    const r = links(HER_LINKS);
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.deepEqual(r.patch.workLinks, HER_LINKS);
  });

  test('every known profile site is accepted by its address alone, whatever numbers it carries', () => {
    for (const l of [
      'https://orcid.org/0000-0002-1825-0097', 'orcid.org/0000-0002-1825-0097', 'https://www.researchgate.net/profile/Nino_Kiknadze',
      'https://www.linkedin.com/in/nino-kiknadze-0a123456', 'https://ge.linkedin.com/in/nino-kiknadze-599123456',
      'https://scholar.google.com/citations?user=AbCdEfGhIjK&hl=en', 'https://scholar.google.ge/citations?user=AbCdEfGhIjK',
      'https://tsu-ge.academia.edu/NinoKiknadze', 'https://www.webofscience.com/wos/author/record/12345678901', 'https://publons.com/researcher/1234567/nino-kiknadze/',
      'https://www.behance.net/ninok', 'https://dribbble.com/ninok', 'https://github.com/ninok'
    ]) {
      const r = links([l]);
      assert.equal(r.error, undefined, `${l}: ${JSON.stringify(r)}`);
      assert.equal(r.patch.workLinks.length, 1, l);
    }
    for (const host of ['linkedin.com', 'www.linkedin.com', 'ge.linkedin.com', 'researchgate.net', 'orcid.org', 'scholar.google.com', 'scholar.google.co.uk', 'tsu-ge.academia.edu', 'publons.com',
      'www.webofscience.com', 'behance.net', 'dribbble.com', 'github.com']) assert.equal(linkCheck.isProfileSite(host), true, host);
    for (const host of ['notlinkedin.com', 'linkedin.com.example.org', 'google.com', 'scholar.google.evil.example', 'example.com']) assert.equal(linkCheck.isProfileSite(host), false, host);
  });

  test('anywhere else, a number in the address is an id, not a phone', () => {
    for (const l of ['https://www.scopus.com/authid/detail.uri?authorId=57190123456', 'https://www.tsu.ge/ka/staff/599123456', 'https://example.org/people/2024/11/0012345678901',
      'https://www.semanticscholar.org/author/N.-Kiknadze/1234567890', 'https://pubmed.ncbi.nlm.nih.gov/?term=Kiknadze+N', 'https://university.example/outlook-on-teaching/nino']) {
      assert.equal(links([l]).error, undefined, l);
    }
  });

  test('refused, and named: not an address, another scheme, a messenger or payment page, an email address, a phone written as one', () => {
    for (const l of ['not a link', 'javascript:alert(1)', 'ftp://example.com/cv.pdf', 'data:text/html,hello', 'https://user:pass@example.com/', 'https://localhost/me']) {
      const r = links([l]);
      assert.equal(r.error, 'invalid_link', l);
      assert.equal(r.field, 'workLinks');
    }
    for (const l of ['https://t.me/nino', 'https://wa.me/995555123456', 'https://paypal.me/nino', 'https://calendly.com/nino', 'https://linktr.ee/nino',
      'https://example.com/contact?mail=nino@example.com', 'https://example.com/mailto:nino', 'https://example.com/call/+995599123456', 'https://example.com/me?phone=599123456',
      'https://example.com/me?whatsapp=995599123456']) {
      const r = links([l]);
      assert.equal(r.error, 'contact_details', l);
      assert.equal(r.field, 'workLinks');
    }
    assert.equal(links(['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example']).error, 'too_many_links');
  });

  test('the messages say, in Georgian and English, what is wrong and what is fine', () => {
    for (const l of ['ka', 'en']) {
      const d = JSON.parse(read(`public/i18n/${l}.json`));
      assert.match(d['story.err.linkContact'], /LinkedIn, ResearchGate, ORCID/);
      assert.match(d['story.err.link'], /https:\/\/linkedin\.com\/in\//);
      assert.match(d['ap.ev.err.invalid_url'], /https:\/\/linkedin\.com\/in\//);
      assert.match(d['story.links.hint'], /ResearchGate/);
      assert.ok(JSON.parse(read(`public/i18n/admin-${l}.json`))['admin.ai.linkFlag.could_not_check'], l);
    }
    assert.match(JSON.parse(read('public/i18n/admin-ka.json'))['admin.ai.linkFlag.could_not_check'], /ავტომატურად ვერ შემოწმდა/);
  });

  test('on the profile the links are named: ResearchGate, ORCID, LinkedIn', () => {
    assert.deepEqual(HER_LINKS.map((l) => mentorStory.linkChip(l).label), ['ResearchGate', 'ORCID', 'LinkedIn']);
    assert.equal(mentorStory.linkChip('https://scholar.google.com/citations?user=x').label, 'Google Scholar');
  });
});

describe('the application: her step 2 is saved and she goes on', () => {
  let c, id;
  before(async () => {
    c = await signupVerified(base, 'Nino Kiknadze', 'nino-kiknadze@example.com');
    assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30, headline: 'Associate professor of psychology' } })).status, 200);
    const r = await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Educational psychology', niche: 'teaching', yearsExperience: 20, roleTitle: 'Associate professor' } });
    assert.equal(r.status, 200, r.text);
    id = (await c.api('/me')).user.id;
  });

  test('step 2 with the path and the three links is saved; nothing about the story is missing', async () => {
    const r = await c.api('/verification/experience', { method: 'PUT', body: { ...PATH, startTags: [], sampleQuestion: '', sampleReply: '', helpPoints: [], workLinks: HER_LINKS } });
    assert.equal(r.status, 200, r.text);
    const v = await c.api('/verification');
    assert.deepEqual(v.application.form.workLinks, HER_LINKS);
    assert.equal(v.application.form.pathStart, PATH.pathStart);
    assert.equal(v.application.missing.includes('story'), false, JSON.stringify(v.application.missing));
    assert.deepEqual((await pool.query('SELECT work_links FROM users WHERE id = $1', [id])).rows[0].work_links, HER_LINKS);
  });

  test('a link that IS refused takes nothing else with it: the page saves the rest of the step first (the page\'s own code)', () => {
    const src = read('public/js/apply.js');
    assert.match(src, /e\.data && e\.data\.field === 'workLinks'/);
    assert.match(src, /delete rest\.workLinks;\s+await WisecallAPI\.apiFetch\('\/verification\/experience', \{ method: 'PUT', body: rest \}\)/);
  });

  test('step 4: a profile link is taken with or without "https://"; only what is not an address is refused', async () => {
    const add = (url) => c.api('/verification/evidence', { method: 'POST', body: { url } });
    const a = await add('www.linkedin.com/in/nino-kiknadze-12345678');
    assert.equal(a.status, 200, a.text);
    assert.equal(a.evidence.kind, 'linkedin');
    assert.equal(a.evidence.url, 'https://www.linkedin.com/in/nino-kiknadze-12345678');
    const b = await add('orcid.org/0000-0002-1825-0097');
    assert.equal(b.status, 200, b.text);
    assert.equal(b.evidence.kind, 'publication');
    const d = await add('https://www.researchgate.net/profile/Nino-Kiknadze-2');
    assert.equal(d.status, 200, d.text);
    for (const bad of ['not a link', 'javascript:alert(1)', 'ftp://example.com/cv.pdf', 'https://user:pass@example.com/']) assert.equal((await add(bad)).error, 'invalid_url', bad);
    // (nothing is opened when a link is added: it waits, and never holds the step back)
    const v = await c.api('/verification');
    assert.equal(v.application.evidence.length, 3);
    assert.equal(v.application.missing.includes('evidence'), false);
  });

  test('sent: the profile links are not opened, a site that does not answer is not "dead"; she sees "our team will check", the admin "couldn\'t check"', async () => {
    web.pages['/robots-refused'] = { status: 403, html: '<title>Access denied</title>' };
    web.pages['/busy'] = { status: 503, html: '' };
    const add = async (url) => { const r = await c.api('/verification/evidence', { method: 'POST', body: { url } }); assert.equal(r.status, 200, r.text); return r.evidence.id; };
    const ids = {
      noAnswer: await add(`http://127.0.0.1:${closedPort}/staff/nino-kiknadze`),
      refused: await add(web.url('/robots-refused')),
      busy: await add(web.url('/busy')),
      gone: await add(web.url('/no-such-page'))
    };
    assert.deepEqual(await (async () => (await c.api('/verification')).application.missing)(), []);
    const hitsBefore = web.hits.length;
    assert.equal((await c.api('/verification/submit', { method: 'POST' })).status, 200);
    const k = await c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(k.status, 200, k.text);
    await client(base).api(`/mock-kyc/sessions/${k.url.split('session=')[1]}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: 'Nino Kiknadze', dateOfBirth: '1980-05-01' } });
    const review = await waitFor(async () => (await pool.query(`SELECT * FROM verification_reviews WHERE user_id = $1 AND status = 'done' ORDER BY created_at DESC`, [id])).rows[0]);
    assert.ok(web.hits.length > hitsBefore, 'the other links were opened');

    // the admin's view
    const d = await admin.api(`/admin/mentors/${id}/verification`);
    assert.equal(d.status, 200, d.text);
    const ev = (needle) => d.evidence.find((e) => e.url && e.url.includes(needle));
    for (const needle of ['linkedin.com', 'orcid.org', 'researchgate.net']) {
      const e = ev(needle);
      assert.equal(e.checkStatus, 'warning', needle);
      assert.deepEqual(e.checkResult.flags, ['could_not_check'], needle);
      assert.equal(e.checkResult.profileSite, true, needle);
      assert.equal(e.checkResult.status, undefined, `${needle} was never opened`);
      assert.equal(e.autoVerified, false);
    }
    for (const [key, needle] of [['noAnswer', `:${closedPort}/`], ['refused', '/robots-refused'], ['busy', '/busy']]) {
      const e = d.evidence.find((x) => x.id === ids[key]);
      assert.ok(e.url.includes(needle));
      assert.equal(e.checkStatus, 'warning', key);
      assert.ok(e.checkResult.flags.includes('could_not_check'), `${key}: ${JSON.stringify(e.checkResult.flags)}`);
      assert.equal(e.checkResult.flags.includes('dead_link'), false, key);
    }
    const gone = d.evidence.find((x) => x.id === ids.gone);
    assert.equal(gone.checkStatus, 'failed', 'a page the site says is not there is still a dead link');
    assert.ok(gone.checkResult.flags.includes('dead_link'));

    // what counts against the application: one dead link, never "nothing opened" for links nobody tried or could open
    assert.deepEqual({ total: review.checks.links.total, dead: review.checks.links.dead, unchecked: review.checks.links.unchecked }, { total: 1, dead: 1, unchecked: 6 });
    assert.equal(review.outcome, 'needs_human');

    // what she sees: "our team will check this link" for each of them; a problem only for the page that is gone
    const mine = (await c.api('/verification')).application.evidence;
    for (const e of mine) assert.equal(e.state, e.id === ids.gone ? 'problem' : 'team', e.url);
    // and the application is where it was: sent, nothing missing
    assert.equal((await pool.query('SELECT verification_status FROM users WHERE id = $1', [id])).rows[0].verification_status, 'pending');
  });
});

describe('the link check itself', () => {
  const person = { name: 'Nino Kiknadze' };
  test('a known profile site is answered at once, without a request', async () => {
    const t0 = Date.now();
    for (const l of [...HER_LINKS, 'https://scholar.google.com/citations?user=AbCdEfGhIjK', 'https://github.com/ninok']) {
      const r = await linkCheck.checkLink(l, person, { allowPrivate: false });
      assert.equal(r.checkStatus, 'warning', l);
      assert.equal(r.autoVerified, false);
      assert.deepEqual(r.result.flags, ['could_not_check'], l);
      assert.equal(r.result.status, undefined);
      assert.equal(r.result.finalUrl, undefined);
    }
    assert.ok(Date.now() - t0 < 1000, 'nothing was fetched');
    // (a profile address that clearly names someone else is still pointed out, from the address alone)
    const other = await linkCheck.checkLink('https://www.linkedin.com/in/john-smith-77', person, { allowPrivate: false });
    assert.deepEqual(other.result.flags, ['could_not_check', 'other_person']);
  });

  test('no answer, a refusal or a busy server: "couldn\'t check"; 404 and 410: dead; a page with her name: verified', async () => {
    const opts = { allowPrivate: true, rdapBase: web.url('/rdap/') };
    web.pages['/429'] = { status: 429, html: '' };
    web.pages['/401'] = { status: 401, html: '' };
    web.pages['/410'] = { status: 410, html: '' };
    web.pages['/staff'] = { html: '<title>Nino Kiknadze, associate professor</title><h1>Nino Kiknadze</h1>' };
    for (const p of ['/robots-refused', '/busy', '/429', '/401']) {
      const r = await linkCheck.checkLink(web.url(p), person, opts);
      assert.equal(r.checkStatus, 'warning', p);
      assert.ok(r.result.flags.includes('could_not_check'), p);
    }
    const none = await linkCheck.checkLink(`http://127.0.0.1:${closedPort}/`, person, opts);
    assert.equal(none.checkStatus, 'warning');
    assert.ok(none.result.flags.includes('could_not_check'));
    for (const p of ['/no-such-page', '/410']) {
      const r = await linkCheck.checkLink(web.url(p), person, opts);
      assert.equal(r.checkStatus, 'failed', p);
      assert.ok(r.result.flags.includes('dead_link'), p);
    }
    const ok = await linkCheck.checkLink(web.url('/staff'), person, opts);
    assert.equal(ok.result.match, 'name');
    assert.equal(ok.result.flags.includes('could_not_check'), false);
    // (an address the server must not open is still refused)
    const refused = await linkCheck.checkLink('http://127.0.0.1:8080/', person, { allowPrivate: false });
    assert.equal(refused.checkStatus, 'failed');
    assert.deepEqual(refused.result.flags, ['refused_address']);
  });
});

describe('the admin\'s page', () => {
  test('the profile\'s own links can be opened and are marked "couldn\'t check automatically"', () => {
    const src = read('public/js/admin-mentors.js');
    assert.match(src, /mv-work-links/);
    assert.match(src, /admin\.ai\.linkFlag\.could_not_check/);
    assert.match(src, /a\.profileExtras\.workLinks\.map\(\(u\) => `<a href="\$\{esc\(u\)\}" target="_blank" rel="noopener noreferrer nofollow">/);
  });
});
