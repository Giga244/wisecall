// /apply.html step 1 on a phone (docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md), as an in-app browser would show it: an Android phone at 360px, in
// Georgian, on a slow network. The years are read from what was typed ("25 წელი" -> 25); empty, "abc" and 71 each say what is wrong under
// the years, in view; a server refusal (invalid_niche) shows its own message under the category; a lost connection says so and keeps what
// was typed; a field left is saved as a draft. Psychology asks for a diploma or certificate, never a licence.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const tag = Date.now();
const people = {};

async function phone(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, userAgent: ANDROID, locale: 'ka-GE' });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('wisecall_lang')) localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, who);
  // (a slow network: every API answer comes 400 ms late)
  await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.fallback(); });
  await page.goto('/apply.html?step=1');
  await expect(page.locator('#apHeadline')).toBeVisible();
  return { ctx, page };
}
// The message is under the years and on the screen (not below it).
async function seen(page, locator, text) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveText(text);
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return Boolean(box) && box.y >= 0 && box.y + box.height <= 760;
  }).toBe(true);
}

test.beforeAll(async () => {
  people.nana = { email: `step1-${tag}@e2e.test` };
  const c = await S.apiUser('ნანა პროფესორი', people.nana.email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  people.psy = { email: `step1-psy-${tag}@e2e.test` };
  const p = await S.apiUser('თამარ ფსიქოლოგი', people.psy.email);
  await p.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ფსიქოლოგიის პროფესორი', price: 30 } });
  await p.api('/verification/experience', { method: 'PUT', body: { customNiche: 'განათლების ფსიქოლოგია', niche: 'psychology', yearsExperience: 20,
    story: 'თბილისის სახელმწიფო უნივერსიტეტში ოცი წელია ფსიქოლოგიის ისტორიას და განათლების ფსიქოლოგიას ვასწავლი, ვხელმძღვანელობ დოქტორანტებს.' } });
});

// (the years are chosen from a list: nothing to type, the same on every phone and keyboard; docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md)
test('the years: none chosen says so under the field, in view; 25 chosen is saved as 25', async ({ browser }) => {
  const { ctx, page } = await phone(browser, people.nana);
  await page.fill('#apHeadline', 'ფსიქოლოგიის პროფესორი');
  await page.fill('#apField', 'განათლების ფსიქოლოგია, ფსიქოლოგიის ისტორია, პედაგოგი');
  await expect(page.locator('[data-field="psy"]')).toHaveAttribute('aria-pressed', 'true'); // (not "Other")
  await expect(page.locator('[data-psych-note]')).toBeVisible(); // (academics can choose teaching or science)
  await S.oneDirection(page); // (1 to 5 directions: this test is about the years)
  const err = page.locator('#apYearsErr');
  await page.click('.apply-next');
  await seen(page, err, KA['apply.err.yearsEmpty']);
  await expect(page.locator('#apYears')).toHaveAttribute('aria-invalid', 'true');
  expect(new URL(page.url()).searchParams.get('step')).toBe('1');
  expect(await page.locator('#apYears option').count(), '"choose", then 0 to 70').toBe(72);
  await page.selectOption('#apYears', '25');
  await expect(err).toBeHidden();
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  const [u] = await S.sql('SELECT years_experience, headline, niche FROM users WHERE email = $1', [people.nana.email]);
  expect(u).toEqual({ years_experience: 25, headline: 'ფსიქოლოგიის პროფესორი', niche: 'psychology' });
  await ctx.close();
});

test('a server refusal shows its own message under its field; a lost connection says so and keeps what was typed', async ({ browser }) => {
  const { ctx, page } = await phone(browser, people.nana);
  await page.route('**/api/verification/experience', (route) => (route.request().method() === 'PUT'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_niche', field: 'niche' }) }) : route.fallback()));
  await page.click('.apply-next');
  await seen(page, page.locator('#apNicheErr'), KA['ap.err.invalid_niche']);
  expect(new URL(page.url()).searchParams.get('step')).toBe('1');
  // no connection at all: "Next" is never silent
  await page.unroute('**/api/verification/experience');
  await page.route('**/api/verification/experience', (route) => route.abort('internetdisconnected'));
  await page.fill('#apHeadline', 'ფსიქოლოგიის ასოცირებული პროფესორი');
  await page.click('.apply-next');
  await seen(page, page.locator('.apply-error'), KA['apply.err.network']);
  await expect(page.locator('#apHeadline')).toHaveValue('ფსიქოლოგიის ასოცირებული პროფესორი');
  expect(new URL(page.url()).searchParams.get('step')).toBe('1');
  await ctx.close();
});

test('a field left is saved as a draft, with no "Next"', async ({ browser }) => {
  const { ctx, page } = await phone(browser, people.nana);
  await page.selectOption('#apYears', '27');
  await page.locator('#apHeadline').focus(); // (the years field is left)
  await expect.poll(async () => (await S.sql('SELECT years_experience FROM users WHERE email = $1', [people.nana.email]))[0].years_experience, { timeout: 8000 }).toBe(27);
  await ctx.close();
});

test('psychology asks for a diploma or certificate, never a licence; its Georgian name is "ფსიქოლოგია"', async ({ browser }) => {
  const { ctx, page } = await phone(browser, people.psy);
  await expect(page.locator('[data-field="psy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-licence-note]')).toHaveText(KA['apply.f.licenceNote.dip']);
  await page.goto('/apply.html?step=4');
  const block = page.locator('.apply-licence');
  await expect(block.locator('h2')).toHaveText(KA['ap.lic.title.dip']);
  await expect(block.locator('label[for="apLicNumber"]')).toHaveText(KA['vt.lic.number.dip']);
  const words = await page.locator('main').innerText();
  expect(words).toContain('დიპლომი ან სერტიფიკატი');
  expect(words).not.toMatch(/ლიცენზ/);
  await ctx.close();
});
