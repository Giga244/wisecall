// The new home page before launch (docs/CLAUDE-CODE-NEW-HOME.md 4): the hero's waiting list instead of the search, the real count (rounded,
// hidden under 50), one friendly answer whether the address was new or already there, "დასვი კითხვა" on a profile opening the waiting list,
// and Browse still open. Runs its own server in prelaunch (the shared test database, like e2e/prelaunch-keys.spec.js).
const { test, expect } = require('@playwright/test');
const { startServer, client } = require('../tests/helpers');
const S = require('./support');

let srv;
const stamp = Date.now();
test.beforeAll(async () => {
  srv = await startServer(4625, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '100', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
});
test.afterAll(() => { if (srv) srv.proc.kill(); });
const ka = async (browser, width = 375) => {
  const ctx = await browser.newContext({ viewport: { width, height: 812 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  return { ctx, page: await ctx.newPage() };
};
const listCount = async () => (await S.sql('SELECT count(DISTINCT lower(email))::int AS n FROM waitlist'))[0].n;

test('the hero has the waiting list (no search); joining saves the address; a repeated address gets the same friendly thank-you', async ({ browser }) => {
  const { ctx, page } = await ka(browser);
  await page.goto(`${srv.base}/ka/`);
  await expect(page.locator('.lhero-pill')).toHaveText('🚀 მალე იხსნება · ჩაეწერე პირველებში');
  await expect(page.locator('#heroSearch')).toHaveCount(0);
  const form = page.locator('#heroWait .waitlist-form');
  await expect(form.locator('button[type="submit"]')).toHaveText('ჩაეწერე სიაში');
  const email = `home-wait-${stamp}@e2e.test`;
  await page.locator('#heroChips [data-wait-field="med"]').click();
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[name="over16"]').check();
  await form.locator('button[type="submit"]').click();
  const done = page.locator('#heroWait .waitlist-done');
  await expect(done).toContainText('გმადლობთ! ეს მისამართი სიაშია');
  const rows = await S.sql('SELECT niche FROM waitlist WHERE lower(email) = lower($1)', [email]);
  expect(rows.map((r) => r.niche)).toEqual(['med']);
  // the same address again: the same kind words, no error (nobody learns whether an address was on the list)
  await page.reload();
  await page.locator('#heroWait input[type="email"]').fill(email);
  await page.locator('#heroWait input[name="over16"]').check();
  await page.locator('#heroWait button[type="submit"]').click();
  await expect(page.locator('#heroWait .waitlist-done')).toContainText('გმადლობთ! ეს მისამართი სიაშია');
  await expect(page.locator('#heroWait .waitlist-error')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('the count line: the real number rounded down to ten, hidden under 50', async ({ browser }) => {
  const { ctx, page } = await ka(browser, 1280);
  const n = await listCount();
  if (n < 50) {
    await page.goto(`${srv.base}/ka/`);
    await page.waitForTimeout(800);
    await expect(page.locator('#waitCount')).toBeHidden();
    for (let i = n; i < 63; i++) await S.sql("INSERT INTO waitlist (email, niche, token) VALUES ($1, 'any', md5(random()::text) || md5(random()::text))", [`count-${stamp}-${i}@e2e.test`]);
  }
  const now = await listCount();
  await page.goto(`${srv.base}/ka/`);
  await expect(page.locator('#waitCount')).toHaveText(`🔥 ${Math.floor(now / 10) * 10}+ ადამიანი უკვე მოლოდინის სიაშია · Wisecall მალე იხსნება`);
  await ctx.close();
});

test('Browse and profiles stay open; "დასვი კითხვა" opens the waiting list with the new words', async ({ browser }) => {
  const [m] = await S.sql(`SELECT username FROM users WHERE role IN ('mentor', 'both') AND verification_status = 'verified' AND username IS NOT NULL AND deleted_at IS NULL LIMIT 1`);
  const { ctx, page } = await ka(browser);
  await page.goto(`${srv.base}/ka/experts.html`);
  await expect(page.locator('#expertGrid')).toBeVisible();
  if (m) {
    await page.goto(`${srv.base}/ka/u/${encodeURIComponent(m.username)}`);
    await expect(page.locator('#askOpen')).toHaveText('დასვი კითხვა');
    await page.click('#askOpen');
    await expect(page.locator('#askArea')).toContainText('Wisecall მალე იხსნება. ჩაეწერე და პირველს შეგატყობინებთ');
    await expect(page.locator('#askArea .waitlist-form input[type="email"]')).toBeVisible();
    await expect(page.locator('#askArea #question')).toHaveCount(0);
  }
  await ctx.close();
});

test('the launch: the same page in launch mode has the search instead', async () => {
  const live = await (await fetch(`${S.BASE}/`)).text();
  expect(live).toMatch(/id="heroSearch"/);
  expect(live).not.toMatch(/id="heroWait"/);
  const pre = await (await fetch(`${srv.base}/`)).text();
  expect(pre).toMatch(/id="heroWait"/);
  expect(pre).not.toMatch(/id="heroSearch"/);
  expect((await client(srv.base).api('/config')).launchMode).toBe('prelaunch');
});
