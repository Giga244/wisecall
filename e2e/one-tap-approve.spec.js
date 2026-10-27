// Admin: one-tap approve on a phone (docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md), in Georgian at 360px: /admin.html?tab=mentors&status=
// needs_human opens on the waiting list; the mentor's card, the evidence and "Approve" fit without sideways scrolling and are big enough
// to tap; "Approve" asks one question that names what it will count (the diploma, the evidence) and, confirmed, approves with nothing
// typed. A mentor whose ID check has not passed cannot be approved this way, and the page says why.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'admin-ka.json'), 'utf8'));
const STORY = 'თბილისის სახელმწიფო უნივერსიტეტში ოცი წელია ფსიქოლოგიის ისტორიას და განათლების ფსიქოლოგიას ვასწავლი, ვხელმძღვანელობ დოქტორანტებს.';
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}
// A psychology applicant who sent the application: the diploma's details and copy and one link wait for a person.
async function applicant(name, email, { idPassed }) {
  const c = await S.apiUser(name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ფსიქოლოგიის პროფესორი', price: 30 } });
  await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'განათლების ფსიქოლოგია', niche: 'psychology', yearsExperience: 20, story: STORY } });
  await c.api('/verification/evidence', { method: 'POST', body: { url: `https://tsu.example.org/staff/${tag}-${email.split('@')[0]}` } });
  const id = (await c.api('/me')).user.id;
  await c.api('/verification/license', { method: 'POST', body: { number: 'TSU-2004-118', issuingBody: 'თბილისის სახელმწიფო უნივერსიტეტი', holderName: name, validUntil: '' } });
  await S.sql(`INSERT INTO verification_steps (user_id, step, status, reason) VALUES ($1, 'license_document', 'pending', 'uploaded')`, [id]);
  if (idPassed) for (const step of ['id_kyc', 'age', 'name_match']) await S.sql(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now()) ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [id, step]);
  const sent = await c.api('/verification/submit', { method: 'POST' });
  if (sent.status !== 200) throw new Error('submit failed: ' + sent.text);
  // (the automatic analysis runs once the ID check has passed: its verdict on the link comes before the test sets its own)
  if (idPassed) await expect.poll(async () => (await S.sql(`SELECT 1 FROM verification_reviews WHERE user_id = $1 AND status <> 'running'`, [id])).length, { timeout: 20000 }).toBe(1);
  await S.sql(`UPDATE mentor_evidence SET check_status = 'admin_check' WHERE user_id = $1`, [id]);
  return { id, email, name };
}

test.beforeAll(async () => {
  await adminClient();
  people.ready = await applicant('ნანა მზადაა', `onetap-ready-${tag}@e2e.test`, { idPassed: true });
  people.noId = await applicant('ნინო უპირადობო', `onetap-noid-${tag}@e2e.test`, { idPassed: false });
});

async function adminPhone(browser) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, ADMIN, '/admin.html?tab=mentors&status=needs_human');
  return { ctx, page };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('at 360px: the waiting list opens from the link; card, evidence and Approve fit; one question, nothing typed, approved', async ({ browser }) => {
  const { ctx, page } = await adminPhone(browser);
  await expect(page).toHaveURL(/tab=mentors&status=/);
  const card = page.locator('.mv-card').filter({ hasText: people.ready.email });
  await expect(card).toBeVisible(); // (the waiting list: sent applications that need a person)
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-panel')).toBeVisible();
  await expect(card.locator('.mv-evidence-list')).toBeVisible();
  const approve = card.locator('.mv-approve');
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeEnabled();
  await expect(approve).toHaveText(KA['admin.oneTap.approve']);
  expect(await noSideways(page), 'nothing scrolls sideways').toBeLessThanOrEqual(0);
  const box = await approve.boundingBox();
  expect(box.height, 'big enough to tap').toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await expect(card.locator('.mv-onetap')).toContainText('დიპლომი');
  await approve.click();
  const dialog = page.locator('.wc-dialog');
  await expect(dialog.locator('#wcDialogMessage')).toHaveText(KA['admin.oneTap.confirmWith'].replace('{name}', people.ready.name).replace('{list}', 'დიპლომი, დიპლომის ასლი, მტკიცებულება'));
  await expect(dialog.locator('[data-ok]')).toHaveText('დადასტურება');
  await expect(dialog.locator('[data-cancel]')).toHaveText('გაუქმება');
  await dialog.locator('[data-ok]').click();
  await expect.poll(async () => (await S.sql('SELECT verification_status FROM users WHERE id = $1', [people.ready.id]))[0].verification_status).toBe('verified');
  const steps = Object.fromEntries((await S.sql('SELECT step, status, reason FROM verification_steps WHERE user_id = $1', [people.ready.id])).map((r) => [r.step, r]));
  expect(steps.license).toMatchObject({ status: 'passed', reason: 'Approved by admin' });
  expect(steps.license_document).toMatchObject({ status: 'passed', reason: 'Approved by admin' });
  await ctx.close();
});

test('the ID check not passed: Approve is off, the page says why, and the server refuses it too', async ({ browser }) => {
  const { ctx, page } = await adminPhone(browser);
  const card = page.locator('.mv-card').filter({ hasText: people.noId.email });
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-approve')).toBeDisabled();
  await expect(card.locator('.mv-blocked')).toContainText(KA['admin.oneTap.blocked'].split(':')[0]);
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  const r = await page.evaluate(async (id) => {
    const res = await fetch(`/api/admin/mentors/${id}/approve`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ all: true }) });
    return { status: res.status, body: await res.json() };
  }, people.noId.id);
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('cannot_approve');
  expect(r.body.missing).toContain('id_kyc');
  expect((await S.sql('SELECT verification_status FROM users WHERE id = $1', [people.noId.id]))[0].verification_status).toBe('pending');
  await ctx.close();
});
