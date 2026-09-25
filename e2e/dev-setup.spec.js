// The local set-up for testing by hand (see LOCAL-TESTING.md): mock bank, mock ID check, email off so codes appear on screen, the site open for
// buyers, and test.admin@example.com as the admin. This runs a second server with exactly those settings and does what a person does:
// signs up as the admin, reads the code from the screen, and opens the admin panel.
const { test, expect } = require('@playwright/test');
const { startServer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let srv;
test.beforeAll(async () => {
  srv = await startServer(4621, {
    RESEND_API_KEY: '', EMAIL_PROVIDER: 'resend', ADMIN_EMAILS: 'test.admin@example.com', LAUNCH_MODE: 'live', SUPPORT_EMAIL: 'support@wisecall.test',
    PAYMENT_PROVIDER: 'mock', KYC_PROVIDER: 'mock', PROBATION_ANSWERS: '' // (the default: a mentor's first answers are held for a check)
  });
});
test.afterAll(() => { if (srv) srv.proc.kill(); });

async function signUpWithScreenCode(page, name, email) {
  await page.goto(`${srv.base}/signup.html`);
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', 'local-test-pass-1');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  const box = page.locator('#devCodeBox');
  await expect(box).toBeVisible(); // "Email sending isn't set up on this server yet, so here's your code directly (dev mode only): 123456"
  await expect(box).toContainText('dev mode only');
  const code = (await box.locator('strong').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.fill('#code', code);
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
}

test('the startup messages: mock providers, open for buyers, no missing-address warning', async () => {
  const log = srv.logs();
  expect(log).toContain('MOCK bank');
  expect(log).toContain('ID check: MOCK');
  expect(log).toContain('Launch mode: live');
  expect(log).toContain('EMAIL IS OFF: verification codes and reset links are shown on screen');
  expect(log).not.toContain('SUPPORT_EMAIL is not set');
});

test('sign up as test.admin@example.com, read the code from the screen, and the admin panel opens (there is no second factor to set up)', async ({ page }) => {
  await signUpWithScreenCode(page, 'Test Admin', 'test.admin@example.com');
  await expect(page.locator('#navLoggedIn .admin-link')).toBeVisible(); // an Admin button next to Dashboard and Settings
  await page.goto(`${srv.base}/admin.html`);
  await expect(page.locator('#adminTabs')).toBeVisible();
  await expect(page.locator('#adminTabs [data-tab="payouts"]')).toBeVisible();
  await expect(page.locator('#adminLaunchNote')).toBeHidden(); // (the site is live, so no "prelaunch" note)
  expect((await page.request.get(`${srv.base}/api/admin/mentors`)).status()).toBe(200);
});

test('another account signs up the same way and gets the plain "no access" page, not the admin panel', async ({ page }) => {
  await signUpWithScreenCode(page, 'Plain Person', 'plain.person@example.com');
  await expect(page.locator('#navLoggedIn .admin-link')).toHaveCount(0);
  const res = await page.goto(`${srv.base}/admin.html`);
  expect(res.status()).toBe(403);
  await expect(page.locator('h1')).toHaveText("You don't have access to this page");
  expect((await page.request.get(`${srv.base}/api/admin/mentors`)).status()).toBe(403);
});
