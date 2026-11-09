// "Find me a mentor" in the browser (PART 7B): Browse offers it when a search finds nobody, a visitor who is not signed in sends a request
// and confirms it from the email, and the admin sees it under "Mentor requests". Runs after full-flow.spec.js (the admin account): files run in name order.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  await S.listedMentor(admin, { name: 'Rati Requests', email: 'rati@e2e.test', niche: 'business', roleTitle: 'Shop owner' });
});

test('Browse: a search that finds nobody leads to the request form, with the words already filled in', async ({ page }) => {
  await page.goto('/experts.html');
  await page.fill('#searchInput', 'Beekeeping in Kakheti');
  const cta = page.locator('#expertGrid a[href^="/find-a-mentor.html"]');
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/find-a-mentor\.html\?field=Beekeeping/);
  await expect(page.locator('#rqField')).toHaveValue('Beekeeping in Kakheti');
});

test('a visitor sends a request, confirms it from the email, and the admin sees it', async ({ page, browser }) => {
  await page.goto('/find-a-mentor.html?field=Beekeeping%20in%20Kakheti');
  await expect(page.locator('#rqEmailField')).toBeVisible();
  await page.selectOption('#rqNiche', 'other');
  await page.fill('#rqNeed', 'call me +995 599 12 34 56, I want to start keeping bees');
  await page.fill('#rqEmail', 'bees@e2e.test');
  await page.click('#requestForm button[type="submit"]');
  await expect(page.locator('#rqError')).toContainText(/phone numbers/i);
  await page.fill('#rqNeed', 'I want to start keeping bees next spring and need to know what the first year costs.');
  await page.check('#rqPublic');
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/find-a-mentor-form.png`, fullPage: true });
  await page.click('#requestForm button[type="submit"]');
  await expect(page.locator('#rqStatus')).toContainText(/Almost done/);
  await expect(page.locator('#requestForm')).toBeHidden();

  const mail = await S.waitForMail('bees@e2e.test', 'Confirm');
  const link = mail.text.match(/https?:\/\/\S+\/api\/requests\/confirm\?token=[0-9a-f]{48}/)[0];
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.locator('#rqStatus')).toContainText(/is confirmed/);
  expect((await S.sql(`SELECT status, show_public FROM mentor_requests WHERE email = 'bees@e2e.test'`))[0]).toEqual({ status: 'active', show_public: true });

  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await S.logIn(admin, { email: 'e2e-admin@example.com' });
  await admin.goto('/admin.html');
  await admin.click('#adminTabs [data-tab="requests"]');
  await expect(admin.locator('#adminContent')).toContainText('bees@e2e.test');
  await expect(admin.locator('.rq-copy').first()).toBeVisible();
  if (process.env.E2E_SHOTS) await admin.screenshot({ path: `${process.env.E2E_SHOTS}/admin-mentor-requests.png`, fullPage: true });
  await ctx.close();
});
