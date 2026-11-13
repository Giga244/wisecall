// Both themes after the calm redesign (docs/CLAUDE-CODE-REDESIGN-CALM.md):
// - the field tiles under Browse are readable in dark: their names and icons were the fixed ink of the old pastel tiles on a dark card;
// - every header link has the same colours: soft text, the page's text colour on hover and focus, and the coral underline only under the
//   page in view. "ადმინი" was a ghost button with a coral hover of its own.
const { test, expect } = require('@playwright/test');

const RATIO = `(fg, bg) => {
  const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}`;

for (const scheme of ['dark', 'light']) {
  test(`${scheme}: the field tiles' names and icons are readable (not the colour of the tile, at least 4.5:1)`, async ({ browser }) => {
    for (const width of [375, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
      const page = await ctx.newPage();
      await page.goto('/ka/experts.html');
      await expect(page.locator('#nicheStrip a.field-tile').first()).toBeVisible();
      const tiles = await page.evaluate((ratio) => {
        const r = eval(ratio); // eslint-disable-line no-eval
        return [...document.querySelectorAll('#nicheStrip a.field-tile')].filter((a) => a.offsetWidth).map((a) => {
          const s = getComputedStyle(a);
          const icon = a.querySelector('svg');
          return { name: a.textContent.trim(), color: s.color, bg: s.backgroundColor, text: r(s.color, s.backgroundColor), icon: icon ? r(getComputedStyle(icon).color, s.backgroundColor) : 99 };
        });
      }, RATIO);
      expect(tiles.length, `${scheme} ${width}px`).toBeGreaterThan(0);
      for (const t of tiles) {
        expect(t.color, `${scheme} ${width}px "${t.name}": the text is not the tile's own colour`).not.toBe(t.bg);
        expect(t.text, `${scheme} ${width}px "${t.name}": ${t.color} on ${t.bg}`).toBeGreaterThanOrEqual(4.5);
        expect(t.icon, `${scheme} ${width}px "${t.name}": the icon`).toBeGreaterThanOrEqual(3);
      }
      await ctx.close();
    }
  });

  test(`${scheme}: every header link has the same colours, signed out and as an admin; only the page in view is underlined`, async ({ browser }) => {
    for (const who of ['visitor', 'admin']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
      await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
      if (who === 'admin') {
        await ctx.addCookies([{ name: 'wc_authed', value: 'admin', url: 'http://localhost:4620' }]);
        await ctx.route('**/api/me', (r) => (r.request().method() === 'GET'
          ? r.fulfill({ json: { user: { id: 1, name: 'Sam Admin', email: 'a@e2e.test', role: 'seeker', isAdmin: true, emailVerified: true, language: 'ka', theme: null } } })
          : r.fulfill({ json: {} })));
      }
      const page = await ctx.newPage();
      await page.goto('/ka/experts.html');
      await page.waitForLoadState('networkidle');
      const links = page.locator('#siteHeader .nav-links a:visible, #siteHeader .nav-right .btn-ghost:visible, #siteHeader .nav-lang .lang-btn:visible');
      const n = await links.count();
      expect(n, who).toBeGreaterThan(2);
      if (who === 'admin') await expect(page.locator('#siteHeader .admin-link')).toBeVisible();
      const ink = await page.evaluate(() => getComputedStyle(document.body).color);
      const rest = new Set(), hover = new Set(), hoverOf = [];
      for (let i = 0; i < n; i++) {
        const a = links.nth(i);
        const current = await a.getAttribute('aria-current');
        await page.mouse.move(5, 790);
        const still = await a.evaluate((e) => ({ color: getComputedStyle(e).color, line: getComputedStyle(e).textDecorationLine }));
        if (current) {
          expect(still.color, 'the page in view: in the text colour').toBe(ink);
          expect(still.line, 'the page in view: underlined').toContain('underline');
        } else {
          rest.add(still.color);
          expect(still.line, `${await a.textContent()}: no underline when it is not the page in view`).not.toContain('underline');
        }
        await a.hover();
        await page.waitForTimeout(300); // (after the 0.2s colour transition)
        hover.add(`${await a.evaluate((e) => getComputedStyle(e).color)}`);
        hoverOf.push(`${(await a.textContent()).trim()}: ${await a.evaluate((e) => getComputedStyle(e).color)}`);
      }
      expect([...rest], `${scheme} ${who}: one colour at rest`).toHaveLength(1);
      expect([...hover], `${scheme} ${who}: one colour on hover, the page's text colour: ${hoverOf.join(' | ')}`).toEqual([ink]);
      // (Browse is the page in view: its link says so)
      await expect(page.locator('#siteHeader .nav-links a[aria-current="page"]')).toHaveCount(1);
      await ctx.close();
    }
  });
}
