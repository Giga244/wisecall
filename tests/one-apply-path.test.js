// One place to apply as a mentor: /apply.html (docs/CLAUDE-CODE-ONE-APPLY-PATH.md). Settings keeps no application form, only a card that
// says where the application stands with one button to it; the Verification tab is an approved mentor's (ID check, licence, badges, "Edit
// my application"); old links to Settings -> Verification lead to /apply.html; nothing filled in the old form is lost.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor, client } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports. Students ask me how to choose a master programme abroad.';
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4774, { RATE_LIMIT_MULTIPLIER: '30' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(() => { if (srv) srv.proc.kill(); });

describe('Settings has no application form', () => {
  test('no experience form, evidence form, "use my profile", AI note or "Submit for review" in Settings', () => {
    const page = read('public/settings.html') + read('public/js/settings.js') + read('public/js/settings-verification.js');
    for (const gone of ['data-form="experience"', 'data-form="evidence"', 'ap-from-profile', 'data-submit', "t('ap.submit')", "t('ap.submit.ai')", 'id="becomeMentor"', 'verificationBox']) {
      assert.ok(!page.includes(gone), `${gone} is gone from Settings`);
    }
    // the Mentor and Verification tabs are an approved mentor's; Payouts every mentor's
    assert.match(read('public/settings.html'), /data-tab="mentor" data-approved-only hidden/);
    assert.match(read('public/settings.html'), /data-tab="verification" data-approved-only hidden/);
    assert.match(read('public/settings.html'), /data-tab="payouts" data-mentor-only hidden/);
    // what stays for an approved mentor: the ID check, the licence, the work-email badge, "Edit my application" (which opens /apply.html)
    const tab = read('public/js/settings-verification.js');
    for (const kept of ['identitySection()', 'licenceSection()', 'workEmailSection()', 'applicationSection()', "window.location.href = '/apply.html'"]) assert.ok(tab.includes(kept), kept);
  });

  test('/apply.html has every field of the old form: the optional title, tags and sample answer too', () => {
    const js = read('public/js/apply.js');
    for (const name of ['headline', 'customNiche', 'niche', 'yearsExperience', 'roleTitle', 'specialtyTags', 'story', 'sampleAnswer', 'price', 'url']) {
      assert.match(js, new RegExp(`name="${name}"`), name);
    }
    // and after "Submit": the ID check, a licence to give again, the video call, "Edit my application"
    for (const part of ['identityDone()', 'licenceToFix ? licenceBlock()', 'interviewBlock()', 'data-edit']) assert.ok(js.includes(part), part);
  });
});

describe('the card at the top of Settings', () => {
  const src = read('public/js/settings-application.js');
  const window = {};
  new Function('window', src)(window);
  const C = window.WisecallApplicationCard;
  const dict = (lang) => JSON.parse(read(`public/i18n/${lang}.json`));

  test('the right state, words and button for each case (and no card for an approved mentor or an admin)', () => {
    const asker = { role: 'seeker' };
    // (steps 1 and 3 done, step 2 next: docs/CLAUDE-CODE-APPLY-PROGRESS.md)
    const draft = { role: 'mentor', verificationStatus: 'none', mentorPath: { state: 'draft', step: 2, done: 2 } };
    const sent = { role: 'mentor', verificationStatus: 'pending', applicationSubmittedAt: '2026-10-20T10:00:00Z', mentorPath: { state: 'sent' } };
    const rejected = { role: 'mentor', verificationStatus: 'rejected', verificationNote: 'The link does not show your work.', mentorPath: { state: 'draft', step: 5 } };
    const failedId = { requirements: [{ step: 'id_kyc', status: 'failed' }] };
    assert.deepEqual(C.view(asker, null), { state: 'none', button: { key: 'settings.app.start', href: '/apply.html' } });
    assert.deepEqual(C.view(draft, { requirements: [] }), { state: 'draft', step: 2, done: 2, fix: null, button: { key: 'settings.app.continue', step: 2, href: '/apply.html?step=2' } });
    assert.equal(C.view(sent, { requirements: [] }).state, 'sent');
    assert.equal(C.view(sent, { requirements: [] }).button.href, '/apply.html');
    assert.deepEqual(C.view(draft, failedId), { state: 'fix', step: 5, done: 2, fix: 'id_kyc', button: { key: 'settings.app.continue', step: 5, href: '/apply.html?step=5' } }, 'an ID check to take again: step 5');
    assert.equal(C.view(sent, failedId).state, 'fix');
    assert.deepEqual(C.view(rejected, null), { state: 'rejected', reason: 'The link does not show your work.', fix: null, button: { key: 'settings.app.see', href: '/apply.html' } });
    assert.equal(C.view({ role: 'mentor', verificationStatus: 'verified' }, null), null, 'an approved mentor: no card');
    assert.equal(C.view({ role: 'mentor', verificationStatus: 'suspended' }, null), null);
    assert.equal(C.view({ role: 'seeker', isAdmin: true }, null), null, 'an admin: no card');

    for (const lang of ['en', 'ka']) {
      const d = dict(lang);
      const t = (k) => d[k] || k;
      const html = (u, v) => C.html(C.view(u, v), t, 2);
      for (const [u, v] of [[asker, null], [draft, { requirements: [] }], [sent, { requirements: [] }], [draft, failedId], [rejected, null]]) assert.doesNotMatch(html(u, v), /settings\.app|\{n\}|\{days\}/, `${lang}: every text is there`);
      assert.ok(html(asker, null).includes(`>${d['settings.app.start']}</a>`));
      assert.ok(html(draft, { requirements: [] }).includes(d['settings.app.continue'].replace('{n}', 2)));
      assert.ok(html(draft, { requirements: [] }).includes(d['settings.app.state.draft'].replace('{n}', 2)));
      assert.match(html(draft, { requirements: [] }), /aria-valuenow="2"[^>]*><span style="width:40%">/, 'the bar: 2 of 5 done');
      assert.ok(html(sent, { requirements: [] }).includes(d['settings.app.state.sent']));
      assert.ok(html(draft, failedId).includes(d['settings.failed.id_kyc']), 'what failed, in one sentence');
      assert.ok(html(rejected, null).includes('The link does not show your work.'), 'the reason');
      assert.equal(C.html(null, t, 2), '');
    }
    assert.equal(dict('ka')['settings.app.continue'].replace('{n}', 2), 'გაგრძელება – ნაბიჯი 2 / 5');
  });
});

describe('the old address: /settings.html?tab=verification', () => {
  const at = async (c, p) => { const r = await (c ? c(p) : fetch(base + p, { redirect: 'manual' })); return { status: r.status, to: r.headers.get('location') }; };

  test('someone applying goes to /apply.html at their step; back from the ID check, at step 5; in Georgian, the Georgian page', async () => {
    const m = await signupVerified(base, 'Dato Draft', 'dato@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Associate professor of economics at TSU' } });
    await m.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics', yearsExperience: 18 } });
    assert.deepEqual(await at(m, '/settings.html?tab=verification'), { status: 302, to: '/apply.html?step=2' });
    assert.deepEqual(await at(m, '/ka/settings.html?tab=verification'), { status: 302, to: '/ka/apply.html?step=2' });
    assert.deepEqual(await at(m, '/settings.html?tab=verification&kyc=returned'), { status: 302, to: '/apply.html?step=5&kyc=returned' });
    assert.equal((await at(m, '/settings.html?tab=profile')).status, 200, 'the other tabs as before');

    // sent: the application (its "where it stands" page)
    await m.api('/verification/experience', { method: 'PUT', body: { story: STORY } });
    await m.api('/me', { method: 'PATCH', body: { price: 40 } });
    await m.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/en/staff/dato' } });
    assert.equal((await m.api('/verification/submit', { method: 'POST' })).status, 200);
    assert.deepEqual(await at(m, '/settings.html?tab=verification'), { status: 302, to: '/apply.html' });

    // approved: their Verification tab stays
    await approveMentor(admin, m);
    assert.equal((await at(m, '/settings.html?tab=verification')).status, 200);
  });

  test('an asker, an admin and nobody signed in get the page as usual', async () => {
    const a = await signupVerified(base, 'Ana Asker', 'ana@example.com');
    assert.equal((await at(a, '/settings.html?tab=verification')).status, 200);
    assert.equal((await at(admin, '/settings.html?tab=verification')).status, 200);
    assert.equal((await at(null, '/settings.html?tab=verification')).status, 200);
  });

  test('the emails, the ID check and the dashboard lead to /apply.html', () => {
    const mail = read('server/mail/templates.js');
    assert.doesNotMatch(mail, /settings\.html\?tab=verification/);
    assert.doesNotMatch(mail, /verification settings|from Settings|ვერიფიკაციის პარამეტრ/);
    assert.match(read('server/verification/kyc.js'), /callbackUrl: `\$\{config\.PUBLIC_URL\}\/apply\.html\?step=5&kyc=returned`/);
    // (only an approved mentor is sent to the Verification tab: from the application's 'where it stands' page)
    for (const f of ['public/js/dashboard.js', 'public/js/settings.js', 'public/js/nav.js', 'public/js/header.js']) assert.doesNotMatch(read(f), /settings\.html\?tab=verification/, f);
  });
});

describe('nothing filled in the old form is lost', () => {
  test('an application started in Settings (title, tags, sample answer, story, evidence) comes back whole in /apply.html', async () => {
    const m = await signupVerified(base, 'Lela Old', 'lela@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Winemaker in Kakheti', price: 30 } });
    // (what the old Settings form sent)
    const old = { roleTitle: 'Winemaker', customNiche: 'Georgian wine', niche: 'wine_agriculture', specialtyTags: ['qvevri', 'natural wine'], yearsExperience: 12, story: STORY, sampleAnswer: 'Start with one qvevri and a small harvest, keep the cellar cool, and taste every week before deciding anything about bottling.' };
    assert.equal((await m.api('/verification/experience', { method: 'PUT', body: old })).status, 200);
    assert.equal((await m.api('/verification/evidence', { method: 'POST', body: { kind: 'website', url: 'https://lela-wines.example.com' } })).status, 200);
    const v = await m.api('/verification');
    for (const [k, val] of Object.entries(old)) assert.deepEqual(v.application.form[k], val, k);
    assert.equal(v.application.evidence.length, 1);
    assert.deepEqual(v.application.missing, []);
    assert.equal((await client(base)('/apply.html')).status, 302, '(the page itself needs a sign-in)');
    assert.equal((await m('/apply.html')).status, 200);
  });
});
