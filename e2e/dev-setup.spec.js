// The local set-up for testing by hand (see LOCAL-TESTING.md): mock bank, mock ID check, email off so codes appear on screen, the site open for
// buyers, test.admin@example.com as the admin, and two-step verification for admins ON (with the development helper that shows the code the
// app would show). This runs a second server with exactly those settings and does what a person does.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { startServer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let srv;
let recoveryCodes = [];
test.beforeAll(async () => {
  srv = await startServer(4621, {
    RESEND_API_KEY: '', EMAIL_PROVIDER: 'resend', ADMIN_EMAILS: 'test.admin@example.com', LAUNCH_MODE: 'live', SUPPORT_EMAIL: 'support@wisecall.test',
    PAYMENT_PROVIDER: 'mock', KYC_PROVIDER: 'mock', PROBATION_ANSWERS: '', // (the default: a mentor's first answers are held for a check)
    ADMIN_2FA: 'required'
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
async function logIn(page, email) {
  await page.goto(`${srv.base}/login.html`);
  await page.fill('#email', email);
  await page.fill('#password', 'local-test-pass-1');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
}
const audit = async (page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);

test('the startup messages: mock providers, open for buyers, no missing-address warning, two-step verification on', async () => {
  const log = srv.logs();
  expect(log).toContain('MOCK bank');
  expect(log).toContain('ID check: MOCK');
  expect(log).toContain('Launch mode: live');
  expect(log).toContain('EMAIL IS OFF: verification codes and reset links are shown on screen');
  expect(log).not.toContain('SUPPORT_EMAIL is not set');
  expect(log).not.toContain('ADMIN 2FA IS OFF');
});

test('sign up as test.admin@example.com: the admin page first asks to set up two-step verification (QR code, key, and a development helper), then the panel opens', async ({ page }) => {
  await signUpWithScreenCode(page, 'Test Admin', 'test.admin@example.com');
  await expect(page.locator('#navLoggedIn .admin-link')).toBeVisible(); // an Admin button next to Dashboard and Settings
  await page.goto(`${srv.base}/admin.html`);

  // nothing of the panel yet: only the set-up page
  await expect(page.locator('h1')).toHaveText('Two-step verification');
  await expect(page.locator('#adminTabs')).toHaveCount(0);
  await expect(page.locator('.tf-qr svg')).toBeVisible();
  await expect(page.locator('.tf-qr')).toHaveAttribute('aria-label', 'QR code for the authenticator app');
  await expect(page.locator('#tfKey')).toHaveText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
  const dev = page.locator('.dev-code');
  await expect(dev).toContainText('Development only: the code the app would show now is');
  expect(await page.request.get(`${srv.base}/api/admin/mentors`).then((r) => r.status())).toBe(403);
  expect(await page.request.get(`${srv.base}/js/admin.js`).then((r) => r.status())).toBe(403);
  expect(await audit(page)).toEqual([]);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/two-step-setup-desktop.png`, fullPage: true });

  // a wrong code, then the helper fills in the right one
  await page.fill('#tfCode', '000000');
  await page.click('#tfForm button[type="submit"]');
  await expect(page.locator('#tfError')).toContainText('That code is not right');
  await page.click('#tfDevFill');
  await expect(page.locator('#tfCode')).toHaveValue(/^\d{6}$/);
  await page.click('#tfForm button[type="submit"]');

  // the recovery codes, once
  await expect(page.locator('#tfRecoveryTitle')).toHaveText('Save your recovery codes');
  await expect(page.locator('#tfRecoveryTitle')).toBeFocused();
  recoveryCodes = await page.locator('.tf-codes code').allInnerTexts();
  expect(recoveryCodes).toHaveLength(8);
  for (const c of recoveryCodes) expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  await page.click('#tfContinue'); // without ticking the box
  await expect(page.locator('#tfError')).toContainText('Tick the box');
  await page.check('#tfSaved');
  await page.click('#tfContinue');
  await page.waitForURL(/\/admin\.html$/);
  await expect(page.locator('#adminTabs')).toBeVisible();
  await expect(page.locator('#adminLaunchNote')).toBeHidden(); // (the site is live, so no "prelaunch" note)
  expect((await page.request.get(`${srv.base}/api/admin/mentors`)).status()).toBe(200);
});

test('signing in again with the password is not enough: the page asks for a code, and the helper gives one that works', async ({ page }) => {
  await logIn(page, 'test.admin@example.com');
  await page.goto(`${srv.base}/admin.html`);
  await expect(page.locator('h1')).toHaveText('Two-step verification');
  await expect(page.locator('#adminTabs')).toHaveCount(0);
  expect((await page.request.get(`${srv.base}/api/admin/mentors`)).status()).toBe(403);
  await expect(page.locator('.dev-code')).toContainText('Development only');
  await page.fill('#tfCode', '000000');
  await page.click('#tfForm button[type="submit"]');
  await expect(page.locator('#tfError')).toContainText('That code is not right');
  await page.click('#tfDevFill');
  await page.click('#tfForm button[type="submit"]');
  await page.waitForURL(/\/admin\.html$/);
  await expect(page.locator('#adminTabs')).toBeVisible();
});

test('a lost phone: a recovery code works once', async ({ page }) => {
  await logIn(page, 'test.admin@example.com');
  await page.goto(`${srv.base}/admin.html`);
  await page.click('#tfSwitch'); // "Lost your phone? Use a recovery code"
  await expect(page.locator('.dev-code')).toHaveCount(0);
  await page.fill('#tfCode', recoveryCodes[0]);
  await page.click('#tfForm button[type="submit"]');
  await page.waitForURL(/\/admin\.html$/);
  await expect(page.locator('#adminTabs')).toBeVisible();

  // the same code again, in a new session
  await page.context().clearCookies();
  await logIn(page, 'test.admin@example.com');
  await page.goto(`${srv.base}/admin.html`);
  await page.click('#tfSwitch');
  await page.fill('#tfCode', recoveryCodes[0]);
  await page.click('#tfForm button[type="submit"]');
  await expect(page.locator('#tfError')).toContainText('That code is not right');
  await expect(page.locator('#adminTabs')).toHaveCount(0);
});

test('the page in Georgian and in the dark theme is readable and passes the accessibility audit', async ({ browser }) => {
  for (const [lang, scheme, title] of [['ka', 'light', 'ორსაფეხურიანი შემოწმება'], ['en', 'dark', 'Two-step verification']]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
    const page = await ctx.newPage();
    await logIn(page, 'test.admin@example.com');
    await page.goto(`${srv.base}/admin.html`);
    await expect(page.locator('h1')).toHaveText(title);
    await page.waitForTimeout(500);
    expect(await audit(page)).toEqual([]);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/two-step-${lang}-${scheme}-390.png`, fullPage: true });
    await ctx.close();
  }
});

test('another account signs up the same way and gets the plain "no access" page, not the admin panel or the two-step page', async ({ page }) => {
  await signUpWithScreenCode(page, 'Plain Person', 'plain.person@example.com');
  await expect(page.locator('#navLoggedIn .admin-link')).toHaveCount(0);
  const res = await page.goto(`${srv.base}/admin.html`);
  expect(res.status()).toBe(403);
  await expect(page.locator('h1')).toHaveText("You don't have access to this page");
  expect((await page.request.get(`${srv.base}/api/admin/mentors`)).status()).toBe(403);
  expect((await page.request.get(`${srv.base}/api/admin/2fa/status`)).status()).toBe(403);
  expect((await page.request.get(`${srv.base}/js/admin-2fa.js`)).status()).toBe(403);
});
