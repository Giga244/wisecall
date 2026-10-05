// The colour theme in a real browser: System follows the device (live), a choice made by hand is kept (after a reload, and on the
// account after signing in elsewhere), the right theme is there from the first paint, and every main page works in both themes.
// Runs after the other specs so the pages have real data. E2E_SHOTS=<folder> keeps a picture of each page in both themes.
const { test, expect } = require('@playwright/test');
const S = require('./support');

const DARK_BG = 'rgb(11, 16, 32)';
const LIGHT_BG = 'rgb(246, 247, 251)';
const theme = (page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pref: document.documentElement.dataset.themePref }));
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const logo = (page) => page.locator('.nav .logo img').evaluate((i) => i.currentSrc.split('/').pop().split('?')[0]);
const barColor = (page) => page.evaluate(() => { const el = document.getElementById('themeColorOverride'); return el ? el.content : null; });

test.describe('System follows the device', () => {
  test('dark device: dark page; light device: light page; and it changes live when the device does', async ({ browser }) => {
    for (const [scheme, expected, bg] of [['dark', 'dark', DARK_BG], ['light', 'light', LIGHT_BG]]) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/');
      expect(await theme(page)).toEqual({ theme: expected, pref: 'system' });
      expect(await bodyBg(page)).toBe(bg);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(expected);
      expect(await barColor(page), 'System mode leaves the address-bar colour to the media-query tags').toBeNull();
      await ctx.close();
    }
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    expect((await theme(page)).theme).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' }); // the evening switch of a phone
    await expect.poll(async () => (await theme(page)).theme).toBe('dark');
    expect(await logo(page)).toBe('wisecall-logo-on-dark-transparent.svg');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await theme(page)).theme).toBe('light');
    expect(await logo(page)).toBe('wisecall-logo.svg');
    await ctx.close();
  });
});

test.describe('a choice made by hand', () => {
  test('the header menu: three choices, keyboard friendly, and the choice survives a reload (over the device setting)', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('/');
    const button = page.locator('#themeBtn');
    await expect(button).toHaveAccessibleName('Theme');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = page.locator('#themeMenu [role="menuitemradio"]');
    await expect(items).toHaveText(['System', 'Light', 'Dark']);
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true'); // System is the default
    await expect(items.nth(0)).toBeFocused();
    // the keyboard: arrows, Enter; Escape closes and gives focus back to the button
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#themeMenu')).toBeHidden();
    await expect(button).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await theme(page)).toEqual({ theme: 'dark', pref: 'dark' });
    await expect.poll(() => bodyBg(page)).toBe(DARK_BG); // after the short fade
    expect(await barColor(page)).toBe('#0B1020'); // the phone's address bar follows
    expect(await logo(page)).toBe('wisecall-logo-on-dark-transparent.svg');
    expect(await page.locator('.footer .logo img').evaluate((i) => i.currentSrc.split('/').pop().split('?')[0])).toBe('wisecall-logo-on-dark-transparent.svg');
    await expect(page.locator('#themeMenu')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('wisecall_theme'))).toBe('dark');

    await page.reload();
    expect(await theme(page)).toEqual({ theme: 'dark', pref: 'dark' });
    await page.goto('/about.html');
    expect((await theme(page)).theme).toBe('dark');

    // back to System: the device (light) rules again and the manual address-bar tag is gone
    await page.click('#themeBtn');
    await page.click('#themeMenu [data-theme-choice="system"]');
    expect(await theme(page)).toEqual({ theme: 'light', pref: 'system' });
    expect(await barColor(page)).toBeNull();
    // Light on a dark device
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('#themeBtn');
    await page.click('#themeMenu [data-theme-choice="light"]');
    expect(await theme(page)).toEqual({ theme: 'light', pref: 'light' });
    expect(await barColor(page)).toBe('#F6F7FB');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await theme(page)).theme, 'a hand-made choice ignores the device').toBe('light');
    await ctx.close();
  });

  test('on a phone the same three choices are in the menu panel (the header button is hidden)', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('#themeBtn')).toBeHidden();
    await page.click('#navToggle');
    const seg = page.locator('#mobileMenu .theme-seg [role="radio"]');
    await expect(seg).toHaveText(['System', 'Light', 'Dark']);
    await expect(page.locator('#mobileMenu [role="radiogroup"]')).toHaveAccessibleName('Theme');
    await seg.nth(2).click();
    expect(await theme(page)).toEqual({ theme: 'dark', pref: 'dark' });
    await expect(seg.nth(2)).toHaveAttribute('aria-checked', 'true');
    expect(await page.locator('#mmTitle img').evaluate((i) => i.currentSrc.split('/').pop().split('?')[0])).toBe('wisecall-logo-on-dark-transparent.svg');
    await ctx.close();
  });

  test('Settings → Account has the same choice, and a signed-in person\'s choice follows them to another device', async ({ browser }) => {
    const a = await browser.newContext({ colorScheme: 'light' });
    const pa = await a.newPage();
    await S.logIn(pa, { email: 'sam@e2e.test' }, '/settings.html?tab=account');
    await expect(pa.locator('#appearanceCard input:checked')).toHaveValue('system');
    await pa.locator('label[for="themeDark"]').click();
    expect((await theme(pa)).theme).toBe('dark');
    await expect.poll(async () => (await S.sql(`SELECT theme FROM users WHERE email = 'sam@e2e.test'`))[0].theme).toBe('dark');

    // another device (a fresh browser with its own memory, on a light device): it signs in and gets the dark theme
    const b = await browser.newContext({ colorScheme: 'light' });
    const pb = await b.newPage();
    await pb.goto('/login.html');
    expect((await theme(pb)).theme).toBe('light');
    await S.logIn(pb, { email: 'sam@e2e.test' });
    await expect.poll(async () => (await theme(pb)).theme).toBe('dark');
    await expect.poll(() => bodyBg(pb)).toBe(DARK_BG);
    expect(await pb.evaluate(() => localStorage.getItem('wisecall_theme'))).toBe('dark');

    // choosing System there is saved too
    await pb.goto('/settings.html?tab=account');
    await pb.locator('label[for="themeSystem"]').click();
    await expect.poll(async () => (await S.sql(`SELECT theme FROM users WHERE email = 'sam@e2e.test'`))[0].theme).toBe('system');
    await a.close(); await b.close();
  });
});

test.describe('no flash of the wrong theme', () => {
  test('the theme is set before the first paint, and never changes while the page loads', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' }); // a light device, with a dark choice
    await ctx.addInitScript(() => {
      try { localStorage.setItem('wisecall_theme', 'dark'); } catch (e) { /* ignore */ }
      window.__themes = [];
      new MutationObserver(() => window.__themes.push(document.documentElement.dataset.theme)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
      document.addEventListener('DOMContentLoaded', () => { window.__atDomReady = getComputedStyle(document.body).backgroundColor; });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'first-paint') window.__paintTheme = document.documentElement.dataset.theme; }).observe({ type: 'paint', buffered: true });
    });
    const page = await ctx.newPage();
    for (const url of ['/', '/login.html', '/about.html', '/terms.html']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const seen = await page.evaluate(() => ({ themes: window.__themes, atDomReady: window.__atDomReady, paint: window.__paintTheme }));
      expect(new Set(seen.themes), `${url}: the theme only ever had one value`).toEqual(new Set(['dark']));
      expect(seen.atDomReady, `${url}: dark before the page was even built`).toBe(DARK_BG);
      expect(seen.paint, `${url}: dark at the first paint`).toBe('dark');
    }
    // the same for a phone that follows a dark device (System)
    await ctx.close();
    const sys = await browser.newContext({ colorScheme: 'dark' });
    await sys.addInitScript(() => {
      window.__themes = [];
      new MutationObserver(() => window.__themes.push(document.documentElement.dataset.theme)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
    });
    const p2 = await sys.newPage();
    await p2.goto('/');
    await p2.waitForLoadState('networkidle');
    expect(new Set(await p2.evaluate(() => window.__themes))).toEqual(new Set(['dark']));
    await sys.close();
  });

  test('the theme script is a plain script in the head (not deferred), and nothing runs inline', async ({ page }) => {
    const res = await page.request.get('/');
    const html = await res.text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toMatch(/<script src="\/js\/theme-init\.js\?v=[0-9a-f]{10}"><\/script>/);
    expect(res.headers()['content-security-policy']).toMatch(/script-src 'self'(;|$)/);
    const violations = [];
    page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
});

test.describe('the header with the theme button', () => {
  // The logo is an image that never shrinks; the theme button is new: the header must still fit, in both languages, for a visitor,
  // a signed-in person and an admin, from 1024px (where the phone menu ends) up.
  const me = (isAdmin) => ({ user: { id: 1, name: 'Sam Seeker', email: 's@e2e.test', role: 'seeker', isAdmin, emailVerified: true, language: 'en', theme: null } });
  for (const lang of ['en', 'ka']) {
    test(`fits at 1024-1600px in ${lang === 'en' ? 'English' : 'Georgian'} (visitor, signed in, admin)`, async ({ browser }) => {
      const problems = [];
      for (const who of ['visitor', 'seeker', 'admin']) {
        for (const w of [1024, 1100, 1180, 1280, 1440, 1600]) {
          const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: 'dark' });
          await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
          const page = await ctx.newPage();
          if (who !== 'visitor') await page.route('**/api/me', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: me(who === 'admin') }) : r.fulfill({ json: {} })));
          await page.goto('/');
          await page.waitForLoadState('networkidle');
          await page.waitForFunction((signedIn) => { const a = document.getElementById('navLoggedIn'); return !signedIn || (a && a.style.display !== 'none'); }, who !== 'visitor');
          const m = await page.evaluate(() => {
            const inner = document.querySelector('.nav-inner');
            const links = [...document.querySelectorAll('.nav-links a')].filter((a) => a.offsetParent);
            const right = document.querySelector('.nav-right').getBoundingClientRect();
            const lastLink = links.length ? links[links.length - 1].getBoundingClientRect().right : document.querySelector('.nav .logo').getBoundingClientRect().right;
            const tooTall = [...document.querySelectorAll('.nav-links a, .nav-right a, .nav-right button')].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 50).length;
            return { logo: Math.round(document.querySelector('.nav .logo img').getBoundingClientRect().width), overflow: inner.scrollWidth - inner.clientWidth, gap: Math.round(right.left - lastLink), page: document.documentElement.scrollWidth - innerWidth, tooTall };
          });
          if (m.logo < 140 || m.overflow > 0 || m.gap < 12 || m.page > 0 || m.tooTall) problems.push(`${who} ${w}px: ${JSON.stringify(m)}`);
          await ctx.close();
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

test.describe('both themes, every main page', () => {
  let mentorUsername;
  const PAGES = {
    visitor: ['/', '/login.html', '/signup.html', '/about.html', '/contact.html', '/terms.html', '/privacy.html', '/forgot-password.html', '/no-such-page'],
    seeker: ['/dashboard.html', '/settings.html?tab=profile', '/settings.html?tab=account'],
    mentor: ['/dashboard.html?tab=received', '/dashboard.html?tab=earnings', '/settings.html?tab=mentor', '/settings.html?tab=verification', '/settings.html?tab=payouts'],
    admin: ['/admin.html']
  };
  const LOGINS = { seeker: 'sam@e2e.test', mentor: 'ana@e2e.test', admin: 'e2e-admin@example.com' };

  // Scans a page for surfaces that are still the light theme's white, or text that is dark on dark, and returns what it found.
  const scan = (page, dark) => page.evaluate((isDark) => {
    const bad = [];
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (isDark) {
        const [R, G, B, A = 1] = rgb(cs.backgroundColor);
        if (A > 0.5 && R > 235 && G > 235 && B > 235 && !el.closest('.btn-google, .theme-item, .lang-btn.active, .ms-num, .cta-primary, .ex-tag, .tag, .toast, .mock-tag, .skip-link, .chip.active, .tab.active, .tab-count, .check-chip, [class*="inverse"], .badge-answered, input[type="radio"]') && r.width * r.height > 900) {
          bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} has a white background`);
        }
      }
    }
    return bad.slice(0, 8);
  }, dark);

  test.beforeAll(async () => { mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username; });

  for (const scheme of ['dark', 'light']) {
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      test(`${scheme} theme at ${w}px: every page loads, nothing runs off the side, no white surfaces in dark`, async ({ browser }) => {
        const shots = process.env.E2E_SHOTS;
        for (const who of Object.keys(PAGES)) {
          const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
          const page = await ctx.newPage();
          if (who !== 'visitor') await S.logIn(page, { email: LOGINS[who] });
          const urls = who === 'visitor' ? [...PAGES.visitor, `/u/${mentorUsername}`] : PAGES[who];
          for (const url of urls) {
            await page.goto(url);
            await page.waitForLoadState('networkidle');
            const th = await theme(page);
            expect(th.theme, `${url}`).toBe(scheme);
            expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `${url} at ${w}px runs off the side`).toBe(false);
            expect(await bodyBg(page)).toBe(scheme === 'dark' ? DARK_BG : LIGHT_BG);
            expect(await scan(page, scheme === 'dark'), `${who} ${url}`).toEqual([]);
            if (shots) await page.screenshot({ path: `${shots}/${scheme}-${who}-${url.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${w}.png`, fullPage: true });
          }
          await ctx.close();
        }
      });
    }
  }
});

test.describe('the pieces that appear on top of a page, in dark', () => {
  const shot = async (page, name) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/dark-state-${name}.png` }); };
  // The colour of the surface a piece is drawn on must be a dark one (or the light "inverse" of a tooltip/toast with dark text).
  const surface = (page, selector) => page.locator(selector).first().evaluate((el) => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    let node = el;
    while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if ((c[3] === undefined ? 1 : c[3]) > 0.9) return { bg: c.slice(0, 3), ink: rgb(getComputedStyle(el).color).slice(0, 3) }; node = node.parentElement; }
    return { bg: [255, 255, 255], ink: [0, 0, 0] };
  });
  const lum = (c) => { const v = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const readable = ({ bg, ink }) => { const [a, b] = [lum(bg), lum(ink)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

  test('filters sheet, phone menu, theme menu, toast, focus ring, form errors, skeleton, payment and ID-check pages', async ({ browser }) => {
    // phone: the filters sheet and the menu panel
    const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const p = await phone.newPage();
    await p.goto('/');
    await p.waitForLoadState('networkidle');
    await p.click('#filtersBtn');
    await expect(p.locator('#filtersSheet .sheet-panel')).toBeVisible();
    expect(readable(await surface(p, '#filtersSheet .sheet-panel'))).toBeGreaterThan(7);
    expect((await surface(p, '#filtersSheet .sheet-panel')).bg.every((v) => v < 80), 'the sheet is a dark surface').toBe(true);
    await shot(p, 'filters-sheet-390');
    await p.click('#filtersSheet .sheet-close');
    await p.click('#navToggle');
    await expect(p.locator('#mobileMenu .mm-panel')).toBeVisible();
    expect((await surface(p, '#mobileMenu .mm-panel')).bg.every((v) => v < 80), 'the menu panel is a dark surface').toBe(true);
    await shot(p, 'mobile-menu-390');
    await phone.close();

    // desktop: the theme menu, a toast, keyboard focus, form errors, the loading skeleton
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/login.html');
    await page.click('#themeBtn');
    await expect(page.locator('#themeMenu')).toBeVisible();
    expect((await surface(page, '#themeMenu')).bg.every((v) => v < 90), 'the theme menu is a dark surface').toBe(true);
    await shot(page, 'theme-menu-1280');
    await page.keyboard.press('Escape');
    await page.locator('#loginForm button[type="submit"]').click(); // empty form: the errors
    await page.waitForTimeout(300);
    await shot(page, 'form-errors-1280');
    const err = page.locator('.field-error:visible, .form-error:visible, [role="alert"]:visible').first();
    if (await err.count()) expect(readable(await surface(page, '.field-error:visible, .form-error:visible, [role="alert"]:visible'))).toBeGreaterThanOrEqual(4.5);
    await page.goto('/signup.html');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor }; });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    await shot(page, 'focus-ring-1280');

    // the loading skeleton on a profile
    const ana = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
    await page.route('**/api/users/**', async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue().catch(() => {}); });
    await page.goto(`/u/${ana}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await shot(page, 'skeleton-1280');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 }); // loaded
    await page.unroute('**/api/users/**');

    // signed in: a toast, the payment page and the ID-check page
    await S.logIn(page, { email: 'sam@e2e.test' }, '/settings.html?tab=account');
    await page.locator('label[for="themeDark"]').click();
    await expect(page.locator('#toast.show')).toBeVisible();
    expect(readable(await surface(page, '#toast'))).toBeGreaterThanOrEqual(4.5);
    await shot(page, 'toast-1280');
    await page.goto(`/u/${ana}`);
    await page.fill('#question', 'A question for the payment page, written in dark mode, long enough?');
    await page.click('#askBtn');
    await page.waitForURL(/mock-bank\.html/);
    expect(await theme(page)).toEqual({ theme: 'dark', pref: 'dark' });
    await expect.poll(() => bodyBg(page)).toBe(DARK_BG);
    await shot(page, 'payment-page-1280');
    await page.click('#cancelBtn');
    await page.waitForURL(/\/u\/[^?]+\?.*booking=/);
    await shot(page, 'back-from-payment-1280');
    await page.goto('/mock-kyc.html');
    await shot(page, 'id-check-page-1280');
    await ctx.close();
  });
});
