// The Inbox in a real browser: the unread badge, the one free follow-up (a phone number is refused with an explanation), the mentor's one
// reply closing the conversation, and a support conversation that reaches the admin panel and comes back with the answer.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay, longAnswer } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let admin, mentor, contexts = [], buyerPage, mentorPage, adminPage, bookingId;

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  const known = (await S.sql('SELECT 1 FROM users WHERE email = $1', ['e2e-admin@example.com'])).length > 0;
  if (known) await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  else admin = await S.apiUser('E2E Admin', 'e2e-admin@example.com');
  mentor = await S.listedMentor(admin, { name: 'Iris Inbox', email: 'iris@e2e.test', niche: 'tech', price: 30, roleTitle: 'Backend engineer' });
  const buyer = await S.apiUser('Ina Buyer', 'ina@e2e.test');
  const booking = await bookAndPay(S.BASE, buyer, mentor.id, 'How should I structure logging for a small web app that is starting to grow?');
  bookingId = booking.id;
  const r = await mentor.client.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: longAnswer('Log one line per request with an id, and keep errors separate from access logs.') } });
  if (r.status !== 200) throw new Error('answer failed: ' + r.text);
  // (a new mentor's first answers wait for an admin: release this one, as the admin would from the review queue)
  const rel = await admin.api(`/admin/answers/${bookingId}/approve`, { method: 'POST' });
  if (rel.status !== 200) throw new Error('release failed: ' + rel.text);
  contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  [buyerPage, mentorPage, adminPage] = await Promise.all(contexts.map((c) => c.newPage()));
  await S.logIn(buyerPage, { email: 'ina@e2e.test' });
  await S.logIn(mentorPage, { email: 'iris@e2e.test' });
  await S.logIn(adminPage, { email: 'e2e-admin@example.com' });
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close())); });

test('the asker opens the conversation from the dashboard; a phone number is refused with an explanation; one follow-up is sent', async () => {
  await buyerPage.goto('/dashboard.html');
  await expect(buyerPage.locator('.nav-inbox .nav-badge')).toBeVisible(); // the answer is unread
  await buyerPage.locator(`a[href="/inbox.html?booking=${bookingId}"]`).click();
  await buyerPage.waitForURL(/\/inbox\.html\?thread=/);
  await expect(buyerPage.locator('.qa-answer')).toContainText('one line per request');
  await expect(buyerPage.locator('.nav-inbox .nav-badge')).toBeHidden(); // read now

  const box = buyerPage.locator('#composerText');
  await box.fill('Thanks! Could you call me on +995 555 12 34 56 to go through it?');
  await buyerPage.locator('[data-composer="ask"] button[type="submit"]').click();
  await expect(buyerPage.locator('#composerError')).toContainText('a phone number');
  await box.fill('Thanks! Would you send the logs to a hosted service from day one, or wait?');
  await buyerPage.locator('[data-composer="ask"] button[type="submit"]').click();
  await expect(buyerPage.locator('.msg-mine .msg-body')).toHaveText('Thanks! Would you send the logs to a hosted service from day one, or wait?');
  await expect(buyerPage.locator('[data-composer]')).toHaveCount(0);
  await expect(buyerPage.locator('.thread-foot')).toContainText('The mentor can reply once');
});

test('the mentor sees the unread badge, replies once, and the conversation closes for both', async () => {
  await mentorPage.goto('/dashboard.html');
  await expect(mentorPage.locator('.nav-inbox .nav-badge')).toBeVisible();
  await mentorPage.goto(`/inbox.html?booking=${bookingId}`);
  await expect(mentorPage.locator('.msg-body').last()).toContainText('hosted service');
  await mentorPage.fill('#composerText', 'Wait until you have real traffic; until then, files rotated daily are enough.');
  await mentorPage.locator('[data-composer="reply"] button[type="submit"]').click();
  await expect(mentorPage.locator('.thread-closed')).toBeVisible();
  await buyerPage.reload();
  await expect(buyerPage.locator('.thread-closed')).toBeVisible();
  await expect(buyerPage.locator('.msg-event').last()).toContainText('closed');
  if (process.env.E2E_SHOTS) await buyerPage.screenshot({ path: `${process.env.E2E_SHOTS}/inbox-desktop.png`, fullPage: true });
});

test('a support conversation reaches the admin panel, and the answer comes back to the person', async () => {
  await buyerPage.goto('/inbox.html');
  await buyerPage.click('#newSupport');
  await buyerPage.fill('#supportSubject', 'Receipt for my payment');
  await buyerPage.fill('#supportBody', 'Hello, could I get a receipt for my last question?');
  await buyerPage.locator('#supportForm button[type="submit"]').click();
  await expect(buyerPage.locator('.thread-head h2')).toHaveText('Receipt for my payment');

  await adminPage.goto('/admin.html');
  await adminPage.locator('#adminTabs [data-tab="support"]').click();
  const item = adminPage.locator('.sup-item', { hasText: 'Receipt for my payment' });
  await expect(item).toContainText('ina@e2e.test');
  await item.locator('[data-sup-open]').click();
  await adminPage.fill('#supReplyText', 'Of course: you will find it in your dashboard.');
  await adminPage.locator('#supReply button[type="submit"]').click();
  await expect(adminPage.locator('.sup-thread .msg-body').last()).toHaveText('Of course: you will find it in your dashboard.');

  await buyerPage.reload();
  await expect(buyerPage.locator('.msg-body').last()).toHaveText('Of course: you will find it in your dashboard.');
  await expect(buyerPage.locator('.msg-meta').last()).toContainText('Wisecall support');
});

test('Georgian, and a phone-width layout: one pane at a time with a way back', async () => {
  await buyerPage.setViewportSize({ width: 375, height: 800 });
  await buyerPage.goto('/inbox.html');
  await expect(buyerPage.locator('.inbox-list')).toBeVisible();
  await buyerPage.locator('.thread-item').first().click();
  await expect(buyerPage.locator('.inbox-list')).toBeHidden();
  await buyerPage.locator('[data-back]').click();
  await expect(buyerPage.locator('.inbox-list')).toBeVisible();
  await buyerPage.locator('.nav-lang .lang-btn[data-lang="ka"]').click();
  await expect(buyerPage.locator('h1')).toHaveText('შემოსულები');
  await expect(buyerPage.locator('#newSupport')).toHaveText('მიწერე მხარდაჭერას');
  if (process.env.E2E_SHOTS) await buyerPage.screenshot({ path: `${process.env.E2E_SHOTS}/inbox-375-ka.png`, fullPage: true });
  const overflow = await buyerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await buyerPage.locator('.nav-lang .lang-btn[data-lang="en"]').click();
  await buyerPage.setViewportSize({ width: 1280, height: 800 });
});

test('a system message about a live session shows its real sentence in the list (title included, escaped once), EN and KA', async () => {
  // (as server/live/notices.js writes a confirmed ticket: one event in the buyer's system thread)
  const [ina] = await S.sql('SELECT id FROM users WHERE email = $1', ['ina@e2e.test']);
  await S.sql(`INSERT INTO threads (kind, user_id, subject) VALUES ('system', $1, 'Wisecall') ON CONFLICT (user_id) WHERE kind = 'system' DO NOTHING`, [ina.id]);
  const [sys] = await S.sql(`SELECT id FROM threads WHERE kind = 'system' AND user_id = $1`, [ina.id]);
  const addEvent = async (title) => {
    await S.sql(`INSERT INTO messages (thread_id, sender_role, kind, event, data) VALUES ($1, 'system', 'event', 'live_ticket', $2)`, [sys.id, JSON.stringify({ title, slug: 'first-backend-job' })]);
    await S.sql('UPDATE threads SET last_message_at = now() WHERE id = $1', [sys.id]);
  };
  const preview = buyerPage.locator(`[data-thread="${sys.id}"] .thread-preview`);

  await addEvent('Your first backend job: ask me anything');
  await buyerPage.goto(`/inbox.html?thread=${sys.id}`);
  await expect(preview).toHaveText('Your ticket to "Your first backend job: ask me anything" is confirmed.');
  await expect(buyerPage.locator('.msg-event p').last()).toContainText('Your ticket to "Your first backend job: ask me anything" is confirmed.');
  await buyerPage.locator('.nav-lang .lang-btn[data-lang="ka"]').click();
  await expect(preview).toHaveText('შენი ბილეთი სესიაზე „Your first backend job: ask me anything“ დადასტურდა.');
  await buyerPage.locator('.nav-lang .lang-btn[data-lang="en"]').click();
  await expect(preview).toHaveText('Your ticket to "Your first backend job: ask me anything" is confirmed.');

  // Characters HTML cares about show as written: not as entities, and never as markup.
  await addEvent('Q&A <live> "logs"');
  await buyerPage.reload();
  await expect(preview).toHaveText('Your ticket to "Q&A <live> "logs"" is confirmed.');
  await expect(buyerPage.locator(`[data-thread="${sys.id}"] .thread-preview live`)).toHaveCount(0);
});
