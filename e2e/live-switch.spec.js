// Live sessions switched off (LIVE_SESSIONS=off, the production default), in a real browser: no link, section, tab or Follow button
// about them for a visitor, a buyer or a mentor (English and Georgian), /live is the "not found" page, and the admin's Live tab is
// read-only with a note. Runs its own server on the same database (after full-flow.spec.js, so the mentor and buyer exist).
const { test, expect } = require('@playwright/test');
const { startServer } = require('../tests/helpers');
const S = require('./support');

let srv, mentorUsername;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  srv = await startServer(4624, { LIVE_SESSIONS: 'off', ADMIN_EMAILS: 'e2e-admin@example.com', DATA_ENCRYPTION_KEY: 'e2e-data-key-that-is-long-enough-1234567890' });
  mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
});
test.afterAll(() => { if (srv) srv.proc.kill(); });

async function open(browser, lang = 'en') {
  const ctx = await browser.newContext({ baseURL: srv.base });
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  return { ctx, page: await ctx.newPage() };
}
// Nothing visible on the page points at live sessions or talks about them.
async function noLive(page, where) {
  await page.waitForLoadState('networkidle');
  expect(await page.locator('a[href="/live"], a[href^="/live/"], a[href="/ka/live"], a[href^="/ka/live/"]').filter({ visible: true }).count(), where).toBe(0);
  expect(await page.locator('#liveHome, #tab-live, #profileLive, #profileFollow').filter({ visible: true }).count(), where).toBe(0);
  expect(await page.locator('body').innerText(), where).not.toMatch(/live sessions?|ცოცხალი სესი/i);
}

test('a visitor and a buyer see nothing about live sessions (home, profile, dashboard; English and Georgian); /live is "not found"', async ({ browser }) => {
  for (const lang of ['en', 'ka']) {
    const { ctx, page } = await open(browser, lang);
    const pre = lang === 'ka' ? '/ka' : '';
    await page.goto(pre + '/');
    await noLive(page, `${lang} home`);
    await page.goto(`${pre}/u/${mentorUsername}`);
    await expect(page.locator('#expertName')).toBeVisible();
    await noLive(page, `${lang} profile`);
    const notFound = await page.goto(pre + '/live');
    expect(notFound.status()).toBe(404);
    await S.logIn(page, { email: 'sam@e2e.test' });
    await noLive(page, `${lang} dashboard`);
    await page.goto('/dashboard.html?tab=live'); // (an old link to the tab opens the first tab instead)
    await expect(page.locator('#tab-asked')).toHaveAttribute('aria-selected', 'true');
    await ctx.close();
  }
});

test('a mentor sees no Live tab on their dashboard', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await S.logIn(page, { email: 'ana@e2e.test' });
  await noLive(page, 'mentor dashboard');
  await ctx.close();
});

test('the admin\'s Live tab is read-only, with the "switched off" note', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/admin.html');
  await page.click('[data-tab="live"]');
  await expect(page.getByText('LIVE_SESSIONS=off')).toBeVisible();
  await expect(page.locator('#adminContent .lv-end, #adminContent .lv-approve, #adminContent .lv-host-form, #adminContent .lr-resolve')).toHaveCount(0);
  await ctx.close();
});
