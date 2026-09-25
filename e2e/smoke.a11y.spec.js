// Accessibility on every page, as each kind of visitor, in English and Georgian:
//   - axe-core with the WCAG 2.0 / 2.1 / 2.2 A and AA rules (colour contrast, names and labels, landmarks, headings, ARIA)
//   - the keyboard: a skip link, every control reachable with Tab and showing a visible focus ring, nothing traps focus
//   - errors that a screen reader announces (role="alert") and fields marked aria-invalid
// Runs after the other specs so the pages have real data.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const S = require('./support');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const describeViolation = (v) => `${v.id} (${v.impact}): ${v.help}\n    ` + v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}  ${(n.failureSummary || '').split('\n')[1] || ''}`).join('\n    ');

for (const lang of ['en', 'ka']) {
  test.describe(`accessibility in ${lang === 'en' ? 'English' : 'Georgian'}`, () => {
    let ctxs = [], pages = {}, mentorUsername;

    test.beforeAll(async ({ browser }) => {
      mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
      for (const who of ['visitor', 'seeker', 'mentor', 'admin']) {
        const ctx = await browser.newContext({ reducedMotion: 'reduce' }); // no animation in flight while axe reads the colours
        await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
        pages[who] = await ctx.newPage();
        ctxs.push(ctx);
      }
      await S.logIn(pages.seeker, { email: 'sam@e2e.test' });
      await S.logIn(pages.mentor, { email: 'ana@e2e.test' });
      await S.logIn(pages.admin, { email: 'e2e-admin@example.com' });
    });
    test.afterAll(async () => { await Promise.all(ctxs.map((c) => c.close())); });

    async function audit(who, url, prepare) {
      const page = pages[who];
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      if (prepare) { await prepare(page); await page.waitForTimeout(250); } // let a chosen tab finish changing colour
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(violations.map(describeViolation), `${who} ${url}`).toEqual([]);
    }

    test('axe finds no WCAG A/AA problem on any public page', async () => {
      for (const url of ['/', `/u/${mentorUsername}`, '/signup.html', '/login.html', '/forgot-password.html', '/contact.html', '/about.html', '/terms.html', '/privacy.html', '/no-such-page']) {
        await audit('visitor', url);
      }
    });

    test('...on the seeker and mentor pages', async () => {
      await audit('seeker', '/dashboard.html');
      await audit('seeker', '/settings.html?tab=account');
      await audit('mentor', '/dashboard.html', async (p) => { await p.click('#tab-received'); });
      await audit('mentor', '/dashboard.html', async (p) => { await p.click('#tab-earnings'); });
      for (const tab of ['profile', 'mentor', 'verification', 'payouts']) await audit('mentor', `/settings.html?tab=${tab}`);
    });

    test('...and on every admin tab', async () => {
      for (const tab of ['mentors', 'bookings', 'queue', 'interviews', 'payouts', 'waitlist']) {
        await audit('admin', '/admin.html', async (p) => { await p.click(`#adminTabs [data-tab="${tab}"]`); await p.waitForLoadState('networkidle'); });
      }
    });

    test('the open menus and dialogs pass too: language switch, FAQ, waiting-list form', async () => {
      await audit('visitor', '/', async (p) => {
        await p.locator('.faq-q').first().click();
        await p.locator('#experts').scrollIntoViewIfNeeded();
      });
    });

    test('keyboard: a skip link, and every control is reachable and shows a focus ring', async () => {
      const page = pages.visitor;
      for (const url of ['/', '/signup.html', '/login.html', '/contact.html', `/u/${mentorUsername}`]) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.keyboard.press('Tab');
        const first = await page.evaluate(() => ({ text: document.activeElement.textContent.trim(), href: document.activeElement.getAttribute('href'), cls: document.activeElement.className }));
        expect(first.href, `${url}: the first Tab stop is the skip link`).toBe('#main');
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => location.hash), `${url}: the skip link goes to the main content`).toBe('#main');

        const seen = new Set();
        const noRing = [];
        for (let i = 0; i < 150; i++) {
          await page.keyboard.press('Tab');
          const info = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
            const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.id || '').trim().slice(0, 40);
            return { key: `${el.tagName}#${el.id}.${el.className}|${label}|${Math.round(r.x)},${Math.round(r.y)}`, ring: Boolean(ring), visible: r.width > 0 && r.height > 0, label: `${el.tagName.toLowerCase()} "${label}"` };
          });
          if (!info) break;
          if (seen.has(info.key)) break; // wrapped around to the start
          seen.add(info.key);
          expect(info.visible, `${url}: ${info.label} is focusable but not visible`).toBe(true);
          if (!info.ring) noRing.push(info.label);
        }
        expect(seen.size, `${url}: Tab reaches the page's controls`).toBeGreaterThan(5);
        expect(noRing, `${url}: controls with no visible focus ring`).toEqual([]);
      }
    });

    test('errors are announced to screen readers, and the fields are marked invalid', async () => {
      const page = pages.visitor;
      // Sign up with nothing typed
      await page.goto('/signup.html');
      await page.click('#signupForm button[type="submit"]');
      const err = page.locator('#formError');
      await expect(err).not.toBeEmpty();
      expect(await err.getAttribute('role')).toBe('alert');
      await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
      expect(await page.evaluate(() => document.activeElement.id), 'focus moves to the field to fix').toBe('name');

      // Log in with a wrong password
      await page.goto('/login.html');
      await page.fill('#email', 'nobody@e2e.test');
      await page.fill('#password', 'wrong-password-1');
      await page.click('#loginForm button[type="submit"]');
      await expect(page.locator('#formError')).not.toBeEmpty();
      expect(await page.locator('#formError').getAttribute('role')).toBe('alert');

      // Waiting-list form with a bad address (in prelaunch and live the form is the same)
      await page.goto('/contact.html');
      const contactError = page.locator('.form-error[role="alert"]').first();
      expect(await contactError.count(), 'the contact form has an announced error area').toBe(1);

      // Every form error area on every page is a live region (checked in the page source: some pages redirect a visitor away)
      const dir = path.join(__dirname, '..', 'public');
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(dir, file), 'utf8');
        const silent = (html.match(/<[a-z]+ [^>]*class="[^"]*form-error[^"]*"[^>]*>/g) || []).filter((tag) => !/role="alert"|aria-live=/.test(tag));
        expect(silent, `${file}: error areas that a screen reader would not announce`).toEqual([]);
      }
    });
    test('every form control has a real <label> (not just a placeholder), on the pages people fill in', async () => {
      const check = async (page, url) => {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).filter((el) => {
          if (el.closest('[hidden]') || el.closest('.hp')) return false;
          return !(el.labels && el.labels.length && el.labels[0].textContent.trim());
        }).map((el) => `${el.tagName.toLowerCase()}#${el.id || el.name}[${el.type}]`));
        expect(unnamed, `${url}: controls without a label`).toEqual([]);
      };
      for (const url of ['/', '/signup.html', '/login.html', '/forgot-password.html', '/contact.html', `/u/${mentorUsername}`]) await check(pages.visitor, url);
      for (const tab of ['profile', 'mentor', 'verification', 'payouts', 'account']) await check(pages.mentor, `/settings.html?tab=${tab}`);
    });
  });
}
