// In a real browser: a question that sounds like an emergency shows calm help and never reaches the bank, and a mentor declines a
// question from the dashboard (the asker is refunded in full and sees why).
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, mentor, contexts = [], buyerPage, mentorPage, buyer;

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  else admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  mentor = await S.listedMentor(admin, { name: 'Sandro Safe', email: 'sandro@e2e.test', niche: 'fitness', price: 25, roleTitle: 'Coach' });
  buyer = await S.apiUser('Salome Buyer', 'salome@e2e.test');
  contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  [buyerPage, mentorPage] = await Promise.all(contexts.map((c) => c.newPage()));
  await S.logIn(buyerPage, { email: 'salome@e2e.test' });
  await S.logIn(mentorPage, { email: 'sandro@e2e.test' });
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

test('an emergency question shows help with 112 and never goes to the bank', async () => {
  await buyerPage.goto(`/u/${mentor.username}`);
  await buyerPage.fill('#question', 'I want to kill myself, nothing I do helps any more and I do not know who to talk to.');
  await buyerPage.click('#askBtn');
  const help = buyerPage.locator('#emergencyHelp');
  await expect(help).toBeVisible();
  await expect(help).toContainText('112');
  await expect(help).toBeFocused();
  expect(buyerPage.url()).not.toMatch(/mock-bank/);
  expect(await S.sql('SELECT id FROM bookings WHERE mentor_id = $1', [mentor.id])).toHaveLength(0);
});

test('the mentor declines a paid question from the dashboard; the asker is refunded and sees why', async () => {
  const b = await bookAndPay(S.BASE, buyer, mentor.id, 'Which strength program should I follow after a knee operation last month?');
  await mentorPage.goto('/dashboard.html?tab=received');
  const card = mentorPage.locator(`.booking-card[data-id="${b.id}"]`);
  await card.locator('.decline-box summary').click();
  await card.locator('input[value="not_qualified"]').check();
  await card.locator('.decline-form button[type="submit"]').click();
  await S.confirm(mentorPage);
  await S.untilBooking(b.id, (x) => ['refunded', 'refund_pending'].includes(x.status), 'the question was not refunded');
  await buyerPage.goto('/dashboard.html');
  await expect(buyerPage.locator(`.booking-card[data-id="${b.id}"] .booking-note`)).toContainText('outside what they can answer well');
});

test('the asker reports a problem with an answer; the admin decides a partial refund; both see the decision', async ({ browser }) => {
  const b = await bookAndPay(S.BASE, buyer, mentor.id, 'How many rest days per week should a beginner take when starting to run?');
  const r = await mentor.client.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: require('../tests/helpers').longAnswer('Two rest days, and never two hard days in a row.') } });
  expect(r.status).toBe(200);
  expect((await admin.api(`/admin/answers/${b.id}/approve`, { method: 'POST' })).status).toBe(200); // (a new mentor's answers wait for an admin)

  await buyerPage.goto('/dashboard.html');
  const card = buyerPage.locator(`.booking-card[data-id="${b.id}"]`);
  await card.locator('.dispute-box summary').click();
  await card.locator('.dispute-form select').selectOption('not_an_answer');
  await card.locator('.dispute-form textarea').fill('It does not say anything about my knee.');
  await card.locator('.dispute-form button[type="submit"]').click();
  await expect(buyerPage.locator(`.booking-card[data-id="${b.id}"] .dispute-note`)).toContainText('You reported a problem');

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await S.logIn(adminPage, { email: 'e2e-admin@example.com' });
  await adminPage.goto('/admin.html');
  await adminPage.locator('#adminTabs [data-tab="disputes"]').click();
  const item = adminPage.locator('.dis-card', { hasText: 'salome@e2e.test' });
  await item.locator('input[value="partial_refund"]').check();
  await item.locator('input[type="number"]').fill('10');
  await expect(item.locator('.dis-split')).toContainText('8.00');
  await item.locator('textarea').fill('Half of the answer did not cover the question.');
  await item.locator('button[type="submit"]').click();
  await expect(adminPage.locator('.dis-card', { hasText: 'salome@e2e.test' })).toHaveCount(0);
  await adminContext.close();

  await buyerPage.reload();
  await expect(buyerPage.locator(`.booking-card[data-id="${b.id}"] .dispute-note`)).toContainText('refunded 10.00');
  const row = (await S.sql('SELECT refunded_amount FROM bookings WHERE id = $1', [b.id]))[0];
  expect(row.refunded_amount).toBe(1000);
});
