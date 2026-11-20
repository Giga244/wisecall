// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// Mentor profiles that build trust (docs/CLAUDE-CODE-MENTOR-STORY.md), on a 375px phone in Georgian: step 2 of the application is "My
// path" (three short blocks with examples labelled "Example", up to 3 starting-point tags, an optional sample answer, "I can help with"
// and work links); the picker finds "ვებ-დიზაინი" and has "My field isn't in the list"; the profile shows the three blocks, the chips and
// the sample answer labelled as one; the Browse card shows the first line of "where I am now", two chips and "Sample answer ✓", and the
// "Where they started" filter finds who started the same way; a mentor from before sees one card on the dashboard, which closes for good.
// E2E_STORY_SHOTS=<folder> saves the pictures the brief asks for.
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_STORY_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
// (for the pictures only: the test server's support address is a placeholder; the pictures show the live site's own, so nobody takes the
// placeholder for what visitors see)
const LIVE_SUPPORT = 'support@wisecall.ge';
const liveLook = async (ctx) => {
  if (!SHOTS) return;
  await ctx.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: LIVE_SUPPORT } });
  });
};
const top = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); };

const START = 'ზუგდიდიდან ჩამოვედი თბილისში. ინგლისური არ ვიცოდი და დიზაინის სკოლის ფული არ მქონდა.';
const HOW = 'ღამით უფასო კურსებით ვსწავლობდი და ნაცნობებს საიტებს უფასოდ ვუკეთებდი. პირველი შეკვეთა 20 ლარად ავიღე.';
const NOW = '3 წელია ფრილანსერი ვებ-დიზაინერი ვარ. კლიენტები 5 ქვეყნიდან მყავს და დამწყებებს ვეხმარები.';
const QUESTION = 'როგორ ვიპოვო პირველი კლიენტი პორტფოლიოს გარეშე?';
const REPLY = 'გააკეთე სამი პატარა საიტი ნაცნობებისთვის უფასოდ, მაგრამ ისე, როგორც ნამდვილი შეკვეთა: დავალება, ვადა და ჩაბარება. ეს სამი ნამუშევარი უკვე პორტფოლიოა, და ხშირად სწორედ ერთ-ერთი მათგანი მოგიყვანს პირველ ფასიან კლიენტს.';
const OLD_STORY = 'ათი წელია გრაფიკულ დიზაინერად ვმუშაობ: ჯერ სტამბაში, შემდეგ სარეკლამო სააგენტოში, ახლა კი საკუთარ სტუდიაში ბრენდებს ვუქმნი იერსახეს.';
const POINTS = ['პირველი პორტფოლიოს აწყობა', 'შეკვეთაზე ფასის დადება', 'უცხოელ კლიენტთან მიწერა'];

let admin, nino, giorgi;

async function adminClient() {
  const email = 'e2e-admin@example.com';
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [email])).length) return S.apiUser('E2E Admin', email);
  const { client } = require('../tests/helpers');
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } });
  return c;
}

test.beforeAll(async () => {
  admin = await adminClient();
  // Nino: listed, with her path, tags, a sample answer, points and a work link. Giorgi: listed, from before "My path" (nothing added).
  nino = await S.listedMentor(admin, { name: 'ნინო წერეთელი', email: `nino-story-${tag}@e2e.test`, niche: 'design', roleTitle: 'ვებ-დიზაინერი', customNiche: 'ვებ-დიზაინი' });
  giorgi = await S.listedMentor(admin, { name: 'გიორგი აბაშიძე', email: `giorgi-story-${tag}@e2e.test`, niche: 'design', roleTitle: 'გრაფიკული დიზაინერი', customNiche: 'გრაფიკული დიზაინი' });
  // (his story from before "My path": one free text, also his About text)
  await S.sql('UPDATE users SET story = $2, bio = $2 WHERE email = $1', [giorgi.email, OLD_STORY]);
  const r = await nino.client.api('/me/details', { method: 'PUT', body: { yearsExperience: 3, pathStart: START, pathHow: HOW, pathNow: NOW, startTags: ['region', 'selftaught', 'worked'],
    sampleQuestion: QUESTION, sampleReply: REPLY, helpPoints: POINTS, workLinks: ['https://www.behance.net/nino-tsereteli', 'https://dribbble.com/nino-ts'] } });
  if (r.status !== 200) throw new Error('story setup failed: ' + r.text);
});

test('step 2 of the application is "My path": three blocks with examples, tags (at most 3), the optional part; "Saved ✓"; the picker finds ვებ-დიზაინი', async ({ browser }) => {
  const email = `applicant-story-${tag}@e2e.test`;
  await S.apiUser('ანა ქავთარაძე', email);
  const ctx = await browser.newContext(PHONE);
  await liveLook(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email }, '/apply.html');
  await page.waitForURL(/step=1$/);

  // Step 1: the search finds a direction by its own words, and choosing it chooses its field; "my field isn't in the list".
  await page.fill('#apHeadline', 'ვებ-დიზაინერი და ფრილანსერი');
  await page.fill('#apField', 'ვებ-დიზაინი');
  await page.fill('#fpSearch', 'ვებ-დიზაინი');
  const hit = page.locator('.fp-hit[data-hit="art.web"]');
  await expect(hit).toContainText('ვებ-დიზაინი');
  await expect(hit).toContainText('დიზაინი და ხელოვნება');
  await hit.click();
  await expect(page.locator('[data-field="art"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-direction="art.web"]')).toHaveAttribute('aria-pressed', 'true');
  for (const [word, chip] of [['გაყიდვები', 'biz.sales'], ['ფრილანსი', 'biz.freelance']]) {
    await page.fill('#fpSearch', word);
    await expect(page.locator(`.fp-hit[data-hit="${chip}"]`)).toBeVisible();
  }
  await page.fill('#fpSearch', '');
  await page.locator('[data-fp-not-listed]').click();
  await expect(page.locator('#fpSuggestion')).toBeVisible();
  await page.fill('#fpSuggestion', 'ხმის რეჟისურა');
  await expect(page.locator('#fpSuggestionHint')).toHaveText('შემდეგ ზემოთ აირჩიე ყველაზე ახლო კატეგორია. შენს სფეროს ჩვენი გუნდი ნახავს და შეიძლება სიაში დაამატოს.');
  await page.selectOption('#apYears', '3');
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  await expect(page.locator('#toast')).toHaveText('შენახულია ✓');
  await expect.poll(async () => (await S.sql('SELECT field_suggestion FROM users WHERE email = $1', [email]))[0].field_suggestion).toBe('ხმის რეჟისურა');

  // Step 2: "My path".
  await expect(page.locator('form[data-step="1"] h1')).toHaveText('ჩემი გზა');
  await expect(page.locator('label[for="ap-pathStart"]')).toHaveText('სად დავიწყე / რა იყო რთული');
  await expect(page.locator('label[for="ap-pathHow"]')).toHaveText('როგორ გავუმკლავდი');
  await expect(page.locator('label[for="ap-pathNow"]')).toHaveText('სად ვარ ახლა');
  await expect(page.locator('#ap-pathStart-ex')).toHaveText('მაგალითი: რეგიონიდან ჩამოვედი, ინგლისური არ ვიცოდი');
  await expect(page.locator('#ap-pathHow-ex')).toHaveText('მაგალითი: ღამით ვსწავლობდი უფასო კურსებით, პირველი შეკვეთა 20 ლარად ავიღე');
  await expect(page.locator('#ap-pathNow-ex')).toHaveText('მაგალითი: 3 წელია ფრილანსერი ვარ, კლიენტები 5 ქვეყნიდან');
  await expect(page.locator('#ap-pathStart-count')).toHaveText('40–400 სიმბოლო');
  await S.fillPath(page, { start: START, how: HOW, now: NOW });
  await expect(page.locator('#ap-pathNow-count')).toHaveClass(/is-ok/);
  // the tags: the seven of the brief, at most 3
  await expect(page.locator('.story-tag')).toHaveText(['რეგიონიდან ჩამოვედი', 'გრანტით / სტიპენდიით ვისწავლე', 'სწავლასთან ერთად ვმუშაობდი', 'თვითნასწავლი ვარ', 'სფერო შევიცვალე', 'საზღვარგარეთ ვისწავლე', 'ოჯახში პირველი სტუდენტი ვარ']);
  for (const id of ['region', 'selftaught', 'worked']) await page.locator(`[data-start-tag="${id}"]`).click();
  await page.locator('[data-start-tag="abroad"]').click();
  await expect(page.locator('[data-start-tag="abroad"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-tags-max]')).toBeVisible();
  await noOverflow(page);
  // a box grows with its text: nothing scrolls inside it
  const tall = await page.locator('#ap-pathHow').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, h: el.getBoundingClientRect().height }));
  expect(tall.scroll).toBeLessThanOrEqual(tall.client + 2);
  await page.fill('#ap-pathHow', `${HOW} ${HOW} ${HOW}`);
  const taller = await page.locator('#ap-pathHow').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, h: el.getBoundingClientRect().height }));
  expect(taller.h).toBeGreaterThan(tall.h);
  expect(taller.scroll).toBeLessThanOrEqual(taller.client + 2);
  await page.fill('#ap-pathHow', HOW);
  // the optional parts are in sight under their heading, each one a row that opens
  await expect(page.locator('.story-more-title')).toHaveText('პროფილის გასაძლიერებლად (არასავალდებულო)');
  await expect(page.locator('.story-opt > summary .story-opt-name')).toHaveText(['ნიმუში პასუხი', 'რაში დაგეხმარები', 'ნამუშევრების ბმულები']);
  for (const row of await page.locator('.story-opt > summary').all()) await expect(row).toBeVisible();
  await expect(page.locator('#ap-sampleQuestion')).toBeHidden();
  if (SHOTS) { await page.waitForTimeout(3200); await top(page); await page.screenshot({ path: `${SHOTS}/1-step2-my-path.png`, fullPage: true }); }

  // the optional part: a contact detail is refused with words, then the real thing is saved
  await page.locator('.story-opt[data-opt="sample"] > summary').click();
  await page.locator('.story-opt[data-opt="help"] > summary').click();
  await page.locator('.story-opt[data-opt="links"] > summary').click();
  await page.fill('#ap-sampleQuestion', QUESTION);
  await page.fill('#ap-sampleReply', REPLY);
  const points = page.locator('[name="helpPoint"]');
  for (let i = 0; i < 3; i++) await points.nth(i).fill(POINTS[i]);
  await page.locator('[name="workLink"]').first().fill('behance.net/ana-design');
  // the question and the points wrap and their boxes grow: never cut off at the side
  const q = await page.locator('#ap-sampleQuestion').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(q.sw).toBeLessThanOrEqual(q.cw + 1);
  expect(q.sh).toBeLessThanOrEqual(q.ch + 2);
  for (let i = 0; i < 3; i++) {
    const box = await points.nth(i).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
    expect(box.sw, `point ${i + 1} is not cut off`).toBeLessThanOrEqual(box.cw + 1);
    expect(box.sh).toBeLessThanOrEqual(box.ch + 2);
  }
  const oneLine = (await points.nth(0).boundingBox()).height;
  await points.nth(2).fill('უცხოელ კლიენტთან პირველი წერილის დაწერა ისე, რომ გიპასუხოს და შეკვეთა მოგცეს');
  expect((await points.nth(2).boundingBox()).height, 'a long point takes more lines').toBeGreaterThan(oneLine);
  await points.nth(2).fill(POINTS[2]);
  const reply = await page.locator('#ap-sampleReply').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(reply.scroll, 'the sample answer is all in sight, no scrolling inside the box').toBeLessThanOrEqual(reply.client + 2);
  await noOverflow(page);
  if (SHOTS) { await page.locator('.story-more').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20)); await page.waitForTimeout(300); await page.locator('.story-more').screenshot({ path: `${SHOTS}/1b-step2-optional-open.png` }); }
  // a contact detail is refused with words, and nothing typed is lost; then the real thing is saved
  await page.fill('#ap-sampleReply', `${REPLY} მომწერე: 555 12 34 56`);
  await page.click('.apply-next');
  await expect(page.locator('.apply-error')).toHaveText('აქ ტელეფონს, ელ-ფოსტას, მესენჯერს ან სოციალური ქსელის ბმულს ვერ დაწერ. სტუდენტები Wisecall-ზე მოგწერენ.');
  expect(new URL(page.url()).searchParams.get('step')).toBe('2');
  await page.fill('#ap-sampleReply', REPLY);
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);
  const [u] = await S.sql('SELECT story, path_now, start_tags, sample_question, help_points, work_links FROM users WHERE email = $1', [email]);
  expect(u.story).toBe(`${START}\n\n${HOW}\n\n${NOW}`);
  expect(u.start_tags).toEqual(['region', 'worked', 'selftaught']);
  expect(u.sample_question).toBe(QUESTION);
  expect(u.help_points).toEqual(POINTS);
  expect(u.work_links).toEqual(['https://behance.net/ana-design']);
  // back on step 2 everything is there (a step can be left and continued later)
  await page.goto('/apply.html?step=2');
  await expect(page.locator('#ap-pathHow')).toHaveValue(HOW);
  await expect(page.locator('[data-start-tag="worked"]')).toHaveAttribute('aria-pressed', 'true');
  for (const part of ['sample', 'help', 'links']) await expect(page.locator(`.story-opt[data-opt="${part}"]`)).toHaveAttribute('open', ''); // (open: something is in them)
  await ctx.close();
});

test('the profile: the three blocks, the starting-point chips, "what I can help with", the sample answer labelled as one, work links, years', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await liveLook(ctx);
  const page = await ctx.newPage();
  await page.goto(`/ka/u/${nino.username}`);
  const pathBlocks = page.locator('.profile-path .story-panel');
  await expect(page.locator('.profile-path h2')).toHaveText('ჩემი გზა');
  await expect(pathBlocks).toHaveCount(3);
  await expect(pathBlocks.nth(0)).toContainText('სად დავიწყე');
  await expect(pathBlocks.nth(0).locator('.story-text')).toHaveText(START);
  await expect(pathBlocks.nth(1)).toContainText('როგორ გავუმკლავდი');
  await expect(pathBlocks.nth(2)).toContainText('სად ვარ ახლა');
  await expect(pathBlocks.nth(2).locator('.story-text')).toHaveText(NOW);
  await expect(page.locator('.profile-about')).toHaveCount(0); // (the same words are not shown twice)
  await expect(page.locator('.profile-start .tag-start')).toHaveText(['რეგიონიდან ჩამოვედი', 'სწავლასთან ერთად ვმუშაობდი', 'თვითნასწავლი ვარ']);
  // The head: a small "✓ გადამოწმებული" by the name and nowhere else; the field and the directions in one wrapping row, the main field
  // once; the starting-point tags in their own group with a label; one coral button, "Copy link" a small text button.
  await expect(page.locator('.profile-name .verified-mark')).toHaveText('გადამოწმებული');
  await expect(page.locator('.profile-card .tag-verified')).toHaveCount(0);
  await expect(page.locator('#expertPage')).not.toContainText('ვერიფიცირებ');
  const nameBox = await page.locator('#expertName').boundingBox();
  const markBox = await page.locator('.verified-mark').boundingBox();
  expect(markBox.y).toBeLessThan(nameBox.y + nameBox.height + 30); // (by the name, not down among the chips)
  const row = await page.locator('.profile-fieldrow > *').allTextContents();
  expect(row[0]).toBe('ვებ-დიზაინი');
  expect(new Set(row.map((x) => x.trim().toLowerCase())).size, `nothing twice: ${row.join(' | ')}`).toBe(row.length);
  const tops = await page.locator('.profile-fieldrow > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 12); })); // (which row each chip is in, by its centre)
  expect(new Set(tops).size, 'the chips share rows, not one under the other').toBeLessThan(Math.max(2, tops.length));
  await expect(page.locator('.profile-start-label')).toHaveText('საიდან დაიწყო');
  await expect(page.locator('.profile-share .copy-link')).toHaveClass(/copy-link-quiet/);
  await expect(page.locator('.profile-share .copy-link')).toHaveText('ბმულის კოპირება');
  await expect(page.locator('.profile-card .btn-primary')).toHaveCount(0); // (nothing in the card competes with the one coral button)
  await expect(page.locator('#askOpen')).toHaveText('დასვი კითხვა');
  await expect(page.locator('#askOpen')).toHaveClass(/btn-primary/);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/2a-profile-after-launch-top.png` }); }
  await expect(page.locator('.profile-help-list li')).toHaveText(POINTS);
  await expect(page.locator('.profile-sample .sample-label')).toHaveText('ნიმუში პასუხი');
  await expect(page.locator('.profile-sample .sample-q')).toContainText(QUESTION);
  await expect(page.locator('.profile-sample .sample-a')).toHaveText(REPLY);
  await expect(page.locator('.profile-sample .sample-note')).toHaveText('ეს მენტორის დაწერილი ნიმუშია: ასე პასუხობს ის ხშირ კითხვას. ნამდვილი სტუდენტის კითხვა არ არის.');
  await expect(page.locator('.profile-work-link')).toHaveText(['Behance', 'Dribbble']);
  await expect(page.locator('.profile-work-link').first()).toHaveAttribute('rel', /nofollow/);
  await expect(page.locator('.profile-years')).toHaveText('3 წელი');
  await noOverflow(page);
  // (for the picture only: the bar fixed to the bottom of a phone would sit across the middle of a full-page picture)
  if (SHOTS) {
    // (scrolled down to "My path", then to "what I can help with" and the sample answer: what a phone shows there)
    await page.locator('.profile-path').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/2d-profile-my-path.png` });
    await page.locator('.profile-help').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/2e-profile-sample-answer.png` });
  }
  if (SHOTS) { await page.addStyleTag({ content: '.ask-bar { display: none !important; }' }); await top(page); await page.screenshot({ path: `${SHOTS}/2-profile.png`, fullPage: true }); }

  // Before launch (as the live site is today: nobody can ask yet, live sessions are off): the one coral button is "გამოწერა".
  const pre = await ctx.newPage();
  await pre.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), launchMode: 'prelaunch', liveSessions: false, ...(SHOTS ? { contactEmail: LIVE_SUPPORT } : {}) } });
  });
  await pre.goto(`/ka/u/${nino.username}`);
  await expect(pre.locator('#askOpen')).toHaveText('გამოწერა');
  await expect(pre.locator('#askOpen')).toHaveClass(/btn-primary/);
  await expect(pre.locator('.profile-follow')).toHaveCount(0);
  await expect(pre.locator('.profile-share .copy-link')).toHaveClass(/copy-link-quiet/);
  await noOverflow(pre);
  if (SHOTS) {
    await top(pre);
    await pre.screenshot({ path: `${SHOTS}/2-profile-before-launch-top.png` });
    await pre.addStyleTag({ content: '.ask-bar { display: none !important; }' });
    await pre.screenshot({ path: `${SHOTS}/2c-profile-before-launch-full.png`, fullPage: true });
  }
  await pre.close();

  // A mentor from before: the old story, as it was; none of the new parts.
  await page.goto(`/ka/u/${giorgi.username}`);
  await expect(page.locator('#expertName')).toHaveText('გიორგი აბაშიძე');
  await expect(page.locator('.profile-path')).toHaveCount(0);
  await expect(page.locator('.profile-sample')).toHaveCount(0);
  await expect(page.locator('.profile-start')).toHaveCount(0);

  // dark, and a wide screen: nothing runs off the side
  for (const [width, scheme] of [[360, 'dark'], [1440, 'light']]) {
    const c2 = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const p2 = await c2.newPage();
    await p2.goto(`/ka/u/${nino.username}`);
    await expect(p2.locator('.profile-path .story-panel')).toHaveCount(3);
    await noOverflow(p2);
    await c2.close();
  }
  await ctx.close();
});

test('Browse: the card shows the first line of "where I am now", two chips and "Sample answer ✓"; the "Where they started" filter', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await liveLook(ctx);
  const page = await ctx.newPage();
  await page.goto('/ka/experts.html');
  const card = page.locator('.expert-card').filter({ hasText: 'ნინო წერეთელი' });
  await expect(card.locator('.card-now')).toHaveText('3 წელია ფრილანსერი ვებ-დიზაინერი ვარ.');
  await expect(card.locator('.card-start .tag-start')).toHaveText(['რეგიონიდან ჩამოვედი', 'სწავლასთან ერთად ვმუშაობდი']); // (two of her three)
  await expect(card.locator('.tag-sample')).toHaveText('ნიმუში პასუხი ✓');
  const plain = page.locator('.expert-card').filter({ hasText: 'გიორგი აბაშიძე' });
  await expect(plain).toBeVisible();
  await expect(plain.locator('.card-start')).toHaveCount(0);
  await expect(plain.locator('.rating')).not.toContainText('★'); // (no rating that nobody gave)
  // one label for the button everywhere, and the role and the field once when they say the same thing
  await expect(card.locator('.btn-primary')).toHaveText('დასვი კითხვა');
  await expect(card.locator('.card-top .card-role').first()).toHaveText('ვებ-დიზაინერი'); // (not "ვებ-დიზაინერი · ვებ-დიზაინი")
  await expect(plain.locator('.card-top .card-role').first()).toHaveText('გრაფიკული დიზაინერი');
  await expect(page.locator('#expertGrid')).not.toContainText('რჩევის თხოვნა');

  // The sort: "Recommended" by default; "Top rated" is offered only when some mentor has a real rating.
  const everyone = (await (await fetch(`${S.BASE}/api/experts`)).json()).experts;
  const rated = everyone.some((e) => (e.reviewCount || 0) > 0 && e.ratingAvg);
  await page.locator('#filtersBtn').click();
  const sheet = page.locator('#filtersSheet');
  await expect(sheet.locator('#sortSelect')).toHaveValue('recommended');
  await expect(sheet.locator('#sortSelect option:checked')).toHaveText('რეკომენდებული');
  expect(await sheet.locator('#sortSelect option[value="rating"]').evaluate((o) => o.hidden && o.disabled)).toBe(!rated);

  // The filters in the sheet: each group with its own label ("ფასი" over free / paid, never "სფერო"), the selects full width and the
  // same height as the sort, "საიდან დაიწყო" as chips (several at once).
  await expect(sheet.locator('.sheet-label')).toHaveText(['ექსპერტების დალაგება']);
  await expect(sheet.locator('.filter-label')).toHaveText(['ფასი', 'ქვეყანა', 'გამოცდილების წლები', 'საიდან დაიწყო']);
  const boxes = [];
  for (const id of ['#sortSelect', '#filterCountry', '#filterYears']) { const b = await sheet.locator(id).boundingBox(); boxes.push([Math.round(b.width), Math.round(b.height)]); }
  expect(boxes[1]).toEqual(boxes[0]);
  expect(boxes[2]).toEqual(boxes[0]);
  expect(boxes[0][0]).toBeGreaterThan(300); // (full width of a 375px phone's sheet)
  await expect(sheet.locator('#filterStart')).toHaveCount(0); // (no dropdown)
  await expect(sheet.locator('.chip-start')).toHaveText(['რეგიონიდან ჩამოვედი', 'გრანტით / სტიპენდიით ვისწავლე', 'სწავლასთან ერთად ვმუშაობდი', 'თვითნასწავლი ვარ', 'სფერო შევიცვალე', 'საზღვარგარეთ ვისწავლე', 'ოჯახში პირველი სტუდენტი ვარ']);
  // the number on the sheet's button is the number of the list, before and after a choice
  const number = async (locator) => Number(((await locator.textContent()) || '').match(/\d+/)[0]);
  expect(await number(page.locator('#filtersApply'))).toBe(await number(page.locator('#resultCount')));
  expect(await number(page.locator('#filtersApply'))).toBe(everyone.length);
  await sheet.locator('.chip-start[data-start="selftaught"]').click();
  await sheet.locator('.chip-start[data-start="abroad"]').click();
  await expect(sheet.locator('.chip-start[data-start="selftaught"]')).toHaveAttribute('aria-pressed', 'true');
  const expected = everyone.filter((e) => e.trust && e.trust.startTags.some((x) => ['selftaught', 'abroad'].includes(x))).length;
  expect(expected).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#filtersApply')).toHaveText(expected === 1 ? '1 ექსპერტის ჩვენება' : `${expected} ექსპერტის ჩვენება`);
  expect(await number(page.locator('#resultCount'))).toBe(expected);
  await noOverflow(page);
  if (SHOTS) {
    // (for the picture only: a taller screen, so the whole sheet is in one picture)
    await page.setViewportSize({ width: 375, height: 1180 });
    await sheet.locator('.sheet-body').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/3b-browse-filter-sheet.png` });
    await page.setViewportSize(PHONE.viewport);
  }
  await page.locator('#filtersApply').click();
  await expect(page.locator('.expert-card')).toHaveCount(expected);
  await expect(page.locator('#resultCount')).toHaveText(expected === 1 ? '1 ექსპერტი' : `${expected} ექსპერტი`);
  await expect(page.locator('.expert-card').filter({ hasText: 'ნინო წერეთელი' })).toBeVisible();
  await expect(page.locator('.expert-card').filter({ hasText: 'გიორგი აბაშიძე' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('start')).toBe('selftaught,abroad');
  await expect(page.locator('#filtersCount')).toHaveText('2');
  await noOverflow(page);
  if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -150)); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/3-browse-card.png` }); }
  // the address opens the same list again; a tag nobody has finds nobody
  await page.goto('/ka/experts.html?start=firstgen');
  await expect(page.locator('#filtersCount')).toHaveText('1');
  await expect(page.locator('.expert-card').filter({ hasText: 'გიორგი აბაშიძე' })).toHaveCount(0);
  await expect(page.locator('.expert-card').filter({ hasText: 'ნინო წერეთელი' })).toHaveCount(0);
  await ctx.close();
});

test('a mentor from before: one card on the dashboard, to "My details"; saving there shows on the profile; closed, it does not come back', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await liveLook(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: giorgi.email });
  const card = page.locator('#storyCard .story-card');
  await expect(card.locator('h2')).toHaveText('დაამატე შენი გზა და ნიმუში პასუხი');
  await expect(card).toContainText('ასე სტუდენტები უფრო გენდობიან.');
  await noOverflow(page);
  if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await card.screenshot({ path: `${SHOTS}/4-dashboard-card.png` }); }
  await card.locator('a.btn').click();
  await page.waitForURL(/settings\.html\?tab=details#story$/);
  const form = page.locator('#storyForm');
  await expect(form.locator('.story-old-text')).toHaveText(OLD_STORY); // (the old story is there until the path is)
  await form.locator('#ds-pathStart').fill(START);
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#storyError')).toHaveText('შეავსე სამივე ველი (ან სამივე ცარიელი დატოვე).');
  await form.locator('#ds-pathHow').fill(HOW);
  await form.locator('#ds-pathNow').fill(NOW);
  await form.locator('[data-start-tag="switched"]').click();
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#toast')).toHaveText('შენახულია ✓');
  await noOverflow(page);
  await page.goto(`/ka/u/${giorgi.username}`);
  await expect(page.locator('.profile-path .story-panel')).toHaveCount(3);
  await expect(page.locator('.profile-start .tag-start')).toHaveText(['სფერო შევიცვალე']);

  // the card is still there (no sample answer yet); closed, it stays closed
  await page.goto('/dashboard.html');
  await expect(page.locator('#storyCard .story-card')).toBeVisible();
  await page.locator('[data-story-dismiss]').click();
  await expect(page.locator('#storyCard')).toBeHidden();
  await page.reload();
  await expect(page.locator('#dashTabs')).toBeVisible();
  await expect(page.locator('#askedList')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#storyCard')).toBeHidden();
  expect((await S.sql('SELECT path_card_dismissed_at FROM users WHERE email = $1', [giorgi.email]))[0].path_card_dismissed_at).not.toBeNull();
  await ctx.close();
});
