// /apply.html step 2, the story (docs/CLAUDE-CODE-STORY-STEP-CHECK.md), in Georgian: a story the server would not count (test typing, the
// same words again and again) is refused on "Next" with a reason, saved as a draft all the same, and keeps step 2 without a tick; moving
// past it leaves a "!" on its dot and a line that says why when it is opened. A real story gets its tick at once.
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const REPEATED = 'ტესტი '.repeat(24).trim(); // (143 characters: long enough, but not writing)
const REAL = 'თბილისის სახელმწიფო უნივერსიტეტში თვრამეტი წელია მაკროეკონომიკას ვასწავლი და ეროვნული ბანკის ანგარიშებზე ვმუშაობდი.';
const tag = Date.now();
const person = { email: `story-check-${tag}@e2e.test` };

test.beforeAll(async () => {
  // steps 1 (about you) and 3 (the price) done
  const c = await S.apiUser('ნინო ისტორია', person.email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში', price: 40 } });
  await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მაკროეკონომიკა', yearsExperience: 18 } });
});

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('wisecall_lang')) localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, person);
  await page.goto('/apply.html?step=2');
  return { ctx, page };
}
const dot = (page, i) => page.locator('#applySteps li').nth(i);

test('a repeated story: the counter is not green, "Next" says why and stays, the draft is saved, step 2 gets no tick', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  expect(REPEATED.length).toBeGreaterThanOrEqual(120);
  await page.fill('#apStory', REPEATED);
  await expect(page.locator('#apStoryCount')).toHaveText(`${REPEATED.length} სიმბოლო – ტექსტი განმეორებადს ჰგავს`);
  await expect(page.locator('#apStoryCount')).not.toHaveClass(/is-ok/);
  await page.click('.apply-next');
  await expect(page.locator('.apply-error')).toHaveText('ეს ტექსტი განმეორებადს ჰგავს. დაწერე რამდენიმე ნამდვილი წინადადება შენს გამოცდილებაზე.');
  expect(new URL(page.url()).searchParams.get('step')).toBe('2');
  await expect(dot(page, 1)).not.toHaveClass(/is-done/);
  await expect(page.locator('#applyDoneText')).toHaveText('დასრულებულია 2 / 5');
  // nothing is lost: the text was saved as it was written
  await expect.poll(async () => (await S.sql('SELECT story FROM users WHERE email = $1', [person.email]))[0].story).toBe(REPEATED);
  await expect(page.locator('#apStory')).toHaveValue(REPEATED);

  // moving on by a step's number (no check): step 2 is left with a "!", and opened again it says why
  await dot(page, 2).locator('button').click();
  await page.waitForURL(/step=3$/);
  await expect(dot(page, 1)).toHaveClass(/has-gap/);
  await expect(dot(page, 1).locator('.apply-step-num')).toHaveText('!');
  await dot(page, 1).locator('button').click();
  await page.waitForURL(/step=2$/);
  await expect(page.locator('.apply-gap')).toContainText('ეს ტექსტი განმეორებადს ჰგავს.');
  await ctx.close();
});

test('a real story gets its tick at once, and the "!" goes', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.fill('#apStory', REAL);
  await expect(page.locator('#apStoryCount')).toHaveClass(/is-ok/);
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);
  await expect(dot(page, 1)).toHaveClass(/is-done/);
  await expect(dot(page, 1)).not.toHaveClass(/has-gap/);
  await expect(dot(page, 1).locator('.apply-step-num')).toHaveText('✓');
  await expect(page.locator('#applyDoneText')).toHaveText('დასრულებულია 3 / 5');
  await ctx.close();
});
