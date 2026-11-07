// Admin > Waitlist, "წაშლა": asks first, then the address is gone from the list and the log shows the deletion without the address.
// Runs after full-flow.spec.js (the admin account): files run in name order.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

const OUT = process.env.E2E_SHOTS;
const ADDRESS = `delete-me-${Date.now()}@e2e.test`;

test.beforeAll(async () => {
  const anon = client(S.BASE);
  const r = await anon.api('/waitlist', { method: 'POST', body: { email: ADDRESS, niche: 'tech', language: 'ka', over16: true } });
  if (r.status !== 201) throw new Error('could not join the list: ' + r.text);
});

for (const width of [375, 1280]) {
  test(`the admin deletes an address after confirming (${width}px, Georgian)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    await S.logIn(page, { email: 'e2e-admin@example.com' });
    const address = width === 375 ? ADDRESS : `second-${ADDRESS}`;
    if (width !== 375) await client(S.BASE).api('/waitlist', { method: 'POST', body: { email: address, niche: 'tech', language: 'ka', over16: true } });
    await page.goto('/admin.html?tab=waitlist');
    const row = page.locator('.wl-list li', { hasText: address });
    await expect(row).toBeVisible();
    const button = row.locator('[data-wl-delete]');
    await expect(button).toHaveText('წაშლა');
    const box = await button.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (OUT) await page.screenshot({ path: `${OUT}/waitlist-delete-${width}.png` });

    // "No" keeps it
    await button.click();
    await expect(page.getByRole('dialog')).toContainText('ამის დაბრუნება შეუძლებელია');
    await page.getByRole('dialog').getByRole('button').filter({ hasNotText: 'წაშლა' }).first().click();
    await expect(row).toBeVisible();

    await button.click();
    await page.getByRole('dialog').getByRole('button', { name: 'წაშლა' }).click();
    await expect(page.locator('.wl-list li', { hasText: address })).toHaveCount(0);
    const log = page.locator('.wl-deletions');
    await expect(log).toBeVisible();
    await expect(log).not.toContainText(address);
    await ctx.close();
  });
}
