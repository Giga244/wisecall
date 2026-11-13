// The new home page, Browse without login and the Jikhva logo (docs/CLAUDE-CODE-NEW-HOME.md), in launch mode, in Georgian. Runs after
// full-flow.spec.js (the admin account): files run in name order. Prelaunch: e2e/new-home-prelaunch.spec.js.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

const stamp = Date.now();
const QUESTION = 'თორმეტე კლასში ვარ და მინდა ექიმი გავხდე. რომელი საგნები ვისწავლო ახლავე, რომ ეროვნულ გამოცდებზე კარგი ქულა ავიღო?';
let admin;
let free;
test.beforeAll(async () => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  free = await S.listedMentor(admin, { name: 'ნინო ჰომი', email: `home-free-${stamp}@e2e.test`, price: 0, roleTitle: 'რეზიდენტი, კარდიოლოგია', niche: 'medicine' });
});
const ka = async (browser, width = 375, height = 812) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  return { ctx, page: await ctx.newPage() };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a visitor opens Browse and a mentor profile without an account; the question box is there, no login wall', async ({ browser }) => {
  const { ctx, page } = await ka(browser);
  await page.goto('/ka/experts.html');
  await expect(page.locator('#expertGrid .expert-card').first()).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.goto(`/ka/u/${encodeURIComponent(free.username)}`);
  await page.click('#askOpen');
  await expect(page.locator('#question')).toBeVisible();
  await expect(page.locator('#askBtn')).toBeVisible();
  await ctx.close();
});

test('"დასვი კითხვა" signed out: the sign-up sheet; after signing up the question is still there and is sent', async ({ browser }) => {
  const { ctx, page } = await ka(browser);
  await page.goto(`/ka/u/${encodeURIComponent(free.username)}`);
  await page.click('#askOpen');
  await page.fill('#question', QUESTION);
  await page.click('#askBtn');
  const sheet = page.locator('dialog#askSignup[open]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toHaveText('დარეგისტრირდი, რომ კითხვა გაიგზავნოს');
  expect(await fits(page)).toBe(true);
  await sheet.locator('a.btn-primary').click();
  await page.waitForURL(/signup\.html\?redirect=/);
  const email = `home-asker-${stamp}@e2e.test`;
  await page.fill('#name', 'ლუკა ახალი');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.selectOption('#birthYear', '1999');
  await page.selectOption('#birthMonth', '05');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', S.codeIn(await S.waitForMail(email)));
  await page.click('#verifyForm button[type="submit"]');
  // back on the profile: the kept question goes out by itself
  await page.waitForURL((u) => u.pathname.includes(`/u/${free.username}`));
  await expect(page.locator('.booking-result.success')).toBeVisible();
  await expect.poll(async () => (await S.sql('SELECT question FROM bookings b JOIN users u ON u.id = b.seeker_id WHERE u.email = $1', [email])).map((r) => r.question)[0]).toBe(QUESTION);
  expect(new URL(page.url()).searchParams.get('send')).toBeNull();
  await ctx.close();
});

test('the home page: only approved mentors who chose to be shown; the search, at most five fields, and the phone', async ({ browser }) => {
  // an approved mentor who chose it, and someone who is not approved (also "shown"): only the first appears
  await S.sql('UPDATE users SET show_on_home = true WHERE id = $1', [free.id]);
  const pending = await S.apiUser('არა დამტკიცებული', `home-pending-${stamp}@e2e.test`);
  await pending.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'იურისტი', niche: 'law', price: 20 } });
  await S.sql("UPDATE users SET show_on_home = true WHERE email = $1", [`home-pending-${stamp}@e2e.test`]);

  const { ctx, page } = await ka(browser);
  await page.goto('/ka/');
  await expect(page.locator('#homeMentorsList')).toContainText('ნინო ჰომი');
  await expect(page.locator('#homeMentorsList')).not.toContainText('არა დამტკიცებული');
  await expect(page.locator('#heroSearch')).toBeVisible();
  await expect(page.locator('#heroWait')).toHaveCount(0);
  expect(await page.locator('#heroChips li').count()).toBeLessThanOrEqual(5);
  // (the phone is always there: real answers, or examples marked as such; e2e/random-phone.spec.js)
  await expect(page.locator('#homeQa')).toHaveAttribute('data-item', /.+/); // (the drawn phone or the example video)
  await expect(page.locator('#homeQa')).toBeVisible();
  expect(await fits(page)).toBe(true);
  await ctx.close();
});

for (const width of [360, 1280]) {
  test(`the logo is not cut off at ${width}px (Jikhva's horns included)`, async ({ browser }) => {
    const { ctx, page } = await ka(browser, width, 800);
    await page.goto('/ka/');
    const logo = page.locator('#siteHeader .logo .jlogo');
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    const header = await page.locator('#siteHeader').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(width < 768 ? 36 : 50); // (a phone's header is about 56px: docs/CLAUDE-CODE-COMPACT-HOME.md)
    // the head has loaded, and it sits inside the logo's own box (the viewBox leaves room for the horns)
    expect(await page.evaluate(() => fetch('/brand/jikhva-head.webp').then((r) => r.ok))).toBe(true);
    expect(await fits(page)).toBe(true);
    await ctx.close();
  });
}
