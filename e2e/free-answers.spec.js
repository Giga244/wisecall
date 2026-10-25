// Free answers (docs/CLAUDE-CODE-FREE-ANSWERS.md), in the browser: a mentor chooses "Answer for free" in Settings; Browse shows "Free" on
// the card and a "Free" filter; the asker sends a question with no payment step and sees "Free" in the dashboard; the mentor's line
// says "Free" too. Georgian: "უფასო".
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}

test.beforeAll(async () => {
  const admin = await adminClient();
  // (an approved mentor at 5 ₾, who would rather answer for free)
  people.mentor = await S.listedMentor(admin, { name: 'Nana Giver', email: `free-mentor-${tag}@e2e.test`, price: 5, roleTitle: 'Beekeeper' });
  people.asker = { name: 'Ana Asker', email: `free-asker-${tag}@e2e.test` };
  await S.apiUser(people.asker.name, people.asker.email);
});

test('the mentor switches to "Answer for free" in Settings -> Mentor, with a weekly number', async ({ page }) => {
  await S.logIn(page, people.mentor, '/settings.html?tab=mentor');
  await expect(page.locator('#price')).toHaveValue('5');
  await page.check('#mentorForm input[name="priceMode"][value="free"]');
  await expect(page.locator('#pricePaidBox')).toBeHidden();
  await expect(page.locator('#priceFreeBox')).toBeVisible();
  await page.fill('#freeWeeklyCap', '6');
  await page.click('#mentorForm button[type="submit"]');
  await expect.poll(async () => (await S.sql('SELECT price, free_weekly_cap FROM users WHERE email = $1', [people.mentor.email]))[0]).toEqual({ price: 0, free_weekly_cap: 6 });
  await page.reload();
  await expect(page.locator('#mentorForm input[name="priceMode"][value="free"]')).toBeChecked();
  await expect(page.locator('#freeWeeklyCap')).toHaveValue('6');
});

test('Browse: the card says "Free", and the "Free" filter shows only mentors who answer for free', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.expert-card', { hasText: 'Nana Giver' });
  await expect(card.locator('.price')).toHaveText('Free');
  await page.locator('#filters [data-free]').click();
  await expect(page).toHaveURL(/[?&]free=1/);
  await expect(page.locator('#filters [data-free]')).toHaveAttribute('aria-pressed', 'true');
  const prices = await page.locator('#expertGrid .expert-card .price').allTextContents();
  expect(prices.length).toBeGreaterThan(0);
  expect(prices.every((p) => p.trim() === 'Free')).toBe(true);
  await page.goto('/ka/?free=1');
  await expect(page.locator('.expert-card', { hasText: 'Nana Giver' }).locator('.price')).toHaveText('უფასო');
});

test('the asker sends a free question: no payment step, "Free" in the dashboard; the mentor sees it as free', async ({ page, browser }) => {
  await S.logIn(page, people.asker, `/u/${people.mentor.username}`);
  const box = page.locator('#askForm');
  await expect(page.locator('.ask-price strong').first()).toHaveText('Free');
  await expect(page.locator('#askCodeBox')).toHaveCount(0); // (no discount code on a free question)
  await page.fill('#question', 'I keep bees in Racha and want to sell honey in Tbilisi. Which shops or markets should I talk to first, and what do they expect?');
  await expect(box.locator('#askBtn')).toHaveText('Send my question');
  await box.locator('#askBtn').click();
  await expect(page.locator('.booking-result.success')).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('localhost'); // (never sent to a bank)
  const [b] = await S.sql(`SELECT b.status, b.amount, b.provider FROM bookings b JOIN users u ON u.id = b.seeker_id WHERE u.email = $1`, [people.asker.email]);
  expect(b).toEqual({ status: 'paid', amount: 0, provider: 'free' });
  await page.goto('/dashboard.html');
  const card = page.locator('.booking-card', { hasText: 'I keep bees in Racha' });
  await expect(card.locator('.booking-amount')).toHaveText('Free');
  await expect(card.locator('.badge')).toHaveText('Free — awaiting answer');

  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await S.logIn(m, people.mentor);
  await m.click('#tab-received');
  const mine = m.locator('.booking-card', { hasText: 'I keep bees in Racha' });
  await expect(mine.locator('.booking-amount')).toHaveText('Free');
  await ctx.close();
});
