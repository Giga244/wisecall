// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A mentor's profile opens under every address a link can use: /u/<name>, /en/u/<name> and /ka/u/<name>, each with the mentor's name on
// it, and in the language of its prefix. Under /en/u/ the page's own script used to look for the name only after "/u/" or "/ka/u/", found
// none, and drew "We couldn't find that profile" over a page the server had written correctly.
//   - the three addresses show the name, and never the "couldn't find" message
//   - /en/ is English and /ka/ is Georgian (the page's language, its header, its title)
//   - an old username moves to the new one and keeps the language of the address it was asked at
//   - the links the site writes to a profile (browse cards, the sitemap, the matching result) are addresses that open a profile
// The picture for the owner: E2E_PATHS_SHOTS=<folder>.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_PATHS_SHOTS;
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const NAME = 'Nestan Paths';
let mentor;

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}

test.beforeAll(async () => {
  const admin = await adminClient();
  mentor = await S.listedMentor(admin, { name: NAME, email: `paths-${tag}@e2e.test`, niche: 'business', roleTitle: 'Business consultant', price: 25 });
});

for (const [prefix, lang] of [['', null], ['/en', 'en'], ['/ka', 'ka']]) {
  test(`${prefix || '(no prefix)'}/u/<name> shows the mentor${lang ? ` in ${lang === 'ka' ? 'Georgian' : 'English'}` : ''}`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('wisecall_lang'); } catch (e) { /* none */ } });
    await page.goto(`${prefix}/u/${mentor.username}`);
    await expect(page.locator('#expertName')).toHaveText(NAME);
    await expect(page.locator('#expertPage .empty-state')).toHaveCount(0); // ("We couldn't find that profile" is drawn as an empty state)
    await expect(page.locator('#expertPage')).not.toContainText(/couldn.t find|ვერ ვიპოვეთ/i);
    await expect(page).toHaveTitle(new RegExp(NAME));
    if (lang) {
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('#askForm')).toBeVisible();
      const words = await page.locator('#askForm').innerText();
      if (lang === 'ka') expect(words).toMatch(/[Ⴀ-ჿ]/);
      else expect(words).not.toMatch(/[Ⴀ-ჿ]/);
    }
    if (SHOTS && prefix === '/en') {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'en-u-slug.png'), fullPage: false });
    }
    if (SHOTS && prefix === '/ka') await page.screenshot({ path: path.join(SHOTS, 'ka-u-slug.png'), fullPage: false });
  });
}

test('a name nobody has still says so, under every address', async ({ page }) => {
  for (const prefix of ['', '/en', '/ka']) {
    await page.goto(`${prefix}/u/nobody-by-this-name-${tag}`);
    await expect(page.locator('#expertPage .empty-state')).toBeVisible();
  }
});

test('an old username moves to the new one and keeps the language of the address', async ({ page }) => {
  const old = mentor.username;
  const next = `paths-new-${tag}`;
  // (a name the mentor has accepted is the one that keeps redirecting when it is given up: "keep the suggested one" accepts it)
  expect((await mentor.client.api('/me/username', { method: 'PUT', body: { username: old } })).status).toBe(200);
  const r = await mentor.client.api('/me/username', { method: 'PUT', body: { username: next } });
  expect(r.status, r.text).toBe(200);
  for (const prefix of ['', '/en', '/ka']) {
    const res = await page.request.get(`${prefix}/u/${old}?x=1`, { maxRedirects: 0 });
    expect(res.status(), prefix).toBe(301);
    expect(res.headers().location, prefix).toBe(`${prefix}/u/${next}?x=1`);
    await page.goto(`${prefix}/u/${old}`);
    await expect(page.locator('#expertName')).toHaveText(NAME);
    expect(new URL(page.url()).pathname).toBe(`${prefix}/u/${next}`);
  }
});

test('the addresses the site writes to a profile open one: browse, the sitemap, the profile\'s own canonical and alternates', async ({ page, request }) => {
  // browse: English and Georgian cards
  await page.goto('/experts.html');
  const en = page.locator(`a.expert-card[href*="/u/"]`).filter({ hasText: NAME }).first();
  await expect(en).toBeVisible();
  expect(new URL(await en.getAttribute('href'), page.url()).pathname).toMatch(/^\/u\//);
  await en.click();
  await expect(page.locator('#expertName')).toHaveText(NAME);
  await page.goto('/ka/experts.html');
  const ka = page.locator(`a.expert-card[href*="/u/"]`).filter({ hasText: NAME }).first();
  await expect(ka).toBeVisible();
  expect(new URL(await ka.getAttribute('href'), page.url()).pathname).toMatch(/^\/ka\/u\//);
  await ka.click();
  await expect(page.locator('#expertName')).toHaveText(NAME);
  expect(new URL(page.url()).pathname).toMatch(/^\/ka\/u\//);

  // the sitemap names the English and the Georgian address of the profile, and both of them open it
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]*\/u\/paths-new-[^<]*)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  expect(locs.sort()).toEqual([`/ka/u/paths-new-${tag}`, `/u/paths-new-${tag}`]);
  for (const p of locs) expect((await request.get(p)).status(), p).toBe(200);

  // the profile's own head: the canonical address and its alternates are the ones that open
  const head = await (await request.get(`/ka/u/paths-new-${tag}`)).text();
  expect(head).toMatch(new RegExp(`rel="canonical" href="[^"]*/ka/u/paths-new-${tag}"`));
  expect(head).toMatch(new RegExp(`hreflang="en" href="[^"]*/u/paths-new-${tag}"`));
});
