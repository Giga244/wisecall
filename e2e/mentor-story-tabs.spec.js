// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "ჩემი გზა" on the profile as tabs (docs/CLAUDE-CODE-STORY-TABS.md), for every mentor:
//   - three parts: a tab bar with three tabs over one card; a tap, a swipe and the arrow keys change the part; the dots follow; 390px fits
//   - two parts: two tabs; one part: its card with its title, no tab bar; none: no section
//   - the mentor's line breaks are kept
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const P = {
  start: 'სოფლიდან ჩამოვედი თბილისში, ქალაქში არავის ვიცნობდი და სწავლის ფულიც არ მქონდა.',
  how: 'ღამით ბიბლიოთეკაში ვმეცადინეობდი და დღისით ვმუშაობდი, სანამ პირველი გრანტი არ მოვიგე.',
  now: 'ახლა პროფესორი ვარ და ჩემი სტუდენტების ნახევარი ჩემსავით რეგიონიდან ჩამოვიდა.\nყოველ კვირას ვხვდები მათ და ვუსმენ.'
};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
let m;
const setPath = (start, how, now) => S.sql('UPDATE users SET path_start = $2, path_how = $3, path_now = $4 WHERE id = $1', [m.id, start, how, now]);
async function open(browser, opts = PHONE) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('#expertName')).toBeVisible();
  return { ctx, page };
}
const selected = (page) => page.locator('.profile-path [role="tab"][aria-selected="true"]');

test.beforeAll(async () => {
  const admin = await adminClient();
  m = await S.listedMentor(admin, { name: 'სატესტო ისტორია', email: `tabs-${tag}@e2e.test`, niche: 'teaching', roleTitle: 'პროფესორი', price: 30 });
});

test('three parts: tabs over one card; tap, swipe and arrow keys; the dots; the line breaks; nothing runs off at 390px', async ({ browser }) => {
  await setPath(P.start, P.how, P.now);
  const { ctx, page } = await open(browser);
  const section = page.locator('.profile-path');
  await expect(section.locator('.story-label')).toHaveText(KA['profile.story.label']);
  await expect(section.locator('h2')).toHaveText(KA['profile.path.title']);
  const tabs = section.locator('[role="tablist"] [role="tab"]');
  await expect(tabs).toHaveText([KA['profile.path.start'], KA['profile.path.how'], KA['profile.path.now']]);
  await expect(selected(page)).toHaveText(KA['profile.path.start']);
  await expect(section.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(section.locator('[role="tabpanel"]:visible .story-text')).toHaveText(P.start);
  await expect(section.locator('.story-dot.is-on')).toHaveCount(1);
  await expect(section.locator('.story-hint')).toBeVisible(); // (a touch screen)
  // a tap
  await tabs.nth(2).tap();
  await expect(selected(page)).toHaveText(KA['profile.path.now']);
  const now = section.locator('[role="tabpanel"]:visible .story-text');
  await expect(now).toHaveText(P.now);
  expect(await now.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap'); // (the line break shows)
  await expect(section.locator('.story-dot').nth(2)).toHaveClass(/is-on/);
  // a swipe to the right: the previous part
  await section.locator('.story-panels').evaluate((box) => {
    const t = (x, y) => new Touch({ identifier: 1, target: box, clientX: x, clientY: y });
    box.dispatchEvent(new TouchEvent('touchstart', { touches: [t(80, 300)], changedTouches: [t(80, 300)], bubbles: true }));
    box.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(300, 305)], bubbles: true }));
  });
  await expect(selected(page)).toHaveText(KA['profile.path.how']);
  // the arrow keys move between the tabs
  await selected(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(selected(page)).toHaveText(KA['profile.path.start']);
  await expect(selected(page)).toBeFocused();
  await page.keyboard.press('End');
  await expect(selected(page)).toHaveText(KA['profile.path.now']);
  // each panel is named by its tab
  const panelId = await selected(page).getAttribute('aria-controls');
  await expect(page.locator(`#${panelId}`)).toHaveAttribute('aria-labelledby', await selected(page).getAttribute('id'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('two parts: two tabs; one part: its card with its title and no tab bar; none: no section', async ({ browser }) => {
  await setPath(P.start, null, P.now);
  let { ctx, page } = await open(browser);
  await expect(page.locator('.profile-path [role="tab"]')).toHaveText([KA['profile.path.start'], KA['profile.path.now']]);
  await expect(page.locator('.profile-path .story-dot')).toHaveCount(2);
  await ctx.close();

  await setPath(null, null, P.now);
  ({ ctx, page } = await open(browser, { viewport: { width: 1280, height: 900 } }));
  await expect(page.locator('.profile-path [role="tablist"]')).toHaveCount(0);
  await expect(page.locator('.profile-path .story-panel-title')).toBeVisible();
  await expect(page.locator('.profile-path .story-panel-title')).toHaveText(KA['profile.path.now']);
  await expect(page.locator('.profile-path .story-text')).toHaveText(P.now);
  await ctx.close();

  await setPath(null, null, null);
  ({ ctx, page } = await open(browser));
  await expect(page.locator('.profile-path')).toHaveCount(0);
  await ctx.close();
});

test('without the tabs script the parts are all there, one under the other, each with its title', async ({ browser }) => {
  await setPath(P.start, P.how, P.now);
  const ctx = await browser.newContext(PHONE);
  await ctx.route('**/js/story-tabs.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  await page.goto(`/ka/u/${m.username}`);
  const panels = page.locator('.profile-path .story-panel');
  await expect(panels).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await expect(panels.nth(i)).toBeVisible();
  await expect(page.locator('.profile-path .story-panel-title')).toHaveText([KA['profile.path.start'], KA['profile.path.how'], KA['profile.path.now']]);
  await ctx.close();
});
