// "ჩემი გზა" refused for one "I can help with" line (docs/CLAUDE-CODE-STORY-SAVE.md). A listed mentor saved a Georgian path in Settings ->
// My details and got 400 helpPoints_too_long: each "I can help with" line was capped at 90 characters, which the form never said, and
// his line had 126; that one refusal took the whole form with it. Now:
//   - a line is up to 200 characters (LIMITS.pointMax), the form is told the same number, and the 126-character Georgian line is saved
//   - every part of the story form is checked on its own: a refused part says which and why (refused), the rest is saved (saved)
//   - a text stored now and sent back unchanged is never refused for its length (a limit that changes never blocks a later save)
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, client } = require('./helpers');
const mentorStory = require('../server/mentorStory');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4900, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

// (Georgian, as long as the real ones: the three blocks near the 400 limit, the last with a line break; the "I can help with" line 126)
const PATH = {
  pathStart: 'ჩემი გზა ოთხმოცდაათიანებში დავიწყე, როცა ქვეყანაში არც სინათლე იყო და არც სამსახური. ბევრს ეგონა, რომ წინ არაფერი გველოდა, და მეც ხშირად ასე მეგონა. ის განცდა, რომ ჩიხში ხარ და გამოსავალი არ ჩანს, დღესაც ბევრ ახალგაზრდას აქვს, ოღონდ სხვა მიზეზებით. სწორედ ეს გვაერთიანებს: გარემოსთან და საკუთარ შიშებთან ბრძოლა, როცა ჯერ არავინ გიცნობს და არავის სჯერა შენი.',
  pathHow: 'სერიოზულად ვეკიდებოდი საქმეს და ამავე დროს არც თავს ვაძლევდი უფლებას, ზედმეტად მძიმედ აღმექვა ყველაფერი. დისციპლინა და ცოტა სილაღე ერთმანეთს არ გამორიცხავს: ჩემთვის სწორედ მათი ერთად ყოფნა აღმოჩნდა გამოსავალი, ყოველ დილით.',
  pathNow: 'მყავს ოჯახი, საკუთარი საქმე და დრო ჰობისთვის. უფროსი არ მყავს.\nფული ჩემთვის თავისუფლებაა, მაგრამ არა მიზანი: ის მხოლოდ საშუალებაა. როცა საშუალება მიზნად იქცევა, იქ იწყება ადამიანის დაკარგვა, და ამას ყოველდღე ვიხსენებ, რომ არ დამავიწყდეს, რისთვის ვმუშაობ და ვისთვის ვცდილობ.'
};
const HELP = 'დაგეხმარები, გაარკვიო რა გინდა სინამდვილეში, დაალაგო პრიორიტეტები და იპოვო ის რესურსებიც, რომლებიც უკვე გაქვს ხელთ მიზნისთვის.';
const ABOUT = 'ოცდაათი წელია ვმუშაობ, ჯერ სახელმწიფო სამსახურში, მერე კერძო სექტორში. ვწერ წიგნებს და ვასწავლი უნივერსიტეტში. ბევრ ახალგაზრდას დავეხმარე, გაერკვია თავის მიზნებში და ეპოვა საკუთარი გზა.';
const LINK = 'https://www.example.org/books/a-personal-journey-through-recent-history';
// (what Settings -> My details sends: the whole story form, as public/js/story-form.js read() gives it)
const form = (over = {}) => ({ ...PATH, about: ABOUT, startTags: [], sampleQuestion: '', sampleReply: '', helpPoints: [HELP], workLinks: [LINK], ...over });

let n = 0;
async function listedMentor() {
  n += 1;
  const c = await signupVerified(base, `Story Save ${n}`, `story-save-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Writer and lecturer' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Lecturer', customNiche: 'Career advice', niche: 'design', yearsExperience: 30, story: 'I worked thirty years in the public service and in business, and I teach at a university now.' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://work-save-${n}.invalid/` } })).status, 200);
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  return { c, id: r.user.id, username: r.user.username };
}
const details = (c, body) => c.api('/me/details', { method: 'PUT', body });
const row = async (id) => (await pool.query('SELECT path_start, path_how, path_now, help_points, work_links, bio FROM users WHERE id = $1', [id])).rows[0];

describe('the reported case: Georgian path, a 126-character "I can help with" line', () => {
  test('the texts are as long as reported', () => {
    assert.equal([...HELP].length, 126);
    for (const k of Object.keys(PATH)) assert.ok([...PATH[k]].length > 200 && [...PATH[k]].length <= mentorStory.LIMITS.pathMax, k);
    assert.ok(PATH.pathNow.includes('\n'));
  });

  test('saved whole, exactly as typed (the line break too), and on the public profile', async () => {
    const m = await listedMentor();
    const r = await details(m.c, form());
    assert.equal(r.status, 200, r.text);
    const db = await row(m.id);
    assert.equal(db.path_start, PATH.pathStart);
    assert.equal(db.path_how, PATH.pathHow);
    assert.equal(db.path_now, PATH.pathNow, 'the line break is kept');
    assert.deepEqual(db.help_points, [HELP]);
    assert.deepEqual(db.work_links, [LINK]);
    const p = (await client(base).api('/users/' + m.username)).profile;
    assert.deepEqual(p.mentor.trust.path, { start: PATH.pathStart, how: PATH.pathHow, now: PATH.pathNow });
    assert.deepEqual(p.mentor.trust.helpPoints, [HELP]);
    // (sent again unchanged: still fine)
    assert.equal((await details(m.c, form())).status, 200);
  });

  test('the limit the form is given is the limit the server keeps (200 per line)', async () => {
    const m = await listedMentor();
    const d = await m.c.api('/me/details');
    assert.equal(d.story.limits.pointMax, mentorStory.LIMITS.pointMax);
    assert.equal(mentorStory.LIMITS.pointMax, 200);
    assert.ok([...HELP].length <= d.story.limits.pointMax);
  });
});

describe('one refused part never blocks the others', () => {
  test('a line over 200: only it is refused, with its reason; "My path", About and the links are saved', async () => {
    const m = await listedMentor();
    const long = 'ა'.repeat(150) + ' ' + 'ბ'.repeat(60); // (211)
    const r = await details(m.c, form({ helpPoints: [HELP, long] }));
    assert.equal(r.status, 400);
    assert.equal(r.error, 'helpPoints_too_long');
    assert.equal(r.field, 'helpPoints');
    assert.deepEqual(r.refused, [{ field: 'helpPoints', error: 'helpPoints_too_long' }]);
    for (const k of ['pathStart', 'pathHow', 'pathNow', 'about', 'workLinks']) assert.ok(r.saved.includes(k), k);
    assert.ok(!r.saved.includes('helpPoints'));
    assert.equal(r.user.pathNow, PATH.pathNow, 'the mentor as saved comes back');
    const db = await row(m.id);
    assert.equal(db.path_start, PATH.pathStart);
    assert.equal(db.path_now, PATH.pathNow);
    assert.deepEqual(db.work_links, [LINK]);
    assert.equal(db.bio, ABOUT);
    assert.deepEqual(db.help_points, [], 'the refused part is left as it was');
  });

  test('two refused parts: each named with its own reason, and the rest saved', async () => {
    const m = await listedMentor();
    const r = await details(m.c, form({ helpPoints: ['ა'.repeat(201)], workLinks: ['https://wa.me/995555123456'] }));
    assert.equal(r.status, 400);
    assert.deepEqual(r.refused, [{ field: 'helpPoints', error: 'helpPoints_too_long' }, { field: 'workLinks', error: 'contact_details' }]);
    assert.equal((await row(m.id)).path_how, PATH.pathHow);
  });

  test('a refused "My path" block keeps the path as it was (all three or none), and the "I can help with" line is saved', async () => {
    const m = await listedMentor();
    const r = await details(m.c, form({ pathStart: 'ა'.repeat(401) }));
    assert.equal(r.status, 400);
    assert.deepEqual(r.refused, [{ field: 'pathStart', error: 'pathStart_too_long' }]);
    const db = await row(m.id);
    assert.equal(db.path_start, null);
    assert.equal(db.path_how, null);
    assert.deepEqual(db.help_points, [HELP]);
  });

  test('everything refused: 400, nothing saved, no mentor sent back', async () => {
    const m = await listedMentor();
    const r = await details(m.c, { helpPoints: ['ა'.repeat(201)] });
    assert.equal(r.status, 400);
    assert.deepEqual(r.saved, []);
    assert.equal(r.user, undefined);
  });
});

describe('what is stored is never refused for its length', () => {
  test('a line stored over today\'s limit, sent back unchanged with a new path: saved; a changed one over the limit: refused', async () => {
    const m = await listedMentor();
    const old = 'ა'.repeat(230);
    await pool.query('UPDATE users SET help_points = $2 WHERE id = $1', [m.id, [old]]);
    const r = await details(m.c, form({ helpPoints: [old] }));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await row(m.id)).help_points, [old]);
    const changed = await details(m.c, form({ helpPoints: [old + 'ბ'] }));
    assert.equal(changed.status, 400);
    assert.equal(changed.error, 'helpPoints_too_long');
  });
});

describe('the form says the limit', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'story-form.js'), 'utf8');
  test('each "I can help with" line and the sample question have a live count with their limit', () => {
    assert.match(src, /name="helpPoint"[^>]*data-story-count[^>]*data-max="\$\{pointMax\}"/);
    assert.match(src, /name="sampleQuestion"[^>]*data-story-count[^>]*data-max=/);
    assert.match(src, /helpPoint-\$\{i\}-count/);
  });
  test('the words for "too long" and for the hint name the limit, in Georgian and English; a partly saved form says so', () => {
    for (const lang of ['ka', 'en']) {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${lang}.json`), 'utf8'));
      assert.match(j['story.err.too_long'], /\{max\}/, lang);
      assert.match(j['story.help.hint'], /\{max\}/, lang);
      assert.ok(j['story.err.partSaved'] && j['story.savedPart'], lang);
    }
  });
});
