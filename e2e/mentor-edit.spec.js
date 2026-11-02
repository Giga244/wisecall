// Mentors edit their details and price; an admin changes a price (docs/CLAUDE-CODE-MENTOR-EDIT.md), at 360px in Georgian: free and paid again
// from the dashboard in two taps each; "My details" saves at once, a field change waits for the admin, the ID check's name is read-only; the
// admin changes the price with a reason and approves the change from "ცვლილებები შესამოწმებლად".
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const AKA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const OUT = process.env.E2E_SHOTS;
const tag = Date.now();
let mentor;

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}
async function phone(browser, who, to) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, who, to);
  return { ctx, page };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const priceOf = async (id) => (await S.sql('SELECT price FROM users WHERE id = $1', [id]))[0].price;

test.beforeAll(async () => {
  const admin = await adminClient();
  mentor = await S.listedMentor(admin, { name: 'ნიკა ფასიანი', email: `edit-${tag}@e2e.test`, price: 25 });
  await mentor.client.api('/me', { method: 'PATCH', body: { language: 'ka' } });
});

test('the dashboard: free in two taps (the switch, Save), the profile says "უფასოდ", and paid again in two taps with the last price back', async ({ browser }) => {
  const { ctx, page } = await phone(browser, mentor, '/dashboard.html');
  const block = page.locator('#priceBlock');
  await expect(block.locator('h2')).toHaveText(KA['priceBlock.title']);
  await expect(block.locator('[data-price-now]')).toHaveText('25 ₾');
  await block.locator('[data-price-free]').check(); // tap 1
  await block.locator('[data-price-save]').click(); // tap 2
  await expect(block.locator('[data-price-now]')).toHaveText(KA['priceBlock.free']);
  expect(await priceOf(mentor.id)).toBe(0);
  expect(await noSideways(page), 'nothing scrolls sideways').toBeLessThanOrEqual(0);
  if (OUT) await page.screenshot({ path: `${OUT}/mentor-edit-price-360-ka.png` });
  await page.goto(`/u/${mentor.username}`);
  await expect(page.locator('main')).toContainText(KA['price.free']);
  expect(KA['price.free']).toBe('უფასოდ');
  await page.goto('/dashboard.html');
  await block.locator('[data-price-free]').uncheck(); // tap 1
  await expect(block.locator('[data-price-input]')).toHaveValue('25');
  await block.locator('[data-price-save]').click(); // tap 2
  await expect(block.locator('[data-price-now]')).toHaveText('25 ₾');
  expect(await priceOf(mentor.id)).toBe(25);
  await ctx.close();
});

test('"ჩემი მონაცემები": the university saves at once; the field change waits for the admin and the profile keeps the old field; the ID name is read-only', async ({ browser }) => {
  const { ctx, page } = await phone(browser, mentor, '/settings.html?tab=details');
  await expect(page.locator('#tab-details')).toHaveText(KA['settings.tab.details']);
  await page.fill('#dUni', 'ილიას სახელმწიფო უნივერსიტეტი');
  await page.locator('#detailsForm button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT university FROM users WHERE id = $1', [mentor.id]))[0].university).toBe('ილიას სახელმწიფო უნივერსიტეტი');
  await page.selectOption('#dMain', 'it');
  await page.locator('#fieldsForm button[type="submit"]').click();
  await expect(page.locator('#detailsPending')).toContainText(KA['details.pending.title']);
  expect((await S.sql('SELECT field_id, niche FROM users WHERE id = $1', [mentor.id]))[0]).toMatchObject({ field_id: 'biz', niche: 'business' });
  await expect(page.locator('#detailsIdTitle')).toHaveText(KA['details.id.title']);
  await expect(page.locator('a[href$="contact.html"]', { hasText: KA['details.id.write'] })).toBeVisible();
  expect(await page.locator('#dIdName input, input[name="verifiedName"], input[name="dateOfBirth"]').count(), 'no field for the ID name or birth date').toBe(0);
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  if (OUT) await page.screenshot({ path: `${OUT}/mentor-edit-details-360-ka.png`, fullPage: true });
  await ctx.close();
});

test('the admin: "ფასის შეცვლა" needs a reason and shows the history; the change is approved in one tap from the queue', async ({ browser }) => {
  const { ctx, page } = await phone(browser, ADMIN, '/admin.html?tab=mentors&status=verified');
  const card = page.locator('.mv-card').filter({ hasText: mentor.email });
  await expect(card).toBeVisible();
  await card.locator('.mv-open').click();
  const price = card.locator('.mv-price');
  await price.scrollIntoViewIfNeeded();
  await expect(price).toContainText(AKA['admin.price.title']);
  await price.locator('.mv-price-amount').fill('30');
  await price.locator('.mv-price-save').click();
  expect(await priceOf(mentor.id), 'no reason, no change').toBe(25);
  await price.locator('.mv-price-reason').fill('მენტორმა ითხოვა მეილით, 02.11');
  await price.locator('.mv-price-save').click();
  await expect.poll(() => priceOf(mentor.id)).toBe(30);
  await expect(card.locator('.mv-price-history')).toContainText('25 ₾ → 30 ₾');
  await expect(card.locator('.mv-price-history')).toContainText('მენტორმა ითხოვა მეილით, 02.11');
  const mail = await S.waitForMail(mentor.email, 'ფასი');
  expect(mail.html).toContain('თქვენი ფასი შეიცვალა: 25 ₾ → 30 ₾. თუ ეს თქვენ არ გითხოვიათ, მოგვწერეთ.');
  expect(await noSideways(page)).toBeLessThanOrEqual(0);

  await page.goto('/admin.html?tab=queue');
  await expect(page.locator('#changesTitle')).toContainText(AKA['admin.ch.title']);
  const change = page.locator('[data-change]').filter({ hasText: mentor.email });
  await expect(change).toContainText('IT');
  await change.locator('.ch-approve').click();
  await expect.poll(async () => (await S.sql('SELECT field_id, verification_status FROM users WHERE id = $1', [mentor.id]))[0]).toMatchObject({ field_id: 'it', verification_status: 'verified' });
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  await ctx.close();
});
