// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// Admin → Mentors: the one-off "profile update" email (server/profileUpdateEmail.js; tests/profile-update-email.test.js has the rules),
// in Georgian:
//   - "პროფილის განახლების წერილი" says how many would get it and how many already did; opened, it lists each approved mentor who lacks
//     "ჩემი გზა", "შენ შესახებ" or a photo, with what they lack and the exact email (subject and the email as it looks)
//   - every mentor starts ticked; unticked ones get nothing; nothing goes out until "გაგზავნა" and its one question
//   - sent: the mentor moves to "უკვე მიიღეს" with the date, and is not offered it again
// The pictures for the owner: E2E_PU_SHOTS=<folder> (the preview at 1280px and 375px, and the email as it arrives).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_PU_SHOTS;
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const SUBJECT = 'Wisecall-ზე ახალი რამ დავამატეთ ✨';
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
async function adminPage(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 400 ? 812 : 900 }, isMobile: width < 400, hasTouch: width < 400 });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, ADMIN, '/ka/admin.html?tab=mentors&status=verified');
  return { ctx, page };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const item = (page, m) => page.locator(`[data-pu-item="${m.id}"]`);

test.beforeAll(async () => {
  const admin = await adminClient();
  // (approved, nothing of the new parts yet: they lack all three; Georgian)
  people.nino = await S.listedMentor(admin, { name: 'ნინო სატესტო', email: `pu-nino-${tag}@e2e.test`, niche: 'design', roleTitle: 'დიზაინერი', price: 25 });
  people.giorgi = await S.listedMentor(admin, { name: 'გიორგი სატესტო', email: `pu-giorgi-${tag}@e2e.test`, niche: 'design', roleTitle: 'ილუსტრატორი', price: 25 });
  for (const m of [people.nino, people.giorgi]) await S.sql(`UPDATE users SET language = 'ka' WHERE id = $1`, [m.id]);
  // (Giorgi has a photo and "ჩემი გზა": he lacks only "შენ შესახებ")
  expect((await people.giorgi.client.api('/me/details', { method: 'PUT', body: { pathStart: S.PATH.start, pathHow: S.PATH.how, pathNow: S.PATH.now } })).status).toBe(200);
  await S.sql('UPDATE users SET photo_updated_at = now() WHERE id = $1', [people.giorgi.id]);
});

test('the preview: who lacks what, and the exact email; nothing is sent by it', async ({ browser }) => {
  for (const width of [1280, 375]) {
    const { ctx, page } = await adminPage(browser, width);
    const open = page.locator('[data-pu-open]');
    await expect(open).toHaveText(KA['admin.pu.button']);
    await expect(page.locator('[data-pu-count]')).toContainText('გასაგზავნი:');
    await open.click();
    const panel = page.locator('.pu-panel');
    await expect(panel.locator('h2')).toHaveText(KA['admin.pu.title']);
    await expect(item(page, people.nino).locator('.pu-part')).toHaveText([KA['admin.pu.part.path'], KA['admin.pu.part.about'], KA['admin.pu.part.photo']]);
    await expect(item(page, people.giorgi).locator('.pu-part')).toHaveText([KA['admin.pu.part.about']]);
    await expect(item(page, people.nino).locator('input[type="checkbox"]')).toBeChecked();
    // the exact email: its subject, and the email as it looks
    await item(page, people.giorgi).locator('.pu-mail > summary').click();
    await expect(item(page, people.giorgi).locator('.pu-subject')).toContainText(SUBJECT);
    const frame = page.frameLocator(`[data-pu-item="${people.giorgi.id}"] iframe`);
    await expect(frame.locator('h1')).toHaveText('გამარჯობა, გიორგი!');
    await expect(frame.locator('body')).toContainText('„შენ შესახებ“ — თქვენი კარიერა თქვენივე სიტყვებით.');
    await expect(frame.locator('body')).not.toContainText('„ჩემი გზა“ —');
    expect(await noSideways(page), 'nothing scrolls sideways').toBeLessThanOrEqual(0);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -90));
      await page.screenshot({ path: path.join(SHOTS, `pu-preview-${width}.png`), fullPage: false });
      await item(page, people.giorgi).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -90));
      await page.screenshot({ path: path.join(SHOTS, `pu-preview-email-${width}.png`), fullPage: false });
    }
    await ctx.close();
  }
  expect(S.mails().filter((m) => m.subject === SUBJECT && [people.nino.email, people.giorgi.email].includes(m.to)), 'the preview sends nothing').toHaveLength(0);
  expect((await S.sql('SELECT profile_update_sent_at FROM users WHERE id = $1', [people.nino.id]))[0].profile_update_sent_at).toBeNull();
});

test('only the ticked mentor gets it, after "გაგზავნა" and its question; then "უკვე მიიღეს", with the date', async ({ browser }) => {
  const { ctx, page } = await adminPage(browser, 1280);
  await page.locator('[data-pu-open]').click();
  await expect(item(page, people.nino)).toBeVisible();
  // (everyone else unticked: only Nino; other test mentors on the list get nothing)
  for (const box of await page.locator('[data-pu-id]').all()) if ((await box.getAttribute('data-pu-id')) !== people.nino.id) await box.uncheck();
  const send = page.locator('[data-pu-send]');
  await expect(send).toHaveText(KA['admin.pu.send'].replace('{n}', 1));
  await send.click();
  const dialog = page.locator('.wc-dialog');
  await expect(dialog.locator('#wcDialogMessage')).toHaveText(KA['admin.pu.confirm'].replace('{n}', 1));
  // "Cancel": nothing
  await dialog.locator('[data-cancel]').click();
  expect((await S.sql('SELECT profile_update_sent_at FROM users WHERE id = $1', [people.nino.id]))[0].profile_update_sent_at).toBeNull();
  await send.click();
  await dialog.locator('[data-ok]').click();
  const mail = await S.waitForMail(people.nino.email, SUBJECT);
  expect(mail.text).toMatch(/^გამარჯობა, ნინო!/);
  expect(mail.text).toContain('• „ჩემი გზა“');
  expect(mail.text).toContain('• ფოტო');
  expect(S.mails().filter((m) => m.to === people.giorgi.email && m.subject === SUBJECT), 'unticked: nothing').toHaveLength(0);
  await expect.poll(async () => (await S.sql('SELECT profile_update_sent_at FROM users WHERE id = $1', [people.nino.id]))[0].profile_update_sent_at).not.toBeNull();
  // the list: Nino has moved to "უკვე მიიღეს"
  await expect(item(page, people.nino)).toHaveCount(0);
  await expect(page.locator('.pu-sent')).toContainText(people.nino.email);
  await expect(item(page, people.giorgi)).toBeVisible();
  if (SHOTS) {
    // the email as it arrives (the same HTML, at a phone's width)
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 390, height: 900 });
    await p.setContent(mail.html, { waitUntil: 'load' });
    await p.screenshot({ path: path.join(SHOTS, 'pu-email-ka-390.png'), fullPage: true });
    await p.setViewportSize({ width: 680, height: 900 });
    await p.screenshot({ path: path.join(SHOTS, 'pu-email-ka-680.png'), fullPage: true });
  }
  await ctx.close();
});
