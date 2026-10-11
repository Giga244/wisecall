// The whole journey in a real browser, once on a desktop and once on a phone viewport (the two Playwright projects):
// sign up with the emailed code -> apply as a mentor (fake ID check) -> the admin approves -> payout details -> a buyer finds the mentor,
// asks and pays at the fake bank -> the mentor answers -> the admin releases the new mentor's first answer -> the buyer rates ->
// an unanswered question is refunded after the deadline -> the language switch keeps the page -> the dark theme sticks.
// Each project uses its own people (the database is shared), and one admin account (the only address in ADMIN_EMAILS of e2e/global-setup.js).
const { test, expect } = require('@playwright/test');
const S = require('../../e2e/support');

test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
let people, pages = {}, contexts = [];
let mentorId, mentorUsername, bookingId;
const isPhone = () => test.info().project.name === 'mobile';

test.beforeAll(async ({ browser }, info) => {
  const p = info.project.name;
  people = {
    buyer: { name: p === 'mobile' ? 'Keti Buyer' : 'Dato Buyer', email: `${p}-buyer@e2e-cloud.test` },
    mentor: { name: p === 'mobile' ? 'Mari Kvaratskhelia' : 'Nika Gelashvili', email: `${p}-mentor@e2e-cloud.test` }
  };
  const opts = info.project.use;
  contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: opts.viewport, userAgent: opts.userAgent, isMobile: opts.isMobile, hasTouch: opts.hasTouch, deviceScaleFactor: opts.deviceScaleFactor })));
  [pages.buyer, pages.mentor, pages.admin] = await Promise.all(contexts.map((c) => c.newPage()));
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

// The ask form: in the page on a desktop, in a bottom sheet opened from the question bar on a phone.
async function openAskForm(page) {
  const bar = page.locator('#askOpen');
  // (the page draws the profile after loading it: wait until either the form or the phone's question bar is on screen — on a slow
  // machine, checking at once found neither and never opened the sheet)
  await page.waitForFunction(() => ['askOpen', 'question'].some((id) => { const el = document.getElementById(id); return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }));
  if (await bar.isVisible().catch(() => false)) await bar.click();
  await expect(page.locator('#question')).toBeVisible();
}
// The header's language and theme controls sit in the menu panel on a phone.
async function openMenuIfPhone(page) {
  const toggle = page.locator('#navToggle');
  if (await toggle.isVisible().catch(() => false)) { await toggle.click(); await expect(page.locator('#mobileMenu')).toBeVisible(); return page.locator('#mobileMenu'); }
  return page.locator('header');
}

test('a visitor signs up and confirms the email with the 6-digit code from the email', async () => {
  await S.signUp(pages.buyer, people.buyer);
  await expect(pages.buyer).toHaveURL(/dashboard\.html/);
  const [row] = await S.sql('SELECT email_verified FROM users WHERE email = $1', [people.buyer.email]);
  expect(row.email_verified).toBe(true);
});

test('a mentor applies: price, Experience form with evidence, submit, then the (fake) ID check', async () => {
  const page = pages.mentor;
  await S.signUp(page, people.mentor);
  await page.goto('/settings.html');
  await page.click('#tab-mentor');
  await page.check('#becomeMentor');
  await page.fill('#price', '35');
  await page.click('#mentorForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT price FROM users WHERE email = $1', [people.mentor.email]))[0].price).toBe(35);
  ({ id: mentorId, username: mentorUsername } = (await S.sql('SELECT id, username FROM users WHERE email = $1', [people.mentor.email]))[0]);

  await page.goto('/settings.html?tab=verification');
  const exp = page.locator('#ap-experience');
  const form = exp.locator('form[data-form="experience"]');
  await form.locator('[name="roleTitle"]').fill('Mobile app developer');
  await form.locator('[name="customNiche"]').fill('Mobile apps for small shops');
  await form.locator('[name="niche"]').selectOption('tech');
  await form.locator('[name="specialtyTags"]').fill('iOS, Android, Flutter');
  await form.locator('[name="yearsExperience"]').fill('7');
  await form.locator('[name="story"]').fill('Seven years building mobile apps for Georgian banks and delivery startups; I lead a team of five and review junior developers’ code every week.');
  await form.locator('[name="sampleAnswer"]').fill('Ship the smallest version that real users can try within two weeks, measure where they stop, and fix that first. A polished app nobody opens teaches you nothing.');
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT niche FROM users WHERE id = $1', [mentorId]))[0].niche).toBe('tech');

  // (saving the Experience form draws the evidence form again: wait for that, or a choice made before it is lost)
  await page.waitForLoadState('networkidle');
  const ev = exp.locator('form[data-form="evidence"]');
  await ev.locator('[name="kind"]').selectOption('website');
  await expect(ev.locator('[name="kind"]')).toHaveValue('website');
  await ev.locator('[name="url"]').fill(`${S.fakeWeb()}/p/${people.mentor.name.toLowerCase().replace(/ /g, '-')}`);
  await ev.locator('button[type="submit"]').click();
  await expect(exp.locator('.ap-evidence li')).toHaveCount(1);
  await exp.locator('[data-submit]').click();
  await expect(page.locator('#ap-experience form[data-form="experience"]')).toHaveCount(0); // locked while it is reviewed

  await page.locator('#ap-identity [data-kyc-start]').click();
  await page.waitForURL(/mock-kyc\.html/);
  await page.fill('#fullName', people.mentor.name);
  await page.click('#mockKycForm button[type="submit"]');
  await page.waitForURL(/settings\.html/);
  await expect(page.locator('#ap-identity')).toContainText('Your name matches your ID');
});

test('the admin opens the application and approves it', async () => {
  const page = pages.admin;
  const [exists] = await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email]);
  if (exists) await S.logIn(page, ADMIN); else await S.signUp(page, ADMIN);
  // (the analysis runs in the background after the ID check; the application is ready when it has finished)
  await expect.poll(async () => ((await S.sql(`SELECT status FROM verification_reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [mentorId]))[0] || {}).status, { timeout: 30000 }).toBe('done');
  await page.goto('/admin.html');
  const card = page.locator('.mv-card').filter({ hasText: people.mentor.email });
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-approve')).toBeEnabled();
  await card.locator('.mv-approve').click();
  await expect.poll(async () => (await S.sql('SELECT verification_status FROM users WHERE id = $1', [mentorId]))[0].verification_status).toBe('verified');
});

test('the mentor saves payout details and becomes visible', async () => {
  const page = pages.mentor;
  await page.goto('/settings.html');
  await page.click('#tab-payouts');
  await page.fill('#payoutName', people.mentor.name);
  await page.fill('#payoutIban', S.GOOD_IBAN);
  await page.fill('#payoutPassword', S.PASSWORD); // (payout details need the current password)
  await page.click('#payoutForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT payout_iban_enc IS NOT NULL AS has FROM users WHERE id = $1', [mentorId]))[0].has).toBe(true);
});

test('the buyer finds the mentor with the search box, asks a question and pays at the (fake) bank', async () => {
  const page = pages.buyer;
  await page.goto('/');
  await page.fill('#searchInput', people.mentor.name.split(' ')[1]);
  const cardLink = page.locator('.expert-card').filter({ hasText: people.mentor.name });
  await expect(cardLink).toBeVisible();
  await cardLink.click();
  await expect(page.locator('h1')).toContainText(people.mentor.name);
  await openAskForm(page);
  await page.fill('#question', 'I want to build my first mobile app for a small café. Should I start with Flutter or learn native iOS first, given I only have evenings?');
  await page.click('#askBtn');
  await page.waitForURL(/mock-bank\.html/);
  await expect(page.locator('#mockAmount')).toContainText('35');
  await page.click('#payBtn');
  await page.waitForURL(/\/u\/[^?]+\?.*booking=/);
  bookingId = new URL(page.url()).searchParams.get('booking');
  await expect(page.locator('.booking-result.success')).toBeVisible();
  await S.untilBooking(bookingId, (b) => b.status === 'paid', 'the payment was not confirmed');
});

test('the mentor answers from the dashboard (check step, then send)', async () => {
  const page = pages.mentor;
  await page.goto('/dashboard.html?tab=received');
  const form = page.locator('.answer-form').first();
  await form.locator('textarea').fill('Start with Flutter: one code base gives you iOS and Android, and for a café menu, orders and a loyalty card you will not hit its limits. Build the menu screen first this week, put it on your own phone, and only then add ordering.');
  await form.locator('.answer-edit button[type="submit"]').click();
  await expect(form.locator('.answer-warn')).toBeVisible();
  await form.locator('.answer-send').click();
  await expect(page.locator('#toast')).toContainText(/Answer sent/i);
  await S.untilBooking(bookingId, (b) => b.status === 'answered', 'the answer was not saved');
});

test('the admin releases the new mentor’s first answer from the review queue', async () => {
  const page = pages.admin;
  await page.goto('/admin.html');
  await page.click('#adminTabs [data-tab="queue"]');
  const item = page.locator('.q-card, .booking-card').filter({ hasText: people.mentor.name }).first();
  await item.locator('.q-approve').click();
  await S.untilBooking(bookingId, (b) => b.answer_review === 'released', 'the answer was not released');
});

test('the buyer reads the answer and rates the mentor', async () => {
  const page = pages.buyer;
  await page.goto('/dashboard.html?tab=asked');
  const list = page.locator('#askedList');
  await expect(list).toContainText('Start with Flutter');
  const form = list.locator('.rate-form').first();
  await form.locator('.star-btn[data-value="5"]').click();
  await form.locator('textarea').fill('Clear, practical and exactly for my situation. Thank you!');
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => ((await S.sql('SELECT stars FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, 'asker_to_mentor']))[0] || {}).stars).toBe(5);
});

test('a question that is not answered in time is refunded automatically, and the buyer sees it', async () => {
  const page = pages.buyer;
  await page.goto(`/u/${mentorUsername}`);
  await openAskForm(page);
  await page.fill('#question', 'A second question that the mentor will not answer in time: how do I publish my first app to the App Store?');
  await page.click('#askBtn');
  await page.waitForURL(/mock-bank\.html/);
  await page.click('#payBtn');
  await page.waitForURL(/booking=/);
  const id = new URL(page.url()).searchParams.get('booking');
  await S.untilBooking(id, (b) => b.status === 'paid', 'not paid');
  await S.sql(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [id]); // seven days later
  await S.untilBooking(id, (b) => b.status === 'refunded', 'the unanswered question was not refunded');
  await page.goto('/dashboard.html?tab=asked');
  await expect(page.locator(`#askedList [data-id="${id}"]`)).toContainText(/Refunded/);
});

test('switching the language keeps you on the same page (and it sticks after a reload)', async () => {
  const page = pages.buyer;
  await page.goto(`/u/${mentorUsername}`);
  const before = page.url();
  const where = await openMenuIfPhone(page);
  await where.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ka');
  expect(page.url()).toBe(before);
  await expect(page.locator('h1')).toContainText(people.mentor.name);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ka');
  // back to English for the rest
  const again = await openMenuIfPhone(page);
  await again.locator('.lang-btn[data-lang="en"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the dark theme can be chosen and stays after a reload', async () => {
  const page = pages.buyer;
  await page.goto('/');
  if (isPhone()) {
    const menu = await openMenuIfPhone(page);
    await menu.locator('[data-theme-choice="dark"]').first().click();
  } else {
    await page.click('#themeBtn');
    await page.locator('#themeMenu [data-theme-choice="dark"]').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
