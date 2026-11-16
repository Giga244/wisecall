// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// Profile links never block a mentor (tests/profile-links.test.js has the rules). On a 375px phone, in Georgian, an associate professor
// on step 2 of the application:
//   - a messenger link is refused with a Georgian message that says what is fine, and the path she wrote is saved all the same
//   - her ResearchGate, ORCID and LinkedIn links are accepted, and "Next" goes on to step 3; back on step 2 they are there
//   - the admin's card shows the three links, each one to open, marked "couldn't check automatically", and the LinkedIn link she gave
//     as proof with the same words (never "does not open")
// The picture for the owner: E2E_LINKS_SHOTS=<folder>.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_LINKS_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN_KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const NAME = 'სატესტო პროფესორი';
const EMAIL = `professor-${tag}@e2e.test`;
const LINKS = ['https://www.researchgate.net/profile/Satesto-Profesori', 'https://orcid.org/0000-0002-1825-0097', 'https://www.linkedin.com/in/satesto-profesori-12345678'];
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
let professorId;

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
  // A professor who finished step 1 and stopped on step 2.
  const c = await S.apiUser(NAME, EMAIL);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'უნივერსიტეტის ასოცირებული პროფესორი', price: 30 } });
  const r = await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'კვლევის მეთოდები და აკადემიური წერა', niche: 'teaching', yearsExperience: 20, roleTitle: 'ასოცირებული პროფესორი' } });
  if (r.status !== 200) throw new Error('experience failed: ' + r.text);
  professorId = (await c.api('/me')).user.id;
});

test('at 375px, in Georgian: ResearchGate, ORCID and LinkedIn are accepted on step 2 and "Next" goes on; a messenger link is refused and costs nothing', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email: EMAIL }, '/ka/apply.html?step=2');
  const form = page.locator('form[data-step="1"]');
  await S.fillPath(page);
  const links = form.locator('.story-opt[data-opt="links"]');
  if (!(await links.evaluate((d) => d.open))) await links.locator('> summary').click();
  const boxes = links.locator('[name="workLink"]');
  await expect(boxes).toHaveCount(3);
  await expect(links).toContainText('ResearchGate'); // (the hint names the sites an academic uses)

  // a messenger link: refused, in Georgian, naming what is fine; the path is saved all the same
  await boxes.nth(0).fill('https://t.me/satesto');
  await form.locator('.apply-next').click();
  await expect(form.locator('.apply-error')).toHaveText(KA['story.err.linkContact']);
  expect(new URL(page.url()).searchParams.get('step')).toBe('2');
  await expect.poll(async () => (await S.sql('SELECT path_start, work_links FROM users WHERE id = $1', [professorId]))[0]).toEqual({ path_start: S.PATH.start, work_links: [] });

  // her three links: accepted
  for (let i = 0; i < 3; i++) await boxes.nth(i).fill(LINKS[i]);
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=3$/);
  expect((await S.sql('SELECT work_links FROM users WHERE id = $1', [professorId]))[0].work_links).toEqual(LINKS);

  // back on step 2: the links are there, nothing is marked wrong
  await page.goto('/ka/apply.html?step=2');
  const again = page.locator('form[data-step="1"] .story-opt[data-opt="links"]');
  await expect(again).toHaveAttribute('open', '');
  for (let i = 0; i < 3; i++) await expect(again.locator('[name="workLink"]').nth(i)).toHaveValue(LINKS[i]);
  await expect(page.locator('form[data-step="1"] .apply-error')).toBeEmpty();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await noOverflow(page);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'links-step2-375.png'), fullPage: true });
    await again.scrollIntoViewIfNeeded();
    await again.screenshot({ path: path.join(SHOTS, 'links-step2-links-375.png') });
  }
  // and "Next" again, with nothing changed, still goes on
  await page.locator('form[data-step="1"] .apply-next').click();
  await page.waitForURL(/step=3$/);
  await ctx.close();
});

test('the admin opens the three links by hand: each is marked "couldn\'t check automatically", and the LinkedIn proof is never "does not open"', async ({ browser }) => {
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: EMAIL, password: S.PASSWORD } });
  const added = await c.api('/verification/evidence', { method: 'POST', body: { url: 'www.linkedin.com/in/satesto-profesori-12345678' } }); // (pasted without https://)
  expect(added.status, added.text).toBe(200);
  for (const step of ['id_kyc', 'age', 'name_match']) await S.sql(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now()) ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [professorId, step]);
  const sent = await c.api('/verification/submit', { method: 'POST' });
  expect(sent.status, sent.text).toBe(200);
  await expect.poll(async () => (await S.sql(`SELECT 1 FROM verification_reviews WHERE user_id = $1 AND status <> 'running'`, [professorId])).length, { timeout: 20000 }).toBe(1);

  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, ADMIN, '/admin.html?tab=mentors&status=needs_human');
  const card = page.locator('.mv-card').filter({ hasText: EMAIL });
  await expect(card).toBeVisible();
  await card.locator('.mv-open').click();
  const work = card.locator('.mv-work-links');
  await expect(work).toBeVisible();
  await expect(work.locator('.badge')).toHaveText(ADMIN_KA['admin.ai.linkFlag.could_not_check']);
  for (const l of LINKS) await expect(work.locator(`a[href="${l}"]`)).toHaveAttribute('target', '_blank');
  const proof = card.locator('.mv-evidence-list [data-evidence]').filter({ hasText: 'linkedin.com/in/satesto-profesori' });
  await expect(proof).toContainText(ADMIN_KA['admin.ai.linkFlag.could_not_check']);
  await expect(proof).not.toContainText(ADMIN_KA['admin.ai.linkFlag.dead_link']);
  await noOverflow(page);
  await ctx.close();
});
