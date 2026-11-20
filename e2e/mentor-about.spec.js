// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "შენ შესახებ" / "About you" (tests/mentor-about.test.js has the rules), at 375px, in Georgian:
//   - the "ჩემი გზა" step has the About box under the three blocks: required (no "optional" in the label), with "N more characters
//     needed" until it has 150, and a grey example; "Save and continue" without it stays on the step and says under the box what is
//     missing, while the step is saved as a draft all the same; what is written in it is saved exactly
//   - Settings → My details has the same box, with the mentor's About in it, and asks for it before saving that section
//   - an approved mentor without one sees one card on the dashboard (to Settings → My details), until it is closed
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

const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), KA[key]);
// The About box in sight (with the end of "ჩემი გზა" above it), as a phone shows it.
async function aboutInView(page, name) {
  await page.evaluate(() => { document.querySelector('#ap-about').scrollIntoView({ block: 'start' }); window.scrollBy(0, -200); });
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

test('the "ჩემი გზა" step: the About box under the three blocks, required; the draft is saved without it; saved exactly as written', async ({ browser }) => {
  const email = `about-apply-${tag}@e2e.test`;
  const c = await S.apiUser('სატესტო მენტორი', email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: HEADLINE } });
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email }, '/ka/apply.html?step=2');
  const form = page.locator('form[data-step="1"]');
  const about = form.locator('#ap-about');
  const count = form.locator('#ap-about-count');
  const error = form.locator('#ap-about-err');
  await expect(about).toBeVisible();
  const label = form.locator('label[for="ap-about"]');
  await expect(label).toHaveText(KA['story.about.label'], { useInnerText: true });
  await expect(label).not.toContainText(KA['story.about.optional']);
  await expect(form.locator('#ap-about-ex')).toContainText(KA['story.about.ex']);
  expect(await about.getAttribute('maxlength'), 'nothing typed is ever cut').toBeNull();
  // under the three blocks of "ჩემი გზა"
  const below = await form.evaluate((f) => f.querySelector('#ap-pathNow').compareDocumentPosition(f.querySelector('#ap-about')) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(below, 'the About box comes after the three blocks').toBeTruthy();
  // the count: 150 more needed, then fewer as it is written
  await expect(count).toHaveText(fill('story.about.need', { left: 150, min: 150 }));
  await expect(error).toBeHidden();
  await S.fillPath(page, { about: false });
  await noOverflow(page);
  await aboutInView(page, 'about-step-empty-375.png');

  // "Save and continue" with the box empty: stays here, the box says what it needs, in focus; the path is saved (a draft)
  await form.locator('.apply-next').click();
  await expect(error).toBeVisible();
  await expect(error).toHaveText(fill('story.err.aboutShort', { min: 150, left: 150 }));
  await expect(about).toBeFocused();
  await expect(about).toHaveAttribute('aria-invalid', 'true');
  expect(page.url()).toMatch(/step=2$/);
  let row = (await S.sql('SELECT bio, path_start FROM users WHERE email = $1', [email]))[0];
  expect(row.bio, 'nothing is written into it by the site').toBeNull();
  expect(row.path_start, 'the step was saved as a draft').toBe(S.PATH.start);
  await noOverflow(page);
  await aboutInView(page, 'about-step-error-375.png');

  // too short: the count and the message say how many more; typing clears the message
  await about.fill('ვებგვერდებს ვქმნი.');
  await expect(error).toBeHidden();
  const short = 'ვებგვერდებს ვქმნი.'.length;
  await expect(count).toHaveText(fill('story.about.need', { left: 150 - short, min: 150 }));
  await form.locator('.apply-next').click();
  await expect(error).toHaveText(fill('story.err.aboutShort', { min: 150, left: 150 - short }));
  // "Continue later": the short About is kept as a draft
  await form.locator('[data-later]').click();
  await page.waitForURL(/\/dashboard\.html/);
  row = (await S.sql('SELECT bio FROM users WHERE email = $1', [email]))[0];
  expect(row.bio, 'a draft is saved however short').toBe('ვებგვერდებს ვქმნი.');

  // written: the count is satisfied, the step moves on, and it is saved exactly, line breaks and all
  await page.goto('/ka/apply.html?step=2');
  await about.fill(ABOUT);
  await expect(count).toHaveClass(/is-ok/);
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

  // Settings → My details: the same box, with what the mentor wrote
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details');
  const box = page.locator('#ds-about');
  await expect(box).toHaveValue(ABOUT);
  await expect(page.locator('label[for="ds-about"]')).toContainText(KA['story.about.label']);
  await expect(page.locator('label[for="ds-about"]')).not.toContainText(KA['story.about.optional']);
  await noOverflow(page);
  await ctx.close();
});

test('an approved mentor without an About: listed, "შესახებ" not shown, one card on the dashboard to My details, where a gentle tip asks for it (never a refused save)', async ({ browser }) => {
  const admin = await adminClient();
  const m = await S.listedMentor(admin, { name: 'სატესტო ფოტოგრაფი', email: `about-card-${tag}@e2e.test`, niche: 'design', roleTitle: 'ფოტოგრაფი', price: 25 });
  expect((await m.client.api('/me/details', { method: 'PUT', body: { pathStart: S.PATH.start, pathHow: S.PATH.how, pathNow: S.PATH.now } })).status).toBe(200);
  expect((await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBeNull();
  const { ctx, page } = await phoneKa(browser);
  // the profile: listed as before, only "ჩემი გზა"
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('.profile-path')).toBeVisible();
  await expect(page.locator('.profile-about')).toHaveCount(0);
  expect((await m.client.api('/me')).user.isListedMentor).toBe(true);

  // the dashboard: one card, to Settings → My details
  await S.logIn(page, { email: m.email }, '/ka/dashboard.html');
  const card = page.locator('#aboutCard .about-card');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText(KA['dash.about.title']);
  await expect(page.locator('.about-card')).toHaveCount(1);
  await noOverflow(page);
  await card.locator('a').click();
  await page.waitForURL(/settings\.html\?tab=details#about$/);
  const box = page.locator('#ds-about');
  await expect(box).toBeFocused();
  // (docs/CLAUDE-CODE-CARD-CHECKS.md: an approved mentor is never refused a save for the About's length; the count gives a gentle tip)
  await expect(page.locator('#ds-about-count')).toHaveText(fill('story.about.soft', { n: 0, min: 150, left: 150 }));
  await page.locator('#storyForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toHaveText(KA['story.saved']);
  await expect(page.locator('#ds-about-err')).toBeHidden();
  expect((await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBeNull();
  await box.fill(ABOUT);
  await expect(page.locator('#ds-about-err')).toBeHidden();
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBe(ABOUT);
  // written: no card
  await page.goto('/ka/dashboard.html');
  await expect(page.locator('#aboutCard')).toBeHidden();

  // without one again (as some mentors are): the card comes back until it is closed, and then it stays closed
  await S.sql('UPDATE users SET bio = NULL WHERE id = $1', [m.id]);
  await page.reload();
  await expect(card).toBeVisible();
  await card.locator('[data-about-dismiss]').click();
  await expect(page.locator('#aboutCard')).toBeHidden();
  await expect.poll(async () => (await S.sql('SELECT about_card_dismissed_at FROM users WHERE id = $1', [m.id]))[0].about_card_dismissed_at).not.toBeNull();
  await page.reload();
  await expect(page.locator('#aboutCard')).toBeHidden();
  expect((await m.client.api('/me')).user.isListedMentor, 'still listed').toBe(true);
  await ctx.close();
});
