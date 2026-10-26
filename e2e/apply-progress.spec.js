// The application's progress counts the steps that are done, not the step that is open (docs/CLAUDE-CODE-APPLY-PROGRESS.md), in Georgian:
// steps 1 and 3 done and step 2 open shows "ნაბიჯი 2: ისტორია", "დასრულებულია 2 / 5", a 40% bar and "განაცხადი · 2/5" in the header,
// and "Continue" leads to step 2; saving a step ticks it at once, and emptying one takes its tick away; all five done is 5/5 and a full bar.
//
// E2E_APPLY_SHOTS=<folder> saves /apply.html and the Settings card at 360px and 1280px (docs/quality-screens/apply-progress/).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_APPLY_SHOTS;
const STORY = 'თბილისის სახელმწიფო უნივერსიტეტში თვრამეტი წელია მაკროეკონომიკას ვასწავლი და ეროვნული ბანკის ინფლაციის ანგარიშებზე ვმუშაობდი. სტუდენტები ხშირად მეკითხებიან, როგორ აირჩიონ მაგისტრატურა საზღვარგარეთ.';
const tag = Date.now();
const people = {};

async function pageFor(browser, width, who) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, isMobile: width < 400, hasTouch: width < 400 });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('wisecall_lang')) localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: who.email });
  return { ctx, page };
}
const barWidth = (page) => page.locator('#applyBar span').evaluate((el) => Math.round((el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width) * 100));
async function expectProgress(page, { step, name, done, ticks }) {
  await expect(page.locator('#applyProgressText')).toHaveText(`ნაბიჯი ${step}: ${name}`);
  await expect(page.locator('#applyDoneText')).toHaveText(`დასრულებულია ${done} / 5`);
  await expect(page.locator('#applyBar')).toHaveAttribute('aria-valuenow', String(done));
  await expect.poll(() => barWidth(page)).toBe(done * 20);
  const marks = await page.locator('#applySteps li').evaluateAll((lis) => lis.map((li) => li.classList.contains('is-done')));
  expect(marks).toEqual(ticks);
}

test.beforeAll(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  // steps 1 (about you) and 3 (the price) done; step 2 (the story) and step 4 (proof) not yet
  people.half = { email: `progress-half-${tag}@e2e.test` };
  const h = await S.apiUser('ნინო ნახევარი', people.half.email);
  await h.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში', price: 40 } });
  await h.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მაკროეკონომიკა', yearsExperience: 18 } });
  // everything done, the ID check passed too (not sent yet)
  people.all = { email: `progress-all-${tag}@e2e.test`, name: 'ლევან სრული' };
  const a = await S.apiUser(people.all.name, people.all.email);
  await a.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'მეღვინე კახეთში', price: 30 } });
  await a.api('/verification/experience', { method: 'PUT', body: { customNiche: 'ქართული ღვინო', yearsExperience: 12, story: STORY } });
  await a.api('/verification/evidence', { method: 'POST', body: { url: `https://levan-wines-${tag}.example.com/about` } });
  const start = await a.api('/verification/kyc/start', { method: 'POST' });
  if (start.status !== 200) throw new Error('ID check failed to start: ' + start.text);
  await client(S.BASE).api(`/mock-kyc/sessions/${start.url.split('=').pop()}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: people.all.name, dateOfBirth: '1988-03-02' } });
  await expect.poll(async () => (await a.api('/verification')).requirements.find((r) => r.step === 'id_kyc').status, { timeout: 15000 }).toBe('passed');
});

test('steps 1 and 3 done, step 2 open: "ნაბიჯი 2: ისტორია", 2 of 5 done, a 40% bar, "2/5" in the header; Continue goes to step 2', async ({ browser }) => {
  for (const width of [1280, 360]) {
    const { ctx, page } = await pageFor(browser, width, people.half);
    await page.goto('/apply.html?step=2');
    await expectProgress(page, { step: 2, name: 'ისტორია', done: 2, ticks: [true, false, true, false, false] });
    if (width === 1280) await expect(page.locator('#navLoggedIn [data-mentor-cta="nav"] .nm-short')).toHaveText('განაცხადი · 2/5');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-apply-step2.png` });
    // the Settings card: the same count, and "Continue" to the first unfinished step
    await page.goto('/settings.html');
    const card = page.locator('#appProgress');
    await expect(card.locator('[data-app-state]')).toHaveText('დასრულებულია 2 / 5');
    await expect(card.locator('.vt-bar')).toHaveAttribute('aria-valuenow', '2');
    await expect(card.locator('[data-app-button]')).toHaveText('გაგრძელება – ნაბიჯი 2 / 5');
    await expect(card.locator('[data-app-button]')).toHaveAttribute('href', '/ka/apply.html?step=2');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-settings-card.png` });
    // the home page's button and the dashboard card go to step 2 as well
    await page.goto('/ka/');
    await expect(page.locator('[data-mentor-cta="hero"]')).toHaveAttribute('href', '/ka/apply.html?step=2');
    await ctx.close();
  }
});

test('saving a step ticks it at once (no reload), and the header follows; emptying a step takes its tick away', async ({ browser }) => {
  const { ctx, page } = await pageFor(browser, 1280, people.half);
  await page.goto('/apply.html?step=2');
  await expectProgress(page, { step: 2, name: 'ისტორია', done: 2, ticks: [true, false, true, false, false] });
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.fill('#apStory', STORY);
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);
  await expectProgress(page, { step: 3, name: 'ფასი', done: 3, ticks: [true, true, true, false, false] });
  await expect(page.locator('#navLoggedIn [data-mentor-cta="nav"] .nm-short')).toHaveText('განაცხადი · 3/5');
  // step 1 emptied (the headline removed), then on to step 3 by its number: step 1 loses its tick
  await page.locator('#applySteps [data-goto="0"]').click();
  await page.waitForURL(/step=1$/);
  await page.fill('#apHeadline', '');
  await page.locator('#applySteps [data-goto="2"]').click();
  await page.waitForURL(/step=3$/);
  await expectProgress(page, { step: 3, name: 'ფასი', done: 2, ticks: [false, true, true, false, false] });
  await expect(page.locator('#navLoggedIn [data-mentor-cta="nav"] .nm-short')).toHaveText('განაცხადი · 2/5');
  expect(loads, 'nothing was reloaded').toBe(0);
  // ... and "Continue" now leads back to step 1
  await page.goto('/settings.html');
  await expect(page.locator('#appProgress [data-app-button]')).toHaveAttribute('href', '/ka/apply.html?step=1');
  await ctx.close();
});

test('all five steps done (the ID check passed): 5 of 5 and a full bar', async ({ browser }) => {
  for (const width of [1280, 360]) {
    const { ctx, page } = await pageFor(browser, width, people.all);
    await page.goto('/apply.html');
    await expectProgress(page, { step: 5, name: 'გაგზავნა', done: 5, ticks: [true, true, true, true, true] });
    if (width === 1280) await expect(page.locator('#navLoggedIn [data-mentor-cta="nav"] .nm-short')).toHaveText('განაცხადი · 5/5');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-apply-all-done.png` });
    await ctx.close();
  }
});
