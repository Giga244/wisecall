// The parts of a booking that depend on days passing, done the way a person testing on their own computer does them: with the
// development-only Fast-forward button in Admin -> Bookings and refunds, and a fake bank page that can pay, fail or be cancelled.
// (The buyer, mentor and admin steps that are not about time are covered by full-flow, refunds and ratings specs.)
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');
const { longAnswer, longQuestion } = require('../tests/helpers');
const { SAMPLE } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, mentor, contexts = [], buyerPage, adminPage;
const toast = () => adminPage.locator('#toast');

// In Admin -> Bookings and refunds: the card of one question, on the tab of its status.
async function openBooking(status, text) {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="bookings"]');
  await adminPage.click(`#statusFilters [data-status="${status}"]`);
  const card = adminPage.locator('.booking-card').filter({ hasText: text });
  await expect(card).toHaveCount(1);
  return card;
}

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  else admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  mentor = await S.listedMentor(admin, { name: 'Forward Mentor', email: 'forward@e2e.test', niche: 'business', price: 20, roleTitle: 'Consultant' });
  await S.apiUser('Fay Buyer', 'fay@e2e.test');
  contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  [buyerPage, adminPage] = await Promise.all(contexts.map((c) => c.newPage()));
  await S.logIn(buyerPage, { email: 'fay@e2e.test' });
  await S.logIn(adminPage, { email: 'e2e-admin@example.com' });
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

test('the fake bank page offers paid, failed and cancelled; a failed payment creates no paid question', async () => {
  await buyerPage.goto(`/u/${mentor.username}`);
  await buyerPage.fill('#question', longQuestion('A question whose payment will fail at the bank?'));
  await buyerPage.click('#askBtn');
  await buyerPage.waitForURL(/mock-bank\.html/);
  await expect(buyerPage.locator('#payBtn')).toHaveText('Pay');
  await expect(buyerPage.locator('#failBtn')).toHaveText('Simulate a failed payment');
  await expect(buyerPage.locator('#cancelBtn')).toHaveText('Cancel');
  await buyerPage.click('#failBtn');
  await buyerPage.waitForURL(/\/u\/[^?]+\?.*booking=.*status=fail/);
  const [b] = await S.sql(`SELECT id, status FROM bookings WHERE question LIKE 'A question whose payment will fail%'`);
  const closed = await S.untilBooking(b.id, (x) => x.status === 'expired', 'the failed payment was not closed');
  expect(closed.status).not.toBe('paid');
  await expect(buyerPage.locator('#askForm')).toBeVisible(); // and it can be tried again
});

test('a question nobody answers: the admin fast-forwards 7 days and the buyer is refunded', async () => {
  const q = 'Nobody will answer this question, so it must be refunded?';
  const bookingId = await S.askAndPay(buyerPage, mentor, q, 'pay');
  await S.untilBooking(bookingId, (x) => x.status === 'paid', 'the payment was not confirmed');

  const card = await openBooking('paid', q);
  await expect(card.locator('.dev-ff .badge')).toHaveText('Development only'); // the tool is marked, and only on a developer's computer
  await expect(card.locator('.ff-days')).toHaveValue('7');
  await card.locator('.ff-btn').click();
  await expect(toast()).toContainText('Moved 7 day(s) forward.');
  await expect(toast()).toContainText(/Status: .* → Refunded/);

  const b = await S.untilBooking(bookingId, (x) => x.status === 'refunded', 'the unanswered question was not refunded');
  expect(b.refund_reason).toBe('no_answer_deadline');
  expect((await S.waitForMail('fay@e2e.test', 'was refunded')).html).toContain('20.00');
  await buyerPage.goto('/dashboard.html');
  await expect(buyerPage.locator('.booking-card').filter({ hasText: q })).toContainText(/refund/i);
});

test('an answer is held for a check, then released; the ratings stay hidden; after the days the earnings are payable and can be paid', async () => {
  const q = 'A question that will be answered and then rated by both people?';
  const bookingId = await S.askAndPay(buyerPage, mentor, q, 'pay');
  await S.untilBooking(bookingId, (x) => x.status === 'paid', 'the payment was not confirmed');
  const answered = await mentor.client.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: longAnswer(SAMPLE) } });
  expect(answered.status).toBe(200);
  const buyerApi = client(S.BASE);
  await buyerApi.api('/auth/login', { method: 'POST', body: { email: 'fay@e2e.test', password: S.PASSWORD } });
  expect((await buyerApi.api(`/bookings/${bookingId}`)).booking.answer).toBeNull(); // a new mentor's answer waits for a check (if this is one of their first)

  // a day passes: the check window is over and the buyer can read it
  let card = await openBooking('answered', q);
  await card.locator('.ff-btn').first().click();
  await expect(toast()).toContainText('The held answer was released.');
  expect((await buyerApi.api(`/bookings/${bookingId}`)).booking.answer).toBe(longAnswer(SAMPLE));

  // both rate: nothing is visible until both have rated
  expect((await buyerApi.api(`/bookings/${bookingId}/ratings`, { method: 'POST', body: { stars: 5, tags: ['clear'], review: 'Clear and to the point.' } })).status).toBe(201);
  expect((await mentor.client.api(`/bookings/${bookingId}/ratings`)).rating.theirs).toBeNull();

  // 7 days after the buyer could read it: ratings revealed and earnings payable
  card = await openBooking('answered', q);
  await card.locator('.ff-days').fill('7');
  await card.locator('.ff-btn').click();
  await expect(toast()).toContainText('The ratings were revealed.');
  await expect(toast()).toContainText("The mentor's earnings are now payable.");
  expect((await mentor.client.api(`/bookings/${bookingId}/ratings`)).rating.theirs.stars).toBe(5);

  // the Payouts tab now has the mentor with an amount to pay
  await adminPage.click('#adminTabs [data-tab="payouts"]');
  const owed = adminPage.locator('.booking-card').filter({ hasText: 'Forward Mentor' });
  await expect(owed).toContainText('16.00'); // 80% of 20.00
  await owed.locator('.payout-ref').fill('e2e-local-flow-1');
  await expect(owed.locator('.pay-btn')).toBeEnabled();
  await owed.locator('.pay-btn').click();
  await S.confirm(adminPage);
  await expect(toast()).toContainText(/recorded/i);
  expect(await S.sql(`SELECT status FROM payouts WHERE booking_id = $1`, [bookingId])).toEqual([{ status: 'paid' }]);
});

test('an admin can refund a question from the list (the answer is not needed)', async () => {
  const q = 'A question the admin will refund by hand after the answer?';
  const bookingId = await S.askAndPay(buyerPage, mentor, q, 'pay');
  await S.untilBooking(bookingId, (x) => x.status === 'paid', 'the payment was not confirmed');
  expect((await mentor.client.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: longAnswer(SAMPLE) } })).status).toBe(200);

  const card = await openBooking('answered', q);
  await card.locator('.refund-btn').click();
  await expect(adminPage.locator('dialog.wc-dialog[open] [data-ok]')).toHaveText(/^Refund \d+\.\d\d/); // (the button says how much)
  await S.confirm(adminPage);
  await expect(toast()).toContainText(/refund/i);
  const b = await S.untilBooking(bookingId, (x) => x.status === 'refunded', 'the refund did not happen');
  expect(b.refund_reason).toBe('admin');
  expect((await S.sql(`SELECT status FROM payouts WHERE booking_id = $1 AND status = 'pending'`, [bookingId]))).toEqual([]); // the mentor earns nothing from it
});
