// The question box, the way back from the bank (cancelled is not failed, and the question comes back), and the answer form (a live count,
// a check step, one answer only), in a real browser.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, longAnswer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, mentor, contexts = [], buyerPage, mentorPage;
const QUESTION = 'My freelance income varies a lot from month to month. How should I plan my taxes and savings?';

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  else admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  mentor = await S.listedMentor(admin, { name: 'Counting Mentor', email: 'counting@e2e.test', niche: 'business', price: 40, roleTitle: 'Accountant' });
  await S.apiUser('Cora Buyer', 'cora@e2e.test');
  contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  [buyerPage, mentorPage] = await Promise.all(contexts.map((c) => c.newPage()));
  await S.logIn(buyerPage, { email: 'cora@e2e.test' });
  await S.logIn(mentorPage, { email: 'counting@e2e.test' });
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

const bookings = async () => S.sql(`SELECT id, status, question FROM bookings WHERE mentor_id = $1 ORDER BY created_at`, [mentor.id]);

test('the question box counts, says how many characters are missing, and refuses a short question before anything is sent', async () => {
  await buyerPage.goto(`/u/${mentor.username}`);
  const box = buyerPage.locator('#question');
  await expect(buyerPage.locator('#qHelp')).toHaveText('50 more characters needed (at least 50)');
  await expect(buyerPage.locator('#qCount')).toHaveText('0 / 4000');
  await box.fill('How do I price my work?');
  await expect(buyerPage.locator('#qHelp')).toHaveText('27 more characters needed (at least 50)');
  await expect(buyerPage.locator('#qCount')).toHaveText('23 / 4000');
  await buyerPage.click('#askBtn');
  await expect(buyerPage.locator('#askError')).toHaveText('Write at least 50 characters.');
  expect(await bookings()).toHaveLength(0); // nothing was created, nobody went to the bank
  await box.fill(`   ${QUESTION}   `);
  await expect(buyerPage.locator('#qHelp')).toHaveText('Long enough.');
  await expect(buyerPage.locator('#qHelp')).toHaveClass(/ok/);
  await expect(buyerPage.locator('#askError')).toHaveText(''); // typing clears the message
});

test('Cancel at the bank: "Payment cancelled, you have not been charged", and the question is still in the box', async () => {
  await buyerPage.goto(`/u/${mentor.username}`);
  await buyerPage.fill('#question', QUESTION);
  await buyerPage.click('#askBtn');
  await buyerPage.waitForURL(/mock-bank\.html/);
  await buyerPage.click('#cancelBtn');
  await buyerPage.waitForURL(/\/u\/[^?]+\?.*status=cancel/);
  const notice = buyerPage.locator('#payNotice');
  await expect(notice).toHaveText('Payment cancelled. You have not been charged. Your question is still here.');
  await expect(notice).toHaveClass(/cancelled/);
  await expect(notice).toBeFocused();
  await expect(buyerPage.locator('#question')).toHaveValue(QUESTION);
  await expect(buyerPage.locator('#askForm')).toBeVisible();
  const [b] = await bookings();
  expect(b.status).toBe('expired');

  // still there after a reload, and in Georgian
  await buyerPage.reload();
  await expect(buyerPage.locator('#question')).toHaveValue(QUESTION);
  await buyerPage.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(buyerPage.locator('#payNotice')).toContainText('გადახდა გაუქმდა');
  await expect(buyerPage.locator('#question')).toHaveValue(QUESTION);
  await buyerPage.locator('.lang-btn[data-lang="en"]').first().click();
});

test('A failed payment says "failed", not "cancelled", and the question is back too', async () => {
  await buyerPage.goto(`/u/${mentor.username}`);
  await buyerPage.fill('#question', `${QUESTION} And what about VAT?`);
  await buyerPage.click('#askBtn');
  await buyerPage.waitForURL(/mock-bank\.html/);
  await buyerPage.click('#failBtn');
  await buyerPage.waitForURL(/\/u\/[^?]+\?.*status=fail/);
  const notice = buyerPage.locator('#payNotice');
  await expect(notice).toHaveText('Payment failed. You have not been charged. Your question is still here: you can try again.');
  await expect(notice).toHaveClass(/failed/);
  await expect(buyerPage.locator('#question')).toHaveValue(`${QUESTION} And what about VAT?`);
});

test('Paying works from the returned question, and then the saved text is gone', async () => {
  await buyerPage.click('#askBtn');
  await buyerPage.waitForURL(/mock-bank\.html/);
  await buyerPage.click('#payBtn');
  await buyerPage.waitForURL(/\/u\/[^?]+\?.*status=success/);
  await expect(buyerPage.locator('.booking-result.success')).toBeVisible();
  await expect(buyerPage.locator('#payNotice')).toHaveCount(0);
  expect(await buyerPage.evaluate((id) => sessionStorage.getItem(`wisecall_question_${id}`), mentor.id)).toBeNull();
  const paid = (await bookings()).filter((b) => b.status === 'paid');
  expect(paid).toHaveLength(1);
});

test('the answer form counts, checks before sending, and refuses what is not a real answer', async () => {
  await mentorPage.goto('/dashboard.html');
  await mentorPage.click('#tab-received');
  const form = mentorPage.locator('.answer-form').first();
  await expect(form.locator('.a-help')).toHaveText('150 more characters needed (at least 150)');
  await form.locator('textarea').fill('ok');
  await expect(form.locator('.a-help')).toHaveText('148 more characters needed (at least 150)');
  await expect(form.locator('.a-count')).toHaveText('2 / 8000');
  await form.locator('.answer-edit button[type="submit"]').click();
  await expect(form.locator('.answer-edit .form-error')).toHaveText('Your answer is too short: write at least 150 characters.');
  await expect(form.locator('.answer-review')).toBeHidden();

  // long enough but not writing: the server says so, on the check step, and the mentor can go back
  await form.locator('textarea').fill('a'.repeat(200));
  await expect(form.locator('.a-help')).toHaveText('Long enough. Read it through, then check and send.');
  await form.locator('.answer-edit button[type="submit"]').click();
  await expect(form.locator('.answer-review')).toBeVisible();
  await form.locator('.answer-send').click();
  await expect(form.locator('.answer-send-error')).toContainText('does not look like a real answer');
  await form.locator('.answer-back').click();
  await expect(form.locator('textarea')).toHaveValue('a'.repeat(200)); // nothing is lost
});

test('a real answer: the check step warns that it cannot be changed; going back keeps the text; sending is final', async () => {
  const ANSWER = longAnswer('Set aside a fixed share of every payment for tax when it arrives, and pay yourself a steady monthly amount from that account.');
  const form = mentorPage.locator('.answer-form').first();
  await form.locator('textarea').fill(`  ${ANSWER}  `);
  await form.locator('.answer-edit button[type="submit"]').click();
  await expect(form.locator('.answer-review-title')).toBeFocused();
  await expect(form.locator('.answer-warn')).toHaveText("You can't change your answer after sending.");
  await expect(form.locator('.answer-preview')).toHaveText(ANSWER);
  await form.locator('.answer-back').click();
  await expect(form.locator('textarea')).toHaveValue(`  ${ANSWER}  `);
  await form.locator('.answer-edit button[type="submit"]').click();
  await form.locator('.answer-send').click();
  await expect(mentorPage.locator('#toast')).toContainText('Answer sent!');
  await expect(mentorPage.locator('.booking-card .booking-answer').first()).toContainText(ANSWER.slice(0, 40));
  await expect(mentorPage.locator('.answer-form')).toHaveCount(0); // no form any more: an answer is written once

  // and the server agrees, for anybody who tries the request by hand
  const [b] = (await bookings()).filter((x) => x.status === 'answered');
  const again = await mentorPage.request.post(`/api/bookings/${b.id}/answer`, { headers: { 'X-Requested-With': 'wisecall' }, data: { answer: longAnswer('A different answer, sent by hand to overwrite the first one.') } });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toBe('already_answered');
  expect((await S.sql('SELECT answer FROM bookings WHERE id = $1', [b.id]))[0].answer).toBe(ANSWER);
});
