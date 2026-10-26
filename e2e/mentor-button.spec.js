// "Become a mentor" stays in sight when signed in (docs/CLAUDE-CODE-MENTOR-BUTTON-SIGNED-IN.md), in Georgian: for each state (signed out,
// asker, application started, sent, approved mentor, admin) the header (and the menu panel on a phone), the home page's second button and
// the dashboard show the right words and address. A new asker sees the dashboard card right after signing up.
//
// E2E_MENTOR_BUTTON_SHOTS=<folder> saves pictures of each state at 360px and 1280px (docs/quality-screens/mentor-button/).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_MENTOR_BUTTON_SHOTS;
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports. Students ask me how to choose a master programme abroad.';
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const KA = {
  become: 'გახდი მენტორი', hero: 'ექსპერტი ვარ – გავხდე მენტორი', continue2: 'განაცხადის გაგრძელება · ნაბიჯი 2 / 5', short2: 'განაცხადი · 2/5',
  review: 'განაცხადი განხილვაშია', reviewShort: 'განხილვაშია', askerCard: 'გინდა შენი გამოცდილება სხვებს გაუზიარო?', draftCard: 'განაცხადის გაგრძელება – ნაბიჯი 2 / 5',
  sentCard: 'შენი მენტორის განაცხადი განხილვაშია'
};
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}

async function pageFor(browser, width, who) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, isMobile: width < 400, hasTouch: width < 400 });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  if (who) await S.logIn(page, { email: who.email });
  return { ctx, page };
}
// (in Georgian every link leads to the Georgian page: docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md #2)
const ka = (href) => '/ka' + href;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

// What the desktop header, the home page and the dashboard show for one person. want: { nav: [words, href] | null, hero: [words, href] |
// null, card: words | null }
async function check(browser, key, who, want) {
  // ---- 1280px: the header, the home page, the dashboard
  const { ctx, page } = await pageFor(browser, 1280, who);
  await page.goto('/ka/');
  await page.waitForLoadState('networkidle');
  const nav = page.locator('#navLoggedIn [data-mentor-cta="nav"]');
  if (want.nav) {
    await expect(nav).toBeVisible();
    await expect(nav).toHaveText(want.nav[0], { useInnerText: true }); // (the words shown: the short ones where the header is narrow)
    await expect(nav).toHaveAttribute('href', ka(want.nav[1]));
  } else await expect(nav).toHaveCount(0);
  await expect(page.locator('.nav-links .nl-mentor')).toHaveCount(who ? 0 : 1);
  const hero = page.locator('[data-mentor-cta="hero"]');
  if (want.hero) {
    await expect(hero).toBeVisible();
    await expect(hero).toHaveText(want.hero[0]);
    await expect(hero).toHaveAttribute('href', ka(want.hero[1]));
  } else await expect(hero).toBeHidden();
  await shot(page, `1280-${key}-home`);
  if (who) {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');
    const card = page.locator('#mentorCard .mentor-card');
    if (want.card) {
      await expect(card.locator('h2')).toHaveText(want.card);
      await expect(card.locator('a')).toHaveAttribute('href', ka(want.hero[1]));
    } else await expect(card).toHaveCount(0);
    await shot(page, `1280-${key}-dashboard`);
  }
  await ctx.close();

  // ---- 360px: the menu panel (the full words), the home page and the dashboard
  const phone = await pageFor(browser, 360, who);
  await phone.page.goto('/ka/');
  await phone.page.waitForLoadState('networkidle');
  await shot(phone.page, `360-${key}-home`);
  await phone.page.click('#navToggle');
  const menu = phone.page.locator('#mmLoggedIn [data-mentor-cta="menu"]');
  if (want.nav) {
    await expect(menu).toBeVisible();
    await expect(menu).toHaveText(want.menu || want.nav[0]);
    await expect(menu).toHaveAttribute('href', ka(want.nav[1]));
  } else await expect(menu).toHaveCount(0);
  if (!who) await expect(phone.page.locator('.mm-links .nl-mentor')).toHaveAttribute('href', ka('/become-a-mentor.html'));
  await shot(phone.page, `360-${key}-menu`);
  if (who && want.card) {
    await phone.page.goto('/dashboard.html');
    await phone.page.waitForLoadState('networkidle');
    await expect(phone.page.locator('#mentorCard h2')).toHaveText(want.card);
    await shot(phone.page, `360-${key}-dashboard`);
  }
  await phone.ctx.close();
}

test.beforeAll(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const admin = await adminClient();
  // an asker
  people.asker = { email: `asker-${tag}@e2e.test` };
  await S.apiUser('ანა მკითხველი', people.asker.email);
  // an application started: what I do, the field and the years (step 1 done: they continue from step 2)
  people.draft = { email: `draft-${tag}@e2e.test` };
  const d = await S.apiUser('დათო განაცხადი', people.draft.email);
  await d.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში' } });
  await d.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მაკროეკონომიკა', yearsExperience: 18 } });
  // sent, waiting for review
  people.sent = { email: `sent-${tag}@e2e.test` };
  const s = await S.apiUser('სოფო გაგზავნილი', people.sent.email);
  await s.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'მეღვინე კახეთში', price: 30 } });
  await s.api('/verification/experience', { method: 'PUT', body: { customNiche: 'ქართული ღვინო', yearsExperience: 12, story: STORY } });
  await s.api('/verification/evidence', { method: 'POST', body: { url: 'https://sopo-wines.example.com/about' } });
  const sent = await s.api('/verification/submit', { method: 'POST' });
  if (sent.status !== 200) throw new Error('submit failed: ' + sent.text);
  // an approved mentor
  people.mentor = { email: `mentor-${tag}@e2e.test` };
  await S.listedMentor(admin, { name: 'მარიამ მენტორი', email: people.mentor.email });
  people.admin = ADMIN;
});

test('signed out: "Become a mentor" among the main links, to the mentors\' page; the home button as before', async ({ browser }) => {
  await check(browser, 'signed-out', null, { nav: null, hero: [KA.hero, '/become-a-mentor.html'], card: null });
});

test('an asker: "გახდი მენტორი" next to Dashboard, to /apply.html; the home button to /apply.html; the dashboard card', async ({ browser }) => {
  await check(browser, 'asker', people.asker, { nav: [KA.become, '/apply.html'], hero: [KA.hero, '/apply.html'], card: KA.askerCard });
});

test('an application started: "continue · step 2 of 5" to /apply.html?step=2 (short in the desktop header), on the home page and the dashboard', async ({ browser }) => {
  await check(browser, 'draft', people.draft, { nav: [KA.short2, '/apply.html?step=2'], menu: KA.continue2, hero: [KA.continue2, '/apply.html?step=2'], card: KA.draftCard });
});

test('sent: the status "in review" linking to /apply.html, on the home page and the dashboard', async ({ browser }) => {
  await check(browser, 'sent', people.sent, { nav: [KA.reviewShort, '/apply.html'], menu: KA.review, hero: [KA.review, '/apply.html'], card: KA.sentCard });
});

test('an approved mentor and an admin: nothing extra', async ({ browser }) => {
  await check(browser, 'mentor', people.mentor, { nav: null, hero: null, card: null });
  await check(browser, 'admin', people.admin, { nav: null, hero: null, card: null });
});

test('a new asker sees the dashboard card right after signing up', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  await S.signUp(page, { name: 'ახალი მომხმარებელი', email: `new-${tag}@e2e.test` });
  await expect(page.locator('#mentorCard h2')).toHaveText(KA.askerCard);
  await expect(page.locator('#mentorCard a')).toHaveAttribute('href', ka('/apply.html'));
});
