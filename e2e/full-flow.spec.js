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
const ANSWER = 'Not before you reach the threshold, but register early if your customers are businesses that can claim the VAT back. Keep every invoice from the start, and ask an accountant to confirm the date.';

let contexts = [];
let seekerPage, mentorPage, adminPage;
let mentorId, mentorUsername, bookingId;

test.beforeAll(async ({ browser }) => {
  contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  [seekerPage, mentorPage, adminPage] = await Promise.all(contexts.map((c) => c.newPage()));
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

test('a mentor signs up and applies at /apply.html for the Law field (a licence too); step 5 asks for the ID check first', async () => {
  await S.signUp(mentorPage, mentor);
  // (the one place to apply: docs/CLAUDE-CODE-ONE-APPLY-PATH.md)
  await S.applyAsMentor(mentorPage, {
    headline: 'Lawyer for small businesses', field: 'Tax law for small businesses', niche: 'law', years: 11,
    title: 'Tax lawyer for small businesses', tags: 'VAT, small business tax, contracts',
    story: 'I studied law in Tbilisi and have advised shop owners, cafés and freelancers on tax registration and contracts since 2014. I also teach a short evening course on VAT for new business owners.',
    sample: 'Register as soon as your turnover is close to the limit, keep every invoice, and ask an accountant to confirm the date. Late registration is the costly mistake, early registration is not.',
    price: 30, url: `${S.fakeWeb()}/p/ana-lomidze`,
    licence: { number: 'LAW-2015-04417', body: 'Georgian Bar Association', until: '2032-12-31' },
    submit: false
  });
  ({ id: mentorId, username: mentorUsername } = (await S.sql('SELECT id, username FROM users WHERE email = $1', [mentor.email]))[0]);
  const [u] = await S.sql('SELECT niche, years_experience, price, headline, role_title, specialty_tags, verification_status FROM users WHERE id = $1', [mentorId]);
  expect(u).toMatchObject({ niche: 'law', years_experience: 11, price: 30, headline: 'Lawyer for small businesses', role_title: 'Tax lawyer for small businesses' });
  expect(u.specialty_tags).toEqual(['VAT', 'small business tax', 'contracts']);
  if (process.env.E2E_SHOTS) await mentorPage.screenshot({ path: `${process.env.E2E_SHOTS}/application-submitted.png`, fullPage: true });
  // Steps 1-4 done, the ID check not: no "send", but "One step left" (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md).
  await expect(mentorPage.locator('.id-card h1')).toHaveText('One step left: confirm your identity');
  await expect(mentorPage.locator('[data-submit]')).toHaveCount(0);
});

test('the mentor does the ID check; the application is sent by itself, the automatic analysis runs and, a regulated field, it waits for a person', async () => {
  await S.passIdCheck(mentorPage, mentor.name);
  await expect(mentorPage.locator('.apply-done')).toBeVisible();
  await expect.poll(async () => ((await S.sql(`SELECT outcome FROM verification_reviews WHERE user_id = $1 AND status = 'done'`, [mentorId]))[0] || {}).outcome).toBe('needs_human');
  const [review] = await S.sql(`SELECT reasons, ai_cost_usd FROM verification_reviews WHERE user_id = $1`, [mentorId]);
  expect(review.reasons.map((r) => r.code)).toContain('regulated_niche');
  expect(Number(review.ai_cost_usd)).toBeGreaterThan(0);
  await mentorPage.reload();
  await expect(mentorPage.locator('.apply-done')).toContainText('Your name matches your ID');
  await expect(mentorPage.locator('.apply-done')).toContainText('Age 18+ confirmed');
  await expect(mentorPage.locator('.apply-status')).toContainText('A person on our team is reviewing your application');
  if (process.env.E2E_SHOTS) await mentorPage.screenshot({ path: `${process.env.E2E_SHOTS}/application-in-review.png`, fullPage: true });
});

test('the admin sees the AI summary on top, asks for a video interview, and the mentor books it', async () => {
  await adminPage.goto('/admin.html');
  const card = adminPage.locator('.mv-card').filter({ hasText: mentor.email });
  await expect(card.locator('.mv-ai-summary')).toBeVisible(); // the summary is on the card in the queue
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-analysis')).toContainText('Automatic analysis');
  await expect(card.locator('.mv-analysis')).toContainText('Regulated field');
  await expect(card.locator('.mv-scores tr')).toHaveCount(5);
  if (process.env.E2E_SHOTS) await card.screenshot({ path: `${process.env.E2E_SHOTS}/admin-analysis.png` });
  await card.locator('.mv-iv-reason').fill('A short call before approving a legal adviser');
  await card.locator('.mv-iv-request').click();
  await S.waitForMail(mentor.email, 'short video call');

  await adminPage.click('#adminTabs [data-tab="interviews"]');
  await adminPage.fill('#ivWhen', localInput(Date.now() + 3 * 86400000));
  await adminPage.click('.iv-add button[type="submit"]');
  await expect(adminPage.locator('.earn-list li')).toHaveCount(1);

  await mentorPage.goto('/apply.html');
  const review = mentorPage.locator('.apply-interview');
  await review.locator('[data-book]').first().click();
  await expect(review).toContainText(/Your interview/i);
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

test('the admin checks the licence in the register and gives the final approval', async () => {
  await adminPage.goto('/admin.html');
  const card = adminPage.locator('.mv-card').filter({ hasText: mentor.email });
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-panel')).toContainText('Georgian Bar Association: members registry');
  const row = card.locator('.mv-step[data-step="license"]');
  await row.locator('.mv-reason').fill('Found in the Bar Association members registry');
  await row.locator('.mv-pass').click();
  await expect(card.locator('.mv-step[data-step="license"]')).toContainText(/passed/i);
  await expect(card.locator('.mv-approve')).toBeEnabled();
  await card.locator('.mv-approve').click();
  await adminPage.locator('.wc-dialog [data-ok]').click(); // (one question first: docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md)
  await expect.poll(async () => (await S.sql('SELECT verification_status FROM users WHERE id = $1', [mentorId]))[0].verification_status).toBe('verified');
  await S.waitForMail(mentor.email, 'approved');
  const steps = Object.fromEntries((await S.sql('SELECT step, status FROM verification_steps WHERE user_id = $1', [mentorId])).map((r) => [r.step, r.status]));
  expect(steps).toMatchObject({ id_kyc: 'passed', age: 'passed', name_match: 'passed', experience: 'passed', license: 'passed', video_interview: 'passed' });
});

test('the mentor adds payout details and appears in Browse experts', async () => {
  await mentorPage.goto('/settings.html');
  await mentorPage.click('#tab-payouts');
  await mentorPage.fill('#payoutName', mentor.name);
  await mentorPage.fill('#payoutIban', S.GOOD_IBAN);
  await mentorPage.fill('#payoutPassword', S.PASSWORD); // (payout details need the current password)
  await mentorPage.click('#payoutForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT payout_iban_enc IS NOT NULL AS has FROM users WHERE id = $1', [mentorId]))[0].has).toBe(true);

  await seekerPage.goto('/experts.html');
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
  await form.locator('.answer-edit button[type="submit"]').click();
  await expect(form.locator('.answer-warn')).toContainText("can't change your answer after sending"); // the check step comes first
  await form.locator('.answer-send').click();
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
  await S.confirm(adminPage);

  await expect.poll(async () => (await S.sql('SELECT status FROM payouts WHERE booking_id = $1', [bookingId]))[0].status).toBe('paid');
  const [batch] = await S.sql('SELECT amount, reference FROM payout_batches WHERE mentor_id = $1', [mentorId]);
  expect(batch).toMatchObject({ amount: 2400, reference: 'BANK-TRANSFER-E2E-1' });
  await S.waitForMail(mentor.email, 'payout has been sent');
  await expect(adminPage.locator('#directBox .earn-list')).toContainText('BANK-TRANSFER-E2E-1'); // (paid without a request: the history under it)
});
