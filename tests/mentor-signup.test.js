// The simple mentor path (docs/CLAUDE-CODE-MENTOR-SIGNUP.md) and the fixes from the walkthrough (docs/CLAUDE-CODE-UX-WALKTHROUGH.md):
//   - an application needs only the headline and years, the field in the mentor's own words (the category is suggested), the story, the
//     price and one piece of evidence (and the licence in a regulated field); a title, tags and a sample answer are optional
//   - a link's kind comes from its address; LinkedIn and other sites that refuse automatic visitors are "checked by our team", never an
//     error; only a dead link or a profile that names someone else warns the mentor
//   - an application that was never sent is never "needs attention", even with a failed step
//   - "About me" and the story stay one text while they are the same
//   - /apply.html (signed out: the mentor's sign-up), the invite link /mentor (source "invite"), ?as=mentor kept by "forgot password",
//     the ID check sent back to the application, and the emails pointing at it
//   - the waiting list keeps the question typed on the home page (without contact details), shown to admins without the email
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client } = require('./helpers');
const linkCheck = require('../server/verification/linkCheck');
const experience = require('../server/verification/experience');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports. Students ask me how to choose a master programme abroad.';
const visit = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });

async function newMentor(name, email) {
  const c = await signupVerified(base, name, email);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } })).status, 200);
  return { c, id: (await c.api('/me')).user.id };
}
const userRow = async (id) => (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];

before(async () => {
  await resetDatabase();
  srv = await startServer(4771, { RATE_LIMIT_MULTIPLIER: '30' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('what an application needs', () => {
  test('headline, years, field, story, price and one link are enough: no title, tags or sample answer; the field picks its category', async () => {
    const m = await newMentor('Nino Beridze', 'nino@example.com');
    const empty = await m.c.api('/verification/submit', { method: 'POST' });
    assert.equal(empty.error, 'incomplete');
    assert.deepEqual(empty.missing, ['headline', 'years', 'field', 'niche', 'story', 'bio', 'price', 'evidence'], 'in the order /apply.html asks');

    // Step 1: what I do (the profile's headline), the field in my own words (no category chosen) and the years.
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { headline: 'Associate professor of economics at TSU' } })).status, 200);
    const s1 = await m.c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics and public policy', yearsExperience: 18 } });
    assert.equal(s1.status, 200, s1.text);
    assert.equal(s1.user.niche, 'business', 'the closest category is chosen from the words');
    // Steps 2 to 4.
    assert.equal((await m.c.api('/verification/experience', { method: 'PUT', body: { story: STORY } })).status, 200);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { price: 40 } })).status, 200);
    const ev = await m.c.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/en/faculty/economics/staff/nino-beridze' } });
    assert.equal(ev.status, 200, ev.text);
    assert.equal(ev.evidence.kind, 'university', 'a university page is recognised as one, with no type chosen');

    const v = await m.c.api('/verification');
    assert.deepEqual(v.application.missing, []);
    const sent = await m.c.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, sent.text);
    const row = await userRow(m.id);
    assert.equal(row.verification_status, 'pending');
    assert.equal(row.role_title, 'Associate professor of economics at TSU', 'the headline is the title when none was given');
    assert.deepEqual(row.specialty_tags, ['Macroeconomics', 'public policy'], 'the tags come from the field, and can be changed later');
    assert.equal(row.sample_answer, null);
    assert.equal(row.bio, STORY, 'the story is also "About me" (over 150 characters: it counts as "შენ შესახებ")');

    // In the admin review queue, with nothing missing from the profile.
    const queue = await admin.api('/admin/mentors?status=pending');
    const entry = (queue.mentors || []).find((x) => x.id === m.id);
    assert.ok(entry, queue.text);
    assert.equal(entry.verification.submitted, true);
    assert.deepEqual(entry.verification.profileGaps, [], 'no "Profile incomplete" label');
  });

  test('a regulated profession in the words moves the field to its category, and the licence is asked for', async () => {
    const m = await newMentor('Dr Lela Tabatadze', 'lela@example.com');
    const r = await m.c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Paediatrician', yearsExperience: 9 } });
    assert.equal(r.user.niche, 'medicine');
    const v = await m.c.api('/verification');
    assert.equal(v.regulated, true);
    assert.ok(v.application.missing.includes('license'));
  });

  test('the category suggestion: own words in English and Georgian, a regulated one only for the profession itself', async () => {
    const s = async (q) => (await client(base).api('/niches/suggest?q=' + encodeURIComponent(q)));
    assert.deepEqual(await s('Georgian wine making').then((r) => [r.niche, r.regulated]), ['wine_agriculture', false]);
    assert.equal((await s('ქართული ღვინის დაყენება')).niche, 'wine_agriculture');
    assert.equal((await s('Studying in Germany: scholarships')).niche, 'study_abroad');
    assert.equal((await s('პროგრამირება და ვებ-დეველოპმენტი')).niche, 'tech');
    assert.equal((await s('Associate professor of physics')).niche, 'science', 'the subject wins over "professor"');
    assert.equal((await s('University lecturer')).niche, 'teaching');
    assert.deepEqual(await s('Lawyer at a Tbilisi firm').then((r) => [r.niche, r.regulated]), ['law', true]);
    assert.equal((await s('personal finance for families')).regulated, false, 'a topic is not a licensed profession');
    assert.equal((await s('')).niche, null);
    assert.equal((await s('zzzz qqqq')).niche, null);
  });
});

describe('proof links', () => {
  test('the kind comes from the address', () => {
    const k = experience.kindFromUrl;
    assert.equal(k('https://www.linkedin.com/in/nino-beridze'), 'linkedin');
    assert.equal(k('https://iliauni.edu.ge/en/people/123'), 'university');
    assert.equal(k('https://ug.edu.ge/ka/staff'), 'university');
    assert.equal(k('https://www.ox.ac.uk/people/x'), 'university');
    assert.equal(k('https://scholar.google.com/citations?user=abc'), 'publication');
    assert.equal(k('https://github.com/nino'), 'portfolio');
    assert.equal(k('https://www.facebook.com/nino'), 'social');
    assert.equal(k('https://nino-wines.ge'), 'website');
    assert.equal(k('not a link'), null);
  });

  test('a profile address that clearly names someone else, and only that, counts as someone else\'s', () => {
    const other = (url, name) => linkCheck.namesSomeoneElse(url, { name });
    assert.equal(other('https://www.linkedin.com/in/john-smith-1234ab', 'Nino Beridze'), true);
    assert.equal(other('https://www.linkedin.com/in/nino-beridze-1234ab', 'Nino Beridze'), false);
    assert.equal(other('https://www.linkedin.com/in/nino-beridze-1234ab', 'ნინო ბერიძე'), false, 'Georgian and Latin spellings are the same name');
    assert.equal(other('https://www.linkedin.com/in/nberidze', 'Nino Beridze'), false, 'one word says nothing either way');
    assert.equal(other('https://www.facebook.com/giorgi.kapanadze', 'Nino Beridze'), true);
    assert.equal(other('https://tsu.ge/staff/john-smith', 'Nino Beridze'), false, 'only profile addresses on the big platforms');
  });

  test('the mentor sees "our team will check this link" for LinkedIn and pages without the name; a warning only for a dead link or someone else', async () => {
    const m = await newMentor('Tamar Gelashvili', 'tamar@example.com');
    const add = async (url) => (await m.c.api('/verification/evidence', { method: 'POST', body: { url } })).evidence.id;
    const ids = {
      walled: await add('https://www.linkedin.com/in/tamar-gelashvili'),
      noName: await add('https://tamar-gelashvili.example.com/about'),
      dead: await add('https://dead.example.com/'),
      someoneElse: await add('https://www.linkedin.com/in/john-smith-77')
    };
    const set = (id, status, flags) => pool.query('UPDATE mentor_evidence SET check_status = $2, check_result = $3 WHERE id = $1', [id, status, JSON.stringify({ flags })]);
    await set(ids.walled, 'warning', ['blocks_automatic_checks']);
    await set(ids.noName, 'warning', ['name_not_found']);
    await set(ids.dead, 'failed', ['dead_link']);
    await set(ids.someoneElse, 'warning', ['name_not_found', 'other_person']);
    const ev = (await m.c.api('/verification')).application.evidence;
    const state = (id) => ev.find((e) => e.id === id).state;
    assert.equal(state(ids.walled), 'team');
    assert.equal(state(ids.noName), 'team');
    assert.equal(state(ids.dead), 'problem');
    assert.equal(state(ids.someoneElse), 'unclear');
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
    assert.equal(en['ap.ev.state.team'], 'Our team will check this link');
    assert.doesNotMatch(en['ap.ev.state.unclear'], /couldn.t find|not found/i);
  });
});

describe('status messages', () => {
  test('an application never sent is not "needs attention" with a failed ID check; the step itself says it failed', async () => {
    const m = await newMentor('Levan Arabuli', 'levan@example.com');
    const r = await m.c.api('/verification/kyc/start', { method: 'POST', });
    assert.equal(r.status, 200, r.text);
    const sid = r.url.split('session=')[1];
    const back = await client(base).api(`/mock-kyc/sessions/${sid}/complete`, { method: 'POST', body: { outcome: 'decline' } });
    assert.match(back.redirect, /\/apply\.html\?step=5&kyc=returned$/, 'started on the application, the provider sends them back to it');
    for (let i = 0; i < 40; i++) { const v = await m.c.api('/verification'); if (v.requirements.find((x) => x.step === 'id_kyc').status === 'failed') break; await new Promise((ok) => setTimeout(ok, 150)); }
    const v = await m.c.api('/verification');
    assert.equal(v.requirements.find((x) => x.step === 'id_kyc').status, 'failed');
    assert.ok(['none', 'pending'].includes(v.state), 'neutral: the application was never sent');
    assert.ok(['none', 'pending'].includes((await m.c.api('/me')).user.verificationState));
    // (wherever it was started, it comes back to the application: the one place to apply)
    const again = await m.c.api('/verification/kyc/start', { method: 'POST' });
    const sid2 = again.url.split('session=')[1];
    const back2 = await client(base).api(`/mock-kyc/sessions/${sid2}/complete`, { method: 'POST', body: { outcome: 'decline' } });
    assert.match(back2.redirect, /\/apply\.html\?step=5&kyc=returned$/);
  });

  test('Settings names the failed step and what to do, with the next step on every badge (EN and KA)', () => {
    // (the card at the top of Settings: tests/one-apply-path.test.js has every state)
    const card = fs.readFileSync(path.join(ROOT, 'public/js/settings-application.js'), 'utf8');
    assert.match(card, /settings\.failed\./);
    assert.match(card, /href: '\/apply\.html'/, 'its button opens the application');
    const sv = fs.readFileSync(path.join(ROOT, 'public/js/settings-verification.js'), 'utf8');
    assert.match(sv, /'ap\.next\.identity\.attention'/);
    for (const lang of ['en', 'ka']) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
      for (const k of ['settings.progress.neutral', 'settings.failed.id_kyc', 'settings.failed.cta', 'ap.next.identity.todo', 'ap.next.experience.todo', 'ap.next.review.rejected']) assert.ok(d[k], `${lang}: ${k}`);
    }
  });
});

describe('"About me" and the story', () => {
  test('one text while they are the same; once they differ each is kept', async () => {
    const m = await newMentor('Ana Kipiani', 'ana-k@example.com');
    await m.c.api('/verification/experience', { method: 'PUT', body: { story: STORY } });
    assert.equal((await userRow(m.id)).bio, STORY, 'the story fills an empty "About me"');
    const edited = STORY.replace('eighteen', 'nineteen');
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { bio: edited } })).status, 200);
    assert.equal((await userRow(m.id)).story, edited, 'editing "About me" edits the story');
    await m.c.api('/verification/experience', { method: 'PUT', body: { story: STORY + ' I also run a podcast.' } });
    assert.equal((await userRow(m.id)).bio, STORY + ' I also run a podcast.');
    // Different on purpose: a short "About me" no longer touches the story.
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [m.id, 'Economist.']);
    await m.c.api('/verification/experience', { method: 'PUT', body: { story: STORY } });
    assert.equal((await userRow(m.id)).bio, 'Economist.');
  });
});

describe('the way in', () => {
  test('/apply.html: signed out to the mentor sign-up (in its language), signed in the page itself, never cached', async () => {
    const out = await visit('/apply.html');
    assert.equal(out.status, 302);
    assert.equal(out.headers.get('location'), '/signup.html?as=mentor');
    assert.equal((await visit('/ka/apply.html')).headers.get('location'), '/ka/signup.html?as=mentor');
    const m = await signupVerified(base, 'Giorgi Lomidze', 'giorgi@example.com');
    const page = await m('/apply.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.match(page.text, /<script src="\/js\/apply\.js/);
    assert.match((await m('/ka/apply.html')).text, /<title>მენტორის განაცხადი — Wisecall<\/title>/);
  });

  test('the invite link: /mentor and /ka/mentor to the mentor sign-up (or the application), and the account says "invite"', async () => {
    const r = await visit('/mentor?utm_campaign=tsu');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/signup.html?as=mentor');
    assert.equal((await visit('/ka/mentor')).headers.get('location'), '/ka/signup.html?as=mentor');
    assert.equal((await visit('/mentor', { dnt: '1' })).headers.getSetCookie().some((c) => c.startsWith('wc_src=')), false, 'Do Not Track: no cookie');
    const set = r.headers.getSetCookie().filter((c) => c.startsWith('wc_src='));
    assert.equal(set.length, 1, 'one source cookie');
    const c = client(base);
    c.setCookie('wc_src', set[0].split(';')[0].slice('wc_src='.length));
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Invited Professor', email: 'invited@example.com', password: 'test-pass-12345' } })).status, 201);
    const src = (await pool.query(`SELECT signup_source FROM users WHERE email = 'invited@example.com'`)).rows[0].signup_source;
    assert.equal(src.source, 'invite');
    assert.equal(src.campaign, 'tsu');
    assert.equal(src.landing, '/mentor');
    assert.equal((await c('/mentor')).headers.get('location'), '/apply.html', 'signed in: straight to the application');
  });

  test('a mentor sign-up needs no username; "forgot password" keeps the mentor path', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Maka Japaridze', email: 'maka@example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201);
    assert.ok((await pool.query(`SELECT username FROM users WHERE email = 'maka@example.com'`)).rows[0].username, 'made from the name');
    const f = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'maka@example.com', as: 'mentor' } });
    assert.match(f.resetUrl, /\/reset-password\.html\?token=[^&]+&as=mentor$/);
    const g = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'maka@example.com', as: '<b>x</b>' } });
    assert.doesNotMatch(g.resetUrl, /as=/);
  });

  test('the pages: the header link, the home page\'s mentor banner, the mentor sign-up and the links to the application', () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(read('public/js/header.js'), /key: 'nav\.becomeMentor', mentor: true/);
    assert.match(read('public/index.html'), /<a href="\/become-a-mentor\.html" class="[^"]*lmentor-btn" data-mentor-cta="hero" data-i18n="nav\.becomeMentor"/);
    assert.match(read('public/become-a-mentor.html'), /<a href="\/signup\.html\?as=mentor" class="btn btn-ink btn-lg btn-arrow become-link" data-i18n="mentors\.start">/);
    assert.match(read('public/js/info-page.js'), /'\/apply\.html' : '\/signup\.html\?as=mentor'/);
    const signup = read('public/signup.html');
    assert.match(signup, /data-for-as="mentor" data-i18n="auth\.signup\.mentorTitle"/);
    assert.match(signup, /<div class="field" data-for-as="asker">\s*<label for="username"/, 'no username for a mentor');
    assert.match(read('public/css/app.css'), /html:not\(\[data-as="mentor"\]\) \[data-for-as="mentor"\], html\[data-as="mentor"\] \[data-for-as="asker"\] \{ display: none !important; \}/);
    assert.match(read('public/js/verify-email.js'), /body: \{ becomeMentor: true \}/);
    assert.match(read('public/js/dashboard.js'), /'\/apply\.html'/);
    const mail = read('server/mail/templates.js');
    assert.match(mail, /s\.verificationSimplified\.button, url: `\$\{config\.PUBLIC_URL\}\/apply\.html`/);
    assert.match(mail, /s\.mentorRejected\.button, url: `\$\{config\.PUBLIC_URL\}\/apply\.html`/);
  });

  test('every text the application page uses exists in English and Georgian', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public/js/apply.js'), 'utf8');
    const keys = [...new Set([...src.matchAll(/(?<![\w.])t\('([a-zA-Z0-9_.]+)'\)/g)].map((m) => m[1]))];
    assert.ok(keys.length > 60, `${keys.length} texts`);
    for (const lang of ['en', 'ka']) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
      for (const k of keys) assert.ok(typeof d[k] === 'string' && d[k], `${lang}: ${k}`);
      for (const k of ['apply.step.about', 'apply.step.story', 'apply.step.price', 'apply.step.proof', 'apply.step.submit', 'meta.apply.title']) assert.ok(d[k], `${lang}: ${k}`);
    }
  });

  test('/api/config: the review time and the suggested price range', async () => {
    const cfg = await client(base).api('/config');
    assert.equal(cfg.mentorReviewDays, 2);
    assert.ok(cfg.priceSuggestMin >= cfg.priceMin && cfg.priceSuggestMax <= cfg.priceMax && cfg.priceSuggestMin < cfg.priceSuggestMax);
    assert.equal(cfg.popularFields.length, 6);
  });
});

describe('the waiting list keeps the question', () => {
  test('stored without contact details, at most 300 characters, and shown to admins without the email', async () => {
    const anon = client(base);
    const q = 'Is a master in Germany worth it? write me at nika.private@example.com or +995 555 12 34 56 ' + 'x'.repeat(400);
    assert.equal((await anon.api('/waitlist', { method: 'POST', body: { over16: true, email: 'nika-w@example.com', niche: 'study_abroad', language: 'ka', wantedQuestion: q } })).status, 201);
    const row = (await pool.query(`SELECT wanted_question FROM waitlist WHERE email = 'nika-w@example.com'`)).rows[0];
    assert.ok(row.wanted_question.startsWith('Is a master in Germany worth it?'));
    assert.ok([...row.wanted_question].length <= 300);
    assert.doesNotMatch(row.wanted_question, /nika\.private@example\.com|555 12 34 56/);
    assert.equal((await anon.api('/waitlist', { method: 'POST', body: { over16: true, email: 'plain@example.com', niche: 'any' } })).status, 201, 'the question is optional');
    const list = await admin.api('/admin/waitlist');
    assert.equal(list.status, 200);
    const d = list.demand.find((x) => x.question.startsWith('Is a master'));
    assert.ok(d);
    assert.deepEqual(Object.keys(d).sort(), ['createdAt', 'niche', 'question']);
    assert.ok(!JSON.stringify(list.demand).includes('@'), 'never an email');
    assert.equal((await anon.api('/admin/waitlist')).status, 401);
  });

  test('the waiting list: the question kept, the six common fields first, and a named inbox link', () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const lang of ['en', 'ka']) {
      const d = JSON.parse(read(`public/i18n/${lang}.json`));
      assert.ok(d['wait.otherFields'] && d['wait.question'] && d['wait.questionNote']);
    }
    assert.match(read('public/js/waitlist.js'), /<optgroup label="\$\{esc\(t\('wait\.otherFields'\)\)\}">/);
    assert.match(read('public/js/waitlist.js'), /wantedQuestion: question \|\| undefined/);
    assert.match(read('public/js/header.js'), /class="btn btn-outline btn-lg btn-block mm-inbox" data-inbox-link aria-label="\$\{w\('nav\.inbox'\)\}"/);
  });
});

describe('Settings on a phone', () => {
  test('the tabs wrap; the profile shows the essentials first; About me holds the whole story', () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const css = read('public/css/app.css');
    assert.match(css, /\.tabs \{ flex-wrap: wrap; overflow: visible;/);
    const html = read('public/settings.html');
    const more = html.indexOf('id="profileMore"');
    assert.ok(more > 0);
    for (const id of ['photoFile', 'name', 'headline', 'bio']) assert.ok(html.indexOf(`id="${id}"`) < more, `${id} comes first`);
    for (const id of ['username', 'currentWork', 'city', 'languageChecks', 'linkedinUrl', 'websiteUrl', 'profileVisibility']) assert.ok(html.indexOf(`id="${id}"`) > more, `${id} is under "More profile details"`);
    // (no maxlength: a browser would cut a pasted story without a word; too long is said and refused: tests/never-cut.test.js)
    assert.match(html, /<textarea id="bio" rows="4" aria-describedby="bioCount bioSync"><\/textarea>/);
  });
});

describe('the review of an application without the optional parts', () => {
  test('the sample answer\'s score counts only when there is one, and the AI is told the optional parts are optional', () => {
    const rules = require('../server/verification/rules');
    const aiReview = require('../server/verification/aiReview');
    const ai = { scores: { expertise_credibility: 90, story_consistency: 90, sample_answer_quality: 0, advice_safety: 95, niche_fit: 90 }, red_flags: [], recommendation: 'approve' };
    const facts = { identity: { kyc: 'passed', age: 'passed', names: 'passed' }, ai, links: { total: 1, opened: 1, autoVerified: 1 }, signals: {} };
    assert.deepEqual(rules.riskFrom({ ...facts, noSample: true }).points, [], 'no sample answer: nothing held against the applicant');
    assert.ok(rules.riskFrom(facts).points.some((p) => p.code === 'ai_score_below_50'), 'a poor sample answer still counts');
    const decide = (extra) => rules.decide({ autoApproveOn: true, identity: facts.identity, ai, risk: { level: 'low' }, autoVerifiedEvidence: 1, ...extra }).reasons.map((r) => r.code);
    assert.deepEqual(decide({ noSample: true }), []);
    assert.ok(decide({}).includes('scores_below'));
    const sent = aiReview.buildApplication({ niche: 'business', customNiche: 'Macroeconomics', roleTitle: null, specialtyTags: [], yearsExperience: 18, story: STORY, sampleAnswer: null }, []);
    assert.equal(sent.sample_answer, null);
    assert.match(fs.readFileSync(path.join(ROOT, 'server/verification/aiReview.js'), 'utf8'), /The title, the specialty tags and the sample answer are optional/);
  });
});
