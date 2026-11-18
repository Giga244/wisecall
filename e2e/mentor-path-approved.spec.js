// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// An approved mentor adds "ჩემი გზა" in Settings → My details (where the dashboard card and the profile-update email lead), then picks
// directions and presses "შესამოწმებლად გაგზავნა", at 375px in Georgian. A real mentor lost the whole path this way: that button drew the
// page again from the server, and the path typed but not saved was gone. Now:
//   - saved, then "send for a check": the path stays (in the boxes, in the database, on the profile) and the change waits for an admin
//   - typed and NOT saved, then "send for a check": the path is saved first, then the change is sent; nothing is lost
//   - a block too short: nothing is sent, the reason is under that block with how many characters it still needs, everything typed stays
//   - the page left before saving: what was typed comes back, with a note that it is not saved yet
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), KA[key]);
// (an About of their own already: this is about the path)
const ABOUT = 'ოცი წელია უნივერსიტეტში ვასწავლი და სტუდენტებს ვხელმძღვანელობ. მანამდე სამინისტროში ვმუშაობდი, სადაც განათლების პროგრამებს ვამზადებდით. შემიძლია დაგეხმაროთ კვლევის დაწყებასა და დოქტორანტურის არჩევაში.';
const P = {
  start: 'სოფლიდან ჩამოვედი თბილისში, ქალაქში არავის ვიცნობდი და სწავლის ფულიც არ მქონდა.',
  how: 'ღამით ბიბლიოთეკაში ვმეცადინეობდი და დღისით ვმუშაობდი, სანამ პირველი გრანტი არ მოვიგე.',
  now: 'ახლა პროფესორი ვარ და ჩემი სტუდენტების ნახევარი ჩემსავით რეგიონიდან ჩამოვიდა.'
};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
async function approvedMentor(name, key) {
  const admin = await adminClient();
  const m = await S.listedMentor(admin, { name, email: `path-${key}-${tag}@e2e.test`, niche: 'teaching', roleTitle: 'პროფესორი', price: 30 });
  await S.sql(`UPDATE users SET bio = $2, language = 'ka' WHERE id = $1`, [m.id, ABOUT]);
  return m;
}
async function detailsPage(browser, m) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details#story');
  await expect(page.locator('#ds-pathStart')).toBeVisible();
  return { ctx, page };
}
const pathRow = async (m) => (await S.sql('SELECT path_start, path_how, path_now FROM users WHERE id = $1', [m.id]))[0];
const openChanges = async (m) => (await S.sql(`SELECT proposed FROM mentor_changes WHERE user_id = $1 AND kind = 'fields' AND status = 'open'`, [m.id]));
// Two more directions in the mentor's field (other than the one they have), as a mentor picks them.
async function pickTwoMore(page) {
  const more = page.locator('.fp-dirs-more');
  if (await more.count()) await more.first().click();
  const free = page.locator('.fp-dirs .fp-dir[data-direction][aria-pressed="false"]');
  await free.nth(0).click();
  await free.nth(0).click(); // (the first is pressed now: the next one is first)
}
async function typePath(page, p = P) {
  await page.fill('#ds-pathStart', p.start);
  await page.fill('#ds-pathHow', p.how);
  await page.fill('#ds-pathNow', p.now);
}
const send = (page) => page.locator('#fieldsSave');

test('saved, then directions sent for a check: the path stays everywhere, and the change waits for an admin', async ({ browser }) => {
  const m = await approvedMentor('სატესტო პროფესორი', 'a');
  const { ctx, page } = await detailsPage(browser, m);
  await typePath(page);
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await pathRow(m)).path_start).toBe(P.start);
  await pickTwoMore(page);
  await send(page).click();
  await expect.poll(async () => (await openChanges(m)).length).toBe(1);
  // the page drawn again: the path is in its boxes, from the server
  await expect(page.locator('#ds-pathStart')).toHaveValue(P.start);
  await expect(page.locator('#ds-pathHow')).toHaveValue(P.how);
  await expect(page.locator('#ds-pathNow')).toHaveValue(P.now);
  expect(await pathRow(m)).toEqual({ path_start: P.start, path_how: P.how, path_now: P.now });
  expect((await openChanges(m))[0].proposed.directions.length).toBe(3);
  // on the profile, and the admin has the change to decide
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('.profile-path')).toContainText(P.how);
  const admin = await adminClient();
  expect((await admin.api('/admin/changes')).changes.some((c) => c.mentor.id === m.id)).toBe(true);
  await ctx.close();
});

test('typed and NOT saved, then "send for a check": the path is saved first, then the change is sent; nothing is lost', async ({ browser }) => {
  const m = await approvedMentor('სატესტო ლექტორი', 'b');
  const { ctx, page } = await detailsPage(browser, m);
  await typePath(page);
  await pickTwoMore(page);
  await send(page).click();
  await expect.poll(async () => (await openChanges(m)).length).toBe(1);
  expect(await pathRow(m)).toEqual({ path_start: P.start, path_how: P.how, path_now: P.now });
  await expect(page.locator('#ds-pathNow')).toHaveValue(P.now);
  await expect(page.locator('#storyDraftNote')).toBeHidden();
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('.profile-path')).toContainText(P.start);
  await ctx.close();
});

test('a block too short: nothing is sent, the reason is under that block, and everything typed stays', async ({ browser }) => {
  const m = await approvedMentor('სატესტო მკვლევარი', 'c');
  const { ctx, page } = await detailsPage(browser, m);
  const short = 'ღამით ვსწავლობდი.';
  await typePath(page, { ...P, how: short });
  await pickTwoMore(page);
  await send(page).click();
  const line = page.locator('#ds-pathHow-err');
  await expect(line).toBeVisible();
  await expect(line).toHaveText(fill('story.err.blockShort', { min: 40, left: 40 - [...short].length }));
  await expect(page.locator('#ds-pathHow')).toBeFocused();
  await expect(page.locator('#ds-pathHow')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#fieldsError')).toHaveText(KA['details.err.storyFirst']);
  // nothing sent, nothing saved, nothing cleared
  expect(await openChanges(m)).toHaveLength(0);
  expect((await pathRow(m)).path_start).toBeNull();
  await expect(page.locator('#ds-pathStart')).toHaveValue(P.start);
  await expect(page.locator('#ds-pathHow')).toHaveValue(short);
  await expect(page.locator('#ds-pathNow')).toHaveValue(P.now);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // fixed: the line goes as it is typed; sent again, both are saved
  await page.fill('#ds-pathHow', P.how);
  await expect(line).toBeHidden();
  await send(page).click();
  await expect.poll(async () => (await openChanges(m)).length).toBe(1);
  expect(await pathRow(m)).toEqual({ path_start: P.start, path_how: P.how, path_now: P.now });
  await ctx.close();
});

test('the page left before saving: what was typed comes back, marked as not saved yet; saved, the note goes', async ({ browser }) => {
  const m = await approvedMentor('სატესტო მასწავლებელი', 'd');
  const { ctx, page } = await detailsPage(browser, m);
  await typePath(page);
  await page.reload();
  await expect(page.locator('#ds-pathHow')).toHaveValue(P.how);
  await expect(page.locator('#ds-pathNow')).toHaveValue(P.now);
  await expect(page.locator('#storyDraftNote')).toBeVisible();
  await expect(page.locator('#storyDraftNote')).toHaveText(KA['details.story.draft']);
  expect((await pathRow(m)).path_start, 'not saved by itself').toBeNull();
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await pathRow(m)).path_now).toBe(P.now);
  await expect(page.locator('#storyDraftNote')).toBeHidden();
  await page.reload();
  await expect(page.locator('#storyDraftNote')).toBeHidden();
  await expect(page.locator('#ds-pathNow')).toHaveValue(P.now);
  await ctx.close();
});
