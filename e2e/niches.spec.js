// Niches (fields) in the browser: the home page's field tiles with "See all", Browse's chips for the fields that have mentors, a field's page
// (/advice/<niche>) in English and Georgian, "Your field" and "Other" in the Experience form, the field on cards, in search and as the
// "Other" filter, and the admin's Niches tab.
// Runs after full-flow.spec.js, whose Law mentor (Ana Lomidze) is listed.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test('the home page shows two full rows of fields and the rest behind "See all"', async ({ page }) => {
  await page.goto('/');
  const strip = page.locator('#nicheStrip');
  await expect(strip.locator('a.field-tile:visible')).toHaveCount(10); // (5 columns at 1280px)
  await expect(page.locator('#fieldsMore')).toHaveText('See all 36 fields');
  await page.locator('#fieldsMore').click();
  await expect(strip.locator('a.field-tile:visible')).toHaveCount(36);
  await expect(page.locator('#fieldsMore')).toHaveText('Show fewer');
  await expect(strip).toContainText('Wine & agriculture');
  if (process.env.E2E_SHOTS) await strip.screenshot({ path: `${process.env.E2E_SHOTS}/home-strip.png` });
});

test('a field page lists its mentors and switches language; Browse links there', async ({ page }) => {
  await page.goto('/advice/law');
  await expect(page.locator('h1')).toHaveText('Advice on Law from people who have done it');
  await expect(page.locator('#adviceRegulated')).toContainText('regulated field');
  await expect(page.locator('#adviceGrid .expert-card')).toContainText('Ana Lomidze');
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/advice-law.png`, fullPage: true });
  await page.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(page.locator('h1')).toHaveText('სამართალი: რჩევა მათგან, ვინც ეს გაიარა');
  await page.locator('.lang-btn[data-lang="en"]').first().click();
  // Other fields are linked from the page.
  await page.locator('#adviceOther a[href="/advice/psychology"]').click();
  await expect(page.locator('h1')).toHaveText('Advice on Psychology & wellbeing from people who have done it');
  await expect(page.locator('#adviceGrid')).toContainText('No mentors in Psychology & wellbeing yet');
  await expect(page.locator('#adviceGrid form')).toBeVisible(); // the waiting list
  // The mentor's profile links to their field's page.
  await page.goto('/u/' + (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username);
  await expect(page.locator('.tag-niche')).toHaveAttribute('href', '/advice/law');
  await expect(page.locator('.tag-niche')).toHaveText('Tax law for small businesses'); // (the mentor's words, not the category)
});

test('the field in the mentor\'s words is on the card, search finds it, and "Other" is a filter', async ({ page }) => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  const who = await S.listedMentor(admin, { name: 'Nodar Nails', email: 'nodar@e2e.test', niche: 'other', roleTitle: 'Salon owner', customNiche: 'Nail artist' });
  await page.goto('/?niche=other#experts');
  const card = page.locator('.expert-card', { hasText: 'Nodar Nails' });
  await expect(card.locator('.card-role')).toHaveText('Salon owner · Nail artist');
  await expect(page.locator('#filters .chip[data-niche="other"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#experts');
  await page.fill('#searchInput', 'nail art');
  await expect(page.locator('.expert-card')).toHaveCount(1);
  await expect(page.locator('.expert-card')).toContainText('Nodar Nails');
  await page.fill('#searchInput', 'small business tax'); // (a specialty tag of the Law mentor)
  await expect(page.locator('.expert-card', { hasText: 'Ana Lomidze' })).toBeVisible();
  await page.goto('/u/' + who.username);
  await expect(page.locator('.tag-niche')).toHaveText('Nail artist');
});

test('"Your field" and "Other" in the application (step 1 of /apply.html)', async ({ page }) => {
  await S.signUp(page, { name: 'Gio Bees', email: 'gio.bees@e2e.test' });
  await page.goto('/apply.html');
  await expect(page.locator('#apField')).toBeVisible(); // (every mentor writes their field)
  await page.fill('#apHeadline', 'Beekeeper in Racha');
  await page.selectOption('#apYears', '9');
  await page.fill('#apField', 'www.bees.ge');
  await expect(page.locator('#apCategory')).toBeVisible(); // (the closest category is suggested; one tap changes it)
  await page.click('[data-cat-change]');
  await page.selectOption('#apNiche', 'other');
  await page.click('.apply-next');
  await expect(page.locator('#apFieldErr')).toContainText('without links'); // (under the field it is about)
  await page.fill('#apField', 'Beekeeping');
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  await expect.poll(async () => (await S.sql(`SELECT niche, custom_niche FROM users WHERE email = 'gio.bees@e2e.test'`))[0]).toMatchObject({ niche: 'other', custom_niche: 'Beekeeping' });
});

test('the admin sees the suggestion under Niches', async ({ page }) => {
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/admin.html');
  await page.click('#adminTabs [data-tab="niches"]');
  await expect(page.locator('.nf-suggestion', { hasText: 'Beekeeping' })).toBeVisible();
  await expect(page.locator('.nf-niche')).toHaveCount(36);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/admin-niches.png` });
});
