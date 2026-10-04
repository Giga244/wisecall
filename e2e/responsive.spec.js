// Phones, tablets and desktop: every page at 360, 390, 430, 768, 834, 1024 and 1280 pixels wide, as each kind of visitor.
//   - nothing sticks out past the edge (no sideways scroll; the development overflow logger says nothing)
//   - the header: a menu button below 1024px, the links on one line from 1024px
//   - everything you tap is at least 44px, text fields use 16px text (so a phone does not zoom in)
//   - the phone patterns work: the menu panel, the Filters sheet, the question bar and sheet, the answer carousel
// Runs after the other specs so the pages have real data.
const { test, expect } = require('@playwright/test');
const S = require('./support');

const WIDTHS = [360, 390, 430, 768, 834, 1024, 1280];
const PHONES = WIDTHS.filter((w) => w < 640);
const heightFor = (w) => (w < 500 ? 844 : w < 1000 ? 1024 : 800);

let mentorUsername;
test.beforeAll(async () => { mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username; });

function watch(page) {
  const layout = [];
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[layout]')) layout.push(m.text()); });
  return layout;
}

async function newPage(browser, width, { login, lang = 'en' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: heightFor(width) }, isMobile: width < 640, hasTouch: width < 1100, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const layout = watch(page);
  if (login) await S.logIn(page, { email: login });
  return { ctx, page, layout };
}

const sideways = (page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));

// ---- Nothing sticks out -------------------------------------------------------------------------------------
const PAGES = [
  ['visitor', null, ['/', () => `/u/${mentorUsername}`, '/signup.html', '/login.html', '/forgot-password.html', '/contact.html', '/about.html', '/terms.html', '/privacy.html', '/no-such-page']],
  ['seeker', 'sam@e2e.test', ['/dashboard.html', '/settings.html?tab=profile', '/settings.html?tab=account']],
  ['mentor', 'ana@e2e.test', ['/dashboard.html', '/settings.html?tab=mentor', '/settings.html?tab=verification', '/settings.html?tab=payouts']],
  ['admin', 'e2e-admin@example.com', ['/admin.html']]
];
for (const w of WIDTHS) {
  test(`no page is wider than a ${w}px screen`, async ({ browser }) => {
    for (const lang of w === 390 ? ['en', 'ka'] : ['en']) {
      for (const [who, login, urls] of PAGES) {
        const { ctx, page, layout } = await newPage(browser, w, { login, lang });
        for (const u of urls) {
          const url = typeof u === 'function' ? u() : u;
          await page.goto(url);
          await page.waitForLoadState('networkidle');
          if (who === 'admin') {
            for (const tab of ['mentors', 'bookings', 'queue', 'interviews', 'payouts', 'waitlist']) {
              await page.click(`#adminTabs [data-tab="${tab}"]`);
              await page.waitForLoadState('networkidle');
              const s = await sideways(page);
              expect(s.page, `${lang} admin ${tab} @${w}`).toBeLessThanOrEqual(s.window);
            }
          }
          const s = await sideways(page);
          expect(s.page, `${lang} ${who} ${url} @${w}: the page is ${s.page}px wide`).toBeLessThanOrEqual(s.window);
        }
        await page.waitForTimeout(600);
        expect(layout, `${lang} ${who} @${w}: elements wider than the screen`).toEqual([]);
        await ctx.close();
      }
    }
  });
}

// ---- The header ---------------------------------------------------------------------------------------------
for (const w of WIDTHS) {
  test(`header at ${w}px: ${w < 1024 ? 'a menu button, no wrapped links' : 'the links on one line'}`, async ({ browser }) => {
    for (const login of [null, 'sam@e2e.test', 'e2e-admin@example.com']) {
      const { ctx, page } = await newPage(browser, w, { login });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const toggle = page.locator('#navToggle');
      const links = page.locator('.nav-links');
      if (w < 1024) {
        await expect(toggle).toBeVisible();
        await expect(links).toBeHidden();
      } else {
        await expect(toggle).toBeHidden();
        await expect(links).toBeVisible();
        // every visible link is one line (no wrapping) and the bar is one row
        const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.nav-links a, .nav-actions .btn')).filter((a) => a.offsetParent !== null).map((a) => a.getBoundingClientRect().height));
        expect(Math.max(...rows), `header @${w} (${login || 'signed out'}): something wraps`).toBeLessThanOrEqual(60);
        const bar = await page.evaluate(() => document.querySelector('.nav-inner').getBoundingClientRect().height);
        expect(bar, `header @${w} is a single row`).toBeLessThanOrEqual(90);
      }
      await ctx.close();
    }
  });
}

// ---- Tap targets and text size ------------------------------------------------------------------------------
for (const w of [360, 390, 430, 768, 834]) {
  test(`tap targets are 44px and fields use 16px text at ${w}px`, async ({ browser }) => {
    const found = [];
    for (const [who, login, urls] of PAGES) {
      const { ctx, page } = await newPage(browser, w, { login });
      for (const u of urls) {
        const url = typeof u === 'function' ? u() : u;
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const small = await page.evaluate(() => {
          const out = [];
          const inline = (el) => el.tagName === 'A' && el.closest('p, li:not(.faq-item), .consent, .legal, .hint, .small, .muted, dd, label') && !el.classList.contains('btn') && !el.closest('.footer-col, .mm-links, .nav-links, .breadcrumb, .niche-strip');
          document.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, summary, [role=tab]').forEach((el) => {
            if (el.closest('[hidden], .hp') || el.closest('.sheet[hidden], .mobile-menu[hidden]')) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (el.classList.contains('skip-link')) return;
            if (inline(el)) return;
            const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 24)}"`;
            if (r.height < 43.5 || (r.width < 43.5 && !['a'].includes(el.tagName.toLowerCase()))) out.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}`);
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && parseFloat(cs.fontSize) < 16) out.push(`${name} has ${cs.fontSize} text`);
          });
          return out;
        });
        for (const s of small) found.push(`${who} ${url}: ${s}`);
      }
      await ctx.close();
    }
    expect([...new Set(found)], `too small at ${w}px`).toEqual([]);
  });
}

// ---- Phone patterns -----------------------------------------------------------------------------------------
test('the menu panel: opens, holds focus, locks the page, closes on Esc, a link and the backdrop', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390, { login: 'sam@e2e.test' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const toggle = page.locator('#navToggle');
  const menu = page.locator('#mobileMenu');
  await expect(menu).toBeHidden();

  await toggle.click();
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mmLoggedIn')).toBeVisible(); // signed in: Dashboard / Settings / Log out
  await expect(page.locator('#mmLoggedOut')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden'); // the page cannot scroll behind it
  expect(await page.evaluate(() => document.querySelector('main').inert)).toBe(true);
  expect(await page.evaluate(() => document.activeElement.classList.contains('mm-close'))).toBe(true);

  // Tab stays inside the panel
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('.mm-panel'))), 'focus left the menu').toBe(true);
  }
  // big tap targets
  const heights = await page.evaluate(() => Array.from(document.querySelectorAll('.mm-panel a, .mm-panel button')).filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => document.activeElement.id), 'focus returns to the menu button').toBe('navToggle');
  expect(await page.evaluate(() => document.querySelector('main').inert)).toBe(false);

  // choosing a link closes it
  await toggle.click();
  await page.locator('.mm-links a', { hasText: /how it works/i }).click();
  await expect(menu).toBeHidden();
  // the backdrop closes it
  await toggle.click();
  // (on a phone the open panel covers the whole screen, so the backdrop is only tappable beside it on wider screens or while the panel
  // slides in; a tap at a fixed point raced the animation. The backdrop's own click is what closes it.)
  await page.locator('.mm-backdrop').dispatchEvent('click');
  await expect(menu).toBeHidden();
  // the language switch is in the panel and works
  await toggle.click();
  await page.locator('.mm-panel .lang-btn[data-lang="ka"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ka');
  await ctx.close();
});

test('the header hides while reading down a phone and returns on the way up; not on a tablet', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const header = page.locator('#siteHeader');
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(300);
  await expect(header).toHaveClass(/nav-hidden/);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(300);
  await expect(header).not.toHaveClass(/nav-hidden/);
  await ctx.close();

  const tablet = await newPage(browser, 768);
  await tablet.page.goto('/');
  await tablet.page.waitForLoadState('networkidle');
  await tablet.page.evaluate(() => window.scrollTo(0, 1500));
  await tablet.page.waitForTimeout(300);
  await expect(tablet.page.locator('#siteHeader')).not.toHaveClass(/nav-hidden/);
  await tablet.ctx.close();
});

test('Browse on a phone: the Filters sheet holds sort and fields, and the list follows', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#filtersBtn')).toBeVisible();
  await expect(page.locator('#sortSelect')).toBeHidden(); // moved into the sheet
  const cards = await page.locator('.expert-card').count();
  expect(cards).toBeGreaterThan(0);
  const columns = await page.evaluate(() => new Set(Array.from(document.querySelectorAll('.expert-card')).map((c) => Math.round(c.getBoundingClientRect().left))).size);
  expect(columns, 'one card per row on a phone').toBe(1);
  // the price and the Ask button are in every card
  await expect(page.locator('.expert-card').first().locator('.price')).toBeVisible();
  await expect(page.locator('.expert-card').first().locator('.btn')).toBeVisible();

  await page.locator('#filtersBtn').click();
  const sheet = page.locator('#filtersSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#sortSelect')).toBeVisible();
  await sheet.locator('.chip[data-niche="law"]').click();
  await expect(page.locator('#filtersApply')).toContainText('1'); // "Show 1 expert"
  await expect(page.locator('#filtersCount')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('.expert-card')).toHaveCount(1);
  await expect(page.locator('#resultCount')).toContainText('1');
  await page.locator('#filtersBtn').click();
  await page.locator('#filtersClear').click();
  await page.locator('#filtersApply').click();
  await expect(page.locator('.expert-card')).toHaveCount(cards);
  await ctx.close();

  // a tablet shows the controls on the page: two cards across, no Filters button
  const tablet = await newPage(browser, 768);
  await tablet.page.goto('/');
  await tablet.page.waitForLoadState('networkidle');
  await expect(tablet.page.locator('#filtersBtn')).toBeHidden();
  await expect(tablet.page.locator('#sortSelect')).toBeVisible();
  const across = await tablet.page.evaluate(() => new Set(Array.from(document.querySelectorAll('.expert-card')).map((c) => Math.round(c.getBoundingClientRect().left))).size);
  expect(across).toBe(2);
  await tablet.ctx.close();
});

test('the expert profile on a phone: a bar with the price and Ask, opening the question sheet', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390, { login: 'sam@e2e.test' });
  await page.goto(`/u/${mentorUsername}`);
  await page.waitForLoadState('networkidle');
  const bar = page.locator('.ask-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('30');
  const box = await bar.boundingBox();
  expect(Math.round(box.y + box.height), 'the bar is fixed to the bottom of the screen').toBe(844);
  await page.evaluate(() => window.scrollTo(0, 800));
  expect(Math.round((await bar.boundingBox()).y + (await bar.boundingBox()).height), 'and stays there while scrolling').toBe(844);

  await bar.locator('#askOpen').click();
  const sheet = page.locator('#askSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#question')).toBeVisible();
  await expect(sheet.locator('#askBtn')).toContainText('30');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#question')).fontSize)).toBe('16px');
  await sheet.locator('#question').fill('A question typed in the sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await bar.locator('#askOpen').click();
  await expect(sheet.locator('#question')).toHaveValue('A question typed in the sheet'); // what was typed is kept
  await ctx.close();

  // a tablet shows the panel next to / under the profile, and no bar
  const tablet = await newPage(browser, 768, { login: 'sam@e2e.test' });
  await tablet.page.goto(`/u/${mentorUsername}`);
  await tablet.page.waitForLoadState('networkidle');
  await expect(tablet.page.locator('.ask-bar')).toBeHidden();
  await expect(tablet.page.locator('.ask-side #question')).toBeVisible();
  await tablet.ctx.close();
});

test('the example answers swipe on a phone, with dots that follow', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const grid = page.locator('.example-grid');
  await grid.scrollIntoViewIfNeeded();
  const dots = page.locator('.ex-dots button');
  await expect(dots).toHaveCount(3);
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
  await dots.nth(2).click();
  await expect(dots.nth(2)).toHaveAttribute('aria-current', 'true', { timeout: 5000 });
  expect((await dots.first().boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await grid.getAttribute('tabindex'), 'the scrolling row can be reached with the keyboard').toBe('0');
  await ctx.close();

  const tablet = await newPage(browser, 768);
  await tablet.page.goto('/');
  await tablet.page.waitForLoadState('networkidle');
  await expect(tablet.page.locator('.ex-dots')).toBeHidden();
  expect(await tablet.page.locator('.example-grid').getAttribute('tabindex')).toBeNull();
  await tablet.ctx.close();
});

test('card groups fill their rows: no lone card on a tablet', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 768);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const rows = async (sel) => page.evaluate((s) => {
    const items = Array.from(document.querySelectorAll(s));
    const byRow = new Map();
    items.forEach((el) => { const top = Math.round(el.getBoundingClientRect().top / 10); byRow.set(top, (byRow.get(top) || []).concat(el.getBoundingClientRect().width)); });
    return Array.from(byRow.values()).map((r) => r.length);
  }, sel);
  expect(await rows('.trust-card'), 'Why trust: 2 + 2').toEqual([2, 2]);
  expect(await rows('.verify-card'), 'How we verify: 3 + 2').toEqual([3, 2]);
  expect(await rows('.example-card'), 'Examples: 1 + 2').toEqual([1, 2]);
  expect(await rows('.how-step'), 'How it works: stacked').toEqual([1, 1, 1]);
  await ctx.close();
});

test('the three application steps stack into one column and a question\'s progress runs down the card on a phone', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, 390, { login: 'ana@e2e.test' });
  await page.goto('/settings.html?tab=verification');
  await page.waitForLoadState('networkidle');
  const xs = await page.evaluate(() => Array.from(document.querySelectorAll('.ap-stepper-num')).map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(xs.length).toBe(3);
  expect(new Set(xs).size, 'Identity, Experience and Review form one column').toBe(1);
  await page.goto('/dashboard.html');
  await page.waitForLoadState('networkidle');
  await page.click('#tab-received');
  const dots = await page.evaluate(() => { const l = document.querySelector('.timeline'); return l ? Array.from(l.querySelectorAll('.tl-dot')).map((d) => Math.round(d.getBoundingClientRect().left)) : []; });
  if (dots.length) expect(new Set(dots).size, 'the progress dots form one column').toBe(1);
  await ctx.close();
});
