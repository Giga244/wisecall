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
  mentorPage.once('dialog', (d) => d.accept());
  await card.locator('.decline-form button[type="submit"]').click();
  await S.untilBooking(b.id, (x) => ['refunded', 'refund_pending'].includes(x.status), 'the question was not refunded');
  await buyerPage.goto('/dashboard.html');
  await expect(buyerPage.locator(`.booking-card[data-id="${b.id}"] .booking-note`)).toContainText('outside what they can answer well');
});
