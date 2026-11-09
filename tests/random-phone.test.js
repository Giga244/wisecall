// The home page's phone plays random real answers, with an honest example (marked, no name, no badge, no rating) while there are fewer than three
// (docs/CLAUDE-CODE-RANDOM-PHONE.md, docs/CLAUDE-CODE-FINISH.md part 1):
// what /api/home-qa sends (only published answers both people agreed to show, the pinned one first, none an admin hid, answers cut to about
// 300 characters), the admin's pin and hide, the order the page plays them in (public/js/phone-rotation.js: real ones first, the example only
// under three, never two of the same field in a row, the pin first), and the example's words. The page itself: e2e/random-phone.spec.js.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, SAMPLE, longQuestion, longAnswer } = require('./helpers');
const Rotation = require('../public/js/phone-rotation.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const dict = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', `${l}.json`), 'utf8'));
let srv, base, admin, seeker, mentor, mentorId;
let n = 0;

// An answered question, published with both people's yes, in the given field.
async function published(niche, { sample = false } = {}) {
  n += 1;
  const asker = await signupVerified(base, `Asker Studentashvili ${n}`, `asker${n}-phone@example.com`);
  const asked = await asker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(`Question number ${n} about ${niche}?`) } });
  const id = asked.booking.id;
  const answer = longAnswer(`Answer number ${n} about ${niche}. Start with the basics and give it one hour every day. Write down what you get wrong `
    + 'and look at it again on Sunday. Ask a teacher which topics come up most often in the exam. Find one friend who studies the same thing, '
    + 'so you can test each other. Read one real case or article a week, not only the textbook. After a month, look back at your notes and '
    + 'decide what to drop. Sleep matters more than one extra hour at night. Keep a short list of questions for the people already working in it.');
  const sent = await mentor.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer } });
  assert.equal(sent.status, 200, JSON.stringify(sent));
  const b = (await pool.query('SELECT seeker_id, question, answer FROM bookings WHERE id = $1', [id])).rows[0];
  const { rows: [r] } = await pool.query(
    `INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, status, asker_consent, asker_decided_at, mentor_consent, mentor_decided_at, question_public, answer_public, slug, published_at, is_sample)
     VALUES ($1, $2, $3, $4, 'published', true, now(), true, now(), $5, $6, 'phone-' || substr(md5(random()::text), 1, 8), now(), $7) RETURNING id`,
    [sample ? null : id, mentorId, sample ? null : b.seeker_id, niche, b.question, b.answer, sample]);
  return r.id;
}
const phone = () => client(base).api('/home-qa');
// (no two neighbours of the same field)
const sameInARow = (items) => items.slice(1).filter((x, i) => x.niche === items[i].niche).length;
// a seeded random, so a failure can be repeated
const seeded = (seed) => () => { // (mulberry32)
  seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

before(async () => {
  await resetDatabase();
  srv = await startServer(4859, { RATE_LIMIT_MULTIPLIER: '50', PUBLIC_CACHE_SECONDS: '0' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Not Admin', 'not-admin-phone@example.com');
  mentor = await signupVerified(base, 'Nino Beridze', 'nino-phone@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiology resident', niche: 'medicine', price: 0, proofUrl: 'https://example.org/in/nino-phone', sampleAnswer: SAMPLE } });
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
  mentorId = (await mentor.api('/me')).user.id;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('with no published answer: the example', () => {
  test('the server has none to send; the page plays the example, again and again; the phone is on the page', async () => {
    const none = await phone();
    assert.equal(none.pinned, null);
    assert.deepEqual(none.answers, []);
    const r = Rotation.create(await phone(), seeded(7));
    assert.equal(r.examples, true);
    const played = Array.from({ length: 4 }, () => r.next());
    assert.ok(played.every((x) => x.example && x.n === 1 && x.niche === 'medicine'), 'only the example');
    assert.match(await (await fetch(base + '/')).text(), /<div class="lhero-phone" id="homeQa">/, 'never hidden now');
    // (a failed request: the example alone)
    assert.equal(Rotation.create(null).examples, true);
  });

  test('the example\'s words: "Example" on the phone, "Expert · <field>", the deadline ("პასუხი 7 დღეში"), no name, no badge, no stars (docs/CLAUDE-CODE-FINISH.md part 1)', async () => {
    const html = await (await fetch(base + '/ka/')).text();
    assert.match(html, /<div class="qa-status"><span>9:41<\/span><span class="qa-example" hidden><\/span>/);
    assert.doesNotMatch(html, /qa-video|phone-example/, 'no video: an example is drawn, honestly');
    const js = fs.readFileSync(path.join(ROOT, 'public/js/landing.js'), 'utf8');
    assert.match(js, /\$\('\.qa-name'\)\.textContent = ex \? \[t\('home2\.qa\.expert'\), field\]\.filter\(Boolean\)\.join\(' · '\)/, 'no name');
    assert.match(js, /\$\('\.qa-meta'\)\.hidden = ex;/, 'no "verified"');
    assert.match(js, /\$\('\.qa-avatar'\)\.innerHTML = ex \? PERSON :/, 'a neutral picture, not a letter');
    assert.match(js, /const stars = !ex && Number\.isInteger\(item\.stars\)/, 'no stars');
    assert.match(js, /\$\('\.qa-adays'\)\.textContent = ex \? t\('home2\.qa\.exampleDays'\)/);
    assert.match(js, /if \(ex\) \$\('\.qa-d2'\)\.style\.display = 'none';/, 'no "2 days later"');
    const ka = dict('ka'), en = dict('en');
    assert.equal(ka['home2.qa.example'], 'მაგალითი');
    assert.equal(en['home2.qa.example'], 'Example');
    assert.equal(ka['home2.qa.expert'], 'ექსპერტი');
    assert.equal(ka['home2.qa.exampleDays'], '✓ პასუხი {answerDays} დღეში');
    assert.equal(ka['home2.qa.thanks'], 'მადლობა! ⭐ {n}.0');
    // (the example's question and answer)
    assert.equal(ka['home2.ex.1.q'], 'ბიოლოგია სუსტად მაქვს. ღირს თუ არა სამედიცინოზე ჩაბარება და საიდან დავიწყო?');
    assert.match(ka['home2.ex.1.a'], /^ღირს, თუ მედიცინა ნამდვილად გაინტერესებს/);
    assert.ok(en['home2.ex.1.q'] && en['home2.ex.1.a']);
    assert.match(ka['home2.qa.exampleCaption'], /^მაგალითი \(არა ნამდვილი საუბარი\)/);
  });

  test('the example is never presented as real: not in the page\'s markup or its structured data; its caption says so', async () => {
    const ka = dict('ka');
    for (const p of ['/', '/ka/']) {
      const html = await (await fetch(base + p)).text();
      assert.ok(!html.includes(ka['home2.ex.1.q'].slice(0, 30)), p);
      const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(' ');
      assert.doesNotMatch(ld, /ბიოლოგია/);
    }
    const js = fs.readFileSync(path.join(ROOT, 'public/js/landing.js'), 'utf8');
    assert.match(js, /\$\('#qaCaption'\)\.textContent = \(ex \? t\('home2\.qa\.exampleCaption'\)/);
  });
});

describe('fewer than three real answers', () => {
  test('the real one first, then the example takes its turn', async () => {
    const id = await published('tech');
    const data = await phone();
    assert.deepEqual(data.answers.map((a) => a.id), [id]);
    const r = Rotation.create(data, seeded(3));
    assert.equal(r.examples, true);
    const played = Array.from({ length: 6 }, () => r.next());
    assert.equal(played[0].id, id);
    assert.deepEqual(played.map((x) => (x.example ? 'example' : x.id)), [id, 'example', id, 'example', id, 'example']);
  });
});

describe('three or more real answers', () => {
  let ids;
  before(async () => { ids = [(await phone()).answers[0].id, await published('medicine'), await published('law'), await published('medicine')]; });

  test('only real ones, the question and answer cut, the student never named', async () => {
    const data = await phone();
    assert.equal(data.answers.length, 4);
    assert.deepEqual(new Set(data.answers.map((a) => a.id)), new Set(ids));
    for (const a of data.answers) {
      assert.ok([...a.answer].length <= 303, `cut: ${[...a.answer].length}`);
      assert.match(a.answer, /\.\.\.$/);
      assert.equal(a.mentor.name, 'Nino Beridze');
      assert.ok(!JSON.stringify(a).includes('Studentashvili'), 'the student is never named');
    }
    const r = Rotation.create(data);
    assert.equal(r.examples, false);
    assert.ok(Array.from({ length: 12 }, () => r.next()).every((x) => !x.example), 'no examples');
  });

  test('a random order (from one visit to the next), a different one on each loop, never two of the same field in a row', async () => {
    const data = await phone();
    const firsts = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const r = Rotation.create(data, seeded(seed));
      const played = Array.from({ length: 12 }, () => r.next()); // (three rounds)
      firsts.add(played[0].id);
      assert.equal(new Set(played.slice(0, 4).map((x) => x.id)).size, 4, 'each loop another one');
      assert.equal(sameInARow(played), 0, `seed ${seed}: ${played.map((x) => x.niche).join(' ')}`);
    }
    assert.ok(firsts.size >= 3, 'the first one differs between visits');
    // and the server's own order changes too
    const orders = new Set();
    for (let i = 0; i < 12; i++) orders.add((await phone()).answers.map((a) => a.id).join());
    assert.ok(orders.size > 1);
  });

  test('a pinned answer comes first (on the first loop); only an admin pins; a sample or unknown answer cannot be pinned', async () => {
    const pin = ids[2];
    assert.equal((await seeker.api('/admin/home-qa', { method: 'POST', body: { id: pin } })).status, 403);
    assert.equal((await admin.api('/admin/home-qa', { method: 'POST', body: { id: pin } })).status, 200);
    const data = await phone();
    assert.equal(data.pinned, pin);
    assert.equal(data.answers[0].id, pin);
    for (let seed = 1; seed <= 20; seed++) {
      const r = Rotation.create(data, seeded(seed));
      const played = Array.from({ length: 8 }, () => r.next());
      assert.equal(played[0].id, pin);
      assert.equal(sameInARow(played), 0);
    }
    const listed = await admin.api('/admin/home-qa');
    assert.equal(listed.pinned, pin);
    const sample = await published('design', { sample: true }).catch(() => null);
    if (sample) assert.equal((await admin.api('/admin/home-qa', { method: 'POST', body: { id: sample } })).status, 404);
    assert.equal((await admin.api('/admin/home-qa', { method: 'POST', body: { id: '00000000-0000-4000-8000-000000000000' } })).status, 404);
  });

  test('an answer an admin hides never shows (hiding the pinned one unpins it); shown again when let back; a withdrawn one disappears', async () => {
    const hide = ids[2]; // (the pinned one)
    assert.equal((await seeker.api(`/admin/home-qa/${hide}/hide`, { method: 'POST', body: { hidden: true } })).status, 403);
    assert.equal((await admin.api(`/admin/home-qa/${hide}/hide`, { method: 'POST', body: { hidden: true } })).status, 200);
    for (let i = 0; i < 8; i++) assert.ok(!(await phone()).answers.some((a) => a.id === hide), 'never sent');
    assert.equal((await phone()).pinned, null, 'no longer pinned');
    const listed = await admin.api('/admin/home-qa');
    assert.equal(listed.answers.find((a) => a.id === hide).hidden, true);
    assert.equal(listed.shown, 3);
    assert.equal((await admin.api('/admin/home-qa', { method: 'POST', body: { id: hide } })).status, 404, 'a hidden one cannot be pinned');
    // three real ones left: still no examples
    assert.equal(Rotation.create(await phone()).examples, false);
    assert.equal((await admin.api(`/admin/home-qa/${hide}/hide`, { method: 'POST', body: { hidden: false } })).status, 200);
    assert.ok((await phone()).answers.some((a) => a.id === hide));
    await pool.query(`UPDATE public_answers SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = 'asker' WHERE id = $1`, [ids[1]]);
    assert.ok(!(await phone()).answers.some((a) => a.id === ids[1]), 'withdrawn: gone');
    assert.equal((await admin.api(`/admin/home-qa/${ids[1]}/hide`, { method: 'POST', body: { hidden: true } })).status, 404, 'only published ones');
  });
});

describe('the order, with any answers', () => {
  test('never two of the same field in a row while the answers allow it, also across rounds; real ones before examples', () => {
    const mk = (niches) => ({ pinned: null, answers: niches.map((niche, i) => ({ id: `a${i}`, niche, question: 'q', answer: 'a' })) });
    for (const niches of [['tech', 'tech'], ['tech'], ['medicine', 'medicine', 'tech'], ['law', 'law', 'law', 'tech', 'tech', 'design'], ['medicine', 'tech', 'law', 'design', 'business']]) {
      for (let seed = 1; seed <= 30; seed++) {
        const r = Rotation.create(mk(niches), seeded(seed));
        const per = niches.length + (r.examples ? Rotation.EXAMPLES.length : 0);
        const played = Array.from({ length: per * 3 }, () => r.next());
        assert.equal(sameInARow(played), 0, `${niches.join(',')} seed ${seed}: ${played.map((x) => x.niche).join(' ')}`);
        if (r.examples) {
          const firstExample = played.findIndex((x) => x.example);
          assert.ok(played.slice(0, per).filter((x) => !x.example).length === niches.length);
          assert.ok(firstExample >= 1, 'a real one comes first');
        }
      }
    }
  });

  test('live texting, as in docs/new-home/phone-animation.html: letters with pauses after punctuation, the dots, the answer letter by letter, the stars one by one; reduced motion: one finished conversation, no rotation (public/js/landing.js)', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/landing.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(js, /if \(',\.\?!:'\.includes\(ch\)\) t \+= 0\.25; else if \(ch === ' '\) t \+= 0\.03;/);
    assert.match(js, /const TT = typedTimes\(qChars, 0\.4, 30\);/);
    assert.match(js, /translateY\(\$\{-Math\.max\(0, Math\.sin\(time \* 7 - i\)\) \* 4\}px\)/);
    assert.match(js, /aChars\.slice\(0, Math\.floor\(clamp\(\(time - S - 3\.2\) \/ 1\.6\) \* aChars\.length\)\)/);
    assert.match(js, /const p = i < stars \? clamp\(\(time - S - 5\.3 - i \* 0\.15\) \/ 0\.2\) : 0;/);
    assert.match(js, /set\(rotation\.next\(\)\);\n\s*\/\/ \(still: one finished conversation\)\n\s*if \(reduceMotion\(\)\) \{ render\(cur\.T\.loop - 0\.6\); screen\.style\.opacity = '1'; return; \}/);
    assert.match(js, /if \(elapsed >= cur\.T\.loop\) \{ elapsed = 0; set\(rotation\.next\(\)\); \}/);
  });
});
