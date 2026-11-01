// The QR code for the ID check on a computer (docs/CLAUDE-CODE-ID-QR-BUG.md): on every screen with the button, a real picture appears and stays, in Georgian at 1280px.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

const OUT = process.env.E2E_SHOTS;
const stamp = Date.now();
const STORY = 'ათი წელია ვასწავლი მაკროეკონომიკას უნივერსიტეტში და ვმუშაობ ეროვნული ბანკის ანგარიშებზე, სტუდენტებს ვეხმარები პროგრამის არჩევაში და კარიერის დაწყებაში ყოველ წელს.';

async function filledIn(c) {
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში', price: 40 } });
  await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'პროფესორი', customNiche: 'მაკროეკონომიკა', niche: 'business', yearsExperience: 10, story: STORY } });
  await c.api('/verification/evidence', { method: 'POST', body: { url: `https://www.tsu.ge/ka/staff/qr-${stamp}` } });
}
async function pageFor(browser, email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email });
  return { ctx, page };
}
// The picture is there, has a real size, on white, and is still there a moment later.
async function seesCode(page, box) {
  const svg = page.locator(`${box} svg`);
  await expect(svg).toBeVisible();
  const size = await svg.boundingBox();
  expect(size.width).toBeGreaterThan(100);
  expect(size.height).toBeGreaterThan(100);
  expect(await svg.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await page.locator(`${box} svg path`).count()).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await expect(svg).toBeVisible();
}

let n = 0;
async function mentor(name, { filled = true } = {}) {
  const email = `qr-${stamp}-${++n}@e2e.test`;
  const c = await S.apiUser(name, email);
  if (filled) await filledIn(c);
  else await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  return { email, c };
}

test('step 5 of the application, on a computer', async ({ browser }) => {
  const m = await mentor('ნინო ბერიძე');
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/apply.html?step=5');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  if (OUT) await page.screenshot({ path: `${OUT}/id-qr-apply-1280-ka.png`, fullPage: false });
  await ctx.close();
});

test('step 5 before the other steps are done: the same picture', async ({ browser }) => {
  const m = await mentor('დათო კაპანაძე', { filled: false });
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/apply.html?step=5');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('the "one step left" card on the dashboard', async ({ browser }) => {
  const m = await mentor('თამარ გელაშვილი');
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/dashboard.html');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('the "one step left" card in Settings', async ({ browser }) => {
  const m = await mentor('გიორგი მაისურაძე');
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/settings.html');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('a mentor from before the age question: the check is not blocked by it', async ({ browser }) => {
  const m = await mentor('ლევან ჩხეიძე');
  await S.sql('UPDATE users SET birth_ym = NULL, age_group = NULL, age_confirmed_at = NULL WHERE email = $1', [m.email]);
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/apply.html?step=5');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('a computer in a narrower window or zoomed in still gets the button', async ({ browser }) => {
  const m = await mentor('ანა ხარაიშვილი');
  const { ctx, page } = await pageFor(browser, m.email, { viewport: { width: 800, height: 800 } });
  await page.goto('/ka/apply.html?step=5');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('the dark theme keeps the white background', async ({ browser }) => {
  const m = await mentor('ეკა ნოზაძე');
  const { ctx, page } = await pageFor(browser, m.email, { colorScheme: 'dark' });
  await page.goto('/ka/apply.html?step=5');
  await page.locator('[data-id-qr]').click();
  await seesCode(page, '.id-card-qr');
  await ctx.close();
});

test('when the code cannot be made: the reason, and the link to open on a phone', async ({ browser }) => {
  const m = await mentor('სოფო ლომიძე');
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/apply.html?step=5');
  await page.route('**/api/verification/kyc/start', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'qr_failed', url: 'https://verify.example/session/abc' }) }));
  await page.locator('[data-id-qr]').click();
  const box = page.locator('.id-card-qr');
  await expect(box).toContainText('გახსენი ტელეფონზე');
  await expect(box.locator('input')).toHaveValue('https://verify.example/session/abc');
  await expect(page.locator('.id-card-error')).toContainText('QR კოდი');
  if (OUT) await page.screenshot({ path: `${OUT}/id-qr-fallback-1280-ka.png` });
  await ctx.close();
});

test('when the check cannot start: the reason in Georgian, never an empty box', async ({ browser }) => {
  const m = await mentor('ირაკლი წერეთელი');
  const { ctx, page } = await pageFor(browser, m.email);
  await page.goto('/ka/apply.html?step=5');
  await page.route('**/api/verification/kyc/start', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'kyc_error' }) }));
  await page.locator('[data-id-qr]').click();
  await expect(page.locator('.id-card-error')).toContainText('პირადობის შემოწმება');
  await expect(page.locator('.id-card-qr')).toBeHidden();
  await expect(page.locator('[data-id-qr]')).toBeEnabled();
  await ctx.close();
});
