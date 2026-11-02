// Didit with no balance: the check cannot start, and the mentor reads why in words, in sight at 360px (not under the "დაწყება" button).
const { test, expect } = require('@playwright/test');
const S = require('./support');

const OUT = process.env.E2E_SHOTS;
const stamp = Date.now();
const NO_CREDIT = 'პირადობის შემოწმება დროებით მიუწვდომელია, მალე ჩაირთვება. ჩვენ მოგწერთ.';
const STORY = 'ათი წელია ვასწავლი მაკროეკონომიკას უნივერსიტეტში და ვმუშაობ ეროვნული ბანკის ანგარიშებზე, სტუდენტებს ვეხმარები პროგრამის არჩევაში და კარიერის დაწყებაში ყოველ წელს.';

let n = 0;
async function mentor({ filled }) {
  const email = `nocredit-${stamp}-${++n}@e2e.test`;
  const c = await S.apiUser('ნინო ბერიძე', email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი თსუ-ში', price: 40 } });
  if (filled) {
    await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'პროფესორი', customNiche: 'მაკროეკონომიკა', niche: 'business', yearsExperience: 10, story: STORY } });
    await c.api('/verification/evidence', { method: 'POST', body: { url: `https://www.tsu.ge/ka/staff/nocredit-${stamp}-${n}` } });
  }
  return email;
}

// The error is on screen, whole, and nothing lies on top of it (the button, the next block).
async function inSight(page, error) {
  await expect(error).toHaveText(NO_CREDIT);
  await expect(error).toBeVisible();
  await error.scrollIntoViewIfNeeded();
  const box = await error.boundingBox();
  expect(box.height).toBeGreaterThan(20);
  const covered = await error.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [[0.1, 0.25], [0.5, 0.5], [0.9, 0.75]].some(([x, y]) => {
      const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
      return !hit || !(hit === el || el.contains(hit));
    });
  });
  expect(covered).toBe(false);
  for (const b of await page.locator('[data-id-start], [data-kyc-start]').all()) {
    if (!(await b.isVisible())) continue;
    const bb = await b.boundingBox();
    expect(bb.y + bb.height <= box.y || box.y + box.height <= bb.y).toBe(true);
  }
}

for (const filled of [true, false]) {
  test(`step 5 at 360px, Didit out of credit (${filled ? 'steps 1-4 done' : 'steps 1-4 not done'})`, async ({ browser }) => {
    const email = await mentor({ filled });
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    await S.logIn(page, { email });
    await page.route('**/api/verification/kyc/start', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'kyc_no_credit' }) }));
    await page.goto('/ka/apply.html?step=5');
    const start = page.locator('[data-id-start]').first();
    await start.click();
    await inSight(page, page.locator('.id-card-error').first());
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (OUT) await page.screenshot({ path: `${OUT}/id-no-credit-360-${filled ? 'filled' : 'early'}.png`, fullPage: false });
    await ctx.close();
  });
}
