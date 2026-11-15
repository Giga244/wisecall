// (named seo-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "რჩევები", the articles (docs/CLAUDE-CODE-SEO.md 5), on a 375px phone in Georgian: the admin writes an article in Admin -> სტატიები (a
// draft: nobody else can open it), presses Publish, and the page exists: whole without any script, with the link to /match at its end and,
// before launch, the waiting list. Taken down, it is gone again. The pictures the brief asks for: E2E_SEO_SHOTS=<folder>.
// The words below are test words only (clearly marked): the owner writes the real articles, and nothing is ever seeded.
const { test, expect } = require('@playwright/test');
const { startServer, client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_SEO_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const top = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); };
const ka = async (ctx) => ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
// (for the pictures only: the test server's support address is a placeholder; the pictures show the live site's own)
const liveLook = async (ctx) => {
  if (!SHOTS) return;
  await ctx.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecallge.ge' } });
  });
};

const TITLE = 'სატესტო სტატია: სათაური აქ იქნება';
const INTRO = 'ეს სატესტო შესავალია. ნამდვილ სტატიაში აქ ორი წინადადება იქნება იმაზე, რას გაიგებს მკითხველი.';
const BODY = [
  'ეს სატესტო ტექსტია და მხოლოდ გვერდის ფორმას აჩვენებს. ნამდვილ სტატიებს საიტის მფლობელი დაწერს და თვითონ გამოაქვეყნებს.',
  '',
  '## პირველი ქვესათაური',
  'აქ იქნება პირველი ნაწილის ტექსტი: რამდენიმე წინადადება ერთ აბზაცად, რომ ჩანდეს, როგორ იკითხება ტექსტი ტელეფონზე.',
  '',
  '- სიის პირველი პუნქტი',
  '- სიის მეორე პუნქტი',
  '- სიის მესამე პუნქტი',
  '',
  '## მეორე ქვესათაური',
  'აქ იქნება მეორე ნაწილის ტექსტი, **მუქი სიტყვით** იქ, სადაც ავტორი რამეს გამოყოფს.'
].join('\n');

let prelaunch, admin, slug;

async function adminClient() {
  const email = 'e2e-admin@example.com';
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [email])).length) return S.apiUser('E2E Admin', email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  return c;
}

test.beforeAll(async () => {
  admin = await adminClient();
  // (articles left by an earlier run of this file: taken down and deleted through the admin's own routes)
  for (const a of (await admin.api('/admin/articles')).articles || []) {
    if (a.status === 'published') await admin.api(`/admin/articles/${a.id}/unpublish`, { method: 'POST' });
    await admin.api(`/admin/articles/${a.id}`, { method: 'DELETE' });
  }
  prelaunch = await startServer(4628, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '100', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
});
test.afterAll(async () => {
  if (prelaunch) prelaunch.proc.kill();
  for (const a of (await admin.api('/admin/articles')).articles || []) {
    if (a.status === 'published') await admin.api(`/admin/articles/${a.id}/unpublish`, { method: 'POST' });
    await admin.api(`/admin/articles/${a.id}`, { method: 'DELETE' });
  }
});

test('the admin writes an article on a phone: the form, a draft nobody else can open, then Publish', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await ka(ctx);
  await liveLook(ctx);
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/ka/admin.html?tab=articles');
  const box = page.locator('#adminContent');
  await expect(page.locator('#adminTabs .chip.active')).toHaveText('სტატიები');
  await expect(box.locator('.art-note')).toHaveText('ახალი სტატია მონახაზია: საიტზე არაფერი ჩანს, სანამ „გამოქვეყნებას“ არ დააჭერ.');
  await expect(box.locator('.art-empty')).toHaveText('სტატია ჯერ არ არის.'); // (nothing is seeded)
  await box.locator('[data-new]').click();

  const form = box.locator('form.art-form');
  await expect(form.locator('h2')).toHaveText('ახალი სტატია');
  await expect(form.locator('.art-status')).toContainText('მონახაზი');
  for (const name of ['kaTitle', 'kaIntro', 'kaBody', 'authorName', 'date', 'category', 'slug']) await expect(form.locator(`[name="${name}"]`)).toBeVisible();
  await expect(form.locator('[name="enTitle"]')).toBeHidden(); // (the English version is optional, and closed)
  await expect(form.locator('[data-view]')).toBeHidden(); // (nothing to look at before the first save)
  // saved empty: a title is asked for, in words
  await form.locator('[data-save]').click();
  await expect(form.locator('.art-error')).toHaveText('დაწერე სათაური.');
  await form.locator('[name="kaTitle"]').fill(TITLE);
  await form.locator('[name="kaIntro"]').fill(INTRO);
  await form.locator('[name="kaBody"]').fill(BODY);
  await form.locator('[name="authorName"]').fill('ავტორის სახელი');
  await form.locator('[name="date"]').fill('2026-11-15');
  await form.locator('[name="category"]').selectOption('edu');
  await expect(form.locator('[data-count="kaTitle"]')).toContainText(`${[...TITLE].length} სიმბოლო`);
  // the text box grows with the text: nothing scrolls inside it
  expect(await form.locator('[name="kaBody"]').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/2-admin-article-form-375.png`, fullPage: true }); }

  await form.locator('[data-save]').click();
  await expect(page.locator('#toast')).toContainText('მონახაზი შენახულია.');
  await expect(form.locator('[name="slug"]')).toHaveValue('satesto-statia-satauri-ak-ikneba'); // (the address, from the Georgian title)
  slug = await form.locator('[name="slug"]').inputValue();
  await expect(form.locator('[data-problems]')).toBeEmpty(); // (nothing stands between it and Publish)
  await expect(form.locator('[data-view]')).toHaveAttribute('href', `/ka/advice-articles/${slug}`);
  // a draft: for a visitor there is no such page
  const visitor = await browser.newContext(PHONE);
  const vp = await visitor.newPage();
  expect((await vp.goto(`/ka/advice-articles/${slug}`)).status()).toBe(404);
  expect((await vp.goto('/ka/advice-articles')).status()).toBe(404);
  // the admin's preview says it is a draft
  const preview = await ctx.newPage();
  await preview.goto(`/ka/advice-articles/${slug}`);
  await expect(preview.locator('.article-draft')).toHaveText('მონახაზი: ეს სტატია ჯერ არ გამოქვეყნებულა. მხოლოდ ადმინი ხედავს.');
  await expect(preview.locator('h1')).toHaveText(TITLE);
  await preview.close();

  // Publish: asked first, then public
  await form.locator('[data-publish]').click();
  const dialog = page.locator('dialog.wc-dialog[open]');
  await expect(dialog.locator('.wc-dialog-message')).toHaveText('გამოვაქვეყნო სტატია? ყველა დაინახავს და საძიებო სისტემებშიც მოხვდება.');
  await dialog.locator('[data-cancel]').click();
  expect((await vp.goto(`/ka/advice-articles/${slug}`)).status()).toBe(404); // (cancelled: still a draft)
  await form.locator('[data-publish]').click();
  await page.locator('dialog.wc-dialog[open] [data-ok]').click();
  await expect(page.locator('#toast')).toContainText('სტატია გამოქვეყნდა.');
  await expect(box.locator('form.art-form .art-status')).toContainText('გამოქვეყნებულია');
  await expect(box.locator('form.art-form [name="slug"]')).toHaveAttribute('readonly', ''); // (the address no longer changes)
  await expect(box.locator('form.art-form [data-publish]')).toHaveCount(0);
  expect((await vp.goto(`/ka/advice-articles/${slug}`)).status()).toBe(200);
  // the list in Admin
  await box.locator('[data-back]').click();
  await expect(box.locator('.art-row')).toHaveCount(1);
  await expect(box.locator('.art-row .badge')).toHaveText('გამოქვეყნებულია');
  await expect(box.locator('.art-row-title')).toHaveText(TITLE);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/3-admin-article-list-375.png`, fullPage: true }); }
  await visitor.close();
  await ctx.close();
});

test('the article page on a phone: whole without scripts; the link to /match at its end; before launch, the waiting list', async ({ browser }) => {
  // without JavaScript: the title, the text, the author and the date are all there
  const plain = await browser.newContext({ ...PHONE, javaScriptEnabled: false });
  const p = await plain.newPage();
  await p.goto(`/ka/advice-articles/${slug}`);
  await expect(p.locator('main h1')).toHaveText(TITLE);
  await expect(p.locator('.article-intro')).toHaveText(INTRO);
  await expect(p.locator('.article-body h2')).toHaveText(['პირველი ქვესათაური', 'მეორე ქვესათაური']);
  await expect(p.locator('.article-body li')).toHaveCount(3);
  await expect(p.locator('.article-body strong')).toHaveText('მუქი სიტყვით');
  await expect(p.locator('.article-by')).toHaveText('ავტორის სახელი · 15 ნოემბერი 2026');
  await expect(p.locator('.article-kicker')).toHaveText('გამოცდები და განათლება');
  await expect(p.locator('.article-next a.btn')).toHaveAttribute('href', '/ka/match?f=edu');
  await plain.close();

  // before launch (its own server, as the live site is today), with scripts: the waiting-list form at the end, its field already chosen
  const ctx = await browser.newContext(PHONE);
  await ka(ctx);
  await liveLook(ctx);
  const page = await ctx.newPage();
  await page.goto(`${prelaunch.base}/ka/advice-articles/${slug}`);
  await expect(page.locator('main h1')).toHaveText(TITLE);
  await expect(page.locator('.breadcrumb')).toContainText('რჩევები');
  const next = page.locator('.article-next');
  await expect(next.locator('h2')).toHaveText('არ იცი, ვის ჰკითხო?');
  await expect(next.locator('a.btn')).toHaveText('იპოვე შენი მენტორი · უფასოდ');
  const wait = page.locator('.article-wait');
  await expect(wait.locator('h2')).toHaveText('Wisecall მალე იხსნება');
  await expect(wait.locator('form.waitlist-form select[name="niche"]')).toHaveValue('edu');
  await expect(wait.locator('label.waitlist-age')).toHaveText('16 წლის ან უფროსი ვარ');
  // (the end of the page, in order: the text, find your mentor, the waiting list)
  const order = await page.evaluate(() => ['.article-body', '.article-next', '.article-wait'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/1-article-375.png`, fullPage: true }); }
  // the list of articles
  await page.goto(`${prelaunch.base}/ka/advice-articles`);
  await expect(page.locator('main h1')).toHaveText('რჩევები');
  await expect(page.locator('.article-card h2 a')).toHaveText(TITLE);
  await noOverflow(page);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/4-article-list-375.png`, fullPage: true }); }
  await page.locator('.article-card h2 a').click();
  await page.waitForURL(new RegExp(`/ka/advice-articles/${slug}$`));
  await ctx.close();

  // after launch (the shared test server): the link to /match, no waiting list; the menu has "რჩევები" (Georgian only: no English article)
  const live = await browser.newContext(PHONE);
  await ka(live);
  const lp = await live.newPage();
  await lp.goto(`/ka/advice-articles/${slug}`);
  await expect(lp.locator('.article-next a.btn')).toBeVisible();
  await expect(lp.locator('.article-wait')).toHaveCount(0);
  await lp.locator('.nav-toggle').click();
  const menuLink = lp.locator('.mm-more [data-articles]');
  await expect(menuLink).toBeVisible();
  await expect(menuLink).toHaveText('რჩევები');
  await expect(menuLink).toHaveAttribute('href', '/ka/advice-articles');
  await lp.locator('.mm-close').click();
  await noOverflow(lp);
  await live.close();
  const en = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const ep = await en.newPage();
  await ep.goto('/about.html');
  await expect(ep.locator('footer .fc-links a').first()).toBeVisible();
  await expect(ep.locator('footer .fc-links a')).toHaveCount(6); // (the footer keeps its six links)
  await expect(ep.locator('.mm-more [data-articles]')).toHaveJSProperty('hidden', true);
  // (wide and dark: the article fits too)
  await ep.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  await ep.goto(`/ka/advice-articles/${slug}`);
  await expect(ep.locator('main h1')).toHaveText(TITLE);
  await noOverflow(ep);
  await en.close();
});

test('taken down in Admin: the page is gone again', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await ka(ctx);
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/ka/admin.html?tab=articles');
  const row = page.locator('#adminContent .art-row');
  await row.locator('[data-unpublish]').click();
  await expect(page.locator('dialog.wc-dialog[open] .wc-dialog-message')).toContainText('მოვხსნა სტატია საიტიდან?');
  await page.locator('dialog.wc-dialog[open] [data-ok]').click();
  await expect(row.locator('.badge')).toHaveText('მონახაზი');
  const visitor = await browser.newContext(PHONE);
  const vp = await visitor.newPage();
  expect((await vp.goto(`/ka/advice-articles/${slug}`)).status()).toBe(404);
  await visitor.close();
  // and a draft can be deleted
  await row.locator('[data-delete]').click();
  await page.locator('dialog.wc-dialog[open] [data-ok]').click();
  await expect(page.locator('#adminContent .art-empty')).toBeVisible();
  await ctx.close();
});
