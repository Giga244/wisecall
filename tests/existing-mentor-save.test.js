// An EXISTING mentor can save with only the data they already have. A mentor who applied before the newer rules has values that were right
// when they were saved (up to 8 specialty tags of 40 characters, when the limit is 5 of 30 now; a "current work" written on the Profile
// tab, which takes "@" and 120 characters; no "what I do" line, no field in their own words, no years, no direction). The forms send every
// box back with each save, so the server used to refuse the whole save for a mentor who had changed nothing, and the application's step 1
// kept asking, in red, for boxes that did not exist when they applied.
//   - a value that comes back exactly as it is stored is kept, never checked again; a value that is changed must fit today's rule
//   - an application that was sent before is never held back by what step 1 has asked for since: it is asked, never required
//   - every refusal names its box and says, in Georgian, what the limit is (the server's own number)
//   - signed out, a returning mentor is led to log-in, and back to the very page they opened
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor, SAMPLE } = require('./helpers');
const experience = require('../server/verification/experience');
const rules = require('../server/verification/rules');
const categories = require('../server/categories');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

const OLD_STORY = 'I have been a web designer for eight years. I started in a small studio making logos and business cards, then learned to design websites and the basics of code. For the last five years I have worked as a freelancer with Georgian and foreign clients.';
const OLD_TAGS = ['logo', 'branding', 'web design', 'UX', 'UI', 'Figma', 'illustration']; // (7: right when 8 were allowed)
const LONG_TAG = 'online shops: design and building them'; // (38 characters: right when 40 were allowed)
const OLD_WORK = 'Freelancer @ Studio Nova, www.nino-design.ge'; // (as the Profile tab takes it)

// A mentor as one who applied before the newer rules is stored: the old free-text story, none of the newer boxes.
async function oldMentor(email, { approve = true } = {}) {
  const m = await signupVerified(base, 'Nino Kartvelishvili', email);
  const r = await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Web designer', niche: 'design', price: 30, sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  const id = r.user.id;
  assert.equal((await m.api('/verification/evidence', { method: 'POST', body: { kind: 'website', url: `https://${email.split('@')[0]}.invalid/` } })).status, 200);
  if (approve) await approveMentor(admin, m);
  else await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() - interval '20 days' WHERE id = $1`, [id]);
  await pool.query(
    `UPDATE users SET story = $2, bio = $2, headline = NULL, custom_niche = NULL, years_experience = NULL, directions = '{}', specialty_tags = $3, current_work = $4,
       path_start = NULL, path_how = NULL, path_now = NULL, start_tags = '{}', sample_question = NULL, sample_reply = NULL, help_points = '{}', work_links = '{}',
       created_at = now() - interval '60 days' WHERE id = $1`, [id, OLD_STORY, OLD_TAGS, OLD_WORK]);
  return { client: m, id };
}
const row = async (id) => (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
// What Settings -> My details sends when "Save" is pressed (every box, as it is on the page).
const detailsBody = (d, over = {}) => ({ specialtyTags: (d.specialtyTags || []).join(', '), currentRole: d.currentRole, university: d.university, country: d.country || null,
  yearsExperience: d.yearsExperience == null ? '' : d.yearsExperience, ...over });
// What step 1 of /apply.html sends with every save.
const aboutBody = (f, over = {}) => ({ customNiche: f.customNiche, roleTitle: f.roleTitle, specialtyTags: (f.specialtyTags || []).join(', '),
  ...(f.fieldId ? { fieldId: f.fieldId, extraFields: f.extraFields, directions: f.directions, directionOther: f.directionOther } : {}), fieldSuggestion: '',
  university: f.university, country: f.country || null, currentRole: f.currentRole, practiceKind: f.practiceKind, ...(f.yearsExperience == null ? { yearsExperience: null } : { yearsExperience: f.yearsExperience }), ...over });

before(async () => {
  await resetDatabase();
  srv = await startServer(4889, { RATE_LIMIT_MULTIPLIER: '50', LAUNCH_MODE: 'prelaunch' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('Settings -> My details: an existing mentor saves with what they have', () => {
  let m, id;
  before(async () => { ({ client: m, id } = await oldMentor('old-details@example.com')); });

  test('"Save" with nothing changed is saved: the old tags and the old "current work" stay exactly as they are', async () => {
    const d = (await m.api('/me/details')).details;
    assert.deepEqual(d.specialtyTags, OLD_TAGS);
    assert.equal(d.currentRole, OLD_WORK);
    assert.ok(OLD_TAGS.length > rules.LIMITS.tagsMax, 'more tags than today\'s limit');
    const r = await m.api('/me/details', { method: 'PUT', body: detailsBody(d) });
    assert.equal(r.status, 200, r.text);
    const u = await row(id);
    assert.deepEqual(u.specialty_tags, OLD_TAGS);
    assert.equal(u.current_work, OLD_WORK);
  });

  test('one box changed (the years) is saved, whatever the other boxes hold', async () => {
    const d = (await m.api('/me/details')).details;
    const r = await m.api('/me/details', { method: 'PUT', body: detailsBody(d, { yearsExperience: '8', university: 'Tbilisi State Academy of Arts' }) });
    assert.equal(r.status, 200, r.text);
    const u = await row(id);
    assert.equal(u.years_experience, 8);
    assert.equal(u.university, 'Tbilisi State Academy of Arts');
    assert.deepEqual(u.specialty_tags, OLD_TAGS, 'the tags were not touched');
    assert.equal(u.current_work, OLD_WORK);
  });

  test('a tag of the old length (up to 40 characters) is kept too', async () => {
    await pool.query('UPDATE users SET specialty_tags = $2 WHERE id = $1', [id, [LONG_TAG, 'logo']]);
    assert.ok([...LONG_TAG].length > rules.LIMITS.tagMax && [...LONG_TAG].length <= 40);
    const d = (await m.api('/me/details')).details;
    assert.equal((await m.api('/me/details', { method: 'PUT', body: detailsBody(d) })).status, 200);
    assert.deepEqual((await row(id)).specialty_tags, [LONG_TAG, 'logo']);
    await pool.query('UPDATE users SET specialty_tags = $2 WHERE id = $1', [id, OLD_TAGS]);
  });

  test('a box that IS changed must fit today\'s rule, and the refusal names the box', async () => {
    const d = (await m.api('/me/details')).details;
    // one tag taken off: still more than 5
    const six = await m.api('/me/details', { method: 'PUT', body: detailsBody(d, { specialtyTags: OLD_TAGS.slice(0, 6).join(', ') }) });
    assert.deepEqual([six.status, six.error, six.field], [400, 'invalid_tags', 'specialtyTags']);
    assert.deepEqual((await row(id)).specialty_tags, OLD_TAGS, 'nothing was written');
    // the "current work" changed to something the rule refuses
    const work = await m.api('/me/details', { method: 'PUT', body: detailsBody(d, { currentRole: 'Designer @ Another Studio' }) });
    assert.deepEqual([work.status, work.error, work.field], [400, 'invalid_current_role', 'currentRole']);
    // down to 5 tags and a plain role: saved
    const ok = await m.api('/me/details', { method: 'PUT', body: detailsBody(d, { specialtyTags: OLD_TAGS.slice(0, 5).join(', '), currentRole: 'Freelance web designer' }) });
    assert.equal(ok.status, 200, ok.text);
    const u = await row(id);
    assert.deepEqual(u.specialty_tags, OLD_TAGS.slice(0, 5));
    assert.equal(u.current_work, 'Freelance web designer');
  });

  test('"My path" is not required of them: the story form saves with the three blocks empty, and the old story is still theirs', async () => {
    const before = (await m.api('/me/details')).story;
    assert.equal(before.oldStory, OLD_STORY);
    const r = await m.api('/me/details', { method: 'PUT', body: { pathStart: '', pathHow: '', pathNow: '', startTags: ['selftaught'], sampleQuestion: '', sampleReply: '', helpPoints: [], workLinks: [] } });
    assert.equal(r.status, 200, r.text);
    const u = await row(id);
    assert.equal(u.story, OLD_STORY);
    assert.deepEqual(u.start_tags, ['selftaught']);
    assert.equal(u.verification_status, 'verified', 'still approved and listed');
  });
});

describe('the application, opened again with "Edit my application"', () => {
  test('an approved mentor from before: step 1 asks for nothing new, saves with the old values, and the application can be sent again as it was', async () => {
    const { client: m, id } = await oldMentor('old-apply@example.com');
    assert.equal((await m.api('/verification/edit', { method: 'POST' })).status, 200);
    const v = await m.api('/verification');
    const a = v.application;
    assert.equal(a.locked, false);
    assert.deepEqual(a.optional, ['headline', 'years', 'field', 'directions', 'bio']);
    for (const code of ['headline', 'years', 'field', 'story', 'bio']) assert.ok(!a.missing.includes(code), `${code} is not missing`);
    assert.equal(a.progress.done[0], true, 'step 1 counts as done with what they have');
    assert.equal(a.progress.done[1], true, 'the old story counts: "My path" is not required');
    // step 1 saved untouched (7 tags, the old "current work", no field in their own words, no years)
    const saved = await m.api('/verification/experience', { method: 'PUT', body: aboutBody(a.form) });
    assert.equal(saved.status, 200, saved.text);
    const u = await row(id);
    assert.deepEqual(u.specialty_tags, OLD_TAGS);
    assert.equal(u.current_work, OLD_WORK);
    // a box changed on the way must still be right: here the title, too long
    const long = await m.api('/verification/experience', { method: 'PUT', body: aboutBody(a.form, { roleTitle: 'x'.repeat(rules.LIMITS.titleMax + 1) }) });
    assert.deepEqual([long.status, long.error, long.field], [400, 'title_too_long', 'roleTitle']);
    // sent again with only the old data: no "what I do", no field in their own words, no years, no direction
    const sent = await m.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, sent.text);
    const after = await row(id);
    assert.equal(after.verification_status, 'pending');
    assert.ok(after.application_submitted_at);
    assert.equal(after.headline, null);
    assert.equal(after.custom_niche, null);
    assert.equal(after.years_experience, null);
  });

  test('a mentor whose application was sent and not decided yet: the same, after "Edit my application"', async () => {
    const { client: m } = await oldMentor('old-pending@example.com', { approve: false });
    assert.equal((await m.api('/verification')).application.locked, true);
    assert.equal((await m.api('/verification/edit', { method: 'POST' })).status, 200);
    const a = (await m.api('/verification')).application;
    assert.deepEqual(a.optional, ['headline', 'years', 'field', 'directions', 'bio'], 'it was sent before: remembered after it was opened again');
    assert.deepEqual(a.missing, []);
    assert.equal((await m.api('/verification/experience', { method: 'PUT', body: aboutBody(a.form) })).status, 200);
    assert.equal((await m.api('/verification/submit', { method: 'POST' })).status, 200);
    // the header's "Continue your application" count agrees
    assert.equal((await m.api('/me')).user.mentorPath.state, 'sent');
  });

  test('a new applicant is still asked for all of it (nothing optional), and cannot send without it', async () => {
    const m = await signupVerified(base, 'New Applicant', 'new-applicant@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    const a = (await m.api('/verification')).application;
    assert.deepEqual(a.optional, []);
    for (const code of ['headline', 'years', 'field', 'bio']) assert.ok(a.missing.includes(code), code);
    const sent = await m.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 400);
    assert.equal(sent.error, 'incomplete');
    for (const code of ['headline', 'years', 'field', 'bio']) assert.ok(sent.missing.includes(code), code);
    assert.equal(await experience.sentBefore((await m.api('/me')).user), false);
  });
});

describe('every refusal says what is wrong, in Georgian, with the real limit', () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', f), 'utf8'));
  const js = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

  test('the messages take their numbers from the server\'s limits (the old one said "8 tags of 40" when the rule was 5 of 30)', () => {
    const ka = read('ka.json'), en = read('en.json');
    for (const d of [ka, en]) {
      for (const k of ['ap.err.invalid_tags', 'details.err.tags', 'details.specs.hint']) { assert.match(d[k], /\{max\}/, k); assert.match(d[k], /\{chars\}/, k); assert.doesNotMatch(d[k], /\d/, `${k}: no number typed in`); }
      for (const k of ['ap.err.invalid_current_role', 'details.err.role']) assert.match(d[k], /\{role\}/, k);
      for (const k of ['ap.err.invalid_university', 'details.err.university']) assert.match(d[k], /\{university\}/, k);
    }
    assert.match(js('apply.js'), /const errText = \(map, e\) => fill\(map\[e\.code\] \|\| 'toast\.error', \{ max: v\.limits\.tagsMax, chars: v\.limits\.tagMax,/);
    assert.match(js('settings-details.js'), /\{ max: limits\.specializations \|\| 5, chars: limits\.specializationMax \|\| 30, role: limits\.currentRoleMax \|\| 100, university: limits\.universityMax \|\| 100 \}/);
    // (the two places that hold the limit agree, so the Settings page's numbers are the rule's)
    assert.equal(categories.LIMITS.specializations, rules.LIMITS.tagsMax);
    assert.equal(categories.LIMITS.specializationMax, rules.LIMITS.tagMax);
    assert.equal(ka['details.err.tags'].replace('{max}', 5).replace('{chars}', 30), 'მაქსიმუმ 5 სპეციალიზაცია, თითო 30 სიმბოლომდე, ბმულებისა და მისამართების გარეშე.');
  });

  test('each code a form can get has Georgian and English words, and the box it is about', () => {
    const ka = read('ka.json'), en = read('en.json');
    const apply = js('apply.js'), details = js('settings-details.js'), signup = js('signup.js');
    const keysIn = (src, re) => [...src.matchAll(re)].map((x) => x[1]);
    // the application's step 1
    const err = /const ERR = \{([\s\S]*?)\};/.exec(apply)[1];
    for (const key of keysIn(err, /: '([\w.]+)'/g)) { assert.ok(ka[key], `ka ${key}`); assert.ok(en[key], `en ${key}`); }
    for (const [field, box] of [['specialtyTags', 'tags'], ['university', 'university'], ['currentRole', 'currentRole'], ['roleTitle', 'title'], ['customNiche', 'field'], ['yearsExperience', 'years']]) {
      assert.match(apply, new RegExp(`${field}: '${box}'`), `${field} -> its own box`);
      assert.match(apply, new RegExp(`data-error-for="${box}"`), `a line under the ${box} box`);
    }
    // Settings -> My details
    const map = /const errorText = \(code\) => fillText\(\{([\s\S]*?)\}\[code\]/.exec(details)[1];
    for (const key of keysIn(map, /: '([\w.]+)'/g)) { assert.ok(ka[key], `ka ${key}`); assert.ok(en[key], `en ${key}`); }
    assert.match(details, /const DETAILS_INPUT = \{ specialtyTags: '#dSpecs', currentRole: '#dRole', university: '#dUni', country: '#dCountry', yearsExperience: '#dYears' \};/);
    assert.match(details, /input\.setAttribute\('aria-invalid', 'true'\); fieldLine\(input, errorText\(e\.code\)\); input\.focus\(\);/);
    // (the line is right under its box: on a phone the end of the form is out of sight)
    for (const id of ['dSpecs', 'dRole', 'dUni', 'dCountry', 'dYears']) assert.match(details, new RegExp(`aria-describedby="${id}Err"`), id);
    assert.match(details, /<p class="form-error details-field-error" id="dSpecsErr" role="alert" hidden><\/p>/);
    // the sign-up page
    const keys = /const ERROR_KEYS = \{([\s\S]*?)\};/.exec(signup)[1];
    for (const key of [...keysIn(keys, /: '([\w.]+)'/g), 'auth.error.nameMissing', 'auth.error.emailMissing', 'auth.error.passwordMissing', 'auth.existing.logIn', 'auth.signup.returning', 'auth.signup.returningLogIn', 'apply.optional']) {
      assert.ok(ka[key], `ka ${key}`); assert.ok(en[key], `en ${key}`);
      assert.match(ka[key], /[ა-ჰ]/, `${key} is Georgian`);
    }
  });

  test('a box marked red is right again as soon as it is changed (sign-up, My details, the application)', () => {
    const signup = js('signup.js');
    assert.match(signup, /form\.addEventListener\('input', unmark\);\s*form\.addEventListener\('change', unmark\);/);
    assert.match(signup, /el\.removeAttribute\('aria-invalid'\);\s*errorEl\.textContent = '';\s*offerLogin\(false\);/);
    assert.match(js('settings-details.js'), /detailsForm\.addEventListener\('input', unmarkDetails\);/);
    assert.match(js('apply.js'), /Object\.entries\(ERROR_INPUT\)\.forEach\(\(\[n, id\]\) => \{ const el = form\.querySelector\('#' \+ id\); if \(el\) el\.addEventListener\('input', \(\) => fieldError\(form, n, ''\)\); \}\);/);
  });
});

describe('a returning mentor who is signed out', () => {
  const js = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

  test('the sign-up page refuses an email that has an account, and shows the way into it; the email is carried to log-in, never in the address', async () => {
    const taken = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' },
      body: JSON.stringify({ name: 'Nino Kartvelishvili', email: 'old-details@example.com', password: 'another-pass-12345', adult: true, as: 'mentor' }) });
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error, 'email_taken');
    const page = await (await fetch(base + '/ka/signup.html?as=mentor')).text();
    assert.match(page, /<div class="auth-returning" data-for-as="mentor"><span data-i18n="auth\.signup\.returning">[^<]*<\/span> <a href="\/ka\/login\.html" data-i18n="auth\.signup\.returningLogIn">[^<]*<\/a><\/div>/);
    assert.match(page, /<p class="auth-existing" id="existingAccount" hidden><a class="btn btn-primary btn-block" id="existingLogin" href="\/ka\/login\.html"/);
    const signup = js('signup.js');
    assert.match(signup, /if \(e\.code === 'email_taken'\) offerLogin\(true\);/);
    assert.match(signup, /sessionStorage\.setItem\('wisecall_login_email', document\.getElementById\('email'\)\.value\.trim\(\)\)/);
    assert.doesNotMatch(signup, /login\.html\?[^'"`]*email=/, 'never in the address');
    const login = js('login.js');
    assert.match(login, /const carried = sessionStorage\.getItem\('wisecall_login_email'\);/);
    assert.match(login, /sessionStorage\.removeItem\('wisecall_login_email'\);/);
  });

  test('the dashboard\'s "add your path" link, signed out: log-in leads back to that very place', () => {
    assert.match(js('settings.js'), /window\.location\.href = '\/login\.html\?redirect=' \+ encodeURIComponent\(window\.location\.pathname\.replace\(\/\^\\\/ka\(\?=\\\/\)\/, ''\) \+ window\.location\.search \+ window\.location\.hash\);/);
    assert.doesNotMatch(js('settings.js'), /'\/login\.html\?redirect=\/settings\.html'/);
  });
});
