// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "შენ შესახებ" / "About you" (tests/mentor-about.test.js has the rules), at 375px, in Georgian:
//   - the "ჩემი გზა" step has the About box under the three blocks: optional, with a count and a grey example; the step moves on without it,
//     and what is written in it is saved exactly
//   - Settings → My details has the same box, with the mentor's About in it
//   - the profile shows "შესახებ" above "ჩემი გზა", only when it is written; the headline is said once under the name
// The pictures for the owner: E2E_ABOUT_SHOTS=<folder>.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_ABOUT_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const ABOUT = 'თორმეტი წელია ვებგვერდებსა და აპლიკაციებს ვქმნი ბანკებისთვის, მაღაზიებისთვის და სტარტაპებისთვის.\n\nახლა პატარა სტუდიას ვხელმძღვანელობ და უნივერსიტეტში დიზაინის კურსს ვასწავლი. შემიძლია დაგეხმარო პირველი პორტფოლიოს აწყობასა და სამუშაოს ფასის დადგენაში.';
const HEADLINE = 'სტუდიის დამფუძნებელი, დიზაინის ლექტორი უნივერსიტეტში';
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
const phoneKa = async (browser) => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  // (for the pictures only: the test server's support address is a placeholder; the pictures show the live site's own)
  if (SHOTS) await ctx.route('**/api/config', async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } }); });
  return { ctx, page: await ctx.newPage() };
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
};

test('the "ჩემი გზა" step: the About box under the three blocks, optional, saved exactly as written', async ({ browser }) => {
  const email = `about-apply-${tag}@e2e.test`;
  const c = await S.apiUser('სატესტო მენტორი', email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: HEADLINE } });
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email }, '/ka/apply.html?step=2');
  const form = page.locator('form[data-step="1"]');
  const about = form.locator('#ap-about');
  await expect(about).toBeVisible();
  await expect(form.locator('label[for="ap-about"]')).toContainText(KA['story.about.label']);
  await expect(form.locator('label[for="ap-about"]')).toContainText(KA['story.about.optional']);
  await expect(form.locator('#ap-about-ex')).toContainText(KA['story.about.ex']);
  expect(await about.getAttribute('maxlength'), 'nothing typed is ever cut').toBeNull();
  // under the three blocks of "ჩემი გზა"
  const below = await form.evaluate((f) => f.querySelector('#ap-pathNow').compareDocumentPosition(f.querySelector('#ap-about')) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(below, 'the About box comes after the three blocks').toBeTruthy();

  // optional: the path alone moves on
  await S.fillPath(page);
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=3$/);
  expect((await S.sql('SELECT bio FROM users WHERE email = $1', [email]))[0].bio, 'nothing is written into it by the site').toBeNull();

  // back, written: saved exactly, line breaks and all
  await page.goto('/ka/apply.html?step=2');
  await about.fill(ABOUT);
  await expect(form.locator('#ap-about-count')).toHaveText(KA['profile.bio.count'].replace('{n}', [...ABOUT].length).replace('{max}', 2000));
  await noOverflow(page);
  await page.evaluate(() => document.querySelector('#ap-about').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -260));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'about-apply-step-375.png'), fullPage: false });
  }
  await shot(page, 'about-apply-step-full-375.png');
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=3$/);
  expect((await S.sql('SELECT bio FROM users WHERE email = $1', [email]))[0].bio).toBe(ABOUT);
  await ctx.close();
});

test('the profile: "შესახებ" above "ჩემი გზა", the headline once; Settings → My details has the same box', async ({ browser }) => {
  const admin = await adminClient();
  const m = await S.listedMentor(admin, { name: 'სატესტო დიზაინერი', email: `about-profile-${tag}@e2e.test`, niche: 'design', roleTitle: HEADLINE.slice(0, 30), price: 25 });
  await m.client.api('/me', { method: 'PATCH', body: { headline: HEADLINE } });
  const r = await m.client.api('/me/details', { method: 'PUT', body: { pathStart: S.PATH.start, pathHow: S.PATH.how, pathNow: S.PATH.now, about: ABOUT } });
  expect(r.status, r.text).toBe(200);

  const { ctx, page } = await phoneKa(browser);
  await page.goto(`/ka/u/${m.username}`);
  const aboutSection = page.locator('.profile-about');
  const pathSection = page.locator('.profile-path');
  await expect(aboutSection).toBeVisible();
  await expect(aboutSection.locator('h2')).toHaveText(KA['expert.about']);
  await expect(aboutSection.locator('p')).toHaveText(ABOUT.replace(/\n\n/g, '\n\n'));
  await expect(pathSection.locator('h2')).toHaveText(KA['profile.path.title']);
  const order = await page.evaluate(() => {
    const a = document.querySelector('.profile-about').getBoundingClientRect().top;
    const p = document.querySelector('.profile-path').getBoundingClientRect().top;
    return a < p;
  });
  expect(order, '"შესახებ" is above "ჩემი გზა"').toBe(true);
  // the headline, once, under the name
  await expect(page.locator('.profile-head')).toContainText(HEADLINE);
  expect(await page.locator('.profile-head').evaluate((el, h) => el.textContent.split(h).length - 1, HEADLINE)).toBe(1);
  await expect(page.locator('.profile-head .profile-headline')).toHaveCount(0);
  await noOverflow(page);
  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'about-profile-375.png');
  }

  // without an About: no "შესახებ", only "ჩემი გზა"
  expect((await m.client.api('/me/details', { method: 'PUT', body: { about: '' } })).status).toBe(200);
  await page.reload();
  await expect(pathSection).toBeVisible();
  await expect(aboutSection).toHaveCount(0);

  // Settings → My details: the same box, with what the mentor wrote
  expect((await m.client.api('/me/details', { method: 'PUT', body: { about: ABOUT } })).status).toBe(200);
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details');
  const box = page.locator('#ds-about');
  await expect(box).toHaveValue(ABOUT);
  await expect(page.locator('label[for="ds-about"]')).toContainText(KA['story.about.label']);
  await noOverflow(page);
  await ctx.close();
});
