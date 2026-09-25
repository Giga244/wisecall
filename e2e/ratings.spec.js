// Two-way ratings in a real browser: the asker and the mentor rate each other (private until both have, or 7 days), the review
// appears on the mentor's profile with the mentor's reply, another user reports it, and an admin hides it with a reason.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const REVIEW = 'Practical and kind: I finally know what to do next.';
const NOTE = 'A thoughtful person; nothing for the team to worry about.';
let admin, mentor, asker, bookingId;
let contexts = [], askerPage, mentorPage, visitorPage, reporterPage, adminPage;

async function ctxPage(browser, login) {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  if (login) await S.logIn(page, { email: login });
  return page;
}

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) {
    const r = await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
    if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  } else admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  mentor = await S.listedMentor(admin, { name: 'Rita Rated', email: 'rita@e2e.test', niche: 'business', price: 18, roleTitle: 'Consultant' });
  asker = await S.apiUser('Alex Asker', 'alex@e2e.test');
  await S.apiUser('Rex Reporter', 'rex@e2e.test');
  askerPage = await ctxPage(browser, 'alex@e2e.test');
  mentorPage = await ctxPage(browser, 'rita@e2e.test');
  reporterPage = await ctxPage(browser, 'rex@e2e.test');
  visitorPage = await ctxPage(browser, null);
  adminPage = await ctxPage(browser, 'e2e-admin@example.com');
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

const openAsked = async (page) => { await page.goto('/dashboard.html?tab=asked'); return page.locator('#askedList'); };
const openReceived = async (page) => { await page.goto('/dashboard.html?tab=received'); return page.locator('#receivedList'); };

test('a paid, answered question: both people are asked to rate', async () => {
  bookingId = await S.askAndPay(askerPage, mentor, 'How do I price my first consulting project?');
  await S.untilBooking(bookingId, (b) => b.status === 'paid', 'not paid');
  // (a new mentor's first answers are checked by an admin before the buyer sees them)
  expect((await mentor.client.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: 'Price by the outcome, not the hours: start from what the result is worth to them.' } })).status).toBe(200);
  expect((await admin.api(`/admin/answers/${bookingId}/approve`, { method: 'POST' })).status).toBe(200);

  const asked = await openAsked(askerPage);
  await expect(asked.locator('.rate-card.rate-prompt .rate-h')).toHaveText('Rate your mentor');
  await expect(asked.locator('.rate-card')).toContainText('Ratings stay private');

  const received = await openReceived(mentorPage);
  await expect(received.locator('.rate-card.rate-prompt .rate-h')).toHaveText('Rate this asker');
  await expect(received.locator('.asker-line')).toContainText('New asker');
});

test('the asker rates first: it is saved, private, and can be changed', async () => {
  const asked = await openAsked(askerPage);
  const form = asked.locator('.rate-form');
  await form.locator('.star-btn[data-value="4"]').click();
  await form.locator('.check-chip', { hasText: 'Helpful' }).click();
  await form.locator('.check-chip', { hasText: 'Clear' }).click();
  await form.locator('textarea').fill(REVIEW);
  await form.locator('button[type="submit"]').click();
  await expect(asked.locator('.rate-card')).toContainText(/saved and stays private until Rita Rated has rated too/);
  let [row] = await S.sql('SELECT stars, tags, review, revealed_at FROM ratings WHERE booking_id = $1', [bookingId]);
  expect(row).toMatchObject({ stars: 4, tags: ['helpful', 'clear'], review: REVIEW, revealed_at: null });

  // change it
  await asked.locator('.rate-change').click();
  const edit = asked.locator('.rate-edit .rate-form');
  await expect(edit).toBeVisible();
  await edit.locator('.star-btn[data-value="5"]').click();
  await edit.locator('button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT stars FROM ratings WHERE booking_id = $1', [bookingId]))[0].stars).toBe(5);
  [row] = await S.sql('SELECT edited_at FROM ratings WHERE booking_id = $1', [bookingId]);
  expect(row.edited_at).not.toBeNull();
});

test('double-blind: the mentor and visitors see nothing of it yet', async () => {
  const received = await openReceived(mentorPage);
  await expect(received.locator('.rate-card')).toBeVisible();
  const text = await received.innerText();
  expect(text).not.toContain(REVIEW);
  expect(text).not.toContain('Both ratings are now visible');
  await visitorPage.goto(`/u/${mentor.username}`);
  await expect(visitorPage.locator('#reviewsBody')).toContainText(/No reviews yet/i);
  expect(await visitorPage.locator('body').innerText()).not.toContain(REVIEW);
});

test('the mentor rates the asker (stars, tags, a private note): both ratings are now visible to both', async () => {
  const received = await openReceived(mentorPage);
  const form = received.locator('.rate-form');
  await expect(received.locator('.rate-card .rate-h')).toHaveText('Rate this asker');
  await expect(form.locator('legend').first()).toHaveText('Clear, respectful question');
  await form.locator('.star-btn[data-value="5"]').click();
  await form.locator('.check-chip', { hasText: 'Clear question' }).click();
  await form.locator('.check-chip', { hasText: 'Respectful' }).click();
  await form.locator('textarea').fill(NOTE);
  await form.locator('button[type="submit"]').click();
  await expect(received.locator('.rate-card')).toContainText('Both ratings are now visible');
  await expect(received.locator('.rate-theirs')).toContainText(REVIEW); // the mentor now reads the asker's review
  await expect(received.locator('.reply-box')).toBeVisible();

  const asked = await openAsked(askerPage);
  await expect(asked.locator('.rate-card')).toContainText('Both ratings are now visible');
  await expect(asked.locator('.rate-theirs')).toContainText('Rita Rated’s rating');
  await expect(asked.locator('.rate-theirs .chip-tag')).toHaveText(['Clear question', 'Respectful']);
  expect(await asked.innerText()).not.toContain(NOTE); // the private note is for the Wisecall team only
  expect((await S.sql('SELECT private_note FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, 'mentor_to_asker']))[0].private_note).toBe(NOTE);
});

test('the review is public on the mentor\'s profile, with the reviewer, the tags and the numbers', async () => {
  await visitorPage.goto(`/u/${mentor.username}`);
  const body = visitorPage.locator('#reviewsBody');
  await expect(body.locator('.review-card')).toHaveCount(1);
  const card = body.locator('.review-card');
  await expect(card).toContainText(REVIEW);
  await expect(card.locator('.reviewer')).toContainText('Alex Asker');
  await expect(card.locator('a.reviewer')).toHaveAttribute('href', '/u/alex-asker');
  await expect(card.locator('.chip-tag')).toHaveText(['Helpful', 'Clear']);
  await expect(body.locator('.review-summary')).toContainText('5');
  await expect(body.locator('.review-summary')).toContainText('1 rating');
  await expect(body.locator('.rate-tag-summary')).toContainText('Helpful');
  await expect(visitorPage.locator('.profile-stats')).toContainText('★ 5');
  // the asker's profile has no rating yet (a badge appears from 3 ratings)
  await visitorPage.goto('/u/alex-asker');
  await expect(visitorPage.locator('.asker-badge')).toHaveCount(0);
});

test('the mentor replies once, in public; the reviewer and visitors see the reply', async () => {
  await mentorPage.goto(`/u/${mentor.username}`);
  const card = mentorPage.locator('#reviewsBody .review-card');
  await card.locator('.reply-box summary').click();
  await card.locator('.reply-form textarea').fill('Thank you, Alex! Come back with the next question.');
  await card.locator('.reply-form button').click();
  await expect(card.locator('.review-reply')).toContainText('Reply from Rita Rated');
  await expect(card.locator('.reply-box')).toHaveCount(0); // only once

  await visitorPage.goto(`/u/${mentor.username}`);
  await expect(visitorPage.locator('#reviewsBody .review-reply')).toContainText('Come back with the next question');
  const asked = await openAsked(askerPage);
  await expect(asked.locator('.rate-mine .review-reply')).toContainText('Come back with the next question');
});

test('anybody who is logged in can report the review; a visitor is asked to log in', async () => {
  await visitorPage.goto(`/u/${mentor.username}`);
  await expect(visitorPage.locator('#reviewsBody .report-login a')).toContainText('Log in to report this review');

  await reporterPage.goto(`/u/${mentor.username}`);
  const card = reporterPage.locator('#reviewsBody .review-card');
  await card.locator('.rreport-box summary').click();
  await card.locator('select[name="reason"]').selectOption('personal_info');
  await card.locator('textarea[name="details"]').fill('It mentions a name.');
  await card.locator('.report-form button').click();
  await expect(card.locator('.rreport-box')).toContainText('Thank you');
  await expect.poll(async () => (await S.sql(`SELECT count(*)::int AS n FROM review_reports WHERE status = 'open'`))[0].n).toBe(1);
});

test('an admin sees the report, and hiding the review needs a written reason', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="reviews"]');
  const card = adminPage.locator('#adminContent .rv-card').first();
  await expect(card).toContainText(REVIEW);
  await expect(card).toContainText('Contains personal information');
  await expect(card).toContainText('rex@e2e.test');
  await card.locator('.rv-hide').click(); // no reason: refused
  await expect(adminPage.locator('#toast')).toContainText(/reason/i);
  expect(await S.sql('SELECT hidden_at FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, 'asker_to_mentor'])).toEqual([{ hidden_at: null }]);
  await card.locator('.rv-reason').fill('Mentions a private person by name');
  await card.locator('.rv-hide').click();
  await expect.poll(async () => (await S.sql('SELECT hidden_at FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, 'asker_to_mentor']))[0].hidden_at).not.toBeNull();

  // it is gone from the profile and from the numbers
  await visitorPage.goto(`/u/${mentor.username}`);
  await expect(visitorPage.locator('#reviewsBody')).toContainText(/No reviews yet/i);
  expect(await visitorPage.locator('body').innerText()).not.toContain(REVIEW);

  // the hidden list keeps who and why; showing it again needs a reason too
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="reviews"]');
  const hidden = adminPage.locator('#adminContent .rv-card').first();
  await expect(hidden).toContainText('Mentions a private person by name');
  await expect(hidden).toContainText('e2e-admin@example.com');
  await hidden.locator('.rv-reason').fill('The reviewer removed the name');
  await hidden.locator('.rv-unhide').click();
  await expect.poll(async () => (await S.sql('SELECT hidden_at FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, 'asker_to_mentor']))[0].hidden_at).toBeNull();
  await visitorPage.reload();
  await expect(visitorPage.locator('#reviewsBody .review-card')).toContainText(REVIEW);
});

test('in Georgian too', async () => {
  await openAsked(askerPage);
  await askerPage.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(askerPage.locator('#askedList .rate-card .rate-h')).toHaveText('შეაფასე შენი მენტორი');
  await expect(askerPage.locator('#askedList .rate-theirs .chip-tag').first()).toHaveText('გასაგები კითხვა');
  await visitorPage.goto(`/u/${mentor.username}`);
  await visitorPage.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(visitorPage.locator('#reviewsBody .chip-tag').first()).toContainText('სასარგებლო');
  await expect(visitorPage.locator('#reviewsBody .review-reply strong')).toContainText('პასუხი: Rita Rated');
  await expect(visitorPage.locator('#reviewsBody .rreport-box summary, #reviewsBody .report-login a').first()).toContainText('მიმოხილვა');
});

test('nothing runs off the side at phone, tablet and laptop widths', async ({ browser }) => {
  const page = await ctxPage(browser, 'alex@e2e.test');
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const url of ['/dashboard.html?tab=asked', `/u/${mentor.username}`]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `${url} at ${w}px`).toBe(false);
      // E2E_SHOTS=<folder> keeps a picture of each page, for looking at the design
      if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/ratings-${url.startsWith('/u/') ? 'profile' : 'dashboard'}-${w}.png`, fullPage: true });
    }
  }
  const mp = await ctxPage(browser, 'rita@e2e.test');
  for (const [w, h] of [[390, 844], [768, 1024]]) {
    await mp.setViewportSize({ width: w, height: h });
    await mp.goto('/dashboard.html?tab=received');
    await mp.waitForLoadState('networkidle');
    expect(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `received at ${w}px`).toBe(false);
  }
});
