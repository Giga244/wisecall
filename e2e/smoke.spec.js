// Every page and every tab, as each kind of visitor, in English and Georgian: nothing may throw, log an error, or
// show "Something went wrong". Runs after the other specs so there is real data on the pages.
const { test, expect } = require('@playwright/test');
const S = require('./support');

const NOISE = /Failed to load resource|fonts\.g|net::ERR|favicon/i; // fonts come from Google and are not reachable in every environment

function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) problems.push(`console: ${m.text()}`); });
  return problems;
}
const WRONG = /something went wrong|დაფიქსირდა შეცდომა|რაღაც არ გამოვიდა|unknown error/i;

for (const lang of ['en', 'ka']) {
  test.describe(`every page and tab in ${lang === 'en' ? 'English' : 'Georgian'}`, () => {
    let ctxs = [], pages = {}, problems = {}, mentorUsername;

    test.beforeAll(async ({ browser }) => {
      mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
      for (const who of ['visitor', 'seeker', 'mentor', 'admin']) {
        const ctx = await browser.newContext();
        await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* ignore */ } }, lang);
        pages[who] = await ctx.newPage();
        problems[who] = watch(pages[who]);
        ctxs.push(ctx);
      }
      await S.logIn(pages.seeker, { email: 'sam@e2e.test' });
      await S.logIn(pages.mentor, { email: 'ana@e2e.test' });
      await S.logIn(pages.admin, { email: 'e2e-admin@example.com' });
    });
    test.afterAll(async () => { await Promise.all(ctxs.map((c) => c.close())); });

    async function visit(who, url, { waitFor } = {}) {
      const page = pages[who];
      problems[who].length = 0;
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      if (waitFor) await expect(page.locator(waitFor).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText(WRONG);
      expect(problems[who], `${who} ${url}`).toEqual([]);
    }

    test('public pages', async () => {
      for (const url of ['/', `/u/${mentorUsername}`, '/signup.html', '/login.html', '/forgot-password.html', '/contact.html', '/about.html', '/become-a-mentor.html', '/terms.html', '/privacy.html', '/waitlist-unsubscribe.html', '/no-such-page']) {
        await visit('visitor', url);
      }
      await expect(pages.visitor.locator('html')).toHaveAttribute('lang', lang);
    });

    test('a seeker\'s dashboard and settings', async () => {
      await visit('seeker', '/dashboard.html', { waitFor: '#askedList' });
      for (const tab of ['profile', 'account']) await visit('seeker', `/settings.html?tab=${tab}`);
    });

    test('a mentor\'s dashboard (questions, earnings) and every settings tab', async () => {
      await visit('mentor', '/dashboard.html', { waitFor: '#dashTabs' });
      for (const tab of ['received', 'earnings']) {
        await pages.mentor.click(`#tab-${tab}`);
        await expect(pages.mentor.locator(`#panel-${tab}`)).toBeVisible();
        await expect(pages.mentor.locator('body')).not.toContainText(WRONG);
      }
      for (const tab of ['profile', 'mentor', 'verification', 'payouts', 'account']) await visit('mentor', `/settings.html?tab=${tab}`);
    });

    test('every admin tab and filter', async () => {
      await visit('admin', '/admin.html', { waitFor: '#adminTabs' });
      const page = pages.admin;
      for (const tab of ['mentors', 'bookings', 'queue', 'interviews', 'payouts', 'waitlist']) {
        await page.click(`#adminTabs [data-tab="${tab}"]`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('#adminContent')).not.toContainText(WRONG);
        if (!(await page.locator('#statusFilters').isVisible())) continue; // some tabs have no filter chips
        const chips = await page.locator('#statusFilters .chip').count();
        for (let i = 0; i < chips; i++) {
          await page.locator('#statusFilters .chip').nth(i).click(); // the chips are redrawn after every click
          await page.waitForLoadState('networkidle');
          await expect(page.locator('#adminContent')).not.toContainText(WRONG);
        }
      }
      expect(problems.admin).toEqual([]);
    });
  });
}
