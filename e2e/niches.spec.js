// Niches (fields) in the browser: the home strip with "Show all", Browse's chips for the fields that have mentors, a field's page
// (/advice/<niche>) in English and Georgian, "Other (type your own)" in the Experience form, and the admin's Niches tab.
// Runs after full-flow.spec.js, whose Law mentor (Ana Lomidze) is listed.
const { test, expect } = require('@playwright/test');
const S = require('./support');

test('the home strip shows the first fields and the rest behind "Show all"', async ({ page }) => {
  await page.goto('/');
  const strip = page.locator('#nicheStrip');
  await expect(strip.locator('a.niche-chip')).toHaveCount(12);
  await strip.locator('.niche-more').click();
  await expect(strip.locator('a.niche-chip')).toHaveCount(36);
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
});

test('"Other (type your own)" in the Experience form', async ({ page }) => {
  await S.signUp(page, { name: 'Gio Bees', email: 'gio.bees@e2e.test' });
  await page.goto('/settings.html');
  await page.click('#tab-mentor');
  await page.check('#becomeMentor');
  await page.goto('/settings.html?tab=verification');
  const form = page.locator('#ap-experience form[data-form="experience"]');
  await expect(form.locator('.ap-custom-niche')).toBeHidden();
  await form.locator('[name="niche"]').selectOption('other');
  await expect(form.locator('.ap-custom-niche')).toBeVisible();
  await form.locator('[name="customNiche"]').fill('www.bees.ge');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.vt-error')).toContainText('without links');
  await form.locator('[name="customNiche"]').fill('Beekeeping');
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => (await S.sql(`SELECT niche, custom_niche FROM users WHERE email = 'gio.bees@e2e.test'`))[0]).toMatchObject({ niche: 'other', custom_niche: 'Beekeeping' });
});

test('the admin sees the suggestion under Niches', async ({ page }) => {
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/admin.html');
  await page.click('#adminTabs [data-tab="niches"]');
  await expect(page.locator('.nf-suggestion')).toContainText('Beekeeping');
  await expect(page.locator('.nf-niche')).toHaveCount(36);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/admin-niches.png` });
});
