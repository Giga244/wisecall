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
  // (a mentor Browse lists, so their profile is public and has the button: one picked from the database at random could be hidden)
  const [m] = ((await (await fetch(`${srv.base}/api/experts`)).json()).experts || []).filter((e) => e.username);
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

// docs/CLAUDE-CODE-FINISH.md part 1: the logo's horns have room, the headline is 2-3 lines (3-4 on a phone), the form is one row with the count
// right under it and the age box and privacy note as one small block, the email is readable in dark, and the fields are one row on a phone.
for (const [width, scheme] of [[360, 'dark'], [360, 'light'], [768, 'dark'], [1280, 'light'], [1280, 'dark']]) {
  test(`the hero at ${width}px ${scheme}: logo, headline, form, count, fields`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    await page.goto(`${srv.base}/ka/`);
    await expect(page.locator('#heroWait .wlc-row')).toBeVisible();
    await expect(page.locator('#heroChips .lchip').first()).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const head = box(document.querySelector('#siteHeader .jlogo-head'));
      const header = box(document.getElementById('siteHeader'));
      const title = document.querySelector('.lhero-title');
      const lines = Math.round(box(title).height / parseFloat(getComputedStyle(title).lineHeight));
      const row = document.querySelector('#heroWait .wlc-row');
      const input = box(row.querySelector('input')), button = box(row.querySelector('button'));
      const chips = [...document.querySelectorAll('#heroChips .lchip')].map((c) => Math.round(box(c).top));
      const count = document.getElementById('waitCount');
      return {
        headTop: Math.round(head.top), headInside: head.bottom <= header.bottom,
        lines, oneRow: Math.abs(input.top - button.top) < 12 && Math.abs(input.bottom - button.bottom) < 12,
        countAfterRow: count.hidden || row.nextElementSibling === count,
        consent: Boolean(document.querySelector('#heroWait .wlc-consent input[name="over16"]') && document.querySelector('#heroWait .wlc-consent .waitlist-hint')),
        inputInk: getComputedStyle(row.querySelector('input')).color === getComputedStyle(document.body).color,
        chipRows: new Set(chips).size, sideways: document.documentElement.scrollWidth - window.innerWidth
      };
    });
    expect(m.headTop, 'room above the horns').toBeGreaterThanOrEqual(12);
    expect(m.headInside).toBe(true);
    expect(m.lines, 'headline lines').toBeLessThanOrEqual(width >= 1024 ? 3 : 4);
    expect(m.oneRow, 'the email and its button on one row').toBe(true);
    expect(m.countAfterRow, 'the count right under the form').toBe(true);
    expect(m.consent, 'the age box and the privacy note in one block').toBe(true);
    expect(m.inputInk, 'the email is written in the page\'s text colour').toBe(true);
    if (width < 640) expect(m.chipRows, 'the fields: one row on a phone').toBe(1);
    expect(m.sideways, 'nothing runs off the side').toBeLessThanOrEqual(0);
    await ctx.close();
  });
}
