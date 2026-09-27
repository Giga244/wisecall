// The admin page in a real browser: a visitor is sent to log in, an ordinary account gets a plain "no access" page (in both languages and both
// themes), and nothing of the admin panel is on it. Runs after full-flow.spec.js, which creates the accounts.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const S = require('./support');

test.describe('the admin page', () => {
  test('a visitor is sent to the login page and back to the admin page after signing in as an admin', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page).toHaveURL(/\/login\.html\?redirect=(%2F|\/)admin\.html/);
    await page.fill('#email', 'e2e-admin@example.com');
    await page.fill('#password', S.PASSWORD);
    await page.locator('#loginForm button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\.html$/);
    await expect(page.locator('#adminTabs')).toBeVisible();
  });

  test('an ordinary account gets a 403 page in the site design, with a way back home, and none of the admin panel', async ({ page }) => {
    await S.logIn(page, { email: 'sam@e2e.test' });
    const res = await page.goto('/admin.html');
    expect(res.status()).toBe(403);
    await expect(page.locator('h1')).toHaveText("You don't have access to this page");
    await expect(page.locator('.error-code')).toHaveText('403');
    const html = await res.text();
    for (const leak of ['adminLaunchNote', 'Prelaunch', 'LAUNCH_MODE', 'ADMIN_EMAILS', 'admin-mentors.js', 'Mentor applications']) expect(html, leak).not.toContain(leak);
    // no admin script or dictionary was even asked for by the page
    const asked = [];
    page.on('request', (r) => { if (/admin[\w-]*\.(js|json)/.test(r.url())) asked.push(r.url()); });
    await page.reload();
    expect(asked).toEqual([]);
    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/\/(index\.html)?$/);
  });

  test('the same page in Georgian and in the dark theme is readable and passes the accessibility audit', async ({ browser }) => {
    for (const [lang, scheme, expected] of [['ka', 'light', 'ამ გვერდზე წვდომა არ გაქვს'], ['en', 'dark', "You don't have access to this page"]]) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 800 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      await S.logIn(page, { email: 'sam@e2e.test' });
      const res = await page.goto('/admin.html');
      expect(res.status()).toBe(403);
      await expect(page.locator('h1')).toHaveText(expected);
      await page.waitForTimeout(500); // (the language buttons fade to their active colours)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
      if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/no-access-${lang}-${scheme}-390.png` });
      await ctx.close();
    }
  });
});
