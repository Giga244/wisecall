// When money has to go back: a mentor who never answers, a payment the buyer cancels, and an admin who suspends
// a mentor with a question still open. Accounts are set up through the API (the pages call the same one); the
// buyer's steps and the admin's steps are done in the browser.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, contexts = [], buyerPage, adminPage;
let quiet, suspended;

test.beforeAll(async ({ browser }) => {
  // The admin account may already exist from the full-flow spec (both run against the same database).
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) {
    const r = await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
    if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  } else {
    admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  }
  quiet = await S.listedMentor(admin, { name: 'Quiet Mentor', email: 'quiet@e2e.test', niche: 'business', price: 15, roleTitle: 'Consultant' });
  suspended = await S.listedMentor(admin, { name: 'Risky Mentor', email: 'risky@e2e.test', niche: 'marketing', price: 25, roleTitle: 'Marketing lead' });
  await S.apiUser('Bea Buyer', 'bea@e2e.test');

  contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  [buyerPage, adminPage] = await Promise.all(contexts.map((c) => c.newPage()));
  await S.logIn(buyerPage, { email: 'bea@e2e.test' });
  await S.logIn(adminPage, { email: 'e2e-admin@example.com' });
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

test('a payment the buyer cancels at the bank creates no paid question and can be tried again', async () => {
  const bookingId = await S.askAndPay(buyerPage, quiet, 'Should I raise my prices this quarter?', 'cancel');
  await expect(buyerPage.locator('#askArea')).not.toContainText(/question was sent/i);
  const b = await S.untilBooking(bookingId, (x) => x.status === 'expired' || x.status === 'failed', 'the cancelled payment was not closed');
  expect(b.status).not.toBe('paid');
  expect(await S.sql('SELECT 1 FROM payouts WHERE booking_id = $1', [bookingId])).toHaveLength(0);
  expect(S.mails().filter((m) => m.to === quiet.email && m.subject.includes('new paid question'))).toHaveLength(0); // the mentor was not told

  // The question form is back, and asking again works.
  await expect(buyerPage.locator('#askForm')).toBeVisible();
  const again = await S.askAndPay(buyerPage, quiet, 'Should I raise my prices this quarter? I have 12 regular clients.', 'pay');
  await S.untilBooking(again, (x) => x.status === 'paid', 'the second payment was not confirmed');
  await S.waitForMail(quiet.email, 'new paid question');
});

test('a mentor who does not answer within 7 days: the buyer is refunded automatically', async () => {
  const [open] = await S.sql(`SELECT id, answer_deadline, created_at FROM bookings WHERE mentor_id = $1 AND status = 'paid'`, [quiet.id]);
  const deadline = new Date(open.answer_deadline).getTime();
  expect(deadline).toBeGreaterThan(Date.now() + 6 * 86400000); // seven days to answer
  expect(deadline).toBeLessThan(Date.now() + 8 * 86400000);

  // Seven days pass without an answer.
  await S.sql(`UPDATE bookings SET answer_deadline = now() - interval '1 hour' WHERE id = $1`, [open.id]);
  const b = await S.untilBooking(open.id, (x) => x.status === 'refunded', 'the unanswered question was not refunded');
  expect(b.refund_reason).toBe('no_answer_deadline');
  const mail = await S.waitForMail('bea@e2e.test', 'was refunded');
  expect(mail.html).toContain('15.00');
  expect(await S.sql('SELECT 1 FROM payouts WHERE booking_id = $1 AND status <> $2', [open.id, 'cancelled'])).toHaveLength(0); // the mentor earns nothing

  await buyerPage.goto('/dashboard.html');
  await expect(buyerPage.locator('.booking-card').filter({ hasText: 'raise my prices this quarter? I have 12' })).toContainText(/refund/i);
});

test('an admin suspends a mentor: the open question is refunded, the buyer is emailed, the mentor leaves Browse', async () => {
  const bookingId = await S.askAndPay(buyerPage, suspended, 'How should I split my ad budget between two channels?', 'pay');
  await S.untilBooking(bookingId, (x) => x.status === 'paid', 'the payment was not confirmed');

  await buyerPage.goto('/');
  await expect(buyerPage.locator('.expert-card').filter({ hasText: 'Risky Mentor' })).toBeVisible();

  await adminPage.goto('/admin.html');
  await adminPage.click('#statusFilters [data-status="verified"]');
  const card = adminPage.locator('.mv-card').filter({ hasText: suspended.email });
  await card.locator('.mv-open').click();
  await card.locator('.mv-suspend-reason').fill('Complaints about misleading advice');
  await card.locator('.mv-suspend-btn').click();
  await S.confirm(adminPage);

  const b = await S.untilBooking(bookingId, (x) => x.status === 'refunded', 'the open question was not refunded after the suspension');
  expect(b.refund_reason).toMatch(/suspend/i);
  expect((await S.sql('SELECT verification_status FROM users WHERE id = $1', [suspended.id]))[0].verification_status).toBe('suspended');
  const mail = await S.waitForMail('bea@e2e.test', 'was refunded', { after: 1 });
  expect(mail.html).toContain('25.00');
  await S.waitForMail(suspended.email, 'profile was suspended');

  // The mentor is gone from Browse and cannot be asked.
  await buyerPage.goto('/');
  await expect(buyerPage.locator('#expertGrid')).toBeVisible();
  await expect(buyerPage.locator('.expert-card').filter({ hasText: 'Risky Mentor' })).toHaveCount(0);
  const ask = await client(S.BASE).api('/experts/' + suspended.id);
  expect(ask.status).toBe(404);
});

test('the admin reinstates the mentor: the panel says they go back to review, and one click reinstates and approves again', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#statusFilters [data-status="suspended"]');
  const card = adminPage.locator('.mv-card').filter({ hasText: suspended.email });
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-suspend .mv-note')).toContainText('Reinstated mentors go back to review. Approve again to list them.');
  await expect(card.locator('.mv-suspend .mv-note')).toContainText('Every verification step is still valid');
  await card.locator('.mv-suspend-reason').fill('The complaints were looked into and found unfounded');
  await expect(card.locator('.mv-reinstate')).toHaveText('Reinstate (needs approval again)');
  await card.locator('.mv-reinstate-approve').click();
  await expect(adminPage.locator('#toast')).toContainText('Reinstated and approved again: the mentor is listed.');

  await expect.poll(async () => (await S.sql('SELECT verification_status FROM users WHERE id = $1', [suspended.id]))[0].verification_status).toBe('verified');
  await buyerPage.goto('/');
  await expect(buyerPage.locator('.expert-card').filter({ hasText: 'Risky Mentor' })).toBeVisible();
  const log = (await S.sql(`SELECT action FROM verification_audit WHERE mentor_id = $1 ORDER BY created_at`, [suspended.id])).map((r) => r.action);
  expect(log.slice(-3)).toEqual(['suspended', 'reinstated', 'approved']);
});
