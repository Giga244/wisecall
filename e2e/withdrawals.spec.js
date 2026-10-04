// Withdrawals in the browser (PART 5): the mentor's Balance card, "Withdraw" with the password, the admin's queue with the full IBAN,
// "Mark as paid" with the bank reference, and the mentor seeing it as sent. Runs after full-flow.spec.js (the admin account).
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay, longAnswer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, mentor, contexts = [], mentorPage, adminPage;

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  mentor = await S.listedMentor(admin, { name: 'Wanda Withdraw', email: 'wanda@e2e.test', niche: 'business', price: 130, roleTitle: 'Consultant' });
  const asker = await S.apiUser('Walt Asker', 'walt@e2e.test');
  const b = await bookAndPay(S.BASE, asker, mentor.id, 'How do I price my first consulting project for a small shop?');
  expect((await mentor.client.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start from the value to the shop.') } })).status).toBe(200);
  await S.sql(`UPDATE bookings SET answer_review = 'released', answer_released_at = now() WHERE id = $1 AND answer_review = 'held'`, [b.id]);
  await S.sql(`INSERT INTO payouts (booking_id, mentor_id, amount, currency, payable_at) SELECT id, mentor_id, mentor_net_amount, currency, now() - interval '1 minute' FROM bookings WHERE id = $1 ON CONFLICT (booking_id) DO UPDATE SET payable_at = now() - interval '1 minute'`, [b.id]);
  for (const who of ['mentor', 'admin']) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    await S.logIn(page, { email: who === 'mentor' ? 'wanda@e2e.test' : 'e2e-admin@example.com' });
    if (who === 'mentor') mentorPage = page; else adminPage = page;
  }
});
test.afterAll(async () => { for (const c of contexts) await c.close(); });

test('the Balance card shows what is available and withdraws it with the password', async () => {
  await mentorPage.goto('/dashboard.html?tab=earnings');
  const card = mentorPage.locator('#balanceCard');
  await expect(card).toContainText('Available');
  await expect(card).toContainText('104.00');
  const form = card.locator('.bal-withdraw');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.form-error')).toContainText(/password/i);
  await form.locator('[name="currentPassword"]').fill(S.PASSWORD);
  await form.locator('button[type="submit"]').click();
  await expect(card).toContainText('Requested');
  await expect(card).toContainText(/being handled/i);
  if (process.env.E2E_SHOTS) await card.screenshot({ path: `${process.env.E2E_SHOTS}/balance-requested.png` });
  // The same card is in Settings → Payouts.
  await mentorPage.goto('/settings.html?tab=payouts');
  await expect(mentorPage.locator('#balanceSettings')).toContainText('Requested');
});

test('the admin sees the request with the full IBAN, marks it paid, and the mentor sees it sent', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="payouts"]');
  const req = adminPage.locator('.wd-request', { hasText: 'Wanda Withdraw' });
  await expect(req).toContainText('GE29 NB00 0000 0101 9049 17');
  await expect(adminPage.locator('.wd-held')).toContainText('Mentor money held in your account');
  if (process.env.E2E_SHOTS) await adminPage.locator('#wdBox').screenshot({ path: `${process.env.E2E_SHOTS}/admin-withdrawals.png` });
  await req.locator('.wd-ref').fill('TR-E2E-1');
  await req.locator('.wd-pay').click();
  await S.confirm(adminPage);
  await expect(adminPage.locator('.wd-request', { hasText: 'Wanda Withdraw' })).toHaveCount(0);
  await mentorPage.goto('/dashboard.html?tab=earnings');
  await expect(mentorPage.locator('#balanceCard')).toContainText('Sent');
  await expect(mentorPage.locator('#balanceCard')).toContainText('TR-E2E-1');
});
