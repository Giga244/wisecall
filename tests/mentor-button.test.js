// "Become a mentor" stays in sight when signed in (docs/CLAUDE-CODE-MENTOR-BUTTON-SIGNED-IN.md). Where someone is on the way to becoming a
// mentor decides what the header, the home page's second button and the dashboard show:
//   signed out  "Become a mentor" -> become-a-mentor.html (among the main links)
//   asker       "Become a mentor" -> /apply.html (next to Dashboard; and a card on the dashboard, from the first sign-in)
//   draft       "Continue your application · step N of 5" -> /apply.html?step=N
//   sent        "Application in review", a status linking to /apply.html
//   approved mentor, admin: nothing extra
// /api/me says which (user.mentorPath), and the "signed in" hint cookie carries it so every page is drawn right from its first frame.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor } = require('./helpers');
const { applicationProgress } = require('../server/verification/experience');

let srv, base, admin;
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports. Students ask me how to choose a master programme abroad.';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const login = (email) => fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ email, password: 'test-pass-12345' })
});
const hintAtLogin = async (email) => ((await login(email)).headers.getSetCookie().find((c) => c.startsWith('wc_authed=')) || '').split(';')[0].slice('wc_authed='.length);
const path_ = async (c) => (await c.api('/me')).user.mentorPath;

before(async () => {
  await resetDatabase();
  srv = await startServer(4772, { RATE_LIMIT_MULTIPLIER: '30', ADMIN_EMAILS: 'qa-admin@example.com' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(() => { if (srv) srv.proc.kill(); });

describe('where someone is, from the server', () => {
  test('signed out: nobody, and no hint', async () => {
    const r = await fetch(base + '/api/me');
    assert.equal((await r.json()).user, null);
  });

  test('an asker: "asker", and the hint "1"', async () => {
    const c = await signupVerified(base, 'Ana Asker', 'ana-asker@example.com');
    assert.deepEqual(await path_(c), { state: 'asker', step: null });
    assert.equal(c.getCookie('wc_authed'), '1', 'right after signing up');
    assert.equal(await hintAtLogin('ana-asker@example.com'), '1');
  });

  test('an application started and not sent: "draft" with the step to continue from and how many are done, which follow what is filled in; the hint "apply"', async () => {
    const c = await signupVerified(base, 'Dato Draft', 'dato-draft@example.com');
    assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } })).status, 200);
    assert.deepEqual(await path_(c), { state: 'draft', step: 1, done: 0, id: 'todo', idLeft: false });
    await c.api('/me', { method: 'PATCH', body: { headline: 'Associate professor of economics at TSU' } });
    await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics', yearsExperience: 18 } });
    assert.deepEqual(await path_(c), { state: 'draft', step: 2, done: 1, id: 'todo', idLeft: false });
    await c.api('/verification/experience', { method: 'PUT', body: { story: STORY } });
    assert.deepEqual(await path_(c), { state: 'draft', step: 3, done: 2, id: 'todo', idLeft: false });
    await c.api('/me', { method: 'PATCH', body: { price: 40 } });
    assert.deepEqual(await path_(c), { state: 'draft', step: 4, done: 3, id: 'todo', idLeft: false });
    await c.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/en/staff/dato-draft' } });
    assert.deepEqual(await path_(c), { state: 'draft', step: 5, done: 4, id: 'todo', idLeft: true }, 'everything is there but the ID check: step 5 next, 4 of 5 done');
    assert.equal(await hintAtLogin('dato-draft@example.com'), 'apply', 'the page adds the step itself (public/js/nav.js)');
  });

  test('sent: "sent", and the hint "sent"; approved: "mentor", and the hint "mentor"', async () => {
    const c = await signupVerified(base, 'Sopo Sent', 'sopo-sent@example.com');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Winemaker in Kakheti', price: 30 } });
    await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Georgian wine', yearsExperience: 12, story: STORY } });
    await c.api('/verification/evidence', { method: 'POST', body: { url: 'https://sopo-wines.example.com/about' } });
    assert.equal((await c.api('/verification/submit', { method: 'POST' })).status, 200);
    assert.deepEqual(await path_(c), { state: 'sent', step: null, id: 'todo', idLeft: true });
    assert.equal(await hintAtLogin('sopo-sent@example.com'), 'sent');

    await approveMentor(admin, c);
    assert.deepEqual(await path_(c), { state: 'mentor', step: null });
    assert.equal(await hintAtLogin('sopo-sent@example.com'), 'mentor');
  });

  test('an admin: the hint "admin", and the pages show nothing extra (isAdmin)', async () => {
    const me = (await admin.api('/me')).user;
    assert.equal(me.isAdmin, true);
    assert.equal(await hintAtLogin('qa-admin@example.com'), 'admin');
    assert.match(read('public/js/nav.js'), /if \(user\.isAdmin\) return \{ state: 'none', step: null \};/);
  });

  test('how far an application is: the steps done, how many, and the first unfinished one (docs/CLAUDE-CODE-APPLY-PROGRESS.md)', () => {
    const p = applicationProgress;
    assert.deepEqual(p(['headline', 'years', 'field', 'story', 'price', 'evidence']), { done: [false, false, false, false, false], count: 0, next: 1 });
    // steps 1 and 3 done, step 2 (the story) open: 2 of 5, and "Continue" goes to step 2
    assert.deepEqual(p(['story', 'evidence']), { done: [true, false, true, false, false], count: 2, next: 2 });
    assert.deepEqual(p(['evidence']), { done: [true, true, true, false, false], count: 3, next: 4 });
    assert.deepEqual(p(['niche']), { done: [false, true, true, true, false], count: 3, next: 1 });
    assert.deepEqual(p(['license_document']), { done: [true, true, true, false, false], count: 3, next: 4 });
    // step 5 is the ID check: done only when it has passed ("pending" is a check just started)
    assert.deepEqual(p([], undefined), { done: [true, true, true, true, false], count: 4, next: 5 });
    assert.deepEqual(p([], 'pending'), { done: [true, true, true, true, false], count: 4, next: 5 });
    assert.deepEqual(p([], 'passed'), { done: [true, true, true, true, true], count: 5, next: 5 }, 'all five: 5/5');
    assert.deepEqual(p(['story'], 'passed'), { done: [true, false, true, true, true], count: 4, next: 2 });
    // (the email is confirmed at sign-up: not one of the five)
    assert.deepEqual(p(['email'], undefined).count, 4);
  });

  test('a made-up hint is not kept: only the known values', () => {
    const auth = read('server/auth.js');
    assert.match(auth, /const HINTS = \/\^\(1\|admin\|mentor\|sent\|idleft\|apply\(\?:\[1-5\]\(\?:-\[0-5\]\)\?\)\?\)\$\/;/);
    assert.match(auth, /res\.cookie\(HINT_COOKIE, HINTS\.test\(hint\) \? hint : '1'/);
  });
});

describe('what the pages show', () => {
  test('the header: the visitor\'s link among the main links, everybody else\'s button next to Dashboard (and in the menu panel)', () => {
    const header = read('public/js/header.js');
    assert.match(header, /const shown = LINKS\.filter\(\(l\) => !l\.mentor \|\| signedIn === ''\);/, 'signed out only, among the main links');
    assert.match(header, /<div class="nav-actions" id="navLoggedIn"\$\{off\(!signedIn\)\}>\n\s+\$\{WisecallMentorButton\.html\(MENTOR, 'nav', w\)\}/);
    assert.match(header, /<div class="mm-actions" id="mmLoggedIn"\$\{off\(!signedIn\)\}>\n\s+\$\{WisecallMentorButton\.html\(MENTOR, 'menu', w\)\}/);
    // the hint -> the state, before the first paint
    const src = header.slice(header.indexOf('const MENTOR = (() => {'), header.indexOf('document.documentElement.dataset.mentorState'));
    const run = (hint) => new Function('signedIn', 'document', 'window', `${src}; return MENTOR;`)(hint, {}, {});
    assert.deepEqual(run(''), { state: 'out', step: null });
    assert.deepEqual(run('1'), { state: 'asker', step: null });
    // ("apply<next step>-<steps done>": docs/CLAUDE-CODE-APPLY-PROGRESS.md; an older hint without the count still works)
    assert.deepEqual(run('apply2-2'), { state: 'draft', step: 2, done: 2 });
    assert.deepEqual(run('apply5-4'), { state: 'draft', step: 5, done: 4 });
    assert.deepEqual(run('apply3'), { state: 'draft', step: 3, done: null });
    assert.deepEqual(run('apply'), { state: 'draft', step: null, done: null });
    assert.deepEqual(run('sent'), { state: 'sent', step: null });
    assert.deepEqual(run('idleft'), { state: 'idleft', step: 5, done: 4 }); // (steps 1-4 done, the ID check left: docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md)
    assert.deepEqual(run('mentor'), { state: 'none', step: null });
    assert.deepEqual(run('admin'), { state: 'none', step: null });
  });

  test('the button\'s words and address in each state, in English and Georgian', () => {
    const header = read('public/js/header.js');
    const btnSrc = header.slice(header.indexOf('window.WisecallMentorButton = {'), header.indexOf('document.documentElement.dataset.mentorState'));
    const window = {};
    new Function('window', btnSrc)(window);
    const B = window.WisecallMentorButton;
    for (const lang of ['en', 'ka']) {
      const d = JSON.parse(read(`public/i18n/${lang}.json`));
      const say = (k) => d[k];
      const html = (state, step, where = 'nav', done) => B.html({ state, step, done }, where, say);
      assert.match(html('asker'), new RegExp(`href="/apply\\.html" class="btn btn-outline nav-mentor"[^>]*><span class="nm-full">${d['nav.becomeMentor']}</span>`));
      // (the link goes to the first unfinished step; the words say how many steps are done: steps 1 and 3 done, step 2 next)
      assert.match(html('draft', 2, 'nav', 2), /href="\/apply\.html\?step=2"/);
      assert.ok(html('draft', 2, 'nav', 2).includes(d['nav.continueStep'].replace('{n}', 2)));
      assert.ok(html('draft', 2, 'nav', 2).includes(d['nav.continueShort'].replace('{n}', 2)), 'the short words where the header is narrow');
      assert.ok(html('draft', 5, 'nav', 3).includes(d['nav.continueShort'].replace('{n}', 3)), 'the count, not the step');
      assert.ok(html('draft', 2).includes(d['nav.continueApp']), 'no count known yet: no number');
      assert.match(html('sent'), new RegExp(`href="/apply\\.html" class="nav-mentor mentor-status"[^>]*><span class="nm-full">${d['nav.inReview']}</span>`));
      assert.match(html('draft', 4, 'menu', 3), new RegExp(`href="/apply\\.html\\?step=4" class="btn btn-outline btn-lg btn-block mm-mentor"[^>]*>${d['nav.continueStep'].replace('{n}', 3)}</a>`));
      assert.equal(html('none'), '');
      assert.equal(html('out'), '');
    }
    const ka = JSON.parse(read('public/i18n/ka.json'));
    assert.equal(ka['nav.becomeMentor'], 'გახდი მენტორი');
    assert.equal(ka['nav.continueStep'].replace('{n}', 2), 'განაცხადის გაგრძელება · დასრულებულია 2 / 5');
    assert.equal(ka['nav.continueShort'].replace('{n}', 2), 'განაცხადი · 2/5');
    assert.equal(ka['nav.inReview'], 'განაცხადი განხილვაშია');
  });

  test('the home page\'s mentor banner: "Become a mentor" for everybody, to the mentors\' page (docs/CLAUDE-CODE-NEW-HOME.md 2.6)', () => {
    assert.match(read('public/index.html'), /<a href="\/become-a-mentor\.html" class="btn btn-primary lmentor-btn" data-mentor-cta="hero" data-i18n="nav\.becomeMentor">/);
    // (the mentors' page sends someone signed in on to the application)
    assert.match(read('public/js/info-page.js'), /'\/apply\.html' : '\/signup\.html\?as=mentor'/);
  });

  test('the dashboard: a card at the top for an asker (also right after signing up), an application started, or one sent', () => {
    assert.match(read('public/dashboard.html'), /<div id="mentorCard"><\/div>/);
    const js = read('public/js/dashboard.js');
    for (const k of ['dash.mentor.asker.title', 'dash.mentor.draft.title', 'dash.mentor.sent.title']) assert.ok(js.includes(`'${k}'`), k);
    for (const lang of ['en', 'ka']) {
      const d = JSON.parse(read(`public/i18n/${lang}.json`));
      for (const k of ['dash.mentor.asker.title', 'dash.mentor.asker.body', 'dash.mentor.draft.title', 'dash.mentor.draft.body', 'dash.mentor.draft.cta', 'dash.mentor.sent.title', 'dash.mentor.sent.body', 'nav.continueApp', 'nav.inReviewShort']) {
        assert.ok(d[k], `${lang}: ${k}`);
      }
    }
    assert.equal(JSON.parse(read('public/i18n/ka.json'))['dash.mentor.draft.title'].replace('{n}', 3), 'განაცხადის გაგრძელება – ნაბიჯი 3 / 5');
  });
});
