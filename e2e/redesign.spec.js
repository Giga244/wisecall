// The redesign's quality gates in a real browser (docs/redesign/): nothing scrolls sideways at 320px, every control is a 44px target on
// a phone, Georgian text never runs out of a button or card, the keyboard focus is a 2px coral outline, reduced motion stops all motion,
// motion never shifts the layout, and the fonts come from this site. (Runs after full-flow.spec.js, so the pages have real data.)
const { test, expect } = require('@playwright/test');
const S = require('./support');

const PUBLIC = ['/', '/live', '/signup.html', '/login.html', '/help.html', '/faq.html', '/about.html', '/how-we-verify.html', '/terms.html', '/contact.html', '/no-such-page'];
const SIGNED_IN = ['/dashboard.html', '/inbox.html', '/settings.html', '/settings.html?tab=account'];
let mentorUsername;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
});

async function open(browser, { width, height = 800, lang = 'en', motion = 'reduce', login } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, isMobile: width < 768, hasTouch: width < 768 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  const page = await ctx.newPage();
  if (login) await S.logIn(page, { email: login });
  return { ctx, page };
}
const url = (lang, p) => (lang === 'ka' ? '/ka' + (p === '/' ? '/' : p) : p);
async function settle(page, p) {
  await page.goto(p);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

test('nothing scrolls sideways at 320px, in English and Georgian, for a visitor and a signed-in person', async ({ browser }) => {
  for (const lang of ['en', 'ka']) {
    const { ctx, page } = await open(browser, { width: 320, height: 700, lang, login: 'sam@e2e.test' });
    for (const p of [...PUBLIC, `/u/${mentorUsername}`, ...SIGNED_IN]) {
      await settle(page, url(lang, p));
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(extra, `${lang} ${p} scrolls ${extra}px sideways`).toBe(0);
    }
    await ctx.close();
  }
});

test('on a phone every control is at least 44px tall (links inside running text excepted, as WCAG allows)', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844, login: 'sam@e2e.test' });
  for (const p of ['/', `/u/${mentorUsername}`, '/live', '/login.html', '/help.html', '/faq.html', '/dashboard.html', '/inbox.html', '/settings.html']) {
    await settle(page, p);
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('a, button, input, select, textarea, summary, [role="button"]')) {
        const s = getComputedStyle(el), b = el.getBoundingClientRect();
        if (s.visibility === 'hidden' || s.display === 'none' || !b.width || !b.height || el.closest('.sr-only, .skip-link, .hp, [aria-hidden="true"]')) continue;
        if (['checkbox', 'radio', 'hidden', 'file'].includes(el.type)) continue; // (a checkbox's label is its target; a file field lies under its button)
        if (el.tagName === 'A' && !el.className && el.closest('p, li') && !el.closest('nav, .footer-col, .breadcrumb')) continue;
        if (b.height < 43.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(b.height)}px`);
      }
      return out;
    });
    expect(small, p).toEqual([]);
  }
  await ctx.close();
});

test('Georgian text fits: no button, chip, tab, badge, card or heading runs out of its box (320, 390 and 768px)', async ({ browser }) => {
  for (const width of [320, 390, 768]) {
    const { ctx, page } = await open(browser, { width, lang: 'ka', login: 'sam@e2e.test' });
    for (const p of [...PUBLIC, `/u/${mentorUsername}`, ...SIGNED_IN]) {
      await settle(page, url('ka', p));
      const over = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.btn, .chip, .tab, .badge, .tag, .lang-btn, .niche-chip, .trust-badge, .meta-chip, .hero-pill, .stage-sticker, .expert-card, .live-card, .settings-card, .booking-card, .faq-q, .price-card, .trust-card, .verify-card, .how-step, h1, h2, h3')) {
          const s = getComputedStyle(el), b = el.getBoundingClientRect();
          if (s.display === 'none' || s.visibility === 'hidden' || !b.width || el.closest('.sr-only, .niche-strip, .example-grid, .tabs, .marquee, .profile-checks, .file-btn')) continue;
          if (el.scrollWidth > el.clientWidth + 1 && s.overflowX === 'visible') out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`);
          else if (b.right > window.innerWidth + 1) out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" ends at ${Math.round(b.right)}`);
        }
        return out;
      });
      expect(over, `${width}px ${p}`).toEqual([]);
    }
    await ctx.close();
  }
});

test('the keyboard focus is a 2px coral outline with an offset (light and dark)', async ({ browser }) => {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await settle(page, '/');
    // (Tab past the skip link to the logo)
    for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('logo'))); i++) await page.keyboard.press('Tab');
    await page.waitForTimeout(150); // (the reduced-motion rule gives every change a 0.01ms transition: read the settled ring)
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor }; });
    expect(ring).toEqual({ style: 'solid', width: '2px', offset: '3px', color: scheme === 'light' ? 'rgb(212, 63, 40)' : 'rgb(255, 111, 89)' });
    await ctx.close();
  }
});

test('with reduced motion nothing moves; with motion the hero rises, the conversation loops, the band scrolls and sections reveal once', async ({ browser }) => {
  const calm = await open(browser, { width: 1280, motion: 'reduce' });
  await settle(calm.page, '/');
  await calm.page.waitForTimeout(500);
  expect(await calm.page.evaluate(() => document.documentElement.classList.contains('motion'))).toBe(false);
  expect(await calm.page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await expect(calm.page.locator('.bubble-a')).toHaveCSS('opacity', '1'); // (the whole conversation is shown, still)
  await calm.ctx.close();

  const lively = await open(browser, { width: 1280, motion: 'no-preference' });
  await settle(lively.page, '/');
  expect(await lively.page.evaluate(() => document.documentElement.classList.contains('motion'))).toBe(true);
  const names = await lively.page.evaluate(() => [...new Set(document.getAnimations().map((a) => a.animationName))]);
  for (const n of ['q-in', 'a-in', 'typing', 'marquee', 'float']) expect(names, n).toContain(n);
  const grid = lively.page.locator('.trust-grid');
  await expect(grid).not.toHaveClass(/is-in/);
  await grid.scrollIntoViewIfNeeded();
  await expect(grid).toHaveClass(/is-in/);
  await lively.ctx.close();
});

test('motion never shifts the layout: no layout shift while the home page, a profile and the live list load (phone and desktop)', async ({ browser }) => {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { ctx, page } = await open(browser, { width, height, motion: 'no-preference' });
    await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    for (const p of ['/', `/u/${mentorUsername}`, '/live']) {
      await settle(page, p);
      await page.waitForTimeout(1200);
      const cls = await page.evaluate(() => window.__cls);
      expect(cls, `${width}px ${p}: ${cls}`).toBeLessThan(0.01);
    }
    await ctx.close();
  }
});

test('the fonts: Bricolage Grotesque for headings, Onest for text, Noto Sans Georgian in Georgian, all from this site', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1280 });
  const fontHosts = new Set();
  page.on('request', (r) => { if (r.resourceType() === 'font') fontHosts.add(new URL(r.url()).host); });
  await settle(page, '/');
  expect(await page.evaluate(() => document.fonts.check('800 48px "Bricolage Grotesque"') && document.fonts.check('400 16px "Onest"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily)).toMatch(/^"Bricolage Grotesque"/);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^Onest/);
  await settle(page, '/ka/');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily)).toMatch(/^"Noto Sans Georgian"/);
  expect(await page.evaluate(() => document.fonts.check('800 40px "Noto Sans Georgian"', 'ა'))).toBe(true);
  expect([...fontHosts]).toEqual(['localhost:4620']);
  await ctx.close();
});
