// The whole business, start to finish, in a real browser: a seeker and a Law mentor (the strictest verification
// level) sign up, the mentor is verified step by step, a question is asked and paid for, answered, released after
// the new-mentor check, reviewed, and the mentor's earnings reach the payout ledger. The bank and the ID check are
// the fake ones; the clock is moved forward in the database where the real thing would take hours or days.
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const admin = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const seeker = { name: 'Sam Seeker', email: 'sam@e2e.test' };
const mentor = { name: 'Ana Lomidze', email: 'ana@e2e.test' };
const QUESTION = 'I run a small shop. Do I need to register for VAT before my turnover reaches the limit?';
const ANSWER = 'Not before you reach the threshold, but register early if your customers are businesses that can claim the VAT back.';

let contexts = [];
let seekerPage, mentorPage, adminPage;
let mentorId, mentorUsername, bookingId;

test.beforeAll(async ({ browser }) => {
  contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  [seekerPage, mentorPage, adminPage] = await Promise.all(contexts.map((c) => c.newPage()));
  // Native confirm() boxes (refunds, payouts) are answered "OK", as a person would.
  for (const p of [seekerPage, mentorPage, adminPage]) p.on('dialog', (d) => d.accept());
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

const localInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const step = (page, name) => page.locator(`.vt-step[data-step="${name}"]`);

test('a seeker signs up and confirms their email with the code from the email', async () => {
  await S.signUp(seekerPage, seeker);
  await expect(seekerPage.locator('#navLoggedIn')).toBeVisible();
  const [row] = await S.sql('SELECT email_verified FROM users WHERE email = $1', [seeker.email]);
  expect(row.email_verified).toBe(true);
});

test('an administrator signs up (their address is on the ADMIN_EMAILS list)', async () => {
  await S.signUp(adminPage, admin);
  await adminPage.goto('/admin.html');
  await expect(adminPage.locator('#adminTabs')).toBeVisible();
  await expect(adminPage.locator('#adminContent')).not.toContainText('not authorized', { ignoreCase: true });
});

test('a mentor signs up, confirms their email and applies in the Law field', async () => {
  await S.signUp(mentorPage, mentor);
  await mentorPage.goto('/settings.html');
  await mentorPage.click('#tab-mentor');
  await mentorPage.check('#becomeMentor');
  await mentorPage.fill('#roleTitle', 'Tax lawyer, 11 yrs');
  await mentorPage.selectOption('#niche', 'law');
  await mentorPage.fill('#price', '30');
  await mentorPage.fill('#proofUrl', 'https://linkedin.com/in/ana-lomidze');
  await mentorPage.fill('#sampleAnswer', 'Register as soon as your turnover is close to the limit, keep every invoice, and ask an accountant to confirm the date. Late registration is the costly mistake, early registration is not.');
  await mentorPage.click('#mentorForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT verification_status, niche, price FROM users WHERE email = $1', [mentor.email]))[0]).toMatchObject({ verification_status: 'pending', niche: 'law', price: 30 });
  ({ id: mentorId, username: mentorUsername } = (await S.sql('SELECT id, username FROM users WHERE email = $1', [mentor.email]))[0]);
});

test('the mentor does the ID check, then submits their licence and its document', async () => {
  await mentorPage.goto('/settings.html?tab=verification');
  // ID and selfie check on the (fake) provider's page
  await mentorPage.locator('.vt-step[data-step="id_kyc"] [data-kyc-start]').click();
  await mentorPage.waitForURL(/mock-kyc\.html/);
  await mentorPage.fill('#fullName', mentor.name);
  await mentorPage.click('#mockKycForm button[type="submit"]');
  await mentorPage.waitForURL(/settings\.html/);
  await expect(step(mentorPage, 'id_kyc')).toHaveClass(/vt-passed/);
  await expect(step(mentorPage, 'name_match')).toHaveClass(/vt-passed/); // the name on the ID matches the account
  await expect(step(mentorPage, 'email')).toHaveClass(/vt-passed/);

  // Licence
  const lic = step(mentorPage, 'license');
  await lic.locator('input[name="number"]').fill('LAW-2015-04417');
  await lic.locator('input[name="issuingBody"]').fill('Georgian Bar Association');
  await lic.locator('input[name="validUntil"]').fill('2032-12-31');
  await lic.locator('form[data-form="license"] button[type="submit"]').click();
  await expect(step(mentorPage, 'license')).toHaveClass(/vt-pending/);

  // Licence document (a PDF)
  const doc = step(mentorPage, 'license_document');
  await doc.locator('input[type="file"]').setInputFiles({ name: 'licence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n') });
  await doc.locator('form[data-form="document"] button[type="submit"]').click();
  await expect(step(mentorPage, 'license_document')).toHaveClass(/vt-pending/);

  // Sample answer and proof link came from the application and wait for a person.
  await expect(step(mentorPage, 'sample_answer')).toHaveClass(/vt-pending/);
  await expect(step(mentorPage, 'proof_link')).toHaveClass(/vt-pending/);
  await expect(step(mentorPage, 'video_interview')).toHaveClass(/vt-todo/);
});

test('the admin publishes an interview slot and the mentor books it', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="interviews"]');
  await adminPage.fill('#ivWhen', localInput(Date.now() + 3 * 86400000));
  await adminPage.click('.iv-add button[type="submit"]');
  await expect(adminPage.locator('.earn-list li')).toHaveCount(1);

  await mentorPage.goto('/settings.html?tab=verification');
  await step(mentorPage, 'video_interview').locator('[data-book]').first().click();
  await expect(step(mentorPage, 'video_interview')).toContainText(/Your interview/i);
  await expect(step(mentorPage, 'video_interview')).toHaveClass(/vt-pending/);
  await S.waitForMail(mentor.email, 'interview is booked');
});

test('the admin sends the meeting link, and after the interview records that the mentor passed', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="interviews"]');
  const card = adminPage.locator('.iv-card').filter({ hasText: mentor.email });
  await card.locator('.iv-link').fill('https://meet.example.com/wisecall-e2e');
  await card.locator('.iv-send').click();
  await S.waitForMail(mentor.email, 'meeting link');

  // Time passes: the interview starts.
  await S.sql(`UPDATE interview_slots SET starts_at = now() - interval '5 minutes' WHERE booked_by = $1`, [mentorId]);
  await adminPage.click('#adminTabs [data-tab="payouts"]');
  await adminPage.click('#adminTabs [data-tab="interviews"]');
  const started = adminPage.locator('.iv-card').filter({ hasText: mentor.email });
  await started.locator('.iv-reason').fill('Confident, clear, and the licence checks out');
  await started.locator('.iv-pass').click();
  await expect(adminPage.locator('.iv-card')).toHaveCount(0);
  const [s] = await S.sql(`SELECT status FROM verification_steps WHERE user_id = $1 AND step = 'video_interview'`, [mentorId]);
  expect(s.status).toBe('passed');
});

test('the admin passes the remaining steps and gives the final approval', async () => {
  await adminPage.goto('/admin.html');
  const card = adminPage.locator('.mv-card').filter({ hasText: mentor.email });
  await card.locator('.mv-open').click();
  for (const name of ['sample_answer', 'proof_link', 'license', 'license_document']) {
    const row = card.locator(`.mv-step[data-step="${name}"]`);
    await row.locator('.mv-reason').fill('Checked against the registry and correct');
    await row.locator('.mv-pass').click();
    await expect(card.locator(`.mv-step[data-step="${name}"]`)).toContainText(/approved|passed/i);
  }
  await expect(card.locator('.mv-approve')).toBeEnabled();
  await card.locator('.mv-approve').click();
  await expect.poll(async () => (await S.sql('SELECT verification_status FROM users WHERE id = $1', [mentorId]))[0].verification_status).toBe('verified');
  await S.waitForMail(mentor.email, 'approved');
});

test('the mentor adds payout details and appears in Browse experts', async () => {
  await mentorPage.goto('/settings.html');
  await mentorPage.click('#tab-payouts');
  await mentorPage.fill('#payoutName', mentor.name);
  await mentorPage.fill('#payoutIban', S.GOOD_IBAN);
  await mentorPage.click('#payoutForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT payout_iban_enc IS NOT NULL AS has FROM users WHERE id = $1', [mentorId]))[0].has).toBe(true);

  await seekerPage.goto('/');
  await seekerPage.fill('#searchInput', 'Lomidze');
  const cardLink = seekerPage.locator('.expert-card').filter({ hasText: mentor.name });
  await expect(cardLink).toBeVisible();
  await expect(cardLink).toContainText('Tax lawyer');
  await cardLink.click();
  await expect(seekerPage.locator('h1')).toContainText(mentor.name);
});

test('the seeker asks a question and pays at the bank; the mentor is told', async () => {
  await seekerPage.fill('#question', QUESTION);
  await seekerPage.click('#askBtn');
  await seekerPage.waitForURL(/mock-bank\.html/);
  await expect(seekerPage.locator('#mockAmount')).toContainText('30');
  await seekerPage.click('#payBtn');
  await seekerPage.waitForURL(/\/u\/[^?]+\?.*booking=/);
  bookingId = new URL(seekerPage.url()).searchParams.get('booking');
  await expect(seekerPage.locator('.booking-result.success')).toBeVisible();

  const b = await S.untilBooking(bookingId, (x) => x.status === 'paid', 'the payment was not confirmed');
  expect([b.amount, b.platform_fee_amount, b.mentor_net_amount]).toEqual([3000, 600, 2400]); // 30 GEL: Wisecall keeps 20%
  await S.waitForMail(mentor.email, 'new paid question');
});

test('the mentor answers; a new mentor\'s first answer is held and the buyer cannot see it yet', async () => {
  await mentorPage.goto('/dashboard.html');
  await mentorPage.click('#tab-received');
  const form = mentorPage.locator('.answer-form').first();
  await form.locator('textarea').fill(ANSWER);
  await form.locator('button[type="submit"]').click();
  const b = await S.untilBooking(bookingId, (x) => x.status === 'answered', 'the answer was not saved');
  expect(b.answer_review).toBe('held');

  const mine = await (await seekerPage.request.get('/api/bookings/mine')).json();
  expect(mine.asked[0].answer).toBeNull();
  expect(mine.asked[0].answerHeld).toBe(true);
  await seekerPage.goto('/dashboard.html');
  await expect(seekerPage.locator('#askedList')).not.toContainText(ANSWER);
  expect(S.mails().filter((m) => m.to === seeker.email && m.subject.includes('answered your question'))).toHaveLength(0);
  expect(await S.sql('SELECT 1 FROM payouts WHERE booking_id = $1', [bookingId])).toHaveLength(0); // nothing is earned until it is released

  // The admin sees it in the review queue.
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="queue"]');
  await expect(adminPage.locator('.q-card').filter({ hasText: ANSWER })).toBeVisible();
});

test('after the check window the answer is released automatically and the buyer is emailed', async () => {
  await S.sql(`UPDATE bookings SET answer_held_until = now() - interval '1 minute' WHERE id = $1`, [bookingId]);
  const b = await S.untilBooking(bookingId, (x) => x.answer_review === 'released', 'the answer was not released');
  expect(b.answer_released_at).not.toBeNull();
  const mail = await S.waitForMail(seeker.email, 'answered your question');
  expect(mail.html).toContain('Ana Lomidze');

  await seekerPage.reload();
  await expect(seekerPage.locator('#askedList')).toContainText(ANSWER);
});

test('the seeker rates the answer; the rating stays private until it is revealed, then shows on the mentor\'s profile', async () => {
  const form = seekerPage.locator('.rate-form').first();
  await form.locator('.star-btn[data-value="5"]').click();
  await form.locator('textarea').fill('Clear and practical, exactly what I needed.');
  await form.locator('button[type="submit"]').click();
  await expect(seekerPage.locator('.rate-card').first()).toContainText(/stays private|saved/i);
  expect((await S.sql('SELECT stars, revealed_at FROM ratings WHERE booking_id = $1', [bookingId]))[0]).toMatchObject({ stars: 5, revealed_at: null });

  // double-blind: nobody sees it yet
  await seekerPage.goto(`/u/${mentorUsername}`);
  await expect(seekerPage.locator('#reviewsBody')).not.toContainText('Clear and practical');
  // 7 days after the answer became readable it is revealed
  await S.sql(`UPDATE bookings SET answered_at = now() - interval '8 days', answer_released_at = now() - interval '8 days' WHERE id = $1`, [bookingId]);
  await seekerPage.reload();
  await expect(seekerPage.locator('#reviewsBody')).toContainText('Clear and practical');
});

test('the mentor\'s earnings are in the payout ledger, and the admin pays them out', async () => {
  const [p] = await S.sql('SELECT amount, currency, status, payable_at FROM payouts WHERE booking_id = $1', [bookingId]);
  expect(p).toMatchObject({ amount: 2400, currency: 'gel', status: 'pending' });
  expect(new Date(p.payable_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000); // held for the 7-day refund window

  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="payouts"]');
  const owed = adminPage.locator(`.booking-card[data-mentor="${mentorId}"]`);
  await expect(owed).toContainText('24.00'); // holding
  await expect(owed.locator('.pay-btn')).toHaveCount(0); // nothing payable yet

  // Seven days pass.
  await S.sql(`UPDATE payouts SET payable_at = now() - interval '1 hour' WHERE booking_id = $1`, [bookingId]);
  await adminPage.reload();
  await adminPage.click('#adminTabs [data-tab="payouts"]');
  const due = adminPage.locator(`.booking-card[data-mentor="${mentorId}"]`);
  await expect(due.locator('.mono')).toBeVisible(); // the mentor's IBAN
  await due.locator('.payout-ref').fill('BANK-TRANSFER-E2E-1');
  await due.locator('.pay-btn').click();

  await expect.poll(async () => (await S.sql('SELECT status FROM payouts WHERE booking_id = $1', [bookingId]))[0].status).toBe('paid');
  const [batch] = await S.sql('SELECT amount, reference FROM payout_batches WHERE mentor_id = $1', [mentorId]);
  expect(batch).toMatchObject({ amount: 2400, reference: 'BANK-TRANSFER-E2E-1' });
  await S.waitForMail(mentor.email, 'payout has been sent');
  await expect(adminPage.locator('.earn-list')).toContainText('BANK-TRANSFER-E2E-1');
});
