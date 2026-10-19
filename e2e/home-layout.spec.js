// The home page at every size (phones, a tablet, a small laptop, desktops), in English and Georgian: short (one rhythm between the
// sections, half its old height, the links to what moved away), full rows of field tiles until "See all", no name broken inside a word,
// one title for the "Wisecall opens soon" card, its size and columns, a sign-up that does not move the page, and a "Back to top" button
// that never covers anything. Runs its own server before launch (live sessions off).
const { test, expect } = require('@playwright/test');
const { startServer } = require('../tests/helpers');

let srv;
test.beforeAll(async () => { srv = await startServer(4623, { LAUNCH_MODE: 'prelaunch', LIVE_SESSIONS: 'off' }); });
test.afterAll(() => { if (srv) srv.proc.kill(); });

async function open(browser, width, lang = 'en', height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  const page = await ctx.newPage();
  await page.goto(`${srv.base}${lang === 'ka' ? '/ka/' : '/'}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#nicheStrip .field-tile').first()).toBeVisible();
  return { ctx, page };
}

test('the home page is short: one rhythm between the sections, and at most half its old height (390 and 1440px)', async ({ browser }) => {
  // (before: 12849px at 390 and 8220px at 1440, English, before launch; docs/redesign/home-simple/before/heights.txt)
  for (const [width, rhythm, maxHeight] of [[390, 48, 6425], [768, 64, null], [1440, 80, 4110]]) {
    const { ctx, page } = await open(browser, width);
    const m = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      hero: parseFloat(getComputedStyle(document.querySelector('.hero')).paddingBottom),
      tops: ['.experts', '.how', '.faq'].map((s) => parseFloat(getComputedStyle(document.querySelector(s)).paddingTop)),
      // (before launch there is no last call to action: the questions end the page, with the same space under them)
      lastWord: document.querySelectorAll('.cta-band').length,
      faqBottom: parseFloat(getComputedStyle(document.querySelector('.faq')).paddingBottom),
      sideways: document.documentElement.scrollWidth - window.innerWidth
    }));
    expect([m.hero, ...m.tops, m.faqBottom], `${width}px: the space between the sections`).toEqual(Array(5).fill(rhythm));
    expect(m.lastWord, 'no "Be first in line" before launch: the waiting-list card already asks').toBe(0);
    if (maxHeight) expect(m.height, `${width}px: the page height`).toBeLessThanOrEqual(maxHeight);
    expect(m.sideways).toBeLessThanOrEqual(0);
    await ctx.close();
  }
});

test('before launch the page arrives marked as such, with the waiting-list card as its skeleton (no mentor cards); then the card', async ({ browser }) => {
  const html = await (await fetch(`${srv.base}/`)).text();
  expect(html).toMatch(/<html lang="en" data-launch="prelaunch">/); // (Browse's search and filters are hidden from the first frame)
  expect(html).toContain('class="wl-card prelaunch-panel skeleton-wl"');
  expect(html).not.toContain('skeleton-expert');
  const { ctx, page } = await open(browser, 390);
  await expect(page.locator('#expertGrid .wl-card:not(.skeleton-wl)')).toBeVisible();
  await expect(page.locator('#expertGrid .skeleton, #expertGrid [role="status"]')).toHaveCount(0);
  await expect(page.locator('#expertGrid')).toHaveAttribute('aria-busy', 'false');
  await ctx.close();
});

test('"Wisecall opens soon" starts on the same left edge as the fields and "How it works" (every width, English and Georgian)', async ({ browser }) => {
  for (const width of [375, 768, 1024, 1180, 1440, 1920]) {
    for (const lang of ['en', 'ka']) {
      const { ctx, page } = await open(browser, width, lang);
      const lefts = await page.evaluate(() => ['#stripTitle', '#expertsTitle', '#experts .wl-card', '#experts .wl-mentor a', '#howTitle', '#faqTitle']
        .map((s) => Math.round(document.querySelector(s).getBoundingClientRect().left)));
      expect(new Set(lefts).size, `${width}px ${lang}: ${lefts.join(', ')}`).toBe(1);
      await ctx.close();
    }
  }
});

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

test('what left the home page is one click away: how we verify, all questions, the mentors\' page', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1440);
  await page.locator('#how .how-verify a').click();
  await expect(page).toHaveURL(/\/how-we-verify\.html$/);
  await expect(page.locator('h1')).toHaveText('How we verify mentors');
  await page.goto(`${srv.base}/`);
  await page.locator('#faq .faq-more a').click();
  await expect(page).toHaveURL(/\/faq\.html$/);
  await expect(page.locator('#faq-examples')).toHaveText('What an answer looks like');
  for (const link of ['#experts .wl-mentor a', '.nav-links a[href="/become-a-mentor.html"]', '.hero-mentor-btn']) {
    await page.goto(`${srv.base}/`);
    await page.locator(link).click();
    await expect(page, link).toHaveURL(/\/become-a-mentor\.html$/);
    await expect(page.locator('h1')).toHaveText('Share what you know, get paid for it');
  }
  // (its button, at the top and at the bottom: the mentor's sign-up, which leads on to the application; docs/CLAUDE-CODE-MENTOR-SIGNUP.md #1)
  await expect(page.locator('.become-link').first()).toHaveAttribute('href', '/signup.html?as=mentor');
  await expect(page.locator('.become-link')).toHaveCount(2);
  await ctx.close();
});

// The visible tiles: how many, in how many columns, how tall, and every name that breaks inside a word or runs out of its tile.
const tiles = (page) => page.evaluate(() => {
  const shown = [...document.querySelectorAll('#nicheStrip .field-tile')].filter((a) => a.offsetWidth);
  const broken = [];
  for (const a of shown) {
    const text = a.querySelector('span').firstChild;
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
  test(`fields at ${width}px: ${count} tiles in ${columns} columns, then all 36; no word broken (English and Georgian)`, async ({ browser }) => {
    for (const lang of ['en', 'ka']) {
      const { ctx, page } = await open(browser, width, lang);
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
      expect(all.count, lang).toBe(36);
      expect(all.broken, lang).toEqual([]);
      await more.click();
      await expect(more).toHaveText(lang === 'ka' ? 'ყველა 36 სფეროს ნახვა' : 'See all 36 fields');
      expect((await tiles(page)).count, lang).toBe(count);
      await ctx.close();
    }
  });
}

test('the "Wisecall opens soon" card: one title, its size and columns, and a sign-up that does not move it', async ({ browser }) => {
  for (const [width, lang, maxWidth, twoColumns] of [[375, 'en', 560, false], [390, 'ka', 560, false], [768, 'ka', 960, true], [1440, 'en', 960, true]]) {
    const { ctx, page } = await open(browser, width, lang);
    const where = `${width}px ${lang}`;
    const card = page.locator('#experts .wl-card');
    await card.scrollIntoViewIfNeeded();
    await expect(page.locator('#experts h2')).toHaveText(lang === 'ka' ? 'Wisecall მალე იხსნება' : 'Wisecall opens soon');
    await expect(card.locator('h1, h2, h3, h4'), `${where}: the section's title is the only one`).toHaveCount(0);
    const m = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = (s) => el.querySelector(s).getBoundingClientRect();
      const button = el.querySelector('.waitlist-submit');
      return {
        width: el.getBoundingClientRect().width, radius: cs.borderTopLeftRadius, borderStyle: cs.borderTopStyle, padding: cs.paddingTop,
        art: r('.empty-art').height, intro: r('.wl-intro'), form: r('.wl-form'),
        inputs: [...el.querySelectorAll('input, select')].map((i) => i.getBoundingClientRect().height),
        buttonShadow: getComputedStyle(button).boxShadow, buttonWidth: button.getBoundingClientRect().width, formWidth: el.querySelector('.waitlist-form').getBoundingClientRect().width,
        hint: getComputedStyle(el.querySelector('.waitlist-hint')).fontSize
      };
    });
    expect(m.width, where).toBeLessThanOrEqual(maxWidth);
    expect(m.radius, where).toBe('24px');
    expect(m.borderStyle, where).toBe('solid');
    expect(m.padding, where).toBe(width >= 1024 ? '48px' : width >= 768 ? '40px' : '24px');
    expect(m.art, where).toBeLessThanOrEqual(96);
    for (const h of m.inputs) expect(h, where).toBeGreaterThanOrEqual(52);
    expect(m.buttonShadow, where).toBe('none');
    expect(Math.round(m.buttonWidth), where).toBe(Math.round(m.formWidth));
    expect(m.hint, where).toBe('13.6px');
    if (twoColumns) expect(m.form.left, `${where}: the form is right of the picture and text`).toBeGreaterThan(m.intro.right);
    else expect(m.form.top, `${where}: the form is under the picture and text`).toBeGreaterThanOrEqual(m.intro.bottom);
    // the mentors' link is a plain link under the card
    const link = page.locator('#experts .wl-mentor a.arrow-link');
    await expect(link).toBeVisible();
    expect((await link.boundingBox()).y).toBeGreaterThan((await card.boundingBox()).y + (await card.boundingBox()).height);

    const before = (await card.boundingBox()).height;
    await card.locator('input[type=email]').fill(`layout-${width}-${lang}-${Date.now()}@example.com`);
    await card.locator('.waitlist-submit').click();
    await expect(card.locator('.waitlist-done')).toBeVisible();
    await expect(card.locator('.waitlist-done .waitlist-check')).toBeVisible();
    expect(Math.abs((await card.boundingBox()).height - before), `${where}: the card keeps its height`).toBeLessThanOrEqual(1);
    await ctx.close();
  }
});

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
    // typing in the waiting-list form hides it; leaving the field brings it back
    // (the button is shown, though it may step aside over the card: its hidden attribute is what typing changes)
    const email = page.locator('#experts .wl-card input[type=email]');
    await page.evaluate(() => { const top = document.querySelector('#experts .wl-card').getBoundingClientRect().top + window.scrollY; window.scrollTo(0, Math.max(top - 80, window.innerHeight * 1.6)); });
    await expect(btn).toHaveJSProperty('hidden', false);
    await email.focus();
    await expect(btn).toHaveJSProperty('hidden', true);
    await email.blur();
    await expect(btn).toHaveJSProperty('hidden', false);
    await ctx.close();
  }
});
