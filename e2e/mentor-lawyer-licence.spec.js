// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A lawyer needs only their bar number (tests/lawyer-licence.test.js has the rules). On a 375px phone, in Georgian, a lawyer whose
// application is filled in up to the proof step:
//   - step 4 opens on the licence: the number, who issued it, the name; "ვადა არ აქვს" is ticked and the date is put away; nothing asks
//     for a file; a link or a document is offered below as optional
//   - "Next" with no number says where to write it; with "ვადა არ აქვს" unticked and no date, the form asks for one of the two
//   - the number, the issuing body and a second jurisdiction ("New York State Bar", no number) are sent: step 5 has nothing missing
//   - the admin's card shows the number, "ვადა არ აქვს", the second jurisdiction and the register to look the number up in
// The picture for the owner: E2E_LAW_SHOTS=<folder>.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_LAW_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN_KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const NAME = 'სატესტო იურისტი';
const EMAIL = `lawyer-${tag}@e2e.test`;
const STORY = 'ცხრამეტი წელია იურისტი ვარ. დავიწყე პატარა კომპანიებისთვის ხელშეკრულებების შედგენით, შემდეგ პარტნიორებს შორის დავებზე ვმუშაობდი, ბოლო ათი წელია კი თბილისში იურიდიული ფირმის კორპორაციულ პრაქტიკას ვხელმძღვანელობ. ვურჩევ დამფუძნებლებს, როგორ დააარსონ კომპანია, როგორ მოიზიდონ ინვესტორი კონტროლის დაკარგვის გარეშე და რა ქნან, როცა პარტნიორები ვერ თანხმდებიან. ასევე ვასწავლი სახელშეკრულებო სამართალს.';
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
let lawyerId;

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
const phoneKa = async (browser) => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  // (for the picture only: the test server's support address is a placeholder; the picture shows the live site's own)
  if (SHOTS) await ctx.route('**/api/config', async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } }); });
  return { ctx, page: await ctx.newPage() };
};

test.beforeAll(async () => {
  await adminClient();
  // A lawyer who stopped at the proof step: the field, the story and the price are filled in; no link, no document, no licence.
  const c = await S.apiUser(NAME, EMAIL);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'კორპორაციული სამართლის იურისტი', price: 40 } });
  const r = await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'კორპორაციული სამართალი', niche: 'law', yearsExperience: 19, story: STORY } });
  if (r.status !== 200) throw new Error('experience failed: ' + r.text);
  lawyerId = (await c.api('/me')).user.id;
});

test('at 375px, in Georgian: the bar number and who issued it are enough; no date, no upload; a second jurisdiction is optional', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email: EMAIL }, '/ka/apply.html?step=4');
  const form = page.locator('form[data-step="3"]');
  const lic = form.locator('.apply-licence');
  await expect(lic).toBeVisible();
  await expect(form.locator('.apply-lead')).toHaveText(KA['apply.proof.leadRegister']);
  await expect(lic.locator('.apply-register-note')).toHaveText(KA['ap.lic.register']);

  // the licence comes first, the (optional) link after it
  const order = await form.evaluate((f) => f.querySelector('.apply-licence').compareDocumentPosition(f.querySelector('#apUrl')) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(order, 'the licence is above the link box').toBeTruthy();
  await expect(form.locator('.apply-proof-optional')).toHaveText(KA['apply.proof.optional']);

  // "No expiry" is ticked and the date is put away; nothing in the licence asks for a file
  const none = lic.locator('#apLicNoExpiry');
  await expect(lic.locator('label[for="apLicNoExpiry"]')).toContainText('ვადა არ აქვს');
  await expect(none).toBeChecked();
  await expect(lic.locator('#apLicUntil')).toBeDisabled();
  await expect(lic.locator('input[type="file"]')).toHaveCount(0);
  await expect(lic.locator('#apLicBody')).toHaveAttribute('placeholder', KA['vt.lic.bodyHint.law']);
  await expect(lic.locator('#apLicHolder')).toHaveValue(NAME);
  await noOverflow(page);

  // "Next" with nothing written: where to write it
  await form.locator('.apply-next').click();
  await expect(form.locator('.apply-error')).toHaveText(KA['apply.err.licenceAbove']);
  expect(new URL(page.url()).searchParams.get('step')).toBe('4');

  // unticked, with no date: one of the two is asked for; ticked again, the date is put away and emptied
  await lic.locator('#apLicNumber').fill('GBA 004512');
  await lic.locator('#apLicBody').fill('საქართველოს ადვოკატთა ასოციაცია');
  await none.uncheck();
  await expect(lic.locator('#apLicUntil')).toBeEnabled();
  await lic.locator('[data-save-licence]').click();
  await expect(lic.locator('.apply-sub-error')).toHaveText(KA['vt.lic.err.until']);
  await lic.locator('#apLicUntil').fill('2031-12-31');
  await none.check();
  await expect(lic.locator('#apLicUntil')).toBeDisabled();
  await expect(lic.locator('#apLicUntil')).toHaveValue('');
  await expect(lic.locator('.apply-sub-error')).toBeEmpty(); // (what was asked about the date no longer stands)

  // the page afresh (nothing was saved yet): the number, who issued it, and nothing else
  await page.reload();
  await expect(none).toBeChecked();
  await expect(lic.locator('#apLicNumber')).toHaveValue('');
  await lic.locator('#apLicNumber').fill('GBA 004512');
  await lic.locator('#apLicBody').fill('საქართველოს ადვოკატთა ასოციაცია');

  // a second jurisdiction: who issued it; its number is optional
  await lic.locator('.apply-second > summary').click();
  await lic.locator('#apLic2Body').fill('New York State Bar');
  await expect(lic.locator('label[for="apLic2Number"]')).toHaveText(KA['vt.lic.second.number']);
  await noOverflow(page);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'law-step-375.png'), fullPage: true });
  }

  await lic.locator('[data-save-licence]').click();
  await expect(lic.locator('.ap-ok')).toBeVisible();
  await expect(lic.locator('.ap-ok')).toContainText('4512');
  await expect(lic.locator('.ap-ok')).toContainText('New York State Bar');
  await expect(lic.locator('.ap-ok')).not.toContainText('მოქმედია'); // (no end date is named)
  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'law-step-sent-375.png'), fullPage: true });
  }
  expect(await S.sql('SELECT valid_until, second_body, second_last4, license_last4 FROM mentor_credentials WHERE user_id = $1', [lawyerId]))
    .toEqual([{ valid_until: null, second_body: 'New York State Bar', second_last4: null, license_last4: '4512' }]);

  // with no link and no document: on to step 5, where nothing is missing
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=5$/);
  await expect(page.locator('#apMissing')).toHaveCount(0);
  await noOverflow(page);
  await ctx.close();
});

test('the admin sees the number, "ვადა არ აქვს", the second jurisdiction and the register to look it up in', async ({ browser }) => {
  for (const step of ['id_kyc', 'age', 'name_match']) await S.sql(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now()) ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [lawyerId, step]);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: EMAIL, password: S.PASSWORD } });
  const sent = await c.api('/verification/submit', { method: 'POST' });
  expect(sent.status, sent.text).toBe(200);
  await expect.poll(async () => (await S.sql(`SELECT 1 FROM verification_reviews WHERE user_id = $1 AND status <> 'running'`, [lawyerId])).length, { timeout: 20000 }).toBe(1);

  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, ADMIN, '/admin.html?tab=mentors&status=needs_human');
  const card = page.locator('.mv-card').filter({ hasText: EMAIL });
  await expect(card).toBeVisible();
  await card.locator('.mv-open').click();
  const creds = card.locator('.mv-credentials');
  await expect(creds).toBeVisible();
  await expect(creds).toContainText('GBA 004512');
  await expect(creds).toContainText('საქართველოს ადვოკატთა ასოციაცია');
  await expect(creds).toContainText(`${ADMIN_KA['admin.mv.validUntil']}: ${ADMIN_KA['admin.mv.noExpiry']}`);
  await expect(creds).toContainText(`${ADMIN_KA['admin.mv.second']}: New York State Bar`);
  await expect(card.locator('a[href*="gba.ge"]').first()).toBeVisible();
  await noOverflow(page);
  await ctx.close();
});
