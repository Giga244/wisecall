// One place to apply as a mentor (docs/CLAUDE-CODE-ONE-APPLY-PATH.md), in Georgian: Settings has no application form, only a card at the
// top that says where the application stands with one button to /apply.html at the right step (none, step 2, sent, rejected; no card
// for an approved mentor or an admin); an old link to Settings -> Verification opens the application; an application started in the old
// form comes back whole in /apply.html.
//
// E2E_ONE_APPLY_SHOTS=<folder> saves Settings for each state at 360px and 1280px (docs/quality-screens/one-apply-path/).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_ONE_APPLY_SHOTS;
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports. Students ask me how to choose a master programme abroad.';
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}
// A full application through the API, as the old Settings form left it (a title, tags and a sample answer too).
async function filledIn(c, extra = {}) {
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში', price: 40 } });
  await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'ასოცირებული პროფესორი', customNiche: 'მაკროეკონომიკა', niche: 'business', specialtyTags: ['ინფლაცია', 'მაგისტრატურა'], yearsExperience: 18, story: STORY, sampleAnswer: 'პირველ რიგში აირჩიე ის პროგრამა, სადაც შენი თემის კვლევა მიმდინარეობს, და მისწერე იქაურ პროფესორს, სანამ განაცხადს გააგზავნი.', ...extra } });
  await c.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/ka/staff/economics-1' } });
}

async function pageFor(browser, width, who) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, isMobile: width < 400, hasTouch: width < 400 });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: who.email });
  return { ctx, page };
}

test.beforeAll(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const admin = await adminClient();
  people.asker = { email: `oap-asker-${tag}@e2e.test` };
  await S.apiUser('ანა მკითხველი', people.asker.email);
  people.draft = { email: `oap-draft-${tag}@e2e.test` };
  const d = await S.apiUser('დათო განაცხადი', people.draft.email);
  await d.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში' } });
  await d.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მაკროეკონომიკა', yearsExperience: 18 } });
  people.sent = { email: `oap-sent-${tag}@e2e.test` };
  const s = await S.apiUser('სოფო გაგზავნილი', people.sent.email);
  await filledIn(s);
  if ((await s.api('/verification/submit', { method: 'POST' })).status !== 200) throw new Error('submit failed');
  people.rejected = { email: `oap-rejected-${tag}@e2e.test` };
  const r = await S.apiUser('ლევან უარყოფილი', people.rejected.email);
  await filledIn(r);
  await r.api('/verification/submit', { method: 'POST' });
  const rid = (await S.sql('SELECT id FROM users WHERE email = $1', [people.rejected.email]))[0].id;
  const rej = await admin.api(`/admin/mentors/${rid}/reject`, { method: 'POST', body: { reason: 'ბმული შენს საქმიანობას არ აჩვენებს: დაამატე უნივერსიტეტის გვერდი.' } });
  if (rej.status !== 200) throw new Error('reject failed: ' + rej.text);
  people.mentor = { email: `oap-mentor-${tag}@e2e.test` };
  await S.listedMentor(admin, { name: 'მარიამ მენტორი', email: people.mentor.email });
  people.admin = ADMIN;
});

// state -> [the card's label, the button's words, its address] (null: no card)
const KA = {
  asker: ['არ დაწყებულა', 'განაცხადის დაწყება', '/apply.html'],
  draft: ['ნაბიჯი 2 / 5', 'გაგრძელება – ნაბიჯი 2 / 5', '/apply.html?step=2'],
  sent: ['გაგზავნილია – განხილვაშია', 'ჩემი განაცხადის ნახვა', '/apply.html'],
  rejected: ['არ დამტკიცდა', 'ჩემი განაცხადის ნახვა', '/apply.html'],
  mentor: null,
  admin: null
};

for (const state of Object.keys(KA)) {
  test(`Settings for ${state === 'asker' ? 'someone who has not applied' : state}: ${KA[state] ? `"${KA[state][0]}", one button to ${KA[state][2]}` : 'no card'}; no application form`, async ({ browser }) => {
    for (const width of [1280, 360]) {
      const { ctx, page } = await pageFor(browser, width, people[state]);
      await page.goto('/settings.html');
      await page.waitForLoadState('networkidle');
      const card = page.locator('#appProgress');
      if (KA[state]) {
        await expect(card).toBeVisible();
        await expect(card.locator('[data-app-state]')).toHaveText(KA[state][0]);
        await expect(card.locator('[data-app-button]')).toHaveText(KA[state][1]);
        await expect(card.locator('[data-app-button]')).toHaveAttribute('href', '/ka' + KA[state][2]); // (in Georgian, the Georgian page)
        if (state === 'rejected') await expect(card.locator('.app-card-reason')).toContainText('დაამატე უნივერსიტეტის გვერდი');
      } else await expect(card).toBeHidden();
      // never the old form: no experience or evidence form, no "Submit for review", no "I'd like to offer advice" checkbox
      await expect(page.locator('form[data-form="experience"], form[data-form="evidence"], [data-submit], #becomeMentor')).toHaveCount(0);
      // the tabs: Mentor and Verification for an approved mentor only, and no tab is empty
      const approved = state === 'mentor';
      await expect(page.locator('#tab-mentor')).toBeVisible({ visible: approved });
      await expect(page.locator('#tab-verification')).toBeVisible({ visible: approved });
      if (approved) {
        await page.click('#tab-verification');
        await expect(page.locator('#ap-identity')).toBeVisible();
        await expect(page.locator('#ap-application [data-edit]')).toBeVisible();
      }
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${state}.png`, fullPage: false });
      await ctx.close();
    }
  });
}

test('the old address Settings -> Verification opens the application at the right step', async ({ browser }) => {
  const { ctx, page } = await pageFor(browser, 1280, people.draft);
  await page.goto('/settings.html?tab=verification');
  await page.waitForURL(/\/apply\.html\?step=2$/);
  await page.goto('/ka/settings.html?tab=verification');
  await page.waitForURL(/\/ka\/apply\.html\?step=2$/);
  await ctx.close();
  const sent = await pageFor(browser, 1280, people.sent);
  await sent.page.goto('/settings.html?tab=verification');
  await sent.page.waitForURL(/\/apply\.html$/);
  await expect(sent.page.locator('.apply-done')).toBeVisible();
  await sent.ctx.close();
});

test('an application started in the old Settings form comes back whole in /apply.html, the optional parts too', async ({ browser }) => {
  const { ctx, page } = await pageFor(browser, 1280, people.rejected); // (sent back: open again for changes)
  await page.goto('/apply.html?step=1');
  await expect(page.locator('#apHeadline')).toHaveValue('ეკონომიკის პროფესორი თსუ-ში');
  await expect(page.locator('#apField')).toHaveValue('მაკროეკონომიკა');
  await expect(page.locator('#apYears')).toHaveValue('18');
  await expect(page.locator('#apTitle')).toHaveValue('ასოცირებული პროფესორი');
  await expect(page.locator('#apTags')).toHaveValue('ინფლაცია, მაგისტრატურა');
  await expect(page.locator('form[data-step="0"] .apply-optional')).toHaveAttribute('open', ''); // (open: something is in it)
  await page.goto('/apply.html?step=2');
  await expect(page.locator('#apStory')).toHaveValue(STORY);
  await expect(page.locator('#apSample')).toHaveValue(/პირველ რიგში აირჩიე/);
  await page.goto('/apply.html?step=3');
  await expect(page.locator('#apPrice')).toHaveValue('40');
  await page.goto('/apply.html?step=4');
  await expect(page.locator('.apply-evidence li')).toHaveCount(1);
  await ctx.close();
});
