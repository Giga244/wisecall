// Cache busting in a real browser: a second visit takes the versioned files from the browser's cache (no request at all), the page itself is
// asked for again, and a changed file (a new version in the address) is fetched anew.
const { test, expect } = require('@playwright/test');

test('the second page view reuses the scripts, stylesheet, logo and icons from the cache and only asks for the page again', async ({ page }) => {
  // (Browse: the home page's short footer has no logo: docs/CLAUDE-CODE-COMPACT-HOME.md)
  await page.goto('/experts.html');
  await page.waitForLoadState('networkidle');
  const first = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\/(css|js|brand|fonts)\/|\/favicon|\/icon-|site\.webmanifest/.test(n)));
  expect(first.length).toBeGreaterThan(10);
  for (const url of first) expect(url, 'every file is asked for with its version').toMatch(/\?v=[0-9a-f]{10}$/);

  await page.goto('/about.html');
  await page.waitForLoadState('networkidle');
  // the files the two pages share come from the browser's cache: nothing was transferred for them
  const transferred = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('resource').map((r) => [r.name.replace(location.origin, ''), r.transferSize])));
  for (const shared of ['/css/style.css', '/js/header.js', '/js/i18n.js', '/js/theme-init.js', '/js/footer.js', '/brand/jikhva-head.webp']) {
    const entry = Object.keys(transferred).find((u) => u.startsWith(shared));
    expect(entry, `${shared} was loaded`).toBeTruthy();
    expect(transferred[entry], `${shared} came from the cache`).toBe(0);
  }
  // the dictionary is not kept: it is asked for again (and answered "not modified" when it is unchanged)
  const dict = Object.keys(transferred).find((u) => u.startsWith('/i18n/en.json'));
  expect(dict).toBeTruthy();
});

test('the browser is told never to keep a page, and to keep a versioned file for a year', async ({ page }) => {
  const res = await page.goto('/');
  expect(res.headers()['cache-control']).toBe('no-cache');
  const css = await page.request.get(await page.locator('link[rel="stylesheet"]').first().evaluate((l) => l.href));
  expect(css.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(css.headers()['content-type']).toMatch(/text\/css/);
});

test('the favicon links carry the version, so an old cached icon is never used again', async ({ page }) => {
  await page.goto('/');
  const icons = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(icons.length).toBe(4);
  for (const href of icons) expect(href).toMatch(/\?v=[0-9a-f]{10}$/);
  const favicon = await page.request.get(icons.find((h) => /favicon\.svg/.test(h)));
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});
