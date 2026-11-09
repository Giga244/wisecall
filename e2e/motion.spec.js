// Moving between pages and within them, in a real browser: a page change is a view transition (the header and footer stay; nothing
// moves with reduced motion), a link the pointer rests on is fetched ahead and the page counts itself once it is opened, and the
// home page's answers fade in and out (at once with reduced motion). Runs after full-flow.spec.js (Ana is a listed mentor).
const { test, expect } = require('@playwright/test');

async function open(browser, motion, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion });
  // (did the new page arrive with a view transition?)
  await ctx.addInitScript(() => { window.__vt = null; window.addEventListener('pagereveal', (e) => { window.__vt = Boolean(e.viewTransition); }); });
  return { ctx, page: await ctx.newPage() };
}

test('a page change is a view transition, with the header and footer standing still; with reduced motion an instant switch', async ({ browser }) => {
  for (const [motion, expected] of [['no-preference', true], ['reduce', false]]) {
    const { ctx, page } = await open(browser, motion);
    await page.goto('/experts.html');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => [getComputedStyle(document.getElementById('siteHeader')).viewTransitionName, getComputedStyle(document.querySelector('.footer')).viewTransitionName]))
      .toEqual(['site-header', 'site-footer']);
    await page.locator('#expertGrid a.expert-card').first().click();
    await page.waitForURL(/\/u\//);
    await expect.poll(() => page.evaluate(() => window.__vt), `${motion}: the new page arrived with a view transition`).toBe(expected);
    await ctx.close();
  }
});

test('a link the pointer rests on is fetched ahead (not counted then); the page counts itself once it is opened', async ({ browser }) => {
  const { ctx, page } = await open(browser, 'reduce');
  const ahead = [];
  const counted = [];
  page.on('request', (r) => {
    if (r.headers()['sec-purpose']) ahead.push(r.url());
    if (r.url().endsWith('/api/stats/pageview')) counted.push(JSON.parse(r.postData()).path);
  });
  await page.goto('/experts.html');
  await page.waitForLoadState('networkidle');
  const card = page.locator('#expertGrid a.expert-card').first();
  const href = await card.getAttribute('href');
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await expect.poll(() => ahead.some((u) => u.endsWith(href)), 'fetched ahead on hover').toBe(true);
  await card.click();
  await page.waitForURL(/\/u\//);
  await expect.poll(() => counted, 'counted once opened').toEqual([href]);
  await ctx.close();
});

// (the home page has no questions of its own any more: they are on the FAQ page, docs/CLAUDE-CODE-NEW-HOME.md)
test('the FAQ page\'s answers open and close (and the page arrives without a hard cut from the home page)', async ({ browser }) => {
  const { ctx, page } = await open(browser, 'no-preference');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('footer a[href$="/faq.html"]').first().click(); // (the FAQ link in the footer)
  await page.waitForURL(/\/faq\.html$/);
  await expect.poll(() => page.evaluate(() => window.__vt)).toBe(true);
  const item = page.locator('details.faq-item').first();
  await item.locator('summary').click();
  await expect(item).toHaveAttribute('open', '');
  await expect(item.locator('p')).toBeVisible();
  await item.locator('summary').click();
  await expect(item).not.toHaveAttribute('open', '');
  await ctx.close();
});
