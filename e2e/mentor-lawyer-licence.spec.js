// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A lawyer needs only their bar number (tests/lawyer-licence.test.js has the rules). On a 375px phone, in Georgian, a lawyer whose
// application is filled in up to the proof step:
//   - step 4 opens on the licence: the number, who issued it (filled in: "საქართველოს ადვოკატთა ასოციაცია"), the name; "ვადა არ აქვს" is
//     ticked and the date is put away; nothing asks for a file; a link or a document is offered below as optional; the licence has no
//     button of its own: "Save and continue" saves it
//   - "Save and continue" with something missing says which field, under that field, and focuses it (never one general line)
//   - the number and a second jurisdiction ("New York State Bar", no number), then "Save and continue": step 5 has nothing missing
//   - a lawyer who types ONLY the number and presses "Save and continue" (in English: "Georgian Bar Association" is filled in) moves to
//     step 5 with the licence saved
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
const EN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
const ADMIN_KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const NAME = 'სატესტო იურისტი';
const EMAIL = `lawyer-${tag}@e2e.test`;
const EMAIL2 = `lawyer-number-only-${tag}@e2e.test`;
const GBA_KA = 'საქართველოს ადვოკატთა ასოციაცია';
const STORY = 'ცხრამეტი წელია იურისტი ვარ. დავიწყე პატარა კომპანიებისთვის ხელშეკრულებების შედგენით, შემდეგ პარტნიორებს შორის დავებზე ვმუშაობდი, ბოლო ათი წელია კი თბილისში იურიდიული ფირმის კორპორაციულ პრაქტიკას ვხელმძღვანელობ. ვურჩევ დამფუძნებლებს, როგორ დააარსონ კომპანია, როგორ მოიზიდონ ინვესტორი კონტროლის დაკარგვის გარეშე და რა ქნან, როცა პარტნიორები ვერ თანხმდებიან. ასევე ვასწავლი სახელშეკრულებო სამართალს.';
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const credentials = (id) => S.sql('SELECT issuing_body, valid_until, second_body, second_last4, license_last4 FROM mentor_credentials WHERE user_id = $1', [id]);
let lawyerId;

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
const phone = async (browser, lang = 'ka') => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  // (for the picture only: the test server's support address is a placeholder; the picture shows the live site's own)
  if (SHOTS) await ctx.route('**/api/config', async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } }); });
  return { ctx, page: await ctx.newPage() };
};
// A lawyer who stopped at the proof step: the field, the story and the price are filled in; no link, no document, no licence.
async function lawyerAtProofStep(name, email) {
  const c = await S.apiUser(name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'კორპორაციული სამართლის იურისტი', price: 40 } });
  const r = await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'კორპორაციული სამართალი', niche: 'law', yearsExperience: 19, story: STORY } });
  if (r.status !== 200) throw new Error('experience failed: ' + r.text);
  return (await c.api('/me')).user.id;
}
// What a licence field was asked for: the line under it, and the field itself in focus.
async function asked(lic, id, name, text) {
  await expect(lic.locator(`[data-lic-error="${name}"]`)).toHaveText(text);
  await expect(lic.locator(`[data-lic-error="${name}"]`)).toBeVisible();
  await expect(lic.locator('#' + id)).toBeFocused();
  await expect(lic.locator('#' + id)).toHaveAttribute('aria-invalid', 'true');
}

test.beforeAll(async () => {
  await adminClient();
  lawyerId = await lawyerAtProofStep(NAME, EMAIL);
});

test('at 375px, in Georgian: the bar number and who issued it are enough; "Save and continue" saves them and says which field is missing', async ({ browser }) => {
  const { ctx, page } = await phone(browser);
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

  // "No expiry" is ticked and the date is put away; nothing in the licence asks for a file; who issued it is filled in; no button of its own
  const none = lic.locator('#apLicNoExpiry');
  await expect(lic.locator('label[for="apLicNoExpiry"]')).toContainText('ვადა არ აქვს');
  await expect(none).toBeChecked();
  await expect(lic.locator('#apLicUntil')).toBeDisabled();
  await expect(lic.locator('input[type="file"]')).toHaveCount(0);
  await expect(lic.locator('#apLicBody')).toHaveValue(GBA_KA);
  await expect(lic.locator('#apLicBody')).toHaveAttribute('placeholder', KA['vt.lic.bodyHint.law']);
  await expect(lic.locator('#apLicHolder')).toHaveValue(NAME);
  await expect(lic.locator('[data-save-licence]')).toHaveCount(0);
  await noOverflow(page);

  // "Save and continue" with no number: the number is asked for, under itself, and focused; no general line
  await form.locator('.apply-next').click();
  await asked(lic, 'apLicNumber', 'number', KA['vt.lic.need.number']);
  await expect(form.locator('.apply-error')).toBeEmpty();
  expect(new URL(page.url()).searchParams.get('step')).toBe('4');

  // the number, with who issued it emptied: "ჩაწერე, ვინ გასცა." under it, and nothing about the number any more
  await lic.locator('#apLicNumber').fill('GBA 004512');
  await expect(lic.locator('[data-lic-error="number"]')).toBeHidden(); // (gone as soon as something is typed)
  await lic.locator('#apLicBody').fill('');
  await form.locator('.apply-next').click();
  await asked(lic, 'apLicBody', 'issuingBody', KA['vt.lic.need.body']);
  await expect(lic.locator('[data-lic-error="number"]')).toBeHidden();
  await expect(form.locator('.apply-error')).toBeEmpty();

  // unticked, with no date: the date is asked for, under itself; ticked again, the date is put away and what was asked goes
  await lic.locator('#apLicBody').fill(GBA_KA);
  await none.uncheck();
  await expect(lic.locator('#apLicUntil')).toBeEnabled();
  await form.locator('.apply-next').click();
  await asked(lic, 'apLicUntil', 'validUntil', KA['vt.lic.err.until']);
  expect(await credentials(lawyerId), 'nothing is saved while a field is missing').toEqual([]);
  await lic.locator('#apLicUntil').fill('2031-12-31');
  await none.check();
  await expect(lic.locator('#apLicUntil')).toBeDisabled();
  await expect(lic.locator('#apLicUntil')).toHaveValue('');
  await expect(lic.locator('[data-lic-error="validUntil"]')).toBeHidden();

  // the page afresh (nothing was saved yet): the number to write, who issued it filled in again
  await page.reload();
  await expect(none).toBeChecked();
  await expect(lic.locator('#apLicNumber')).toHaveValue('');
  await expect(lic.locator('#apLicBody')).toHaveValue(GBA_KA);
  await lic.locator('#apLicNumber').fill('GBA 004512');

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

  // "Save and continue": the licence is saved with the step, and with no link and no document, on to step 5, where nothing is missing
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=5$/);
  await expect(page.locator('#apMissing')).toHaveCount(0);
  expect(await credentials(lawyerId)).toEqual([{ issuing_body: GBA_KA, valid_until: null, second_body: 'New York State Bar', second_last4: null, license_last4: '4512' }]);
  await noOverflow(page);

  // back on step 4: the licence shows as sent
  await page.goto('/ka/apply.html?step=4');
  await expect(lic.locator('.ap-ok')).toBeVisible();
  await expect(lic.locator('.ap-ok')).toContainText('4512');
  await expect(lic.locator('.ap-ok')).toContainText('New York State Bar');
  await expect(lic.locator('.ap-ok')).not.toContainText('მოქმედია'); // (no end date is named)
  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'law-step-sent-375.png'), fullPage: true });
  }
  await ctx.close();
});

test('a lawyer who types only the number and presses "Save and continue" moves to step 5 with the licence saved (English: "Georgian Bar Association")', async ({ browser }) => {
  const id = await lawyerAtProofStep('Number Only Lawyer', EMAIL2);
  const { ctx, page } = await phone(browser, 'en');
  await S.logIn(page, { email: EMAIL2 }, '/en/apply.html?step=4');
  const form = page.locator('form[data-step="3"]');
  const lic = form.locator('.apply-licence');
  await expect(lic.locator('#apLicBody')).toHaveValue('Georgian Bar Association');
  await lic.locator('#apLicNumber').fill('GBA 007731');
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=5$/);
  await expect(page.locator('#apMissing')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(EN['ap.missing.license']);
  expect(await credentials(id)).toEqual([{ issuing_body: 'Georgian Bar Association', valid_until: null, second_body: null, second_last4: null, license_last4: '7731' }]);
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
  await expect(creds).toContainText(GBA_KA);
  await expect(creds).toContainText(`${ADMIN_KA['admin.mv.validUntil']}: ${ADMIN_KA['admin.mv.noExpiry']}`);
  await expect(creds).toContainText(`${ADMIN_KA['admin.mv.second']}: New York State Bar`);
  await expect(card.locator('a[href*="gba.ge"]').first()).toBeVisible();
  await noOverflow(page);
  await ctx.close();
});
