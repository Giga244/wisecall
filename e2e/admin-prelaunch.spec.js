// Before launch the admin page shows its tabs (#adminTabs) and status chips (#statusFilters), and a link can open a status directly:
// /admin.html?tab=mentors&status=verified (docs/CLAUDE-CODE-ADMIN-TABS-BUG.md). The prelaunch rule that hides the home page's expert
// search and field filters used to hide every .filters row on every page. Runs its own server, in prelaunch.
//
// E2E_ADMIN_SHOTS=<folder> saves pictures of admin.html in prelaunch at 1280px and 360px (docs/quality-screens/admin-prelaunch/).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { startServer, signupVerified, approveMentor } = require('../tests/helpers');

const SHOTS = process.env.E2E_ADMIN_SHOTS;
let srv;
// (addresses of their own each run: after a failed test Playwright starts the set-up again, with the accounts of the last run still there)
const TAG = Date.now();
const ADMIN = { email: `qa-admin-${TAG}@example.com`, password: 'test-pass-12345' };
const VERA = `vera.verified.${TAG}@example.com`;
const PAVLE = `pavle.pending.${TAG}@example.com`;

test.beforeAll(async () => {
  srv = await startServer(4623, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '30', ADMIN_EMAILS: ADMIN.email });
  const admin = await signupVerified(srv.base, 'QA Admin', ADMIN.email);
  const m = await signupVerified(srv.base, 'Vera Verified', VERA);
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, niche: 'business', roleTitle: 'Founder', price: 20 } });
  await approveMentor(admin, m);
  const p = await signupVerified(srv.base, 'Pavle Pending', PAVLE);
  await p.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (srv) srv.proc.kill(); });

async function signIn(page) {
  await page.goto(`${srv.base}/login.html`);
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
}

for (const width of [1280, 360]) {
  test(`${width}px: the tabs and the status chips are there before launch, and every tab opens`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 400, hasTouch: width < 400 });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${srv.base}/admin.html`);
    await expect(page.locator('html')).toHaveAttribute('data-launch', 'prelaunch');
    await expect(page.locator('#adminLaunchNote')).toBeVisible();
    await expect(page.locator('#adminTabs')).toBeVisible();
    await expect(page.locator('#adminTabs [data-tab="mentors"]')).toBeVisible();
    await expect(page.locator('#adminTabs [data-tab="waitlist"]')).toBeVisible();
    await expect(page.locator('#statusFilters')).toBeVisible();
    await expect(page.locator('#statusFilters .chip')).toHaveCount(7); // Needs a human, Verified, A step failed, Rejected, Suspended, Email not confirmed, All
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-${width}.png`, fullPage: true });

    // the Verified chip lists the approved mentor (and the address says so)
    await page.locator('#statusFilters .chip[data-status="verified"]').click();
    await expect(page.locator('.mv-card').filter({ hasText: VERA })).toBeVisible();
    await expect(page).toHaveURL(/\?tab=mentors&status=verified$/);
    // the Waiting list tab opens
    await page.locator('#adminTabs [data-tab="waitlist"]').click();
    await expect(page.locator('#statusFilters')).toBeHidden(); // (it has no status chips)
    await expect(page).toHaveURL(/\?tab=waitlist$/);
    await ctx.close();
  });
}

test('a link opens a status directly: ?tab=mentors&status=verified and &status=all', async ({ page }) => {
  await signIn(page);
  await page.goto(`${srv.base}/admin.html?tab=mentors&status=verified`);
  await expect(page.locator('#statusFilters .chip.active')).toHaveAttribute('data-status', 'verified');
  await expect(page.locator('.mv-card').filter({ hasText: VERA })).toBeVisible();
  await expect(page.locator('.mv-card').filter({ hasText: PAVLE })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-verified-1280.png`, fullPage: true });

  await page.goto(`${srv.base}/admin.html?tab=mentors&status=all`);
  await expect(page.locator('#statusFilters .chip.active')).toHaveAttribute('data-status', '');
  await expect(page.locator('.mv-card').filter({ hasText: VERA })).toBeVisible();
  await expect(page.locator('.mv-card').filter({ hasText: PAVLE })).toBeVisible();

  // an unknown status is ignored: the default list (Needs a human) opens
  await page.goto(`${srv.base}/admin.html?tab=mentors&status=nonsense`);
  await expect(page.locator('#statusFilters .chip.active')).toHaveAttribute('data-status', 'pending');
});

test('Browse keeps its expert search and field filters before launch (docs/CLAUDE-CODE-NEW-HOME.md 4); no page loses a .filters row', async ({ page }) => {
  await page.goto(`${srv.base}/experts.html`);
  await expect(page.locator('#experts .browse-toolbar')).toBeVisible();
  await expect(page.locator('#filters .chip').first()).toBeVisible();
  await signIn(page);
  for (const p of ['/dashboard.html', '/settings.html', '/inbox.html', '/help.html', '/admin.html']) {
    await page.goto(srv.base + p);
    await page.waitForLoadState('networkidle');
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.filters')].filter((el) => el.id !== 'statusFilters' && getComputedStyle(el).display === 'none').map((el) => el.id || el.className));
    expect(hidden, p).toEqual([]);
  }
});
