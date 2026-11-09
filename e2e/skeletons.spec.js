// Loading skeletons: while each screen's data is on its way it shows soft blocks in the shape of what is coming (Browse experts' cards,
// the field tiles, a profile, the dashboard's questions, the inbox's conversations and messages, the answers library), hidden from
// screen readers, with one "Loading…" status for them; the real content then takes the same place, and if loading fails the usual
// message replaces the skeleton. The shimmer runs only when motion is allowed.
// Runs after full-flow.spec.js (Ana is a listed mentor, Sam asked her a question).
const { test, expect } = require('@playwright/test');
const S = require('./support');

let mentorUsername;
test.beforeAll(async () => {
  mentorUsername = (await S.sql(`SELECT username FROM users WHERE email = 'ana@e2e.test'`))[0].username;
});

async function open(browser, width, { motion = 'reduce', login } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion });
  const page = await ctx.newPage();
  if (login) await S.logIn(page, { email: login });
  return { ctx, page };
}
// Hold back an API's answers until release() (or fail them with fail()); every request that matches is held, and once settled the
// later ones go through (or fail) at once.
async function hold(page, pattern) {
  const FAIL = { status: 500, contentType: 'application/json', body: '{"error":"server_error"}' };
  const waiting = [];
  let mode = null;
  let arrive;
  const arrived = new Promise((resolve) => { arrive = resolve; });
  await page.route(pattern, (route) => {
    if (mode === 'continue') return route.continue();
    if (mode === 'fail') return route.fulfill(FAIL);
    waiting.push(route);
    arrive();
    return undefined;
  });
  const settle = async (m) => {
    await arrived;
    mode = m;
    for (const route of waiting.splice(0)) await (m === 'continue' ? route.continue() : route.fulfill(FAIL)).catch(() => {});
  };
  return { arrived, release: () => settle('continue'), fail: () => settle('fail') };
}
// What a loading area must be: skeleton blocks hidden from screen readers, and exactly one "Loading…" status.
async function expectLoading(page, area, skeleton, count) {
  const blocks = page.locator(`${area} ${skeleton}:visible`);
  await expect(blocks).toHaveCount(count);
  for (const el of await blocks.all()) {
    expect(await el.evaluate((e) => Boolean(e.closest('[aria-hidden="true"]'))), `${skeleton} is hidden from screen readers`).toBe(true);
  }
  await expect(page.locator(`${area} [role="status"]`)).toHaveText(['Loading…']);
}
const box = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width) }; });

test('Browse experts: 8 skeleton cards on a desktop, 6 on a phone; the real cards take their place; an error replaces them', async ({ browser }) => {
  for (const [width, count] of [[1280, 8], [390, 6]]) {
    const { ctx, page } = await open(browser, width);
    const experts = await hold(page, '**/api/experts');
    await page.goto('/experts.html');
    await experts.arrived;
    await expect(page.locator('#expertGrid')).toHaveAttribute('aria-busy', 'true');
    await expectLoading(page, '#expertGrid', '.skeleton-expert', count);
    const first = await box(page.locator('#expertGrid .skeleton-expert').first());
    await experts.release();
    const card = page.locator('#expertGrid a.expert-card').first();
    await expect(card).toBeVisible();
    expect(await box(card), `${width}px: the first card is where its skeleton was`).toEqual(first);
    await expect(page.locator('#expertGrid')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#expertGrid .skeleton, #expertGrid [role="status"]')).toHaveCount(0);
    await ctx.close();
  }
  const { ctx, page } = await open(browser, 1280);
  const experts = await hold(page, '**/api/experts');
  await page.goto('/experts.html');
  await experts.fail();
  await expect(page.locator('#expertGrid')).toHaveText('Could not load experts right now.');
  await expect(page.locator('#expertGrid')).toHaveAttribute('aria-busy', 'false');
  await ctx.close();
});

test('the field tiles: skeleton tiles in the same full rows until the fields arrive, and the section keeps its height', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1280);
  const config = await hold(page, '**/api/config');
  await page.goto('/experts.html');
  await config.arrived;
  await expect(page.locator('#nicheStrip .skeleton-tile:visible')).toHaveCount(10); // (5 columns, 2 rows)
  const before = await page.locator('.strip').evaluate((e) => e.getBoundingClientRect().height);
  await config.release();
  await expect(page.locator('#nicheStrip .field-tile:visible')).toHaveCount(10);
  await expect(page.locator('#fieldsMoreSkeleton')).toHaveCount(0);
  expect(Math.abs((await page.locator('.strip').evaluate((e) => e.getBoundingClientRect().height)) - before)).toBeLessThanOrEqual(2);
  await ctx.close();
});

test('a profile: the name at once, skeletons for the rest, the cards stay in place; if it cannot load, the skeletons go', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1280);
  let api = await hold(page, `**/api/users/${mentorUsername}`);
  await page.goto(`/u/${mentorUsername}`);
  await api.arrived;
  await expect(page.locator('#expertPage h1')).toHaveText('Ana Lomidze'); // (written by the server)
  await expectLoading(page, '#expertPage', '.ask-side .skeleton-card', 1);
  const card = await box(page.locator('#expertPage .profile-card'));
  await api.release();
  await expect(page.locator('#askCard')).toBeVisible();
  expect(await box(page.locator('#expertPage .profile-card'))).toEqual(card);
  await expect(page.locator('#expertPage [data-skeleton], #expertPage [role="status"]:not(#askCodeNote)')).toHaveCount(0); // (the question form's own live note stays)
  await page.unroute(`**/api/users/${mentorUsername}`);

  api = await hold(page, `**/api/users/${mentorUsername}`);
  await page.goto(`/u/${mentorUsername}`);
  await api.fail();
  await expect(page.locator('.profile-retry')).toContainText("We couldn't load this profile.");
  await expect(page.locator('#expertPage .skeleton, #expertPage [role="status"]')).toHaveCount(0);
  await expect(page.locator('#expertPage h1')).toHaveText('Ana Lomidze'); // (what the server wrote stays)
  await ctx.close();
});

test('the dashboard: two question cards as skeletons, then the questions in their place; an error replaces them', async ({ browser }) => {
  for (const width of [1280, 390]) {
    const { ctx, page } = await open(browser, width, { login: 'sam@e2e.test' });
    const mine = await hold(page, '**/api/bookings/mine');
    await page.goto('/dashboard.html');
    await mine.arrived;
    await expectLoading(page, '#askedList', '.skeleton-booking', 2);
    const first = await box(page.locator('#askedList .skeleton-booking').first());
    await mine.release();
    const card = page.locator('#askedList article.booking-card').first();
    await expect(card).toBeVisible();
    expect(await box(card)).toEqual(first);
    await expect(page.locator('#askedList')).toHaveAttribute('aria-busy', 'false');
    await ctx.close();
  }
  const { ctx, page } = await open(browser, 1280, { login: 'sam@e2e.test' });
  const mine = await hold(page, '**/api/bookings/mine');
  await page.goto('/dashboard.html');
  await mine.fail();
  await expect(page.locator('#askedList')).toHaveText('Something went wrong.');
  await ctx.close();
});

test('the inbox: conversations and a conversation\'s messages as skeletons (one "Loading…"); errors replace them', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1280, { login: 'sam@e2e.test' });
  const list = await hold(page, '**/api/inbox');
  await page.goto('/inbox.html');
  await list.arrived;
  await expectLoading(page, '#threadList', '.skeleton-thread', 4);
  await expect(page.locator('#main [role="status"]'), 'one "Loading…" for the whole page').toHaveCount(1);
  const first = await box(page.locator('#threadList .skeleton-thread').first());
  await list.release();
  // (on a desktop the first conversation then opens, which draws the list once more: measure after that, in one step, so the element
  // measured is never one that was just replaced; that is what made this fail now and then on CI)
  await expect(page.locator('#threadList .thread-item.active')).toBeVisible();
  const top = await page.evaluate(() => Math.round(document.querySelector('#threadList .thread-item').parentElement.getBoundingClientRect().top + scrollY));
  expect(top, 'the first conversation is where its skeleton was').toBe(first.top);
  await expect(page.locator('#threadList')).toHaveAttribute('aria-busy', 'false');
  // a conversation that is not open yet: its messages as a skeleton while they load, the error message if they cannot
  const other = page.locator('#threadList .thread-item:not(.active)').first();
  if (await other.count()) {
    const thread = await hold(page, '**/api/inbox/threads/*');
    await other.click();
    await thread.arrived;
    await expectLoading(page, '#threadView', '.skeleton-bubble', 2);
    await thread.fail();
    await expect(page.locator('#threadView')).toHaveText('Something went wrong.');
  }
  await page.unroute('**/api/inbox');
  const failing = await hold(page, '**/api/inbox');
  await page.goto('/inbox.html');
  await failing.fail();
  await expect(page.locator('#threadList')).toHaveText('Something went wrong.');
  await ctx.close();
});

test('the answers library: three answers as skeletons while a new search is on its way', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1280);
  await page.goto('/answers');
  await page.waitForLoadState('networkidle');
  // (the page's own handler runs first; this one then keeps the page here, as if the next one were still on its way)
  await page.evaluate(() => document.querySelector('.answers-search').addEventListener('submit', (e) => e.preventDefault()));
  await page.fill('#answersQ', 'career');
  await page.click('.answers-search button[type="submit"]');
  await expectLoading(page, '.answers-list', '.skeleton-answer', 3);
  await expect(page.locator('.answers-list')).toHaveAttribute('aria-busy', 'true');
  await ctx.close();
});

test('the shimmer moves only when motion is allowed; with reduced motion the blocks stand still', async ({ browser }) => {
  for (const motion of ['no-preference', 'reduce']) {
    const { ctx, page } = await open(browser, 1280, { motion });
    const experts = await hold(page, '**/api/experts');
    await page.goto('/experts.html');
    await experts.arrived;
    await expect(page.locator('#expertGrid .skeleton-expert').first()).toBeVisible();
    const shining = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'skeleton-shine' && a.playState === 'running').length);
    if (motion === 'reduce') expect(shining, 'nothing moves').toBe(0);
    else expect(shining, 'a band of light passes over the blocks').toBeGreaterThan(0);
    await experts.release();
    await ctx.close();
  }
});
