// PART 9 in the browser: "Copy link" on a mentor's profile and on the mentor's dashboard (the profile-link card), and the confirmation
// dialog that replaced window.confirm (focus on Cancel, Esc closes it and nothing happens, focus goes back, the action button acts).
// Runs after full-flow.spec.js (the admin account): files run in name order.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let mentor;
test.beforeAll(async () => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  mentor = await S.listedMentor(admin, { name: 'Lika Link', email: 'lika@e2e.test', niche: 'design', roleTitle: 'Product designer' });
});

test('a visitor copies a mentor\'s profile link', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(`/u/${mentor.username}?utm_source=test`);
  const btn = page.locator('.profile-share .copy-link');
  await expect(btn).toHaveText(/Copy link/);
  await btn.click();
  await expect(btn).toHaveText(/Copied!/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${S.BASE}/u/${mentor.username}`); // (without the ?query)
  await expect(btn).toHaveText(/Copy link/, { timeout: 5000 }); // (back after two seconds)
  await ctx.close();
});

test('the mentor\'s dashboard has a profile-link card with Copy link', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'lika@e2e.test' });
  await page.goto('/dashboard.html?tab=received');
  const card = page.locator('#shareCard');
  await expect(card).toBeVisible();
  await expect(card).toContainText(`/u/${mentor.username}`);
  await card.locator('.copy-link').click();
  await expect(card.locator('.copy-link')).toHaveText(/Copied!/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${S.BASE}/u/${mentor.username}`);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/dashboard-share-card.png` });
  await ctx.close();
});

test('the confirmation dialog: Cancel has the focus, Esc closes it and nothing happens, the action button acts', async ({ browser }) => {
  // (two sessions: the mentor's API client from the set-up, and this browser)
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'lika@e2e.test' });
  await page.goto('/settings.html?tab=account');
  const open = page.locator('#logoutOthers');
  await open.click();
  const dialog = page.locator('dialog.wc-dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.wc-dialog-message')).toHaveText('Sign out every device except this one?');
  await expect(dialog.locator('[data-ok]')).toHaveText('Sign out the other devices');
  await expect(dialog.locator('[data-cancel]')).toBeFocused();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/confirm-dialog.png` });
  await page.keyboard.press('Tab');
  await expect(dialog.locator('[data-ok]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('[data-cancel]')).toBeFocused(); // (round again: the focus stays in the dialog)
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('[data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  const live = async () => (await S.sql(`SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'lika@e2e.test' AND s.revoked_at IS NULL`))[0].n;
  expect(await live()).toBeGreaterThanOrEqual(2);
  await open.click();
  await S.confirm(page);
  await expect(page.locator('#toast')).toContainText('Every other device is signed out');
  await expect.poll(live).toBe(1);
  await ctx.close();
});
