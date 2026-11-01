// Public answers in the browser (PART 7A): the asker's offer on the dashboard (question cleaned, editable), the mentor's agreement, the
// admin's approval, the public page with "Helpful", and the library. Runs after full-flow.spec.js (the admin account).
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay, longAnswer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let contexts = [], askerPage, mentorPage, adminPage, slug;

test.beforeAll(async ({ browser }) => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  const m = await S.listedMentor(admin, { name: 'Pia Public', email: 'pia@e2e.test', niche: 'tech', price: 20, roleTitle: 'Frontend developer' });
  const asker = await S.apiUser('Paata Asker', 'paata@e2e.test');
  const b = await bookAndPay(S.BASE, asker, m.id, 'I am Paata. How do I get my first frontend job without a degree? I have been learning on my own for a year.');
  // (a question from before contact details were refused in questions: the draft still takes the email out)
  await S.sql('UPDATE bookings SET question = $2 WHERE id = $1', [b.id, 'I am Paata, email paata@e2e.test. How do I get my first frontend job without a degree?']);
  expect((await m.client.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Build three small real projects, put them online and write about what you learned.') } })).status).toBe(200);
  expect((await admin.api(`/admin/answers/${b.id}/approve`, { method: 'POST' })).status).toBe(200);
  await S.sql(`UPDATE bookings SET answered_at = now() - interval '8 days', answer_released_at = now() - interval '8 days' WHERE id = $1`, [b.id]);
  expect((await asker.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 5 } })).status).toBe(201);
  for (const email of ['paata@e2e.test', 'pia@e2e.test', 'e2e-admin@example.com']) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    await S.logIn(page, { email });
    if (email.startsWith('paata')) askerPage = page; else if (email.startsWith('pia')) mentorPage = page; else adminPage = page;
  }
});
test.afterAll(async () => { for (const c of contexts) await c.close(); });

test('the asker is offered to publish, sees the question without their name and email, and agrees', async () => {
  await askerPage.goto('/dashboard.html');
  const box = askerPage.locator('.pa-offer');
  await expect(box).toBeVisible();
  const draft = await box.locator('textarea').inputValue();
  expect(draft).not.toContain('Paata');
  expect(draft).not.toContain('paata@e2e.test');
  if (process.env.E2E_SHOTS) await askerPage.locator('.pa-box').screenshot({ path: `${process.env.E2E_SHOTS}/public-answer-offer.png` });
  await box.locator('button[type="submit"]').click();
  await expect(askerPage.locator('.pa-status')).toContainText(/waiting for the mentor/i);
});

test('the mentor agrees, and the admin approves it', async () => {
  await mentorPage.goto('/dashboard.html?tab=received');
  await mentorPage.locator('#tab-received').click();
  const form = mentorPage.locator('.pa-mentor');
  await expect(form).toBeVisible();
  await form.locator('button[type="submit"]').click();
  await expect(mentorPage.locator('.pa-status')).toContainText(/our team is checking/i);
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="answers"]');
  const item = adminPage.locator('.pa-review').first();
  await expect(item).toBeVisible();
  await item.locator('.pa-approve').click();
  await expect(adminPage.locator('.pa-review')).toHaveCount(0);
  slug = (await S.sql(`SELECT slug FROM public_answers WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`))[0].slug;
});

test('the public page: the question and answer, the mentor with "Ask", Helpful once; the library lists it', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/answers/${slug}`);
  await expect(page.locator('h1')).toContainText('How do I get my first frontend job');
  await expect(page.locator('main')).not.toContainText('Paata');
  await expect(page.locator('.answer-mentor')).toContainText('Pia Public');
  await expect(page.locator('.answer-mentor a.btn')).toHaveAttribute('href', /\/u\//);
  await page.click('#helpfulBtn');
  await expect(page.locator('#helpfulCount')).toContainText('1');
  await expect(page.locator('#helpfulBtn')).toBeDisabled();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/public-answer-page.png`, fullPage: true });
  await page.goto('/answers');
  await expect(page.locator('.answer-card')).toContainText('How do I get my first frontend job');
  await ctx.close();
});
