// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// Every mentor's expert card kept whole (docs/CLAUDE-CODE-CARD-CHECKS.md):
//   - Settings → My details at 390px, Georgian: under „შენ შესახებ“ the card as students will see it, drawn again as the mentor types; where
//     each part appears; an approved mentor's short About is counted with a gentle tip and saved anyway (never refused for its length)
//   - the admin's review: the card, the warnings ("FInance"), and the About fixed from there (audit-logged)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN_KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const ABOUT = 'ათ წელზე მეტია ვმუშაობ ფინანსურ ანალიტიკაში და ვასწავლი უნივერსიტეტში. ვეხმარები დამწყებებს პირველი სამსახურის პოვნაში და ინტერვიუსთვის მზადებაში. ასევე ვკითხულობ ლექციებს საბანკო რისკებზე.';
const fill = (key, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(String(v)), KA[key]);
const SHORT = 'ფინანსური ანალიტიკოსი ვარ.';

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
let m;
test.beforeAll(async () => {
  const admin = await adminClient();
  m = await S.listedMentor(admin, { name: 'სატესტო ანალიტიკოსი', email: `card-check-${tag}@e2e.test`, niche: 'teaching', roleTitle: 'ანალიტიკოსი', price: 30 });
  await S.sql(`UPDATE users SET bio = NULL, language = 'ka', custom_niche = 'FInance, International Relations and Politics' WHERE id = $1`, [m.id]);
});

test('My details at 390px: the card preview under the About follows the typing; "where it appears"; a short About hinted and saved', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details#story');
  const about = page.locator('#ds-about');
  await expect(about).toBeVisible();
  await expect(page.locator('#ds-about-hint')).toHaveText(KA['story.about.hint']);
  await expect(page.locator('.story-about .story-where')).toHaveText(KA['story.where.card']);
  await expect(page.locator('.story-field .story-where').first()).toHaveText(KA['story.where.profile']);
  // the preview: right under the About, the mentor's name, no text yet
  const box = page.locator('[data-card-preview]');
  await expect(box).toBeVisible();
  await expect(box.locator('.card-preview-title')).toHaveText(KA['story.preview.title']);
  const card = box.locator('.expert-card.is-preview');
  await expect(card.locator('.card-name')).toContainText('სატესტო ანალიტიკოსი');
  await expect(card.locator('.card-bio-text')).toHaveCount(0);
  expect((await box.boundingBox()).y).toBeGreaterThan((await about.boundingBox()).y);
  // typing: the card says it
  await about.fill(ABOUT);
  await expect(card.locator('.card-bio-text')).toHaveText(ABOUT);
  await expect(page.locator('#ds-about-count')).toHaveClass(/is-ok/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // short (an approved mentor): the count gives a gentle tip, never an error, and the save goes through
  await about.fill(SHORT);
  await expect(card.locator('.card-bio-text')).toHaveText(SHORT);
  await expect(page.locator('#ds-about-count')).toHaveText(fill('story.about.soft', { n: [...SHORT].length, min: 150, left: 150 - [...SHORT].length }));
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBe(SHORT);
  await expect(page.locator('#ds-about-err')).toBeHidden();
  // a full one: saved too
  await about.fill(ABOUT);
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBe(ABOUT);
  await ctx.close();
});

test('the admin\'s review: the card as students see it, the warnings, and the About fixed from there (audit-logged)', async ({ browser }) => {
  await S.sql('UPDATE users SET bio = NULL WHERE id = $1', [m.id]);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, ADMIN, '/admin.html?tab=mentors&status=verified');
  const row = page.locator('.mv-card').filter({ hasText: m.email });
  await expect(row).toBeVisible();
  await row.locator('.mv-open').click();
  const check = row.locator('.mv-card-check');
  await expect(check).toBeVisible();
  await expect(check.locator('.card-preview .expert-card .card-name')).toContainText('სატესტო ანალიტიკოსი');
  await expect(check.locator('.card-preview .card-role')).toContainText('FInance');
  await expect(check.locator('[data-warning="odd_caps"]')).toContainText('FInance');
  await expect(check.locator('[data-warning="card_empty"]')).toHaveText(new RegExp(ADMIN_KA['admin.card.w.card_empty'].slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // the About, written by the admin: saved at once, the card has its text, the warning is gone
  await check.locator('[data-text="about"]').fill(ABOUT);
  await check.locator('.mv-card-save').click();
  await expect.poll(async () => (await S.sql('SELECT bio FROM users WHERE id = $1', [m.id]))[0].bio).toBe(ABOUT);
  await expect(row.locator('.mv-card-check .card-preview .card-bio-text')).toHaveText(ABOUT);
  await expect(row.locator('.mv-card-check [data-warning="card_empty"]')).toHaveCount(0);
  const audit = await S.sql(`SELECT step, actor_label FROM verification_audit WHERE mentor_id = $1 AND action = 'admin_text_edit'`, [m.id]);
  expect(audit.map((a) => a.step)).toEqual(['about']);
  expect(audit[0].actor_label).toBe(ADMIN.email);
  await ctx.close();
});
