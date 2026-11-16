// Mentor profiles that build trust (docs/CLAUDE-CODE-MENTOR-STORY.md): "My path" in three blocks takes the place of the free-text story
// (an old story stays until the mentor fills the blocks in), up to 3 neutral starting-point tags only the mentor sets, a sample answer
// labelled as one, "I can help with", work links; all through the contact filter; the Browse card, its filter and the search words.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails } = require('./helpers');
const mentorStory = require('../server/mentorStory');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4876, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const START = 'I came to Tbilisi from a small town in Guria and did not speak any English at all.';
const HOW = 'I studied at night with free online courses and took my first order for twenty lari.';
const NOW = 'I have been a freelance web designer for three years. My clients come from five countries.';
const QUESTION = 'How do I find my first client without a portfolio?';
const REPLY = 'Make three small sites for people you know, for free, and treat each one as a real order: a brief, a deadline and a hand-over. Those three are your portfolio, and one of them usually brings the first paid client.';
const OLD_STORY = 'I taught myself design while working in a bank, then spent eight years designing mobile apps for startups in Tbilisi and Berlin.';

let n = 0;
async function mentor(name, { story = OLD_STORY } = {}) {
  n += 1;
  const c = await signupVerified(base, name, `story-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Web designer and freelancer' } })).status, 200);
  const body = { roleTitle: 'Web designer', customNiche: 'Web design', niche: 'design', yearsExperience: 3, ...(story ? { story } : {}) };
  const r = await c.api('/verification/experience', { method: 'PUT', body });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://work-${n}.invalid/` } })).status, 200);
  return { c, id: r.user.id, username: r.user.username };
}
async function listed(name, opts) {
  const m = await mentor(name, opts);
  await approveMentor(admin, m.c);
  await addPayoutDetails(m.c);
  return m;
}
const put = (c, body) => c.api('/verification/experience', { method: 'PUT', body });
const details = (c, body) => c.api('/me/details', { method: 'PUT', body });
const missing = async (c) => (await c.api('/verification')).application.missing;
const cardOf = async (id, query = '') => (await client(base).api('/experts' + query)).experts.find((e) => e.id === id);
const profileOf = async (username, viewer) => (await (viewer || client(base)).api('/users/' + username)).profile;

describe('"My path" in the application (a draft)', () => {
  test('short blocks are saved but the step is not counted; three full blocks are the story', async () => {
    const m = await mentor('Draft Path', { story: null });
    assert.ok((await missing(m.c)).includes('story'));
    const short = await put(m.c, { pathStart: 'Too short', pathHow: HOW });
    assert.equal(short.status, 200, short.text);
    assert.equal(short.user.pathStart, 'Too short', 'a draft keeps what was typed');
    assert.ok((await missing(m.c)).includes('story'), 'two blocks, one of them short: not counted');

    const full = await put(m.c, { pathStart: START, pathHow: HOW, pathNow: NOW, startTags: ['region', 'selftaught'] });
    assert.equal(full.status, 200, full.text);
    assert.equal(full.user.story, `${START}\n\n${HOW}\n\n${NOW}`, 'the three blocks are the application\'s story');
    // (the path is never copied into the About: "შენ შესახებ" is the mentor's own, optional text; tests/mentor-about.test.js)
    assert.equal(full.user.bio, null, 'the About stays empty until the mentor writes it');
    assert.deepEqual(full.user.startTags, ['region', 'selftaught']);
    assert.ok(!(await missing(m.c)).includes('story'));
    const form = (await m.c.api('/verification')).application.form;
    assert.equal(form.pathNow, NOW);
    assert.deepEqual((await m.c.api('/verification')).startTags.map((x) => x.id), mentorStory.TAG_IDS);
  });

  test('a story written before stays, and counts, until the three blocks are filled in', async () => {
    const m = await mentor('Old Story');
    assert.ok(!(await missing(m.c)).includes('story'), 'the old story still counts');
    const one = await put(m.c, { pathStart: START });
    assert.equal(one.user.story, OLD_STORY, 'one block alone changes nothing');
    const all = await put(m.c, { pathHow: HOW, pathNow: NOW });
    assert.equal(all.user.story, `${START}\n\n${HOW}\n\n${NOW}`);
  });

  test('each block is 40 to 400 characters; a repeated text is saved as typed but does not count, and the page is told why', async () => {
    const m = await mentor('Limits', { story: null });
    const long = await put(m.c, { pathStart: 'a'.repeat(401) });
    assert.equal(long.status, 400);
    assert.equal(long.error, 'pathStart_too_long');
    assert.equal((await put(m.c, { pathStart: `${START} ${HOW} ${NOW} ${REPLY}`.slice(0, 399).trim() })).status, 200, '399 characters fit');
    const repeated = await put(m.c, { pathStart: START, pathHow: 'ha '.repeat(40), pathNow: NOW });
    assert.equal(repeated.status, 200, 'a draft is saved as it was typed');
    assert.equal(repeated.user.story, null, 'but the three blocks are not a story yet');
    const v = await m.c.api('/verification');
    assert.ok(v.application.missing.includes('story'));
    assert.equal(v.application.storyReason, 'repeated');
    // (not a draft, a sent or approved mentor's details: refused, with the field)
    const strict = await details(m.c, { pathStart: START, pathHow: 'ha '.repeat(40), pathNow: NOW });
    assert.equal(strict.error, 'path_repeated');
    assert.equal(strict.field, 'pathHow');
  });
});

describe('the contact filter', () => {
  test('a phone number, an email, a handle or a messenger link is refused in every text, with the field named', async () => {
    const m = await mentor('Contacts');
    for (const [body, field] of [
      [{ pathNow: `${NOW} Call me on 555 12 34 56.` }, 'pathNow'],
      [{ pathHow: `${HOW} Write to nino.designer@gmail.com` }, 'pathHow'],
      [{ sampleReply: `${REPLY} DM me on Telegram: t.me/nino_design` }, 'sampleReply'],
      [{ sampleQuestion: 'Can I message you at @nino_design?' }, 'sampleQuestion'],
      [{ helpPoints: ['Pricing an order', 'Find me: wa.me/995555123456'] }, 'helpPoints']
    ]) {
      const r = await put(m.c, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.error, 'contact_details');
      assert.equal(r.field, field);
    }
    assert.equal((await put(m.c, { pathNow: NOW })).status, 200, 'the same text without the number is fine');
  });

  test('work links: Behance, Dribbble, a site and LinkedIn are kept; a messenger, payment or contact link is refused; at most 3', async () => {
    const m = await mentor('Links');
    const ok = await put(m.c, { workLinks: ['behance.net/nino-design', 'https://dribbble.com/nino', 'https://www.linkedin.com/in/nino-design/'] });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.user.workLinks, ['https://behance.net/nino-design', 'https://dribbble.com/nino', 'https://www.linkedin.com/in/nino-design/']);
    for (const bad of ['https://t.me/nino', 'https://wa.me/995555123456', 'https://paypal.me/nino', 'https://calendly.com/nino', 'https://example.com/contact?mail=nino@example.com', 'https://linktr.ee/nino']) {
      const r = await put(m.c, { workLinks: [bad] });
      assert.equal(r.error, 'contact_details', bad);
      assert.equal(r.field, 'workLinks');
    }
    assert.equal((await put(m.c, { workLinks: ['javascript:alert(1)'] })).error, 'invalid_link');
    assert.equal((await put(m.c, { workLinks: ['not a link'] })).error, 'invalid_link');
    assert.equal((await put(m.c, { workLinks: ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example'] })).error, 'too_many_links');
    assert.deepEqual(mentorStory.linkChip('https://www.behance.net/nino'), { url: 'https://www.behance.net/nino', label: 'Behance' });
    assert.equal(mentorStory.linkChip('https://nino.design/work').label, 'nino.design');
  });
});

describe('starting-point tags', () => {
  test('up to 3, only from the list, set and removed by the mentor; never about income or family wealth', async () => {
    const m = await mentor('Tags');
    assert.equal((await put(m.c, { startTags: ['region', 'grant', 'worked', 'selftaught'] })).error, 'too_many_start_tags');
    assert.equal((await put(m.c, { startTags: ['rich_family'] })).error, 'invalid_start_tags');
    assert.deepEqual((await put(m.c, { startTags: ['worked', 'region'] })).user.startTags, ['region', 'worked'], 'kept in the list\'s order');
    assert.deepEqual((await put(m.c, { startTags: [] })).user.startTags, [], 'removed at any time');

    assert.equal(mentorStory.START_TAGS.length, 7);
    // (Browse draws the chips before the catalog arrives, from its own copy of the ids: the same ones, in the same order)
    const main = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
    assert.ok(main.includes(`const START_IDS = [${mentorStory.TAG_IDS.map((id) => `'${id}'`).join(', ')}];`), 'public/js/main.js START_IDS');
    const texts = mentorStory.START_TAGS.map((x) => `${x.ka} ${x.en}`).join(' ');
    assert.doesNotMatch(texts, /income|money|rich|poor|wealth|შემოსავ|ფულ|მდიდარ|ღარიბ|შეძლებულ/i);
    for (const lang of ['ka', 'en']) {
      const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${lang}.json`), 'utf8'));
      for (const x of mentorStory.START_TAGS) assert.equal(dict['start.' + x.id], x[lang], `${lang} ${x.id}`);
    }
  });
});

describe('on the profile and on Browse', () => {
  let m;
  test('an approved mentor adds the path, tags, a sample answer, points and links in "My details"; the profile shows them', async () => {
    m = await listed('Nino Listed');
    const before = await profileOf(m.username);
    assert.equal(before.mentor.trust.path, null);
    assert.equal(before.bio, OLD_STORY, 'the old story is shown until the path is there');

    assert.equal((await details(m.c, { pathStart: START })).error, 'path_incomplete', 'all three blocks or none');
    assert.equal((await details(m.c, { pathStart: START, pathHow: HOW, pathNow: 'Too short' })).error, 'path_short');
    assert.equal((await details(m.c, { sampleReply: REPLY })).error, 'sample_question_short', 'a sample answer needs its question');
    assert.equal((await details(m.c, { sampleQuestion: QUESTION, sampleReply: 'Too short.' })).error, 'sample_reply_short');
    assert.equal((await details(m.c, { sampleQuestion: QUESTION, sampleReply: 'x'.repeat(601) })).error, 'sampleReply_too_long');

    const saved = await details(m.c, { pathStart: START, pathHow: HOW, pathNow: NOW, startTags: ['region', 'selftaught', 'worked'], sampleQuestion: QUESTION, sampleReply: REPLY,
      helpPoints: ['Building a first portfolio', 'Pricing an order', 'Writing to a client abroad'], workLinks: ['https://www.behance.net/nino-design'] });
    assert.equal(saved.status, 200, saved.text);

    const p = await profileOf(m.username);
    assert.deepEqual(p.mentor.trust.path, { start: START, how: HOW, now: NOW });
    // (the About they had, their old story, is kept exactly as it is and shown above the path: it is no longer replaced by a copy of the path)
    assert.equal(p.mentor.trust.aboutIsPath, false, 'the About is their own words, not the path');
    assert.equal(p.bio, OLD_STORY, 'the About is unchanged');
    assert.deepEqual(p.mentor.trust.startTags, ['region', 'worked', 'selftaught']);
    assert.deepEqual(p.mentor.trust.sample, { question: QUESTION, answer: REPLY });
    assert.deepEqual(p.mentor.trust.helpPoints, ['Building a first portfolio', 'Pricing an order', 'Writing to a client abroad']);
    assert.deepEqual(p.mentor.trust.workLinks, [{ url: 'https://www.behance.net/nino-design', label: 'Behance' }]);
    assert.equal(p.mentor.trust.years, 3);
  });

  test('the Browse card: the first line of "where I am now", the chips, "sample answer"; the filter finds who started the same way', async () => {
    const other = await listed('Giorgi Other');
    assert.equal((await details(other.c, { startTags: ['abroad'] })).status, 200);
    const card = await cardOf(m.id);
    assert.equal(card.trust.nowLine, 'I have been a freelance web designer for three years.');
    assert.deepEqual(card.trust.startTags, ['region', 'worked', 'selftaught']);
    assert.equal(card.trust.hasSample, true);
    const plain = await cardOf(other.id);
    assert.deepEqual(plain.trust, { nowLine: null, startTags: ['abroad'], hasSample: false });
    assert.doesNotMatch(JSON.stringify(card), /ratingAvg":\s*[1-9]/, 'no rating that nobody gave');

    const region = (await client(base).api('/experts?start=region')).experts.map((e) => e.id);
    assert.ok(region.includes(m.id) && !region.includes(other.id));
    const abroad = (await client(base).api('/experts?start=abroad')).experts.map((e) => e.id);
    assert.ok(abroad.includes(other.id) && !abroad.includes(m.id));
    // (several at once: a mentor with any of them)
    const either = (await client(base).api('/experts?start=region,abroad')).experts.map((e) => e.id);
    assert.ok(either.includes(m.id) && either.includes(other.id));
    const none = (await client(base).api('/experts?start=firstgen,grant')).experts.map((e) => e.id);
    assert.ok(!none.includes(m.id) && !none.includes(other.id));
    assert.equal((await client(base).api('/experts?start=rich')).experts.length, (await client(base).api('/experts')).experts.length, 'an unknown tag filters nothing');
    assert.deepEqual((await client(base).api('/categories')).startTags.map((x) => x.id), mentorStory.TAG_IDS);
  });

  test('the texts follow "About": hidden from visitors, the path and the sample answer go too; the mentor removes everything at any time', async () => {
    assert.equal((await m.c.api('/me/profile/visibility', { method: 'PUT', body: { section: 'about', level: 'only_me' } })).status, 200);
    const hidden = await profileOf(m.username);
    assert.equal(hidden.mentor.trust.path, null);
    assert.equal(hidden.mentor.trust.sample, null);
    assert.deepEqual(hidden.mentor.trust.helpPoints, []);
    assert.equal((await cardOf(m.id)).trust.nowLine, null);
    assert.equal((await cardOf(m.id)).trust.hasSample, false);
    assert.equal((await m.c.api('/me/profile/visibility', { method: 'PUT', body: { section: 'about', level: 'everyone' } })).status, 200);

    const cleared = await details(m.c, { startTags: [], sampleQuestion: '', sampleReply: '', helpPoints: [], workLinks: [] });
    assert.equal(cleared.status, 200, cleared.text);
    const p = await profileOf(m.username);
    assert.deepEqual(p.mentor.trust.startTags, []);
    assert.equal(p.mentor.trust.sample, null);
    assert.deepEqual(p.mentor.trust.workLinks, []);
    assert.ok(p.mentor.trust.path, 'the path stays');
  });
});

describe('the form is easier', () => {
  test('"ვებ-დიზაინი", "გაყიდვები" and "ფრილანსი" are found by the search', async () => {
    for (const [q, chip] of [['ვებ-დიზაინი', 'art.web'], ['ვებ დიზაინი', 'art.web'], ['web design', 'art.web'], ['გაყიდვები', 'biz.sales'], ['ფრილანსი', 'biz.freelance'], ['ფრილანსერი', 'biz.freelance']]) {
      const r = await client(base).api('/categories/search?q=' + encodeURIComponent(q));
      assert.ok(r.chips.some((c) => c.id === chip), `${q} -> ${chip}: ${JSON.stringify(r.chips.map((c) => c.id))}`);
    }
  });

  test('"my field is not in the list": what the mentor typed reaches the admins, with the closest category they chose', async () => {
    const m = await mentor('Not Listed');
    const r = await put(m.c, { fieldSuggestion: 'Sound engineering', fieldId: 'art', directions: ['art.web'] });
    assert.equal(r.status, 200, r.text);
    const again = await mentor('Not Listed Too');
    assert.equal((await put(again.c, { fieldSuggestion: 'sound  Engineering' })).status, 200);
    const list = (await admin.api('/admin/niches')).fieldSuggestions;
    const group = list.find((s) => /sound engineering/i.test(s.label));
    assert.ok(group, JSON.stringify(list));
    assert.equal(group.count, 2, 'the same words are one suggestion');
    assert.ok(group.mentors.some((x) => x.id === m.id && x.fieldId === 'art'));
    assert.equal((await put(m.c, { fieldSuggestion: 'see https://evil.example' })).status, 400);
    assert.equal((await put(m.c, { fieldSuggestion: '' })).user.fieldSuggestion, null, 'taken back');
  });
});

describe('mentors from before', () => {
  test('one card on the dashboard until the path and a sample answer are there, or it is closed; never for a draft', async () => {
    const draft = await mentor('Still Drafting');
    assert.equal((await draft.c.api('/me')).user.storyCard, false, 'an application not sent yet has the form itself');
    const m = await listed('Before Path');
    assert.equal((await m.c.api('/me')).user.storyCard, true);
    assert.equal((await details(m.c, { pathStart: START, pathHow: HOW, pathNow: NOW })).status, 200);
    assert.equal((await m.c.api('/me')).user.storyCard, true, 'the sample answer is still to add');
    assert.equal((await details(m.c, { sampleQuestion: QUESTION, sampleReply: REPLY })).status, 200);
    assert.equal((await m.c.api('/me')).user.storyCard, false);

    const other = await listed('Closes Card');
    assert.equal((await other.c.api('/me/story-card/dismiss', { method: 'POST' })).status, 200);
    assert.equal((await other.c.api('/me')).user.storyCard, false, 'closed for good');
  });
});
