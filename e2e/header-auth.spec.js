// The header is right from its first frame: signed in or signed out (and an admin's Admin button), on a desktop and a phone, in English
// and Georgian, light and dark. The sign-in check (/api/me) is held back to see the first frame; once it answers nothing in the header
// moves (the same boxes, no layout shift). A hint that is wrong changes the header once, with a fade, and is corrected.
// Runs after full-flow.spec.js (Sam, and the admin, have accounts).
const { test, expect } = require('@playwright/test');
const S = require('./support');

// Hold back every /api/me until release().
async function holdMe(page) {
  const waiting = [];
  let go = false;
  let arrive;
  const arrived = new Promise((resolve) => { arrive = resolve; });
  await page.route('**/api/me', (route) => { if (go) return route.continue(); waiting.push(route); arrive(); return undefined; });
  return { arrived, release: async () => { await arrived; go = true; for (const r of waiting.splice(0)) await r.continue().catch(() => {}); } };
}
// What the header shows, and where each of its pieces sits.
const look = (page) => page.evaluate(() => {
  const shown = (id) => { const e = document.getElementById(id); return Boolean(e) && getComputedStyle(e).display !== 'none'; };
  const boxes = [...document.querySelectorAll('#siteHeader .logo, #siteHeader .nav-links a, #siteHeader .lang-toggle, #siteHeader .theme-btn, #siteHeader .nav-actions > *, #navToggle')]
    .filter((e) => e.offsetWidth).map((e) => { const r = e.getBoundingClientRect(); return `${e.className || e.tagName}@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
  return {
    signedIn: document.getElementById('siteHeader').classList.contains('is-authed'),
    header: shown('navLoggedIn') ? 'in' : shown('navLoggedOut') ? 'out' : '?',
    menu: shown('mmLoggedIn') ? 'in' : shown('mmLoggedOut') ? 'out' : '?',
    admin: document.querySelectorAll('#siteHeader .admin-link, #mobileMenu .admin-link').length,
    boxes
  };
});
const hintOf = async (ctx) => ((await ctx.cookies()).find((c) => c.name === 'wc_authed') || {}).value || '';

async function firstFrame(browser, { width, lang, scheme, login, path }) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  const page = await ctx.newPage();
  if (login) await S.logIn(page, { email: login });
  await page.addInitScript(() => {
    window.__headerShift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput && (e.sources || []).some((s) => s.node && s.node.closest && s.node.closest('#siteHeader'))) window.__headerShift += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const me = await holdMe(page);
  await page.goto((lang === 'ka' ? '/ka' : '') + path);
  await me.arrived;
  const before = await look(page);
  await me.release();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const after = await look(page);
  const shift = await page.evaluate(() => window.__headerShift);
  return { ctx, page, before, after, shift };
}

const VARIANTS = [
  { width: 1280, lang: 'en', scheme: 'light', path: '/' },
  { width: 1280, lang: 'ka', scheme: 'dark', path: '/dashboard.html' },
  { width: 1100, lang: 'ka', scheme: 'light', path: '/faq.html' },
  { width: 390, lang: 'ka', scheme: 'dark', path: '/' },
  { width: 390, lang: 'en', scheme: 'light', path: '/inbox.html' }
];

test('signed in: the signed-in header (and menu panel) from the first frame, nothing moves after the check', async ({ browser }) => {
  for (const v of VARIANTS) {
    const { ctx, before, after, shift } = await firstFrame(browser, { ...v, login: 'sam@e2e.test' });
    const where = `${v.width}px ${v.lang} ${v.scheme} ${v.path}`;
    expect(before.signedIn, where).toBe(true);
    expect(before.menu, where).toBe('in');
    if (v.width >= 1024) expect(before.header, where).toBe('in');
    expect(after.boxes, `${where}: the header after the check`).toEqual(before.boxes);
    expect(shift, `${where}: no layout shift in the header`).toBe(0);
    await ctx.close();
  }
});

test('signed out: the signed-out header from the first frame, nothing moves after the check', async ({ browser }) => {
  for (const v of VARIANTS.filter((x) => !/dashboard|inbox/.test(x.path))) {
    const { ctx, before, after, shift } = await firstFrame(browser, v);
    const where = `${v.width}px ${v.lang} ${v.scheme}`;
    expect(before.signedIn, where).toBe(false);
    expect(before.menu, where).toBe('out');
    expect(after.boxes, where).toEqual(before.boxes);
    expect(shift, where).toBe(0);
    await ctx.close();
  }
});

test('an admin: the Admin button is there from the first frame too', async ({ browser }) => {
  const { ctx, before, after, shift } = await firstFrame(browser, { width: 1280, lang: 'en', scheme: 'light', path: '/', login: 'e2e-admin@example.com' });
  expect(await hintOf(ctx)).toBe('admin');
  expect(before.admin).toBe(2); // (the header and the menu panel)
  expect(after.boxes).toEqual(before.boxes);
  expect(shift).toBe(0);
  await ctx.close();
});

test('a hint with no session behind it: drawn signed in, then signed out with a fade, and the hint is gone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'wc_authed', value: '1', url: 'http://localhost:4620' }]);
  const page = await ctx.newPage();
  const me = await holdMe(page);
  await page.goto('/');
  await me.arrived;
  expect((await look(page)).signedIn).toBe(true);
  await me.release();
  await expect(page.locator('#siteHeader')).not.toHaveClass(/is-authed/);
  await expect(page.locator('#siteHeader')).toHaveClass(/auth-swap/); // (the fade)
  expect((await look(page)).header).toBe('out');
  await expect.poll(() => hintOf(ctx)).toBe('');
  await ctx.close();
});

test('a sign-in from before the hint existed: the header corrects itself once, and the next page is right from its first frame', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'sam@e2e.test' });
  await ctx.clearCookies({ name: 'wc_authed' });
  await page.goto('/');
  await expect(page.locator('#siteHeader')).toHaveClass(/is-authed/);
  await expect.poll(() => hintOf(ctx)).toBe('1');
  const me = await holdMe(page);
  await page.goto('/faq.html');
  await me.arrived;
  expect((await look(page)).signedIn).toBe(true);
  await me.release();
  // and signing out takes the hint away
  await page.locator('#logoutBtn').click();
  await page.waitForURL(/\/index\.html$/);
  await expect.poll(() => hintOf(ctx)).toBe('');
  await expect(page.locator('#siteHeader')).not.toHaveClass(/is-authed/);
  await ctx.close();
});
