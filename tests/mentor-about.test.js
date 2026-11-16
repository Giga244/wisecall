// "შენ შესახებ" / "About you": the profile's About (users.bio), back in the application now that "ჩემი გზა" took the place of the free-text
// story, which used to become the About. It is the mentor's own words:
//   - optional everywhere: it never stops saving, moving on or sending the application; 0 to 2000 characters
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

describe('in the application ("ჩემი გზა" step)', () => {
  test('optional: the path alone completes the step, nothing asks for an About, and the path is not copied into it', async () => {
    const m = await mentor('No About');
    const r = await put(m.c, PATH);
    assert.equal(r.status, 200, r.text);
    const app = await application(m.c);
    assert.ok(!app.missing.includes('story'), 'the step counts without an About');
    assert.ok(!app.missing.some((x) => /about|bio/.test(x)));
    assert.equal(await bioOf(m.id), null, 'never filled in by the site');
    assert.equal(app.form.about, '');
  });

  test('written with the path: saved exactly as written, shown in the form, and the step still counts', async () => {
    const m = await mentor('With About');
    const r = await put(m.c, { ...PATH, about: ABOUT });
    assert.equal(r.status, 200, r.text);
    assert.equal(await bioOf(m.id), ABOUT, 'line breaks and all');
    const app = await application(m.c);
    assert.equal(app.form.about, ABOUT);
    assert.ok(!app.missing.includes('story'));
    // emptied again: nothing
    assert.equal((await put(m.c, { about: '' })).status, 200);
    assert.equal(await bioOf(m.id), null);
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
  test('an approved mentor adds, changes and empties it in My details; the profile shows it', async () => {
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
    assert.equal((await details(m.c, { about: 'Call me on +995 599 12 34 56' })).error, 'contact_details');
    r = await details(m.c, { about: '' });
    assert.equal(r.status, 200, 'optional here too');
    p = await profileOf(m.username);
    assert.equal(p.bio, null);
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
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [m.id, `${OLD_ABOUT}\nMy site: studio.example`]);
    const before = await bioOf(m.id);
    assert.equal((await put(m.c, PATH)).status, 200);
    assert.equal(await bioOf(m.id), before, 'adding the path leaves the About as it was');
    assert.equal((await application(m.c)).form.about, before);
    assert.equal((await put(m.c, { ...PATH, about: before, startTags: ['region'] })).status, 200, 'sent back as it was: saved with the rest');
    assert.equal(await bioOf(m.id), before, 'byte for byte');
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    // approved: My details sends it back with every save, and it stays as it is
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
    // the path changed: the copy follows it (still out of sight), never the other way round
    const NOW2 = `${NOW} I also mentor two junior designers.`;
    assert.equal((await details(m.c, { ...PATH, pathNow: NOW2, about: '' })).status, 200);
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
