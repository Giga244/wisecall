// Before the ID-check provider's keys exist (prelaunch), a mentor's ID-check step says "ID checks open soon" instead of a start button, in
// English and Georgian, and the rest of the application still works. Runs its own server: prelaunch, a bank named but without keys, Didit named
// but without keys (a development server, so the sign-up code is on screen).
const { test, expect } = require('@playwright/test');
const { startServer } = require('../tests/helpers');

let srv;
test.beforeAll(async () => {
  srv = await startServer(4622, {
    LAUNCH_MODE: 'prelaunch', RESEND_API_KEY: '', EMAIL_PROVIDER: 'resend',
    PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', KYC_PROVIDER: 'didit', DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: ''
  });
});
test.afterAll(() => { if (srv) srv.proc.kill(); });

test('a mentor applies and sees "ID checks open soon" (English and Georgian); nothing else is blocked', async ({ page }) => {
  await page.goto(`${srv.base}/signup.html`);
  await page.fill('#name', 'Early Mentor');
  await page.fill('#email', 'early.mentor@example.com');
  await page.fill('#password', 'local-test-pass-1');
  await page.selectOption('#birthYear', '1990');
  await page.selectOption('#birthMonth', '01');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', (await page.locator('#devCodeBox strong').innerText()).trim());
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');

  const headers = { 'X-Requested-With': 'wisecall' };
  const apply = await page.request.patch(`${srv.base}/api/me`, { headers, data: { becomeMentor: true, price: 25 } });
  expect(apply.status()).toBe(200);

  // (the ID check is step 5 of the application, /apply.html: the one place to apply)
  await page.goto(`${srv.base}/apply.html?step=5`);
  const soon = page.locator('.apply-step .vt-soon');
  await expect(soon).toContainText('ID checks open soon.');
  await expect(soon).toContainText('You can submit your application now');
  await expect(page.locator('[data-kyc-start]')).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/id-checks-soon-en.png`, fullPage: true });

  // the rest works: a portfolio link is accepted as evidence (step 4), its type chosen under "More options"
  await page.goto(`${srv.base}/apply.html?step=4`);
  await page.locator('.apply-more > summary').first().click();
  await page.selectOption('#apKind', 'portfolio');
  await page.fill('#apUrl', 'https://early-mentor.invalid/portfolio');
  await page.click('[data-add-link]');
  await expect(page.locator('.apply-evidence li')).toHaveCount(1);
  await expect(page.locator('.apply-evidence li')).toContainText('Portfolio');

  // and the server agrees that the ID check is closed
  expect((await page.request.post(`${srv.base}/api/verification/kyc/start`, { headers })).status()).toBe(503);

  await page.goto(`${srv.base}/apply.html?step=5`);
  await page.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(page.locator('.apply-step .vt-soon')).toContainText('პირადობის შემოწმება მალე გაიხსნება.');
});
