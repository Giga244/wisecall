// Live sessions in the browser, with the fake bank and the fake video provider: a mentor writes and publishes a session, the admin approves
// it, a buyer pays at the bank, both join the room (the call is the fake video page), the buyer asks a question that another participant
// upvotes, the mentor marks it and ends the session, the session's earnings are recorded, and the mentor withdraws them.
// Runs after full-flow.spec.js (the admin account): files run in name order.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

let contexts = [];
let mentor, mentorPage, adminPage, buyerPage, otherBuyer, sessionId, slug;
const shot = (page, name) => (process.env.E2E_SHOTS ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }) : null);

test.beforeAll(async ({ browser }) => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  mentor = await S.listedMentor(admin, { name: 'Lela Live', email: 'lela-live@e2e.test', niche: 'tech', roleTitle: 'Engineering manager' });
  expect((await admin.api(`/admin/live/hosts/${mentor.id}`, { method: 'POST' })).status).toBe(200);
  await S.apiUser('Beka Buyer', 'beka-live@e2e.test');
  otherBuyer = await S.apiUser('Tako Watcher', 'tako-live@e2e.test');
  for (const email of ['lela-live@e2e.test', 'e2e-admin@example.com', 'beka-live@e2e.test']) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    await S.logIn(page, { email });
    if (email.startsWith('lela')) mentorPage = page; else if (email.startsWith('beka')) buyerPage = page; else adminPage = page;
  }
});
test.afterAll(async () => { for (const c of contexts) await c.close(); });

test('the mentor writes a session, previews it and sends it for approval', async () => {
  await mentorPage.goto('/dashboard.html?tab=live');
  await mentorPage.click('text=New session');
  await mentorPage.waitForURL(/live-edit\.html/);
  await mentorPage.fill('#lvTitle', 'Your first engineering job: ask me anything');
  await mentorPage.fill('#lvDescription', 'An hour of honest answers about getting the first engineering job: CVs, interviews, the first months. For students and career changers.');
  await mentorPage.locator('#lvPoints input').first().fill('What interviewers really look for');
  await mentorPage.selectOption('#lvNiche', 'tech');
  await mentorPage.fill('#lvPrice', '200'); // (one ticket's share, 160 ₾, is enough to withdraw)
  await mentorPage.fill('#lvMinSeats', '1');
  await mentorPage.click('#liveForm button[type="submit"]');
  await expect(mentorPage.locator('#lvStatus')).toContainText('Draft');
  sessionId = new URL(mentorPage.url()).searchParams.get('id');
  await mentorPage.click('#lvPublish');
  await S.confirm(mentorPage);
  await expect(mentorPage.locator('#lvStatus')).toContainText('Waiting for approval');
  await shot(mentorPage, 'live-editor');
  slug = (await S.sql('SELECT slug FROM live_sessions WHERE id = $1', [sessionId]))[0].slug;
});

test('the admin approves it; it is public', async () => {
  await adminPage.goto('/admin.html');
  await adminPage.click('#adminTabs [data-tab="live"]');
  const card = adminPage.locator('.lv-review', { hasText: 'Lela Live' });
  await expect(card).toBeVisible();
  await card.locator('.lv-approve').click();
  await expect(adminPage.locator('.lv-review', { hasText: 'Lela Live' })).toHaveCount(0);
  expect((await S.sql('SELECT status FROM live_sessions WHERE id = $1', [sessionId]))[0].status).toBe('published');
  const visitor = await (await fetch(`${S.BASE}/live`)).text();
  expect(visitor).toContain('Your first engineering job');
});

test('a buyer reads the rules, pays at the bank and has a ticket', async () => {
  await buyerPage.goto(`/live/${slug}`);
  await expect(buyerPage.locator('.live-rules')).toContainText('24 hours');
  await buyerPage.locator('details.live-ask summary').click();
  await buyerPage.fill('#q1', 'How many projects should a junior show?');
  await buyerPage.check('#agree');
  await buyerPage.click('#buyForm button[type="submit"]');
  await buyerPage.waitForURL(/mock-bank\.html/);
  await buyerPage.click('#payBtn');
  await buyerPage.waitForURL(/\/live\//);
  await expect(buyerPage.locator('#liveBuy')).toContainText('You have a ticket', { timeout: 20000 });
  await shot(buyerPage, 'live-session-ticket');
  // a second participant, paid through the API (the same fake bank)
  const r = await otherBuyer.api(`/live/${sessionId}/tickets`, { method: 'POST', body: {} });
  await client(S.BASE).api(`/mock-bank/orders/${new URL(r.checkoutUrl).searchParams.get('order')}/complete`, { method: 'POST', body: { outcome: 'success' } });
  await expect.poll(async () => (await S.sql('SELECT status FROM live_tickets WHERE id = $1', [r.ticket.id]))[0].status).toBe('paid');
});

test('in the room: the buyer joins with a nickname, asks; another participant upvotes; the mentor marks it', async () => {
  await S.sql(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [sessionId]);
  await buyerPage.goto(`/live/${slug}/room`);
  await buyerPage.check('#joinAnon');
  await buyerPage.click('#joinBtn');
  const call = buyerPage.frameLocator('iframe.live-call');
  await expect(call.locator('dd[data-key="result"]')).toHaveText('joined');
  await expect(call.locator('dd[data-key="name"]')).toHaveText(/^Guest \d+$/);
  await expect(call.locator('dd[data-key="canSend"]')).toContainText('nothing');
  await buyerPage.fill('#askInput', 'Do side projects count as experience?');
  await buyerPage.click('#askForm button[type="submit"]');
  await expect(buyerPage.locator('#liveQuestions')).toContainText('Do side projects count as experience?');
  const q = (await S.sql(`SELECT id FROM live_questions WHERE session_id = $1 AND source = 'room'`, [sessionId]))[0];
  expect((await otherBuyer.api(`/live/questions/${q.id}/vote`, { method: 'POST' })).status).toBe(200);
  await mentorPage.goto(`/live/${slug}/room`);
  const mentorCall = mentorPage.frameLocator('iframe.live-call');
  await expect(mentorCall.locator('dd[data-key="role"]')).toHaveText('owner');
  const item = mentorPage.locator('.live-q', { hasText: 'Do side projects count' });
  await expect(item).toContainText('▲ 1');
  await item.locator('.q-state[data-state="answering"]').click();
  await expect(buyerPage.locator('.live-q', { hasText: 'Do side projects count' })).toContainText('answering now', { timeout: 10000 });
  await shot(buyerPage, 'live-room-participant');
  await shot(mentorPage, 'live-room-mentor');
});

test('the mentor ends the session; the earnings are recorded and can be withdrawn', async () => {
  // (the mentor was there for the whole hour: heartbeats are simulated)
  await S.sql(`UPDATE live_sessions SET starts_at = now() - interval '61 minutes', mentor_seconds = 3600 WHERE id = $1`, [sessionId]);
  await mentorPage.click('#endBtn');
  await S.confirm(mentorPage);
  await expect(mentorPage.locator('#liveStatus')).toContainText('ended');
  const [p] = await S.sql('SELECT * FROM payouts WHERE live_session_id = $1', [sessionId]);
  expect([p.amount, p.status]).toEqual([2 * 16000, 'pending']);
  await S.sql(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE id = $1`, [p.id]);
  await mentorPage.goto('/dashboard.html?tab=earnings');
  const card = mentorPage.locator('#balanceCard');
  await expect(card).toContainText('320');
  const form = card.locator('.bal-withdraw');
  await form.locator('input[type="password"]').fill(S.PASSWORD);
  await form.locator('button[type="submit"]').click();
  await expect(card).toContainText('Requested');
  expect((await S.sql(`SELECT amount FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentor.id]))[0].amount).toBe(32000);
});
