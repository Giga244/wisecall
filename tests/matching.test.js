// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md, stage 1): the points and the order, the reason built only from what matched, only
// real listed mentors of the chosen category (never a made-up one, fewer than 3 when there are fewer), what is kept of a student's
// answers (a visitor: only the count; signed in: the answers, the free text for 30 days), the admin's counts, and the page's addresses.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails } = require('./helpers');
const matching = require('../server/matching');
const config = require('../server/matchConfig');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4878, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const START = 'I came to Tbilisi from a small town in Guria and did not speak any English at all.';
const HOW = 'I studied at night with free online courses and took my first order for twenty lari.';
const NOW = 'I have been a freelance web designer for three years. My clients come from five countries.';
const REPLY = 'Make three small sites for people you know, for free, and treat each one as a real order: a brief, a deadline and a hand-over. Those three are your portfolio, and one of them usually brings the first paid client.';

describe('the points (server/matchConfig.js) and the order', () => {
  const student = { fieldId: 'art', directions: ['art.web', 'art.graphic'], stage: 'switching', startTags: ['region', 'selftaught'], worry: null };
  const mentor = (over) => ({ id: 'm', startTags: [], directions: [], practiceKind: null, ...over });
  const path3 = { pathStart: START, pathHow: HOW, pathNow: NOW };

  test('the weights are the ones of the brief, in one file', () => {
    assert.deepEqual(config.points, { direction: 3, startTag: 3, stageFit: 2, hasPath: 1, hasSample: 1 });
    assert.equal(config.top, 3);
    assert.deepEqual(Object.keys(config.stageFit), ['school', 'university', 'switching', 'working']);
  });

  test('each shared direction +3, each shared starting-point tag +3, a fitting start +2, "My path" +1, a sample answer +1', () => {
    assert.equal(matching.score(student, mentor({})).score, 0);
    assert.equal(matching.score(student, mentor({ directions: ['art.web'] })).score, 3);
    assert.equal(matching.score(student, mentor({ directions: ['art.web', 'art.graphic', 'art.photography'] })).score, 6, 'only the ones the student chose');
    assert.equal(matching.score(student, mentor({ startTags: ['region'] })).score, 3);
    assert.equal(matching.score(student, mentor({ startTags: ['abroad'] })).score, 0, 'a tag the student does not have, and no fit');
    assert.equal(matching.score(student, mentor({ startTags: ['switched'] })).score, 2, '"changed fields" fits somebody changing fields');
    assert.equal(matching.score(student, mentor({ startTags: ['switched', 'selftaught'] })).score, 5, 'the fit counts once (+2), the shared tag +3');
    assert.equal(matching.score(student, mentor(path3)).score, 1);
    assert.equal(matching.score(student, mentor({ sampleQuestion: 'How do I find my first client?', sampleReply: REPLY })).score, 1);
    assert.equal(matching.score(student, mentor({ ...path3, pathNow: 'Too short' })).score, 0, 'a path that is not complete does not count');
    assert.equal(matching.score({ ...student, stage: 'working' }, mentor({ practiceKind: 'practitioner' })).score, 2, 'a practitioner fits somebody who works');
    assert.equal(matching.score({ ...student, stage: 'working' }, mentor({ practiceKind: 'academic' })).score, 0);
  });

  test('the stage bonus counts once per mentor (at most +2), however many of their tags fit; "Why them" names the fit only when it matched', () => {
    const school = { fieldId: 'art', directions: [], stage: 'school', startTags: [], worry: null };
    assert.deepEqual(config.stageFit.school.tags, ['region', 'grant', 'firstgen', 'abroad'], '"came from the regions" fits a school student too');
    assert.equal(matching.score(school, mentor({ startTags: ['region'] })).score, 2);
    assert.equal(matching.score(school, mentor({ startTags: ['region', 'grant', 'abroad'] })).score, 2, 'three fitting tags: still +2');
    assert.equal(matching.score(school, mentor({ startTags: ['region', 'grant'], practiceKind: 'academic' })).score, 2, 'tags and a fitting way of working: still +2');
    assert.equal(matching.score(school, mentor({ practiceKind: 'both' })).score, 2);
    // the reason names the fit only when there is one, and one sign of it
    assert.deepEqual(matching.score(school, mentor({ startTags: ['region', 'grant'] })).why.stage, { tag: 'region' });
    assert.deepEqual(matching.score(school, mentor({ practiceKind: 'academic' })).why.stage, { kind: 'academic' });
    const noFit = matching.score(school, mentor({ startTags: ['switched', 'selftaught'], practiceKind: 'practitioner' }));
    assert.equal(noFit.why.stage, null, 'nothing fits a school student here: the reason says nothing about the stage');
    assert.equal(noFit.score, 0);
    // every stage: the bonus is 0 or +2, never more
    for (const stage of Object.keys(config.stageFit)) {
      const everything = mentor({ startTags: require('../server/mentorStory').TAG_IDS, practiceKind: 'both' });
      assert.equal(matching.score({ ...school, stage }, everything).score, 2, stage);
    }
  });

  test('the reason holds only what matched', () => {
    const w = matching.score(student, mentor({ startTags: ['region', 'abroad', 'switched'], directions: ['art.web', 'art.photography'] })).why;
    assert.deepEqual(w.tags, ['region'], 'not "abroad": the student did not choose it');
    assert.deepEqual(w.directions, ['art.web']);
    assert.deepEqual(w.stage, { tag: 'switched' });
    const none = matching.score(student, mentor({ startTags: ['abroad'], directions: ['art.photography'] })).why;
    assert.deepEqual({ tags: none.tags, directions: none.directions, stage: none.stage }, { tags: [], directions: [], stage: null }, 'nothing matched: nothing is claimed');
    // (a fitting tag the student shares is already said by "like you": not said twice)
    assert.equal(matching.score(student, mentor({ startTags: ['selftaught'] })).why.stage, null);
  });

  test('ties: fewer questions waiting first, then chance (not always the same mentor)', () => {
    const a = mentor({ id: 'a', startTags: ['region'] }), b = mentor({ id: 'b', startTags: ['region'] }), c = mentor({ id: 'c', directions: ['art.web', 'art.graphic'] });
    assert.deepEqual(matching.rank(student, [a, b, c], { open: { a: 2, b: 0 } }).map((x) => x.mentor.id), ['c', 'b', 'a'], 'points first, then the one with fewer open questions');
    const luck = (values) => { let i = 0; return () => values[i++]; };
    assert.deepEqual(matching.rank(student, [a, b], { random: luck([0.9, 0.1]) }).map((x) => x.mentor.id), ['b', 'a']);
    assert.deepEqual(matching.rank(student, [a, b], { random: luck([0.1, 0.9]) }).map((x) => x.mentor.id), ['a', 'b']);
  });
});

let n = 0;
async function listed(name, { fieldId = 'art', directions = ['art.web'], niche = 'design', practiceKind = null, startTags, path3 = false, sample = false, approve = true } = {}) {
  n += 1;
  const c = await signupVerified(base, name, `match-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Designer and freelancer' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Designer', customNiche: `Design ${n}`, niche, fieldId, directions, yearsExperience: 4, ...(practiceKind ? { practiceKind } : {}),
    story: 'I taught myself design while working in a bank, then spent eight years designing for startups in Tbilisi and Berlin.' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://match-${n}.invalid/` } })).status, 200);
  if (approve) { await approveMentor(admin, c); await addPayoutDetails(c); }
  const more = { ...(startTags ? { startTags } : {}), ...(path3 ? { pathStart: START, pathHow: HOW, pathNow: NOW } : {}), ...(sample ? { sampleQuestion: 'How do I find my first client without a portfolio?', sampleReply: REPLY } : {}) };
  if (Object.keys(more).length) assert.equal((await c.api('/me/details', { method: 'PUT', body: more })).status, 200);
  return { c, id: r.user.id, name };
}
const match = (c, body) => c.api('/match', { method: 'POST', body });

describe('a match: real mentors of the chosen category only', () => {
  let best, second, third, fourth, other, draft;
  before(async () => {
    best = await listed('Best Fit', { directions: ['art.web'], startTags: ['region', 'selftaught'], path3: true, sample: true });     // 3 + 6 + 2 + 1 + 1 = 13
    second = await listed('Second Fit', { directions: ['art.web'], startTags: ['region'] });                                          // 3 + 3 = 6
    third = await listed('Third Fit', { directions: ['art.graphic'], startTags: ['switched'], path3: true });                         // 2 + 1 = 3
    fourth = await listed('Fourth Fit', { directions: ['art.graphic'] });                                                             // 0
    other = await listed('Other Field', { fieldId: 'biz', directions: ['biz.marketing'], niche: 'marketing', startTags: ['region', 'selftaught'], path3: true, sample: true });
    draft = await listed('Not Approved', { directions: ['art.web'], startTags: ['region', 'selftaught'], approve: false });
  });
  const answers = { fieldId: 'art', directions: ['art.web'], stage: 'switching', startTags: ['region', 'selftaught'], worry: 'I do not know where to start.' };

  test('the top 3, in order, each with what really matched; nobody from another category, nobody who is not approved', async () => {
    const r = await match(client(base), answers);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.mentors.map((m) => m.name), ['Best Fit', 'Second Fit', 'Third Fit']);
    assert.equal(r.inField, 4);
    assert.deepEqual(r.mentors[0].why, { tags: ['region', 'selftaught'], directions: ['art.web'], stage: null, field: 'art' });
    assert.deepEqual(r.mentors[1].why, { tags: ['region'], directions: ['art.web'], stage: null, field: 'art' });
    assert.deepEqual(r.mentors[2].why, { tags: [], directions: [], stage: { tag: 'switched' }, field: 'art' });
    // (whether the path is told, never its words: docs/CLAUDE-CODE-CARD-ABOUT.md)
    assert.deepEqual(r.mentors[0].trust, { hasPath: true, helpPoints: [], startTags: ['region', 'selftaught'], hasSample: true });
    const ids = r.mentors.map((m) => m.id);
    assert.ok(!ids.includes(other.id) && !ids.includes(draft.id) && !ids.includes(fourth.id));
    // the card has what it shows, and nothing private
    assert.deepEqual(Object.keys(r.mentors[0]).sort(), ['color', 'customNiche', 'fieldId', 'id', 'name', 'niche', 'photoUrl', 'price', 'roleTitle', 'trust', 'username', 'why']);
    assert.doesNotMatch(r.text, /example\.com|I do not know where to start/, 'no email, and the student\'s text is never sent back');
  });

  test('fewer than 3 real mentors: only the real ones; none: an empty list, never a placeholder', async () => {
    const two = await match(client(base), { fieldId: 'biz', stage: 'working' }); // (her start fits a school student, not somebody who works)
    assert.deepEqual(two.mentors.map((m) => m.name), ['Other Field']);
    assert.equal(two.inField, 1);
    assert.deepEqual(two.mentors[0].why, { tags: [], directions: [], stage: null, field: 'biz' }, 'only the field matched: nothing else is claimed');
    const school = await match(client(base), { fieldId: 'biz', stage: 'school' });
    assert.deepEqual(school.mentors[0].why.stage, { tag: 'region' }, 'for a school student her start does fit, and the reason says which');
    const none = await match(client(base), { fieldId: 'law', stage: 'university' });
    assert.equal(none.status, 200);
    assert.deepEqual(none.mentors, []);
    assert.equal(none.inField, 0);
    const everyone = (await pool.query(`SELECT name FROM users WHERE role IN ('mentor', 'both')`)).rows.map((x) => x.name);
    for (const r of [two, none]) for (const m of r.mentors) assert.ok(everyone.includes(m.name), 'every mentor shown is a real account');
  });

  test('a mentor an admin hid, or who is taken off the site, is never matched; a mentor is not matched with themselves', async () => {
    assert.ok(!(await match(best.c, answers)).mentors.some((m) => m.id === best.id), 'not themselves');
    await pool.query(`INSERT INTO profile_settings (user_id, hidden_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET hidden_at = now()`, [second.id]);
    await pool.query(`UPDATE users SET verification_status = 'suspended' WHERE id = $1`, [third.id]);
    const r = await match(client(base), answers);
    assert.deepEqual(r.mentors.map((m) => m.name), ['Best Fit', 'Fourth Fit']);
    await pool.query(`UPDATE profile_settings SET hidden_at = NULL WHERE user_id = $1`, [second.id]);
    await pool.query(`UPDATE users SET verification_status = 'verified' WHERE id = $1`, [third.id]);
  });

  test('the texts follow "About": hidden from visitors, the path and the sample answer give no points and are not on the card', async () => {
    assert.equal((await best.c.api('/me/profile/visibility', { method: 'PUT', body: { section: 'about', level: 'only_me' } })).status, 200);
    const r = await match(client(base), answers);
    const card = r.mentors.find((m) => m.id === best.id);
    assert.deepEqual(card.trust, { hasPath: false, helpPoints: [], startTags: ['region', 'selftaught'], hasSample: false });
    assert.equal((await best.c.api('/me/profile/visibility', { method: 'PUT', body: { section: 'about', level: 'everyone' } })).status, 200);
  });

  test('what is refused: an unknown field or stage, a direction of another field, too many, a phone number in the text', async () => {
    const c = client(base);
    assert.equal((await match(c, { fieldId: 'nope', stage: 'school' })).error, 'invalid_field');
    assert.equal((await match(c, { fieldId: 'art' })).error, 'invalid_stage');
    assert.equal((await match(c, { fieldId: 'art', stage: 'school', directions: ['biz.marketing'] })).error, 'invalid_directions');
    assert.equal((await match(c, { fieldId: 'art', stage: 'school', directions: ['art.web', 'art.graphic', 'art.photography', 'art.illustration'] })).error, 'too_many_directions');
    assert.equal((await match(c, { fieldId: 'art', stage: 'school', startTags: ['rich'] })).error, 'invalid_start_tags');
    // ("changed fields" is not a student's starting point: the stage "I'm changing fields" says it)
    assert.equal((await match(c, { fieldId: 'art', stage: 'switching', startTags: ['switched'] })).error, 'invalid_start_tags');
    assert.equal((await match(c, { fieldId: 'art', stage: 'school', startTags: ['region', 'grant', 'worked', 'abroad'] })).error, 'too_many_start_tags');
    assert.equal((await match(c, { fieldId: 'art', stage: 'school', worry: 'x'.repeat(501) })).error, 'worry_too_long');
    const phone = await match(c, { fieldId: 'art', stage: 'school', worry: 'Please call me on 555 12 34 56 about design.' });
    assert.equal(phone.status, 400);
    assert.equal(phone.error, 'contact_details');
    assert.equal(phone.field, 'worry');
  });
});

describe('privacy: what is kept', () => {
  test('a visitor leaves only the count of the match; a signed-in person their answers, the free text for 30 days', async () => {
    await pool.query('DELETE FROM match_runs');
    const worry = 'I am afraid I started too late to change my field.';
    assert.equal((await match(client(base), { fieldId: 'art', stage: 'switching', startTags: ['region'], directions: ['art.web'], worry })).status, 200);
    const visitor = (await pool.query('SELECT * FROM match_runs')).rows;
    assert.equal(visitor.length, 1);
    assert.deepEqual({ user: visitor[0].user_id, stage: visitor[0].stage, tags: visitor[0].start_tags, dirs: visitor[0].directions, worry: visitor[0].worry }, { user: null, stage: null, tags: null, dirs: null, worry: null });
    assert.equal(visitor[0].field_id, 'art');
    assert.ok(visitor[0].results >= 1);

    const student = await signupVerified(base, 'Signed In Student', 'match-student@example.com');
    assert.equal((await match(student, { fieldId: 'art', stage: 'switching', startTags: ['region'], directions: ['art.web'], worry })).status, 200);
    const mine = (await pool.query('SELECT * FROM match_runs WHERE user_id IS NOT NULL')).rows[0];
    assert.deepEqual({ stage: mine.stage, tags: mine.start_tags, dirs: mine.directions, worry: mine.worry }, { stage: 'switching', tags: ['region'], dirs: ['art.web'], worry });

    // after 30 days the free text is emptied; the rest stays
    assert.equal(await matching.purgeOld(), 0, 'not yet');
    await pool.query(`UPDATE match_runs SET created_at = now() - interval '31 days' WHERE id = $1`, [mine.id]);
    assert.equal(await matching.purgeOld(), 1);
    const after = (await pool.query('SELECT * FROM match_runs WHERE id = $1', [mine.id])).rows[0];
    assert.equal(after.worry, null);
    assert.equal(after.stage, 'switching');
    // their own download has their answers; deleting the account removes them
    const data = await student.raw('/api/me/export');
    assert.match(await data.text(), /"mentorMatching"/);
  });

  test('the admins see counts only: how many matches, by category, with 0, 1, 2 or 3 results, and where more mentors are needed', async () => {
    await pool.query('DELETE FROM match_runs');
    const c = client(base);
    await match(c, { fieldId: 'art', stage: 'school', worry: 'A secret worry nobody else may read.' });   // 3 results
    await match(c, { fieldId: 'biz', stage: 'school' });   // 1
    await match(c, { fieldId: 'law', stage: 'school' });   // 0
    await match(c, { fieldId: 'law', stage: 'working' });  // 0
    const ov = await admin.api('/admin/overview');
    assert.equal(ov.status, 200, ov.text);
    const m = ov.matching;
    assert.equal(m.total, 4);
    assert.equal(m.month, 4);
    assert.deepEqual(m.byResults, { 0: 2, 1: 1, 2: 0, 3: 1 });
    assert.deepEqual(m.fields.map((f) => [f.fieldId, f.runs, f.short, f.mentors]), [['law', 2, 2, 0], ['art', 1, 0, 4], ['biz', 1, 1, 1]]);
    assert.doesNotMatch(JSON.stringify(m), /secret worry|worry/i, 'never the student\'s text');
    assert.equal((await client(base).api('/admin/overview')).status, 401);
  });
});

describe('the page and its words', () => {
  test('/match, /ka/match and /en/match are the matching page (public/find-a-mentor.html); the request form is still on it', async () => {
    const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); return { status: r.status, html: await r.text() }; };
    for (const [p, lang, canonical] of [['/match', 'en', '/match'], ['/en/match', 'en', '/match'], ['/ka/match', 'ka', '/ka/match'], ['/find-a-mentor.html', 'en', '/match'], ['/ka/find-a-mentor.html', 'ka', '/ka/match']]) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.html, new RegExp(`<html lang="${lang}"`), p);
      assert.match(r.html, /id="matchApp"/, p);
      assert.match(r.html, /id="requestForm"/, `${p}: "tell us who you need" is still here`);
      assert.match(r.html, new RegExp(`<link rel="canonical" href="[^"]*${canonical.replace(/\//g, '\\/')}">`), p);
      assert.match(r.html, /<script src="\/js\/match\.js[^"]*"><\/script>/, p);
    }
    assert.match((await get('/ka/match')).html, /<title>იპოვე შენი მენტორი — Wisecall<\/title>/);
    assert.match((await get('/en/match')).html, /<title>Find your mentor — Wisecall<\/title>/);
    assert.match((await get('/sitemap.xml')).html, /\/match<\/loc>/);
  });

  test('the privacy line, the questions and the reasons are in both languages; nothing promises more than what matched', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'match.js'), 'utf8');
    assert.match(js, /t\('match\.privacy'\)/, 'the privacy line is on the form');
    const ka = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
    assert.equal(ka['match.privacy'], 'ამას მხოლოდ მენტორის მოსაძებნად ვიყენებთ. მენტორები შენს ტექსტს ვერ ხედავენ. ტელეფონი ან მისამართი არ დაწერო.');
    assert.equal(ka['match.q.field'], 'რომელ სფეროზე ფიქრობ?');
    assert.equal(ka['match.q.stage'], 'სად ხარ ახლა?');
    assert.equal(ka['match.q.start'], 'საიდან იწყებ?');
    assert.equal(ka['match.q.worry'], 'რა გაწუხებს ყველაზე მეტად?');
    assert.equal(ka['match.results.like'], 'ეს მენტორები შენსავით იწყებდნენ.');
    assert.equal(ka['match.few.title'], 'შენი სფეროს მეტი მენტორი მალე');
    assert.equal(ka['browse.match.title'], 'არ იცი, ვინ აირჩიო?');
    assert.equal(ka['browse.match.cta'], 'დამეხმარე არჩევაში →');
    for (const k of Object.keys(ka).filter((x) => x.startsWith('match.') || x.startsWith('browse.match.') || x.startsWith('home2.match.'))) assert.ok(en[k], `en ${k}`);
    for (const id of require('../server/mentorStory').TAG_IDS) { assert.ok(ka['match.did.' + id], id); assert.ok(en['match.did.' + id], id); }
    for (const k of ['school', 'university', 'switching', 'working']) assert.ok(ka['match.stage.' + k] && en['match.stage.' + k], k);
    // ("started like you" is said only when a shown mentor shares a start the student is living now; with only a shared grant or study
    // abroad, "walked the path you are starting")
    assert.match(js, /const likeYou = list\.some\(\(m\) => \(m\.why\.tags \|\| \[\]\)\.some\(\(id\) => SAME\.includes\(id\)\)\);/);
    assert.match(js, /const samePath = list\.some\(\(m\) => \(m\.why\.tags \|\| \[\]\)\.length\);/);
    assert.ok(ka['match.results.path'] && ka['match.results.path.one']);
    // (the stage is in "Why them" only when the server says it matched: why.stage)
    assert.match(js, /const stageTag = w\.stage && w\.stage\.tag \? w\.stage\.tag : null;/);
    assert.match(js, /if \(stageTag && !wanted\.length\) parts\.push\(/);
    assert.match(js, /if \(!stageTag && w\.stage && w\.stage\.kind\) parts\.push\(/);
  });

  test('"Where are you starting from?" is asked in the student\'s words, scored on the mentors\' tags; "changed fields" is not asked', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'match.js'), 'utf8');
    const ka = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
    const story = require('../server/mentorStory');
    assert.deepEqual(config.studentTags, ['region', 'grant', 'worked', 'selftaught', 'abroad', 'firstgen']);
    assert.ok(config.studentTags.every((id) => story.TAG_IDS.includes(id)), 'each one is a mentor tag too: the same id is scored');
    assert.deepEqual((await client(base).api('/categories')).matchTags, config.studentTags, 'the page gets the list from the server');
    assert.match(js, /catalog\.matchTags \|\| \[\]\)\.map\(\(id\) => `<button type="button" class="chip match-chip" data-tag="\$\{esc\(id\)\}"[^\n]*t\('match\.tag\.' \+ id\)/);
    assert.deepEqual(config.studentTags.map((id) => ka['match.tag.' + id]), [
      'რეგიონიდან ვარ', 'გრანტი / სტიპენდია მჭირდება', 'სწავლასთან ერთად ვმუშაობ', 'თვითონ ვსწავლობ', 'საზღვარგარეთ მინდა სწავლა', 'ოჯახში პირველი სტუდენტი ვიქნები'
    ]);
    for (const id of config.studentTags) assert.ok(en['match.tag.' + id], id);
    assert.equal(ka['match.tag.switched'], undefined);
    // "like you" only for what the student is living now; a grant and study abroad are said as what the mentor did
    const same = /const SAME = \[([^\]]*)\];/.exec(js)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    assert.deepEqual(same, ['region', 'worked', 'selftaught', 'firstgen']);
    for (const id of same) { assert.ok(ka['match.like.' + id], id); assert.ok(en['match.like.' + id], id); }
    assert.equal(ka['match.why.like'].replace('{list}', ka['match.like.region']), 'შენსავით რეგიონიდანაა.');
    assert.equal(ka['match.why.also'].replace('{what}', ka['match.did.grant']), 'თვითონ გრანტით ან სტიპენდიით ისწავლა.');
    assert.ok(config.studentTags.filter((id) => !same.includes(id)).every((id) => ka['match.did.' + id]));
  });

  test('"notify me" has a drawn envelope, not an emoji; before launch a card\'s button is the waiting list ("გამოწერა"), after it "დასვი კითხვა"', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'match.js'), 'utf8');
    const waitlist = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'waitlist.js'), 'utf8');
    const ka = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
    assert.equal(ka['match.notify'], 'შემატყობინე');
    assert.equal(en['match.notify'], 'Notify me');
    assert.match(js, /WisecallWaitlist\.html\(result\.fieldId, \{ submit: t\('match\.notify'\), icon: 'mail' \}\)/);
    assert.match(waitlist, /const ICONS = \{ mail: '<svg class="waitlist-icon"[^']*aria-hidden="true">/);
    assert.match(waitlist, /\$\{ICONS\[opts\.icon\] \|\| ''\}<\/button>/);
    // (no emoji in the matching page's words: on a coral button the emoji envelope was a white rectangle; the lock of the privacy line is in the page itself)
    for (const [k, v] of Object.entries(ka).filter(([k]) => k.startsWith('match.'))) assert.doesNotMatch(v + en[k], /\p{Extended_Pictographic}/u, k);
    assert.match(js, /\? `<button type="button" class="btn btn-primary" data-subscribe="matchWait\$\{i\}">\$\{esc\(t\('expert\.subscribeCta'\)\)\}<\/button>`/);
    assert.match(js, /: `<a class="btn btn-primary" href="\$\{href\}">\$\{esc\(t\('expert\.askCta'\)\)\}<\/a>`\}/);
    assert.match(js, /WisecallWaitlist\.html\(result\.fieldId, \{ submit: t\('expert\.subscribeCta'\) \}\)/);
    assert.equal(ka['expert.subscribeCta'], 'გამოწერა');
    assert.equal(ka['expert.askCta'], 'დასვი კითხვა');
  });
});
