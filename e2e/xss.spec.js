// Cross-site scripting (PART 6): "<script>alert(1)</script>" and "<img src=x onerror=alert(1)>" are saved in every text a person can
// write (names, profile, mentor application, question, answer, review, reply, follow-up, support, report, dispute, contact form), then
// every page that shows them is opened as each kind of visitor. Nothing may run: no dialog, no injected element, the text shown as text.
// Runs after full-flow.spec.js (the admin account).
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay, longAnswer, longQuestion } = require('../tests/helpers');

const SCRIPT = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';
const BOTH = `${SCRIPT} ${IMG}`;

test.describe.configure({ mode: 'serial' });

let admin, asker, mentor, bookingId, askerName, mentorUsername, askerUsername;

test.beforeAll(async () => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });

  // The mentor: a name, a title, a profile and an application full of markup.
  const m = await S.listedMentor(admin, { name: `Xavi ${IMG}`, email: 'xavi.xss@e2e.test', niche: 'tech', price: 20, roleTitle: `Engineer ${SCRIPT}` });
  mentor = m.client;
  mentorUsername = m.username;
  await mentor.api('/me', { method: 'PATCH', body: { bio: `About me ${BOTH}`, headline: `Head ${IMG}`, currentWork: `Work ${SCRIPT}`, city: `City ${IMG}` } });

  // The asker: the same, and a public profile.
  askerName = `Asha ${SCRIPT}`;
  asker = await S.apiUser(askerName, 'asha.xss@e2e.test');
  await asker.api('/me', { method: 'PATCH', body: { bio: `Asker bio ${BOTH}`, headline: `Asker ${IMG}`, profileVisibility: 'public' } });
  // (an asker's parts start as "only me": shown to everyone here, so the escaping can be checked)
  for (const section of ['about', 'headline']) await asker.api('/me/profile/visibility', { method: 'PUT', body: { section, level: 'everyone' } });
  askerUsername = (await asker.api('/me')).user.username;

  // A question, its answer, both ratings with a review, the mentor's reply, a follow-up and its reply.
  const b = await bookAndPay(S.BASE, asker, m.id, longQuestion(`My question ${BOTH}`));
  bookingId = b.id;
  expect((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`My answer ${BOTH}`) } })).status).toBe(200);
  expect((await admin.api(`/admin/answers/${b.id}/approve`, { method: 'POST' })).status).toBe(200); // (a new mentor's first answers wait for an admin)
  const threadId = (await asker.api(`/inbox/booking/${b.id}`)).threadId;
  expect((await asker.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body: `Follow-up question ${BOTH}` } })).status).toBe(201);
  expect((await mentor.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body: `Follow-up reply ${BOTH}` } })).status).toBe(201);
  await S.sql(`UPDATE bookings SET answered_at = now() - interval '8 days', answer_released_at = now() - interval '8 days' WHERE id = $1`, [b.id]);
  expect((await asker.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 5, review: `Review ${BOTH}` } })).status).toBe(201);
  expect((await mentor.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 5, privateNote: `Note to the team ${BOTH}` } })).status).toBe(201);
  const [rating] = await S.sql(`SELECT id FROM ratings WHERE booking_id = $1 AND direction = 'asker_to_mentor'`, [b.id]);
  expect((await mentor.api(`/ratings/${rating.id}/reply`, { method: 'POST', body: { body: `Reply ${BOTH}` } })).status).toBe(201);

  // A support conversation, a report about the mentor, a reported problem with the answer, and the contact form.
  expect((await asker.api('/inbox/support', { method: 'POST', body: { subject: `Subject ${IMG}`, body: `Support ${BOTH}` } })).status).toBe(201);
  expect((await asker.api(`/experts/${m.id}/report`, { method: 'POST', body: { reason: 'other', details: `Report ${BOTH}` } })).status).toBe(201);
  await S.sql(`UPDATE bookings SET answered_at = now(), answer_released_at = now() WHERE id = $1`, [b.id]); // (back inside the window to report a problem)
  expect((await asker.api(`/bookings/${b.id}/dispute`, { method: 'POST', body: { reason: 'other', details: `Dispute ${BOTH}` } })).status).toBe(201);
  expect((await client(S.BASE).api('/contact', { method: 'POST', body: { name: `Visitor ${IMG}`, email: 'visitor.xss@e2e.test', message: `Contact ${BOTH}` } })).status).toBe(200);
});

// Opens a page and checks that nothing ran: no alert, no element made from the text, and (where given) the text visible as text.
async function check(page, url, shown) {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  expect(dialogs, `${url}: a dialog opened`).toEqual([]);
  const injected = await page.evaluate(() => ({
    img: document.querySelectorAll('img[src="x"]').length,
    // (a script that would run; the structured data block is data, and must keep "<" escaped so it cannot close itself)
    scripts: Array.from(document.querySelectorAll('script')).filter((s) => (s.type === 'application/ld+json' ? /<\/?script|<img/i : /alert\(1\)/).test(s.textContent)).length,
    handlers: Array.from(document.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => /^on/i.test(a.name))).length
  }));
  expect(injected, `${url}: markup from the text became part of the page`).toEqual({ img: 0, scripts: 0, handlers: 0 });
  if (shown) await expect(page.locator('body')).toContainText(shown);
}

test('the public pages: Browse, the mentor and asker profiles, a search, the field page', async ({ page }) => {
  await check(page, '/experts.html', 'Engineer <script>alert(1)</script>');
  await check(page, `/u/${mentorUsername}`, 'About me <script>alert(1)</script> <img src=x onerror=alert(1)>');
  await expect(page.locator('body')).toContainText('Review <script>alert(1)</script>');
  await expect(page.locator('body')).toContainText('Reply <script>alert(1)</script>');
  await check(page, `/u/${askerUsername}`, 'Asker bio <script>alert(1)</script>');
  await check(page, '/experts.html?q=Engineer');
  await check(page, '/advice/tech', 'Engineer <script>alert(1)</script>');
});

test('the server-rendered HTML escapes it too (profile, structured data, titles)', async ({ request }) => {
  for (const url of [`/u/${mentorUsername}`, `/ka/u/${mentorUsername}`, '/advice/tech']) {
    const html = await (await request.get(url)).text();
    expect(html, url).not.toContain('<img src=x onerror');
    expect(html, url).not.toContain('<script>alert(1)');
  }
});

test('the asker\'s and the mentor\'s pages: dashboard, inbox, settings', async ({ browser }) => {
  for (const email of ['asha.xss@e2e.test', 'xavi.xss@e2e.test']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await S.logIn(page, { email });
    await check(page, '/dashboard.html', 'My question <script>alert(1)</script>');
    await check(page, `/inbox.html?booking=${bookingId}`, 'Follow-up question <script>alert(1)</script>');
    await check(page, '/inbox.html?tab=notifications');
    await check(page, '/settings.html?tab=profile');
    if (email.startsWith('xavi')) {
      await check(page, '/dashboard.html?tab=earnings');
      await check(page, '/settings.html?tab=verification');
    }
    await ctx.close();
  }
});

test('every admin tab', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await S.logIn(page, { email: 'e2e-admin@example.com' });
  for (const tab of ['mentors', 'bookings', 'queue', 'reviews', 'payouts', 'waitlist', 'disputes', 'support', 'overview']) {
    await check(page, `/admin.html#${tab}`);
    await page.click(`#adminTabs [data-tab="${tab}"]`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const injected = await page.evaluate(() => document.querySelectorAll('img[src="x"]').length);
    expect(injected, `admin ${tab}`).toBe(0);
  }
  await page.click('#adminTabs [data-tab="bookings"]');
  await page.locator('#statusFilters [data-status=""]').click();
  await expect(page.locator('#adminContent')).toContainText('My question <script>alert(1)</script>');
  await page.click('#adminTabs [data-tab="disputes"]');
  await expect(page.locator('#adminContent')).toContainText('Dispute <script>alert(1)</script>');
  await ctx.close();
});

test('texts that become labels refuse markup instead of storing it', async () => {
  // (the mentor's field and specialty tags are short public labels: angle brackets are refused)
  expect((await mentor.api('/verification/experience', { method: 'PUT', body: { customNiche: IMG } })).status).toBe(409); // (locked: approved)
  const fresh = await S.apiUser('Lana Labels', 'lana.xss@e2e.test');
  await fresh.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } });
  expect((await fresh.api('/verification/experience', { method: 'PUT', body: { customNiche: IMG } })).error).toBe('invalid_custom_niche');
  expect((await fresh.api('/verification/experience', { method: 'PUT', body: { specialtyTags: [SCRIPT] } })).error).toBe('invalid_tags');
  expect((await fresh.api('/me', { method: 'PATCH', body: { linkedinUrl: 'javascript:alert(1)' } })).status).toBe(400);
  expect((await fresh.api('/me', { method: 'PATCH', body: { websiteUrl: 'javascript:alert(1)' } })).status).toBe(400);
});
