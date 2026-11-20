// "შენ შესახებ" / "About you": the profile's About (users.bio), back in the application now that "ჩემი გზა" took the place of the free-text
// story, which used to become the About. It is the mentor's own words:
//   - required for a new application: at least 150 characters (up to 2000) before step 2 counts and the application can be sent; a draft
//     is saved however short or empty it is
//   - required in Settings → My details too, for saving that section, when it is new, changed or empty; an About a mentor already had is
//     kept as it is, however short
//   - an approved mentor without one is never hidden, held back or sent back to review: one card on the dashboard, until they write it or
//     close it; an application sent before is not held back for it either
//   - the same rules as the other texts a mentor writes (the contact filter, rude words)
//   - never written by the site: the path is not copied into an empty About any more
//   - an existing About is kept exactly as it is (saving other things never touches it, and one sent back unchanged is not checked again);
//     an About that is only the copy of the path made before counts as empty, and stays out of sight
//   - the headline, which the role title is made from, is said once under the name
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails } = require('./helpers');
const mentorStory = require('../server/mentorStory');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4898, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const START = 'I came to Tbilisi from a small town in Guria and did not speak any English at all.';
const HOW = 'I studied at night with free online courses and took my first order for twenty lari.';
const NOW = 'I have been a freelance web designer for three years. My clients come from five countries.';
const ABOUT = 'For twelve years I have designed websites and apps for banks, shops and startups.\n\nI lead a small studio now and teach a design course at a university. I can help with a first portfolio and with pricing work.';
const OLD_ABOUT = 'I taught myself design while working in a bank, then spent eight years designing mobile apps for startups in Tbilisi and Berlin.';
const HEADLINE = 'Senior Partner, a design studio, lecturer at a university';

let n = 0;
async function mentor(name, { story = null, headline = 'Web designer and freelancer', roleTitle = 'Web designer' } = {}) {
  n += 1;
  const c = await signupVerified(base, name, `about-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle, customNiche: 'Web design', niche: 'design', yearsExperience: 3, ...(story ? { story } : {}) } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://about-${n}.invalid/` } })).status, 200);
  return { c, id: r.user.id, username: r.user.username };
}
const put = (c, body) => c.api('/verification/experience', { method: 'PUT', body });
const details = (c, body) => c.api('/me/details', { method: 'PUT', body });
const application = async (c) => (await c.api('/verification')).application;
const profileOf = async (username) => (await client(base).api('/users/' + username)).profile;
const bioOf = async (id) => (await pool.query('SELECT bio FROM users WHERE id = $1', [id])).rows[0].bio;
const PATH = { pathStart: START, pathHow: HOW, pathNow: NOW };

const submit = (c) => c.api('/verification/submit', { method: 'POST' });

describe('in the application ("ჩემი გზა" step)', () => {
  test('required: without it the step is not done and the application cannot be sent; the draft is saved all the same', async () => {
    const m = await mentor('No About');
    const r = await put(m.c, PATH);
    assert.equal(r.status, 200, r.text);
    let app = await application(m.c);
    assert.ok(!app.missing.includes('story'), 'the path itself counts');
    assert.ok(app.missing.includes('bio'), 'the About is what step 2 still needs');
    assert.equal(app.progress.done[1], false);
    assert.deepEqual(app.optional, []);
    assert.equal(await bioOf(m.id), null, 'never filled in by the site');
    assert.equal(app.form.about, '');
    let s = await submit(m.c);
    assert.equal(s.status, 400);
    assert.equal(s.error, 'incomplete');
    assert.deepEqual(s.missing, ['bio'], 'only the About is missing');
    // a draft that is too short, or the same letter over and over: saved as typed, and still not enough
    for (const text of ['I design websites.', 'ა'.repeat(200)]) {
      assert.equal((await put(m.c, { about: text })).status, 200, 'a draft is always saved');
      assert.equal(await bioOf(m.id), text);
      app = await application(m.c);
      assert.ok(app.missing.includes('bio'), text);
      assert.equal((await submit(m.c)).error, 'incomplete');
    }
    // under 150 characters: not yet; 150: enough (counted like the path: spaces at the ends do not count)
    const under = 'I design websites and apps. '.repeat(6).trim().slice(0, 149);
    assert.equal(mentorStory.LIMITS.aboutMin, 150);
    assert.equal((await put(m.c, { about: `  ${under}  ` })).status, 200);
    assert.ok((await application(m.c)).missing.includes('bio'), 'under 150');
    assert.equal((await put(m.c, { about: `${under}x` })).status, 200);
    assert.ok(!(await application(m.c)).missing.includes('bio'), '150');
    assert.equal((await put(m.c, { about: ABOUT })).status, 200);
    app = await application(m.c);
    assert.ok(!app.missing.includes('bio'));
    assert.equal(app.progress.done[1], true);
    s = await submit(m.c);
    assert.equal(s.status, 200, s.text);
  });

  test('written with the path: saved exactly as written, shown in the form, and the step counts', async () => {
    const m = await mentor('With About');
    const r = await put(m.c, { ...PATH, about: ABOUT });
    assert.equal(r.status, 200, r.text);
    assert.equal(await bioOf(m.id), ABOUT, 'line breaks and all');
    const app = await application(m.c);
    assert.equal(app.form.about, ABOUT);
    assert.ok(!app.missing.includes('story'));
    assert.ok(!app.missing.includes('bio'));
    // emptied again in a draft: saved (nothing kept), and the step is open again
    assert.equal((await put(m.c, { about: '' })).status, 200);
    assert.equal(await bioOf(m.id), null);
    assert.ok((await application(m.c)).missing.includes('bio'));
  });

  test('up to 2000 characters; the contact filter and rude words as for every other text; a refusal changes nothing', async () => {
    const m = await mentor('Rules About');
    assert.equal((await put(m.c, { about: 'ა'.repeat(2000) })).status, 200, 'exactly 2000 is fine');
    const long = await put(m.c, { about: 'ა'.repeat(2001) });
    assert.equal(long.error, 'about_too_long');
    assert.equal(long.field, 'about');
    assert.equal((await bioOf(m.id)).length, 2000, 'nothing was cut or replaced');
    for (const text of ['Write to me: nino.design@gmail.com', 'Call me on +995 599 12 34 56', 'Find me on t.me/nino_design']) {
      const r = await put(m.c, { about: `${ABOUT} ${text}` });
      assert.equal(r.error, 'contact_details', text);
      assert.equal(r.field, 'about');
    }
    assert.equal(mentorStory.LIMITS.aboutMax, 2000);
  });
});

describe('in Settings → My details, and on the Profile tab', () => {
  test('an approved mentor adds and changes it in My details; a short or empty one is saved too (never refused for its length), one letter over and over is not; the profile shows it', async () => {
    const m = await mentor('Settings About');
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.equal((await m.c.api('/me/details')).story.about, '');
    let r = await details(m.c, { about: ABOUT });
    assert.equal(r.status, 200, r.text);
    let p = await profileOf(m.username);
    assert.equal(p.bio, ABOUT);
    assert.equal(p.mentor.trust.aboutIsPath, false);
    assert.deepEqual(p.mentor.trust.path, { start: START, how: HOW, now: NOW }, 'and "ჩემი გზა" next to it');
    assert.equal((await details(m.c, { about: `${ABOUT} Call me on +995 599 12 34 56` })).error, 'contact_details');
    // one letter over and over: refused, said next to the field, the About stays as it was
    r = await details(m.c, { ...PATH, about: 'ა'.repeat(200) });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'about_repeated');
    assert.equal(r.field, 'about', 'said next to the field');
    assert.equal(await bioOf(m.id), ABOUT, 'nothing was changed');
    // (docs/CLAUDE-CODE-CARD-CHECKS.md: an approved mentor is never refused a save for the About's length; the form hints, the admins'
    // daily check lists the card)
    r = await details(m.c, { ...PATH, about: 'I design websites.' });
    assert.equal(r.status, 200, r.text);
    assert.equal(await bioOf(m.id), 'I design websites.');
    // the other fields of the API are saved without it (only the section that sends it asks for it)
    assert.equal((await details(m.c, { startTags: ['region'] })).status, 200);
    p = await profileOf(m.username);
    assert.equal(p.bio, 'I design websites.');
    assert.equal((await details(m.c, { ...PATH, about: '' })).status, 200, 'emptied too');
  });

  test('an approved mentor with no About: the section is saved without one (never refused for its length), and the first one written is saved', async () => {
    const m = await mentor('Settings Empty About');
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    const r = await details(m.c, { ...PATH, about: '', startTags: ['worked'] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pool.query('SELECT start_tags FROM users WHERE id = $1', [m.id])).rows[0].start_tags, ['worked'], 'the rest is saved');
    assert.equal((await details(m.c, { ...PATH, about: ABOUT, startTags: ['worked'] })).status, 200);
    assert.equal(await bioOf(m.id), ABOUT);
  });

  test('the Profile tab writes the same About, through the same contact filter', async () => {
    const m = await mentor('Profile Tab About');
    assert.equal((await put(m.c, PATH)).status, 200);
    const bad = await m.c.api('/me', { method: 'PATCH', body: { bio: 'Write to me: nino.design@gmail.com', bioWas: '' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.error, 'contact_details');
    const ok = await m.c.api('/me', { method: 'PATCH', body: { bio: ABOUT, bioWas: '' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.user.about, ABOUT);
    assert.equal((await m.c.api('/me/details')).story.about, ABOUT, 'one text: My details shows the same');
  });
});

describe('existing mentors', () => {
  test('an About written before is kept exactly as it is, also when the path is added; the profile shows it with the path', async () => {
    const m = await mentor('Old About', { story: OLD_ABOUT });
    assert.equal(await bioOf(m.id), OLD_ABOUT, '(the old story was their About)');
    // a legacy About the filter would refuse today is not checked again when it comes back unchanged
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [m.id, `${OLD_ABOUT}\nSite: st.example`]);
    const before = await bioOf(m.id);
    assert.equal((await put(m.c, PATH)).status, 200);
    assert.equal(await bioOf(m.id), before, 'adding the path leaves the About as it was');
    assert.equal((await application(m.c)).form.about, before);
    assert.equal((await put(m.c, { ...PATH, about: before, startTags: ['region'] })).status, 200, 'sent back as it was: saved with the rest');
    assert.equal(await bioOf(m.id), before, 'byte for byte');
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    // approved: My details sends it back with every save, and it stays as it is (shorter than 150, and still saved: it was there before)
    assert.ok(mentorStory.LIMITS.aboutMin > [...before].length);
    assert.equal((await details(m.c, { ...PATH, about: before, startTags: ['region', 'worked'] })).status, 200);
    assert.equal(await bioOf(m.id), before, 'byte for byte after My details too');
    const p = await profileOf(m.username);
    assert.equal(p.bio, before);
    assert.equal(p.mentor.trust.aboutIsPath, false);
    assert.deepEqual(p.mentor.trust.path, { start: START, how: HOW, now: NOW });
  });

  test('an About that is only the copy of the path made before: empty in the forms, out of sight, kept until the mentor writes their own', async () => {
    const m = await mentor('Copied About');
    assert.equal((await put(m.c, PATH)).status, 200);
    const copy = mentorStory.asStory(PATH);
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [m.id, copy]); // (what the site wrote before this change)
    assert.equal((await application(m.c)).form.about, '');
    assert.equal((await m.c.api('/me')).user.about, '');
    // saving the step with the About box left empty leaves the copy as it is
    assert.equal((await put(m.c, { ...PATH, about: '' })).status, 200);
    assert.equal(await bioOf(m.id), copy);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { bio: '', bioWas: '' } })).status, 200);
    assert.equal(await bioOf(m.id), copy);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.equal((await m.c.api('/me/details')).story.about, '');
    let p = await profileOf(m.username);
    assert.equal(p.mentor.trust.aboutIsPath, true, 'the profile shows only "ჩემი გზა"');
    // the path changed (through the API, without the About box): the copy follows it (still out of sight), never the other way round
    const NOW2 = `${NOW} I also mentor two junior designers.`;
    assert.equal((await details(m.c, { ...PATH, pathNow: NOW2 })).status, 200);
    assert.equal(await bioOf(m.id), mentorStory.asStory({ ...PATH, pathNow: NOW2 }));
    assert.equal((await profileOf(m.username)).mentor.trust.aboutIsPath, true);
    // their own About replaces it, and shows
    assert.equal((await details(m.c, { about: ABOUT })).status, 200);
    assert.equal(await bioOf(m.id), ABOUT);
    p = await profileOf(m.username);
    assert.equal(p.mentor.trust.aboutIsPath, false);
    assert.equal(p.bio, ABOUT);
  });
});

describe('approved mentors without an About', () => {
  test('stay listed and approved; one card on the dashboard until they write it or close it', async () => {
    const m = await mentor('Listed No About');
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    let me = (await m.c.api('/me')).user;
    assert.equal(me.verificationStatus, 'verified');
    assert.equal(me.isListedMentor, true, 'listed without an About');
    assert.ok((await profileOf(m.username)).mentor, 'the profile is a mentor profile');
    const browse = await client(base).api('/experts?q=Listed');
    assert.ok(browse.experts.some((x) => x.id === m.id), 'in Browse experts');
    assert.equal(me.aboutCard, true, 'the card');
    // (an asker never sees it; nor a mentor with an About, however short)
    // closed: it does not come back, and nothing else changes
    assert.equal((await m.c.api('/me/about-card/dismiss', { method: 'POST' })).status, 200);
    me = (await m.c.api('/me')).user;
    assert.equal(me.aboutCard, false);
    assert.equal(me.isListedMentor, true);
    assert.equal(me.verificationStatus, 'verified');
  });

  test('the card is gone once they write their About; one they had before, however short, never brings it', async () => {
    const m = await mentor('Card Goes');
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.equal((await m.c.api('/me')).user.aboutCard, true);
    assert.equal((await details(m.c, { ...PATH, about: ABOUT })).status, 200);
    assert.equal((await m.c.api('/me')).user.aboutCard, false);
    const old = await mentor('Short Old About', { story: OLD_ABOUT });
    await approveMentor(admin, old.c);
    assert.equal((await old.c.api('/me')).user.aboutCard, false, 'an About of 128 characters is theirs: no card');
    const asker = await signupVerified(base, 'Asker No Card', 'asker-no-card@example.com');
    assert.equal((await asker.api('/me')).user.aboutCard, false);
  });

  test('"Edit my application": an application sent before is never held back for the About', async () => {
    const m = await mentor('Edit No About');
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.equal((await m.c.api('/verification/edit', { method: 'POST' })).status, 200);
    const app = await application(m.c);
    assert.ok(!app.missing.includes('bio'), 'not required of it');
    assert.ok(app.optional.includes('bio'), 'the page says "optional"');
    assert.equal(app.progress.done[1], true);
  });
});

describe('the headline under the name', () => {
  const ssr = async (username) => {
    const html = await (await fetch(`${base}/u/${username}`, { headers: { Accept: 'text/html' } })).text();
    return html.slice(html.indexOf('<article class="profile-card profile-ssr">'), html.indexOf('</article>'));
  };
  test('the role title made from the headline: the headline is said once, whole', async () => {
    // (as the site makes it when the application is sent: the headline, cut at the title's limit)
    const m = await mentor('Headline Once', { headline: HEADLINE, roleTitle: HEADLINE.slice(0, 30) });
    assert.equal((await put(m.c, PATH)).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.ok((await profileOf(m.username)).mentor, 'a listed mentor (the page writes the role title)');
    const head = await ssr(m.username);
    assert.equal(head.split(HEADLINE).length - 1, 1, 'once');
    assert.doesNotMatch(head, /class="profile-headline"/);
    assert.match(head, new RegExp(`<p class="profile-title">${HEADLINE}</p>`));
  });
  test('a role title of its own: the title and the headline, each once', async () => {
    const m = await mentor('Headline Two', { headline: HEADLINE });
    assert.equal((await put(m.c, { ...PATH, roleTitle: 'Design studio founder' })).status, 200);
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    assert.ok((await profileOf(m.username)).mentor, 'a listed mentor (the page writes the role title)');
    const head = await ssr(m.username);
    assert.equal(head.split(HEADLINE).length - 1, 1);
    assert.match(head, /<p class="profile-title">Design studio founder<\/p>/);
    assert.match(head, new RegExp(`<p class="profile-headline">${HEADLINE}</p>`));
  });
});
