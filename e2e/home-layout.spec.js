// The home page and Browse at every size (phones, a tablet, desktops), in English and Georgian: the footer's link groups, full rows of
// field tiles on Browse until "See all" with no name broken inside a word, and a "Back to top" button that never covers anything.
// (The new home page's own sections: e2e/new-home.spec.js and e2e/new-home-prelaunch.spec.js.) Runs its own server before launch
// (live sessions off).
const { test, expect } = require('@playwright/test');
const { startServer } = require('../tests/helpers');

let srv;
test.beforeAll(async () => { srv = await startServer(4623, { LAUNCH_MODE: 'prelaunch', LIVE_SESSIONS: 'off' }); });
test.afterAll(() => { if (srv) srv.proc.kill(); });

async function open(browser, width, lang = 'en', height = 900, where = '/') {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  const page = await ctx.newPage();
  await page.goto(`${srv.base}${lang === 'ka' ? '/ka' : ''}${where}`);
  await page.waitForLoadState('networkidle');
  if (where === '/experts.html') await expect(page.locator('#nicheStrip .field-tile').first()).toBeVisible();
  else await expect(page.locator('#heroWait .waitlist-form')).toBeVisible();
  return { ctx, page };
}

test('the footer on a phone: the link groups two by two (English and Georgian)', async ({ browser }) => {
  for (const [width, lang] of [[375, 'en'], [375, 'ka'], [390, 'ka']]) {
    const { ctx, page } = await open(browser, width, lang);
    const cols = await page.evaluate(() => [...document.querySelectorAll('footer .footer-col')].map((c) => {
      const r = c.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right) };
    }));
    expect(cols.length).toBe(3);
    expect(cols[0].top, `${width}px ${lang}: Product and Company side by side`).toBe(cols[1].top);
    expect(cols[1].left).toBeGreaterThan(cols[0].right);
    expect(cols[2].left, 'Legal under Product').toBe(cols[0].left);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await ctx.close();
  }
});

// The visible tiles: how many, in how many columns, how tall, and every name that breaks inside a word or runs out of its tile.
const tiles = (page) => page.evaluate(() => {
  const shown = [...document.querySelectorAll('#nicheStrip .field-tile')].filter((a) => a.offsetWidth);
  const broken = [];
  for (const a of shown) {
    const text = a.querySelector('span:last-child').firstChild;
    let at = 0;
    for (const word of text.textContent.split(' ')) {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + word.length);
      at += word.length + 1;
      if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) broken.push(word);
    }
    if (a.scrollWidth > a.clientWidth + 1) broken.push(`${text.textContent} (overflows)`);
  }
  return {
    count: shown.length,
    columns: new Set(shown.map((a) => Math.round(a.getBoundingClientRect().left))).size,
    minHeight: Math.min(...shown.map((a) => a.getBoundingClientRect().height)),
    broken,
    sideways: document.documentElement.scrollWidth - window.innerWidth
  };
});

for (const [width, count, columns, height] of [[375, 6, 2, 56], [390, 6, 2, 56], [768, 9, 3, 56], [1024, 8, 4, 64], [1440, 10, 5, 64], [1920, 10, 5, 64]]) {
  test(`Browse's fields at ${width}px: ${count} tiles in ${columns} columns, then all 16; no word broken (English and Georgian)`, async ({ browser }) => {
    for (const lang of ['en', 'ka']) {
      const { ctx, page } = await open(browser, width, lang, 900, '/experts.html');
      const closed = await tiles(page);
      expect(closed.count, lang).toBe(count);
      expect(closed.columns, lang).toBe(columns);
      expect(closed.minHeight, lang).toBeGreaterThanOrEqual(height - 0.5);
      expect(closed.broken, lang).toEqual([]);
      expect(closed.sideways, lang).toBeLessThanOrEqual(0);
      const more = page.locator('#fieldsMore');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(await more.evaluate((b) => getComputedStyle(b).whiteSpace)).toBe('nowrap');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(more).toHaveText(lang === 'ka' ? 'ნაკლების ჩვენება' : 'Show fewer');
      const all = await tiles(page);
      expect(all.count, lang).toBe(16);
      expect(all.broken, lang).toEqual([]);
      await more.click();
      await expect(more).toHaveText(lang === 'ka' ? 'ყველა 16 სფეროს ნახვა' : 'See all 16 fields');
      expect((await tiles(page)).count, lang).toBe(count);
      await ctx.close();
    }
  });
}

test('"Back to top" never covers a field, a button or text, and hides while someone types (phone and desktop)', async ({ browser }) => {
  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1440, 900]]) {
    const { ctx, page } = await open(browser, width, 'en', height);
    const btn = page.locator('.back-to-top');
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const covered = [];
    for (let y = 0; y < total; y += Math.round(height / 3)) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(80);
      const hit = await page.evaluate(() => {
        const b = document.querySelector('.back-to-top');
        if (!b || b.hidden || b.classList.contains('is-aside')) return null;
        const r = b.getBoundingClientRect();
        if (r.bottom > window.innerHeight) return 'below the screen';
        for (const el of document.querySelectorAll('input, select, textarea, button, a, p, h1, h2, h3, li, label, .field-tile, .wl-card')) {
          if (el === b || b.contains(el) || !el.offsetWidth) continue;
          const o = el.getBoundingClientRect();
          // (an overlap of a pixel or two at the edge is not covering anything)
          if (Math.min(o.right, r.right) - Math.max(o.left, r.left) > 2 && Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top) > 2) return `${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 30)}"`;
        }
        return null;
      });
      if (hit) covered.push(`${width}px at ${y}: ${hit}`);
    }
    expect(covered).toEqual([]);
    // typing in a field hides it; leaving the field brings it back (the page's one form is in the hero, where the button is never shown:
    // its email is focused without scrolling up to it)
    const email = page.locator('#heroWait input[type=email]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // (it comes after one and a half screens: the short home page on a tall desktop screen may never get that far)
    if (await page.evaluate(() => window.scrollY < window.innerHeight * 1.5)) { await expect(btn).toHaveJSProperty('hidden', true); await ctx.close(); continue; }
    await expect(btn).toHaveJSProperty('hidden', false);
    await email.evaluate((el) => el.focus({ preventScroll: true }));
    await expect(btn).toHaveJSProperty('hidden', true);
    await email.evaluate((el) => el.blur());
    await expect(btn).toHaveJSProperty('hidden', false);
    await ctx.close();
  }
});
