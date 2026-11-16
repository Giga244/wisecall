// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md, stage 1), in Georgian: the experts page's banner leads to /ka/match; on a 375px phone
// the form is three steps with a progress bar (the field and "where are you now" are required; the privacy line is under the free text);
// a short "looking…", then up to 3 real mentors, each with a "Why them" line made only of what matched; with fewer than 3 only the real
// ones, then "more mentors of your field soon" with a way to be told by email; with none, no card at all. On a computer the form is one
// page. The home page has a small row before launch and a card after it. The admin sees counts only.
// E2E_MATCH_SHOTS=<folder> saves the pictures the brief asks for.
const { test, expect } = require('@playwright/test');
const { startServer, client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_MATCH_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const top = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); };
// (for the pictures only: the test server's support address is a placeholder; the pictures show the live site's own)
const liveLook = async (ctx) => {
  if (!SHOTS) return;
  await ctx.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } });
  });
};
const phoneKa = async (browser) => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  await liveLook(ctx);
  return { ctx, page: await ctx.newPage() };
};

const START = 'ზუგდიდიდან ჩამოვედი თბილისში. კოსმეტოლოგიის სკოლის ფული არ მქონდა და არავის ვიცნობდი.';
const HOW = 'დღისით სალონში ვეხმარებოდი, ღამით უფასო ვიდეოებით ვსწავლობდი. პირველი კლიენტი მეზობელი იყო.';
const NOW = '6 წელია საკუთარი სტუდია მაქვს. დამწყებებს ვასწავლი, როგორ იპოვონ პირველი კლიენტები.';
const REPLY = 'დაიწყე ნაცნობებით: სამ ადამიანს უფასოდ მოემსახურე და სთხოვე, ფოტო გადაგაღებინონ. ეს სამი ნამუშევარი უკვე შენი პორტფოლიოა, და კმაყოფილი ადამიანი ყოველთვის მეორეს მოიყვანს.';

let admin, tamar, luka, mariam, keti, prelaunch;

async function adminClient() {
  const email = 'e2e-admin@example.com';
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [email])).length) return S.apiUser('E2E Admin', email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } });
  return c;
}
// A listed mentor in one field (written straight into the test database: the application and the admin's change of field have their own tests).
async function mentorIn(field, directions, { name, slug, roleTitle, startTags = [], kind = null, full = false }) {
  const m = await S.listedMentor(admin, { name, email: `${slug}-${tag}@e2e.test`, niche: 'design', roleTitle, customNiche: roleTitle });
  await S.sql(`UPDATE users SET field_id = $2, directions = $3, extra_fields = '{}', start_tags = $4, practice_kind = $5,
      path_start = $6, path_how = $7, path_now = $8, sample_question = $9, sample_reply = $10 WHERE id = $1`,
    [m.id, field, directions, startTags, kind, full ? START : null, full ? HOW : null, full ? NOW : null, full ? 'როგორ ვიპოვო პირველი კლიენტები?' : null, full ? REPLY : null]);
  return m;
}

test.beforeAll(async () => {
  admin = await adminClient();
  // "beauty": three mentors (the full three results). "fashion": one (the few-mentors state). "perform": none.
  tamar = await mentorIn('beauty', ['beauty.cosmetology', 'beauty.makeup'], { name: 'თამარ ქავთარაძე', slug: 'tamar-match', roleTitle: 'კოსმეტოლოგი', startTags: ['region', 'selftaught'], full: true });
  luka = await mentorIn('beauty', ['beauty.hair'], { name: 'ლუკა ჯაფარიძე', slug: 'luka-match', roleTitle: 'თმის სტილისტი', startTags: ['switched'] });
  mariam = await mentorIn('beauty', ['beauty.nails'], { name: 'მარიამ ლომიძე', slug: 'mariam-match', roleTitle: 'მანიკიურის ოსტატი' });
  keti = await mentorIn('fashion', ['fashion.styling'], { name: 'ქეთი ბერიძე', slug: 'keti-match', roleTitle: 'სტილისტი', startTags: ['worked', 'grant'] });
  prelaunch = await startServer(4627, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '100', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
});
test.afterAll(() => { if (prelaunch) prelaunch.proc.kill(); });

test('the experts page: the dark banner under the search leads to the matching page (phone and computer)', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/experts.html');
  const banner = page.locator('.browse-match');
  await expect(banner.locator('h2')).toHaveText('არ იცი, ვინ აირჩიო?');
  await expect(banner.locator('p')).toHaveText('მოგვიყევი შენ შესახებ და შეგირჩევთ მენტორებს, ვინც შენსავით დაიწყო.');
  await expect(banner.locator('.btn')).toHaveText('დამეხმარე არჩევაში →');
  await expect(page.locator('#expertGrid a.expert-card').first()).toBeVisible();
  // under the search box, above the list
  const order = await page.evaluate(() => ['#searchInput', '.browse-match', '#expertGrid'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/4-experts-banner-375.png` }); }
  await banner.locator('.btn').click();
  await page.waitForURL(/\/ka\/match$/);
  await expect(page.locator('#matchForm h1')).toHaveText('ვიპოვოთ შენი მენტორი');
  await ctx.close();

  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await wide.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  await liveLook(wide);
  const wp = await wide.newPage();
  await wp.goto('/ka/experts.html');
  await expect(wp.locator('.browse-match .btn')).toBeVisible();
  await expect(wp.locator('#expertGrid a.expert-card').first()).toBeVisible();
  await noOverflow(wp);
  if (SHOTS) { await top(wp); await wp.screenshot({ path: `${SHOTS}/6-experts-1280.png` }); }
  // (a field chosen on the experts page is where the matching starts)
  await wp.goto('/ka/experts.html?field=beauty');
  await expect(wp.locator('#browseMatchLink')).toHaveAttribute('href', '/ka/match?f=beauty');
  await wide.close();
});

test('the form on a phone: three steps with a progress bar; then "looking…", and the 3 mentors with a true "Why them"', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/match');
  const form = page.locator('#matchForm');
  await expect(form.locator('h1')).toHaveText('ვიპოვოთ შენი მენტორი');
  await expect(form.locator('.match-progress')).toHaveAttribute('aria-valuenow', '1');
  await expect(form.locator('.match-progress i.is-on')).toHaveCount(1);
  await expect(form.locator('#mqField')).toHaveText('რომელ სფეროზე ფიქრობ?');
  await expect(form.locator('#mqStage')).toBeHidden(); // (one step at a time)
  await expect(form.locator('.match-free')).toHaveText('უფასოა. რეგისტრაცია არ სჭირდება.');
  // the field is required
  await form.locator('[data-next]').click();
  await expect(form.locator('[data-error="0"]')).toHaveText('აირჩიე სფერო.');
  // the search finds a direction by its own word, and choosing it chooses its field
  await page.fill('#matchSearch', 'ვიზაჟი');
  const hit = form.locator('[data-hit="beauty.makeup"]');
  await expect(hit).toContainText('ვიზაჟი');
  await hit.click();
  await expect(form.locator('[data-field="beauty"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(form.locator('[data-direction="beauty.makeup"]')).toHaveAttribute('aria-pressed', 'true');
  await form.locator('[data-direction="beauty.cosmetology"]').click();
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/1a-form-step1.png`, fullPage: true }); }
  await form.locator('[data-next]').click();

  await expect(form.locator('.match-progress')).toHaveAttribute('aria-valuenow', '2');
  await expect(form.locator('#mqStage')).toHaveText('სად ხარ ახლა?');
  await expect(form.locator('[data-stage]')).toHaveText(['სკოლაში', 'უნივერსიტეტში', 'სფეროს ვცვლი', 'ვმუშაობ']);
  await form.locator('[data-next]').click();
  await expect(form.locator('[data-error="1"]')).toHaveText('აირჩიე, სად ხარ ახლა.');
  await form.locator('[data-stage="switching"]').click();
  await expect(form.locator('#mqStart')).toContainText('საიდან იწყებ?');
  await expect(form.locator('[data-tag]')).toHaveText(['რეგიონიდან ვარ', 'გრანტი / სტიპენდია მჭირდება', 'სწავლასთან ერთად ვმუშაობ', 'თვითონ ვსწავლობ', 'საზღვარგარეთ მინდა სწავლა', 'ოჯახში პირველი სტუდენტი ვიქნები']);
  await expect(form.locator('[data-tag="switched"]')).toHaveCount(0); // ("სფეროს ვცვლი" above already says it)
  await expect(form.locator('.match-hint')).toHaveText('აირჩიე 3-მდე. ასე ვიპოვით მენტორს, ვინც ეს გზა თვითონ გაიარა.');
  for (const id of ['region', 'selftaught', 'worked']) await form.locator(`[data-tag="${id}"]`).click();
  await form.locator('[data-tag="abroad"]').click(); // (a fourth: not taken)
  await expect(form.locator('[data-tag="abroad"]')).toHaveAttribute('aria-pressed', 'false');
  await form.locator('[data-tag="worked"]').click(); // (and one taken off again)
  await noOverflow(page);
  await expect(form.locator('[data-tag][aria-pressed="true"]')).toHaveText(['რეგიონიდან ვარ', 'თვითონ ვსწავლობ']);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/1b-form-step2.png`, fullPage: true }); }
  await form.locator('[data-next]').click();

  await expect(form.locator('.match-progress i.is-on')).toHaveCount(3);
  await expect(form.locator('#mqWorry')).toContainText('რა გაწუხებს ყველაზე მეტად?');
  await expect(form.locator('#matchPrivacy')).toHaveText('🔒 ამას მხოლოდ მენტორის მოსაძებნად ვიყენებთ. მენტორები შენს ტექსტს ვერ ხედავენ. ტელეფონი ან მისამართი არ დაწერო.');
  // a phone number is refused, with words, and what was typed stays
  await page.fill('#matchWorry', 'კოსმეტოლოგია მაინტერესებს. დამირეკეთ: 555 12 34 56');
  await form.locator('.match-submit').click();
  await expect(form.locator('[data-error="2"]')).toHaveText('ტექსტში ტელეფონი, ელ-ფოსტა ან სხვა საკონტაქტო მონაცემია. წაშალე და სცადე თავიდან.');
  await expect(page.locator('#matchWorry')).toHaveValue(/555 12 34 56/);
  await page.fill('#matchWorry', 'კოსმეტოლოგია მაინტერესებს, მაგრამ სკოლის ფული არ მაქვს. არ ვიცი, საიდან დავიწყო და როგორ ვიპოვო პირველი კლიენტი.');
  await expect(form.locator('[data-error="2"]')).toBeEmpty(); // (the line goes once the text is changed)
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/1c-form-step3.png`, fullPage: true }); }
  await form.locator('.match-submit').click();

  // "looking…" for a moment, then the results
  await expect(page.locator('.match-searching h1')).toHaveText('ვეძებთ შენს მენტორებს…');
  await expect(page.locator('.match-checks')).toContainText('საიდან იწყებ: რეგიონიდან ვარ, თვითონ ვსწავლობ');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2a-searching.png` });
  const results = page.locator('.match-results');
  await expect(results.locator('.match-banner h1')).toHaveText('ეს მენტორები შენსავით იწყებდნენ.', { timeout: 8000 });
  const cards = results.locator('.match-mentor');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.match-mentor-name')).toHaveText(['თამარ ქავთარაძე', 'ლუკა ჯაფარიძე', 'მარიამ ლომიძე']);
  await expect(cards.locator('.match-rank')).toHaveText(['#1', '#2', '#3']);
  await expect(cards.locator('.verified-mark')).toHaveText(['გადამოწმებული', 'გადამოწმებული', 'გადამოწმებული']);
  // "Why them": only what matched. Tamar shares both starting points ("like you": she is from a region too, and self-taught) and both
  // directions; Luka changed fields himself (the student is changing fields); Mariam only works in the field, and nothing more is said of her.
  await expect(cards.nth(0).locator('.match-why')).toHaveText('რატომ ის: შენსავით რეგიონიდანაა და თვითნასწავლია. მუშაობს მიმართულებით, რომელიც აირჩიე: კოსმეტოლოგია, ვიზაჟი.');
  await expect(cards.nth(1).locator('.match-why')).toHaveText('რატომ ის: თვითონ სფერო შეიცვალა.');
  await expect(cards.nth(2).locator('.match-why')).toHaveText('რატომ ის: მუშაობს შენს არჩეულ სფეროში: სილამაზე და კოსმეტოლოგია.');
  await expect(cards.nth(0).locator('.tag-start')).toHaveText(['რეგიონიდან ჩამოვედი', 'თვითნასწავლი ვარ']);
  await expect(cards.nth(0).locator('.tag-sample')).toHaveText('ნიმუში პასუხი ✓');
  await expect(cards.nth(2).locator('.match-tags')).toHaveCount(0);
  await expect(cards.nth(0).locator('.match-price')).toContainText('20');
  // (the shared test server is after launch: "დასვი კითხვა", to the mentor's page; before launch it is "გამოწერა": the test further down)
  await expect(cards.nth(0).locator('.btn-primary')).toHaveText('დასვი კითხვა');
  await expect(cards.nth(0).locator('.btn-primary')).toHaveAttribute('href', `/ka/u/${tamar.username}`);
  await expect(results.locator('[data-subscribe]')).toHaveCount(0);
  await expect(results.locator('.match-few')).toHaveCount(0); // (three real mentors: no "more soon" block)
  await expect(results.locator('.match-all a')).toHaveText('ყველა მენტორის ნახვა');
  await expect(results.locator('.match-all a')).toHaveAttribute('href', '/ka/experts.html?field=beauty');
  await expect(results).not.toContainText('555'); // (nothing of the refused text; and the student's text is nowhere on the results)
  await expect(results).not.toContainText('არ ვიცი, საიდან დავიწყო');
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/2-results.png`, fullPage: true }); }
  // a visitor's answers are not kept: only the count of the match
  const [run] = await S.sql('SELECT user_id, stage, start_tags, directions, worry, results FROM match_runs WHERE field_id = $1 ORDER BY created_at DESC LIMIT 1', ['beauty']);
  expect(run).toEqual({ user_id: null, stage: null, start_tags: null, directions: null, worry: null, results: 3 });
  // "change my answers" goes back to the form with the answers still there
  await results.locator('[data-again]').click();
  await expect(page.locator('#matchForm [data-field="beauty"]')).toHaveAttribute('aria-pressed', 'true');
  await ctx.close();
});

test('few mentors: only the real one, then "more mentors of your field soon" and "notify me"; none: no card at all', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/match?f=fashion'); // (as from the experts page with that field open)
  const form = page.locator('#matchForm');
  await expect(form.locator('[data-field="fashion"]')).toHaveAttribute('aria-pressed', 'true');
  await form.locator('[data-next]').click();
  await form.locator('[data-stage="university"]').click();
  await form.locator('[data-next]').click();
  await form.locator('.match-submit').click();
  const results = page.locator('.match-results');
  await expect(results.locator('.match-banner h1')).toHaveText('ეს მენტორი შენს სფეროში მუშაობს.', { timeout: 8000 }); // (not "started like you": no starting point was shared)
  await expect(results.locator('.match-mentor')).toHaveCount(1);
  await expect(results.locator('.match-mentor-name')).toHaveText('ქეთი ბერიძე');
  await expect(results.locator('.match-why')).toHaveText('რატომ ის: თვითონ სწავლასთან ერთად მუშაობდა.'); // (her own start fits a university student)
  const few = results.locator('.match-few');
  await expect(few.locator('h2')).toHaveText('შენი სფეროს მეტი მენტორი მალე');
  await expect(few).toContainText('ახლა ერთი შესაბამისი მენტორი ვიპოვეთ. ახალი რომ დაემატება, ელ-ფოსტით მოგწერთ.');
  await expect(few.locator('.waitlist-submit')).toHaveText('შემატყობინე'); // (no emoji: the envelope is drawn)
  await expect(few.locator('.waitlist-submit svg.waitlist-icon')).toBeVisible();
  expect(await few.locator('.waitlist-submit').evaluate((b) => /\p{Extended_Pictographic}/u.test(b.textContent))).toBe(false);
  await expect(few.locator('.match-real')).toHaveText('ჩვენ არასდროს გაჩვენებთ მოგონილ მენტორებს.');
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/3-few-mentors.png`, fullPage: true }); }
  // "notify me": the email and the field, with the consent box (the waiting list, as everywhere)
  const email = `match-notify-${tag}@e2e.test`;
  await few.locator('input[type="email"]').fill(email);
  await few.locator('.waitlist-submit').click();
  await expect(few.locator('.waitlist-error')).not.toBeEmpty(); // (the "16 or older" box is asked for)
  await few.locator('input[name="over16"]').check();
  await few.locator('.waitlist-submit').click();
  await expect.poll(async () => (await S.sql('SELECT niche FROM waitlist WHERE lower(email) = $1', [email])).map((r) => r.niche)).toEqual(['fashion']);

  // "I need a grant": she studied on one. Said as what she did (never "like you"), and the heading is not "started like you" either.
  await page.goto('/ka/match?f=fashion');
  await page.locator('#matchForm [data-next]').click();
  await page.locator('#matchForm [data-stage="school"]').click();
  await page.locator('#matchForm [data-tag="grant"]').click();
  await page.locator('#matchForm [data-next]').click();
  await page.locator('#matchForm .match-submit').click();
  await expect(page.locator('.match-results .match-banner h1')).toHaveText('ამ მენტორმა ის გზა გაიარა, რომელსაც შენ იწყებ.', { timeout: 8000 });
  await expect(page.locator('.match-results .match-why')).toHaveText('რატომ ის: თვითონ გრანტით ან სტიპენდიით ისწავლა.');
  await expect(page.locator('.match-results .match-mentor .tag-start')).toHaveText(['გრანტით / სტიპენდიით ვისწავლე', 'სწავლასთან ერთად ვმუშაობდი']); // (her own tags, in her own words)

  // a field with nobody yet: no card, no placeholder
  await page.goto('/ka/match?f=perform');
  await page.locator('#matchForm [data-next]').click();
  await page.locator('#matchForm [data-stage="school"]').click();
  await page.locator('#matchForm [data-next]').click();
  await page.locator('#matchForm .match-submit').click();
  await expect(page.locator('.match-results .match-banner h1')).toHaveText('თეატრი, მსახიობობა და ცეკვა: მენტორი ჯერ არ გვყავს', { timeout: 8000 });
  await expect(page.locator('.match-results .match-mentor')).toHaveCount(0);
  await expect(page.locator('.match-results .match-few')).toContainText('როგორც კი ამ სფეროს მენტორი დაემატება, ელ-ფოსტით მოგწერთ.');
  await expect(page.locator('.match-results .avatar')).toHaveCount(0);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/3b-no-mentors.png`, fullPage: true }); }
  await ctx.close();
});

test('a computer: one page, every question in sight; /en/match is English; with reduced motion there is no waiting; dark and wide fit', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/en/match');
  const form = page.locator('#matchForm');
  await expect(form.locator('h1')).toHaveText("Let's find your mentor");
  await expect(form.locator('.match-progress')).toBeHidden();
  for (const id of ['#mqField', '#mqStage', '#mqStart', '#mqWorry']) await expect(form.locator(id)).toBeVisible();
  await expect(form.locator('[data-next]')).toBeHidden();
  await expect(form.locator('#matchPrivacy')).toHaveText("🔒 We use this only to find your mentor. Mentors never see your text. Don't write a phone number or an address.");
  // sent with the field missing: said under the first question
  await form.locator('.match-submit').click();
  await expect(form.locator('[data-error="0"]')).toHaveText('Choose a field.');
  await form.locator('[data-all-fields]').click();
  await form.locator('[data-field="beauty"]').click();
  await form.locator('[data-stage="working"]').click();
  const began = Date.now();
  await form.locator('.match-submit').click();
  await expect(page.locator('.match-results .match-mentor')).toHaveCount(3);
  expect(Date.now() - began, 'no made-up waiting with reduced motion').toBeLessThan(800 + 1500);
  await expect(page.locator('.match-results .match-banner h1')).toHaveText('These mentors work in your field.');
  await expect(page.locator('.match-results .match-mentor .btn-primary').first()).toHaveText('Ask a question');
  await noOverflow(page);
  await ctx.close();
  for (const [width, scheme] of [[360, 'dark'], [1440, 'light']]) {
    const c2 = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const p2 = await c2.newPage();
    await p2.goto('/ka/match?f=beauty');
    await expect(p2.locator('#matchForm h1')).toBeVisible();
    await noOverflow(p2);
    await c2.close();
  }
});

test('the home page: after launch a card under the search; before launch only a small row under the waiting list, and a result card\'s button is the waiting list ("გამოწერა")', async ({ browser }) => {
  // after launch (the shared test server)
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/');
  const card = page.locator('#heroMatchCard');
  await expect(card).toBeVisible();
  await expect(card).toContainText('არ იცი, ვის ჰკითხო?');
  await expect(card.locator('.btn')).toHaveText('იპოვე შენი მენტორი · უფასოდ');
  await expect(card).toHaveAttribute('href', '/ka/match');
  await expect(page.locator('#heroMatchRow')).toHaveCount(0);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/5b-home-after-launch.png` }); }
  await ctx.close();

  // before launch (its own server, in prelaunch)
  const pre = await browser.newContext(PHONE);
  await pre.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  if (SHOTS) await pre.route('**/api/config', async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } }); });
  const p = await pre.newPage();
  await p.goto(`${prelaunch.base}/ka/`);
  const row = p.locator('#heroMatchRow');
  await expect(row).toHaveText('არ იცი, ვის ჰკითხო? იპოვე შენი მენტორი →');
  await expect(row.locator('a')).toHaveAttribute('href', '/ka/match');
  await expect(p.locator('#heroMatchCard')).toHaveCount(0);
  await expect(p.locator('#heroWait .waitlist-submit')).toBeVisible();
  // (the home page's waiting list: its "16 or older" box and its consent words, to compare with a result card's form below)
  const heroAge = (await p.locator('#heroWait label.waitlist-age').textContent()).trim();
  const heroConsent = (await p.locator('#heroWait .waitlist-hint').textContent()).trim();
  // the waiting list is the only big button of the hero; the row is a text link under it
  expect(await p.locator('.lhero-text .btn-primary:visible').count()).toBe(1);
  const tops = await p.evaluate(() => ['#heroWait', '#heroMatchRow'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(tops[0]).toBeLessThan(tops[1]);
  await noOverflow(p);
  if (SHOTS) { await top(p); await p.screenshot({ path: `${SHOTS}/5-home-before-launch.png` }); }
  // the results before launch: nobody can ask yet, so each card's button is "გამოწერა" (never "დასვი კითხვა"), and it gives way to the
  // waiting list right there: the same form as on a mentor's own page before launch
  await p.goto(`${prelaunch.base}/ka/match?f=beauty`);
  const pf = p.locator('#matchForm');
  for (const id of ['beauty.cosmetology', 'beauty.makeup']) await pf.locator(`[data-direction="${id}"]`).click();
  await pf.locator('[data-next]').click();
  await pf.locator('[data-stage="switching"]').click();
  for (const id of ['region', 'selftaught']) await pf.locator(`[data-tag="${id}"]`).click();
  await pf.locator('[data-next]').click();
  await pf.locator('.match-submit').click();
  const pc = p.locator('.match-results .match-mentor');
  await expect(pc).toHaveCount(3, { timeout: 8000 });
  await expect(pc.locator('.match-mentor-foot .btn-primary')).toHaveText(['გამოწერა', 'გამოწერა', 'გამოწერა']);
  await expect(p.locator('.match-results')).not.toContainText('დასვი კითხვა');
  await expect(pc.nth(0).locator('.match-wait')).toBeHidden();
  await noOverflow(p);
  if (SHOTS) { await top(p); await p.screenshot({ path: `${SHOTS}/2p-results-before-launch.png`, fullPage: true }); }
  const subscribe = pc.nth(0).locator('[data-subscribe]');
  await subscribe.click();
  await expect(subscribe).toBeHidden(); // (one "გამოწერა" in sight: the form's own)
  const wait = pc.nth(0).locator('.match-wait');
  await expect(wait.locator('.match-wait-note')).toHaveText('Wisecall მალე იხსნება. ჩაეწერე და პირველს შეგატყობინებთ');
  await expect(wait.locator('select[name="niche"]')).toHaveValue('beauty');
  await expect(wait.locator('.waitlist-submit')).toHaveText('გამოწერა');
  await expect(pc.nth(1).locator('.match-wait')).toBeHidden(); // (only the card that was tapped)
  await noOverflow(p);
  await expect(pc.nth(0).locator('.btn-primary:visible')).toHaveCount(1);
  if (SHOTS) { await pc.nth(0).locator('.match-why').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -90)); await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/2q-card-waitlist-open.png` }); }
  // it is the waiting list's own form: the same "16 or older" box (not ticked for anybody) and the same consent words as the home page's
  // list, with the privacy link; nothing is sent until the box is ticked
  expect(heroAge).toBe('16 წლის ან უფროსი ვარ');
  await expect(wait.locator('label.waitlist-age')).toHaveText(heroAge);
  await expect(wait.locator('input[name="over16"]')).not.toBeChecked();
  expect(heroConsent).toContain('ერთხელ მოგწერთ, როცა შენს სფეროში მენტორი შემოგვიერთდება, და შენს მისამართს არავის გავუზიარებთ.');
  await expect(wait.locator('.waitlist-hint')).toContainText(heroConsent);
  await expect(wait.locator('.waitlist-hint a')).toHaveText('კონფიდენციალურობა');
  await expect(wait.locator('.waitlist-hint a')).toHaveAttribute('href', /\/privacy\.html$/);
  const mail = `match-subscribe-${tag}@e2e.test`;
  await wait.locator('input[type="email"]').fill(mail);
  await wait.locator('.waitlist-submit').click();
  await expect(wait.locator('.waitlist-error')).toHaveText('Wisecall 16 წლიდან არის ხელმისაწვდომი. გთხოვ, დაადასტურე შენი ასაკი.');
  expect(await S.sql('SELECT 1 FROM waitlist WHERE lower(email) = $1', [mail])).toHaveLength(0);
  await wait.locator('input[name="over16"]').check();
  await wait.locator('.waitlist-submit').click();
  await expect(wait.locator('.waitlist-done')).toBeVisible();
  await expect.poll(async () => (await S.sql('SELECT niche FROM waitlist WHERE lower(email) = $1', [mail])).map((r) => r.niche)).toEqual(['beauty']);
  // with one mentor only, before launch: "notify me" has a drawn envelope, and the card's button is still "გამოწერა"
  await p.goto(`${prelaunch.base}/ka/match?f=fashion`);
  await p.locator('#matchForm [data-next]').click();
  await p.locator('#matchForm [data-stage="university"]').click();
  await p.locator('#matchForm [data-next]').click();
  await p.locator('#matchForm .match-submit').click();
  await expect(p.locator('.match-results .match-mentor-foot .btn-primary')).toHaveText(['გამოწერა'], { timeout: 8000 });
  await expect(p.locator('.match-few .waitlist-submit')).toHaveText('შემატყობინე');
  await expect(p.locator('.match-few .waitlist-submit svg.waitlist-icon')).toBeVisible();
  await noOverflow(p);
  if (SHOTS) { await top(p); await p.screenshot({ path: `${SHOTS}/3p-few-before-launch.png`, fullPage: true }); }
  await pre.close();
});

test('the admin overview: "მეჩინგი" with counts only', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/ka/admin.html?tab=overview');
  const title = page.locator('.overview-title', { hasText: 'მეჩინგი' });
  await expect(title).toBeVisible();
  await expect(page.locator('.ov-match-fields')).toContainText('სილამაზე და კოსმეტოლოგია');
  await expect(page.locator('.ov-match-fields li', { hasText: 'თეატრი, მსახიობობა და ცეკვა' })).toContainText('სჭირდება მეტი მენტორი');
  await expect(page.locator('#adminContent')).not.toContainText('არ ვიცი, საიდან დავიწყო'); // (never what a student wrote)
  await ctx.close();
});
