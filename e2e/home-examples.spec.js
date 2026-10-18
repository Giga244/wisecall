// The hero's rotating example (public/js/home.js, docs/CLAUDE-CODE-ROTATING-EXAMPLE.md) in a real browser:
//   - one of the six is shown, chosen before any is visible; the card is the same size whichever is shown, at 360, 768 and 1280px, light
//     and dark, English and Georgian, and nothing in it shifts
//   - with motion, the next one each time the 12-second conversation starts over; never the same twice in a row
//   - with reduced motion, nothing plays and nothing rotates (a random one per page load)
//   - a hidden tab pauses the loop, and so the rotation
const { test, expect } = require('@playwright/test');

async function open(browser, { width, lang = 'en', scheme = 'light', motion = 'reduce' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: motion, isMobile: width < 768, hasTouch: width < 768 });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ }
    // (layout shifts inside the card, from its first frame)
    window.__cardShift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e.sources || []).some((s) => s.node && s.node.closest && s.node.closest('.hero-stage .stage'))) window.__cardShift += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  }, lang);
  const page = await ctx.newPage();
  await page.goto(lang === 'ka' ? '/ka/' : '/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const active = (page) => page.evaluate(() => [...document.querySelectorAll('.stage-example')].findIndex((e) => e.classList.contains('is-active')));
// The card with example i shown: its size, where the answer ends and the details begin, and the texts shown.
const measure = (page, i) => page.evaluate((k) => {
  document.querySelectorAll('.stage-example').forEach((e, n) => e.classList.toggle('is-active', n === k));
  const box = (s) => document.querySelector(s).getBoundingClientRect();
  const stage = box('.hero-stage .stage');
  const answer = box('.stage-example.is-active .bubble-a');
  const question = box('.stage-example.is-active .bubble-q');
  return {
    height: Math.round(stage.height), heroHeight: Math.round(box('.hero-stage').height),
    fits: answer.bottom <= box('.stage-meta').top && question.top >= box('.stage-head').bottom && answer.right <= stage.right && question.left >= stage.left,
    shown: document.querySelectorAll('.stage-example.is-active').length,
    text: document.querySelector('.stage-example.is-active .bubble-a p:last-child').textContent.trim(),
    sideways: document.documentElement.scrollWidth - window.innerWidth
  };
}, i);

test('one example shown, chosen before any is visible; the card never changes size: 360/768/1280, light and dark, EN and KA', async ({ browser }) => {
  for (const width of [360, 768, 1280]) {
    for (const lang of ['en', 'ka']) {
      for (const scheme of ['light', 'dark']) {
        const where = `${width}px ${lang} ${scheme}`;
        const { ctx, page } = await open(browser, { width, lang, scheme });
        expect(await page.locator('.stage-example.is-active').count(), where).toBe(1);
        expect(await page.evaluate(() => window.__cardShift), `${where}: no layout shift in the card`).toBe(0);
        const first = await active(page);
        const sizes = [];
        for (let i = 0; i < 6; i++) {
          const m = await measure(page, i);
          expect(m.fits, `${where}, example ${i + 1}: inside the card, above the details`).toBe(true);
          expect(m.shown).toBe(1);
          expect(m.sideways, `${where}: nothing scrolls sideways`).toBe(0);
          if (lang === 'ka') expect(m.text, where).toMatch(/[ა-ჿ]/);
          sizes.push([m.height, m.heroHeight]);
        }
        expect(new Set(sizes.map(String)).size, `${where}: the same size for every example (${JSON.stringify(sizes)})`).toBe(1);
        await measure(page, first);
        // (decoration: one label for screen readers, the rotating text is hidden from them)
        await expect(page.locator('.hero-stage')).toHaveAttribute('role', 'img');
        await expect(page.locator('.hero-stage .stage')).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('.stage-tag')).toHaveText(lang === 'ka' ? 'მაგალითი' : 'Example');
        await ctx.close();
      }
    }
  }
});

test('with motion: the next example each time the conversation starts over, never the same twice in a row', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1280, motion: 'no-preference' });
  const start = await active(page);
  // The real loop: 12 seconds, then the next one.
  await expect.poll(() => active(page), { timeout: 15000, intervals: [500] }).toBe((start + 1) % 6);
  // A dozen more turns (the loop's own event, sent at once instead of waiting 12 seconds each).
  const seq = [await active(page)];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => {
      const q = document.querySelector('.stage-example.is-active .bubble-q');
      q.dispatchEvent(new AnimationEvent('animationiteration', { animationName: 'q-in', bubbles: true }));
    });
    seq.push(await active(page));
  }
  for (let i = 1; i < seq.length; i++) expect(seq[i], `turn ${i}: ${seq}`).not.toBe(seq[i - 1]);
  expect(new Set(seq).size).toBe(6);
  // (other animations of the card, the typing dots for one, never move it on)
  const before = await active(page);
  await page.evaluate(() => document.querySelector('.stage-example.is-active .bubble-typing span').dispatchEvent(new AnimationEvent('animationiteration', { animationName: 'dot', bubbles: true })));
  expect(await active(page)).toBe(before);
  await ctx.close();
});

test('a hidden tab pauses the loop (and the rotation); it goes on when the tab is back', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1280, motion: 'no-preference' });
  const state = () => page.evaluate(() => ({
    paused: document.querySelector('.hero-stage .stage').classList.contains('is-paused'),
    play: getComputedStyle(document.querySelector('.stage-example.is-active .bubble-q')).animationPlayState
  }));
  const setVisibility = (v) => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
  expect(await state()).toEqual({ paused: false, play: 'running' });
  await setVisibility('hidden');
  expect(await state()).toEqual({ paused: true, play: 'paused' });
  await setVisibility('visible');
  expect(await state()).toEqual({ paused: false, play: 'running' });
  await ctx.close();
});

test('with reduced motion: nothing plays and nothing rotates; each page load picks one at random', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1280, motion: 'reduce' });
  expect(await page.evaluate(() => document.querySelector('.hero-stage .stage').getAnimations({ subtree: true }).length)).toBe(0);
  const firsts = new Set();
  for (let i = 0; i < 12; i++) {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    firsts.add(await active(page));
  }
  expect(firsts.size, `different first examples over 12 loads: ${[...firsts]}`).toBeGreaterThan(1);
  const now = await active(page);
  await page.waitForTimeout(1500);
  expect(await active(page)).toBe(now);
  await expect(page.locator('.stage-example.is-active .bubble-a')).toHaveCSS('opacity', '1');
  await ctx.close();
});
