// A mentor's own text is never cut (docs/CLAUDE-CODE-FINISH.md part 2). A mentor's card showed only the first 525 characters of his
// 1252-character story: "About me" took the story while it was half written (the application copies the story into it), a Settings
// page opened at that moment kept that half, and saving it later (another field changed) wrote the half back over the whole text. The
// form now sends only what was changed, with the "About me" it started from, and the server refuses an "About me" from an older start.
// And no box cuts a pasted text: too long is said, never shortened. (In a browser: e2e/never-cut.spec.js.)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// A long Georgian text in paragraphs, like a real story (1200+ characters), and its first part cut mid-word, as a half-typed save.
const PARA = 'მაქვს მრავალწლიანი გამოცდილება საჯარო სამსახურში, კერძო სექტორში და უნივერსიტეტში. ვკითხულობ ლექციებს, ვწერ სტატიებს და ვეხმარები სტუდენტებს, რომ სწორი გზა აირჩიონ. ';
const FULL = [1, 2, 3, 4, 5, 6].map((n) => `${n}. ${PARA}${'ვმუშაობდი სხვადასხვა ქვეყანაში, '.repeat(n % 3 + 1)}`.trim()).join('\n\n');
const HALF = [...FULL].slice(0, 525).join('');
let srv, base, mentor;

before(async () => {
  await resetDatabase();
  srv = await startServer(4861, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupVerified(base, 'Lekso Mentor', 'lekso-cut@example.com');
  assert.equal((await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Associate professor', niche: 'teaching', price: 20, proofUrl: 'https://example.org/in/lekso', sampleAnswer: SAMPLE } })).status, 200);
  mentor.admin = admin;
});
after(() => { if (srv) srv.proc.kill(); });

describe('"About me" is never replaced from an older copy', () => {
  test('the story saved half-typed and then whole: "About me" follows it to the whole text', async () => {
    assert.ok([...FULL].length > 1200 && [...FULL].length <= 1500, `${[...FULL].length}`);
    assert.equal((await mentor.api('/verification/experience', { method: 'PUT', body: { story: HALF } })).status, 200);
    assert.equal((await mentor.api('/me')).user.bio, HALF, 'the half, copied while the story was half written');
    assert.equal((await mentor.api('/verification/experience', { method: 'PUT', body: { story: FULL } })).status, 200);
    const me = (await mentor.api('/me')).user;
    assert.equal(me.story, FULL);
    assert.equal(me.bio, FULL, 'the whole text, copied again');
    await approveMentor(mentor.admin, mentor);
    await addPayoutDetails(mentor); // (listed: on Browse)
  });

  test('a Settings page opened while it was half written cannot write the half back (the case of the card cut at 525 characters)', async () => {
    // the page sends the "About me" it showed (the half) with the one it started from: refused, with the current text; nothing changes
    const stale = await mentor.api('/me', { method: 'PATCH', body: { city: 'Tbilisi', bio: HALF, bioWas: HALF } });
    assert.equal(stale.status, 409);
    assert.equal(stale.error, 'bio_changed');
    assert.equal(stale.bio, FULL, 'the page is told the current text');
    let me = (await mentor.api('/me')).user;
    assert.equal(me.bio, FULL);
    assert.equal(me.story, FULL);
    assert.notEqual(me.city, 'Tbilisi', 'nothing of the refused save is written');
    // the page now sends only what was changed: another field alone leaves "About me" as it is
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { city: 'Tbilisi' } })).status, 200);
    me = (await mentor.api('/me')).user;
    assert.equal(me.city, 'Tbilisi');
    assert.equal(me.bio, FULL);
    // a change made from the current text is saved, whole
    const edited = `${FULL}\n\nდა კიდევ ერთი წინადადება.`;
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { bio: edited, bioWas: FULL } })).status, 200);
    assert.equal((await mentor.api('/me')).user.bio, edited);
    // and the card shows exactly what is stored
    const { experts } = await (await fetch(`${base}/api/experts`)).json();
    const card = experts.find((e) => e.name === 'Lekso Mentor');
    assert.ok(card, 'listed');
    assert.equal(card.bio, edited);
  });

  test('the Settings form sends only the fields changed, "About me" with the text it started from, and keeps what was typed when refused', () => {
    const js = read('public/js/settings-profile.js');
    assert.match(js, /const body = Object\.fromEntries\(Object\.entries\(v\)\.filter\(\(\[k, val\]\) => !loaded \|\| !same\(val, loaded\[k\]\)\)\);/);
    assert.match(js, /if \(body\.bio !== undefined && loaded\) body\.bioWas = loaded\.bio;/);
    assert.match(js, /if \(e\.code === 'bio_changed'\) \{/);
    assert.match(js, /loaded = values\(\);\r?\n\s*\}/,'the start is taken when the form is filled (and again after each save)');
    for (const l of ['en', 'ka']) assert.ok(JSON.parse(read(`public/i18n/${l}.json`))['profile.err.bioChanged'], l);
  });
});

describe('too long is said, never cut', () => {
  test('"About me": 2000 characters are kept whole; 2001 are refused and nothing changes', async () => {
    const two = 'ა'.repeat(1999) + 'ბ';
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { bio: two, bioWas: (await mentor.api('/me')).user.bio } })).status, 200);
    assert.equal((await mentor.api('/me')).user.bio, two);
    const r = await mentor.api('/me', { method: 'PATCH', body: { bio: two + 'გ', bioWas: two } });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'bio_too_long');
    assert.equal((await mentor.api('/me')).user.bio, two, 'not cut to 2000: refused');
    for (const l of ['en', 'ka']) assert.match(JSON.parse(read(`public/i18n/${l}.json`))['profile.err.bioLong'], /2000/, `${l}: the real limit`);
  });

  test('a profile description over its limit is refused with the limit, never cut', async () => {
    const r = await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'experience', data: { title: 'Lecturer', organisation: 'A university', start: { year: 2015 }, current: true, description: 'დ'.repeat(1001) } } });
    assert.equal(r.status, 400);
    assert.equal(r.max, 1000, JSON.stringify(r));
    const ok = await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'experience', data: { title: 'Lecturer', organisation: 'A university', start: { year: 2015 }, current: true, description: 'დ'.repeat(1000) } } });
    assert.equal(ok.status, 201, JSON.stringify(ok));
    assert.equal([...ok.item.description].length, 1000, 'kept whole');
  });

  test('no box of a mentor\'s own text has a maxlength (a browser cuts a pasted text at it without a word): the counters and the save say it', () => {
    assert.doesNotMatch(read('public/settings.html'), /<textarea id="bio"[^>]*maxlength/);
    const apply = read('public/js/apply.js');
    assert.doesNotMatch(apply, /<textarea id="apStory"[^>]*maxlength/);
    assert.doesNotMatch(apply, /<textarea id="apSample"[^>]*maxlength/);
    // (step 2 is "My path" now, docs/CLAUDE-CODE-MENTOR-STORY.md: its boxes are drawn by public/js/story-form.js, none with a maxlength; the
    // counter says when a text is over, and the save refuses it with what was typed still in the box)
    const story = read('public/js/story-form.js');
    assert.doesNotMatch(story, /maxlength/);
    assert.match(story, /const over = \[\.\.\.area\.value\.trim\(\)\]\.length > max;/);
    assert.match(apply, /WisecallStoryForm\.html\(/);
    assert.doesNotMatch(read('public/js/settings-profile-sections.js'), /const area = [^\n]*maxlength/);
    for (const l of ['en', 'ka']) {
      const d = JSON.parse(read(`public/i18n/${l}.json`));
      assert.match(d['apply.story.countOver'], /\{max\}/);
      assert.match(d['story.count.over'], /\{max\}/);
      assert.match(d['ps.err.invalid_description'], /\{max\}/);
    }
  });
});

describe('the cards show the first lines, the profile and the stored text stay whole', () => {
  test('Browse and the home page get the whole bio (the card clamps it, nothing is shortened on the way); kept whole in the database', async () => {
    const pg = new (require('pg').Pool)({ connectionString: process.env.TEST_DATABASE_URL });
    const me = (await mentor.api('/me')).user;
    await mentor.api('/me', { method: 'PATCH', body: { bio: FULL, bioWas: me.bio } });
    await pg.query('UPDATE users SET show_on_home = true WHERE id = $1', [me.id]);
    const { experts } = await (await fetch(`${base}/api/experts`)).json();
    assert.equal(experts.find((e) => e.id === me.id).bio, FULL);
    const { mentors } = await (await fetch(`${base}/api/home-mentors`)).json();
    assert.equal(mentors.find((m) => m.id === me.id).bio, FULL);
    assert.equal((await pg.query('SELECT bio FROM users WHERE id = $1', [me.id])).rows[0].bio, FULL, 'stored whole');
    await pg.end();
  });

  test('the clamp is only a display rule: the home page 3 lines (2 at 360px) with "Read more →" when cut; an expert card 2 lines and always "სრულად ნახვა →"', () => {
    const css = read('public/css/style.css');
    assert.match(css, /\.card-bio-text, \.lexpert-bio \{ margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden;/);
    assert.match(css, /@media \(max-width: 360px\) \{ \.card-bio-text, \.lexpert-bio \{ -webkit-line-clamp: 2; line-clamp: 2; \} \}/);
    assert.match(read('public/js/clamp.js'), /const cut = \(el\) => el\.scrollHeight > el\.clientHeight \+ 1;/);
    // (an expert card, docs/CLAUDE-CODE-CARD-ABOUT.md: two lines with an ellipsis, and the link at its foot on every card, a span: the card is the link)
    assert.ok(css.includes('.card-bio-text { -webkit-line-clamp: 2; line-clamp: 2; text-overflow: ellipsis; }'));
    // (the card is drawn by public/js/expert-card.js for Browse and the previews: docs/CLAUDE-CODE-CARD-CHECKS.md)
    assert.ok(read('public/js/expert-card.js').includes("<span class=\"card-view\">${esc(t('experts.card.view'))}</span>"));
    assert.doesNotMatch(read('public/js/expert-card.js'), /<a [^>]*class="card-view"/, 'never a link inside the card\'s link');
    assert.match(read('public/js/main.js'), /WisecallExpertCard\.html\(e, \{/);
    assert.equal(JSON.parse(read('public/i18n/ka.json'))['experts.card.view'], 'სრულად ნახვა →');
    assert.equal(JSON.parse(read('public/i18n/en.json'))['experts.card.view'], 'View full profile →');
    assert.match(read('public/js/home-mentors.js'), /<a class="lmore lexpert-more" href="\$\{href\}" data-clamp-more hidden>/);
    assert.equal(JSON.parse(read('public/i18n/ka.json'))['experts.card.more'], 'სრულად ნახვა →');
    assert.equal(JSON.parse(read('public/i18n/en.json'))['experts.card.more'], 'Read more →');
    // the profile page: the whole text, its paragraphs kept
    assert.match(read('public/css/app.css'), /\.profile-about p \{ margin: 0; color: var\(--ink\); white-space: pre-line; overflow-wrap: anywhere; \}/);
  });
});
