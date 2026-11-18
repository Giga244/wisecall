// The flows a user must never get stuck in or lose text in (each test's title carries @flow: `npm run test:flows` runs just these, and
// the pre-push hook runs them before every push: .githooks/pre-push). In a real browser, against a real server:
//   1. sign-up, then "About me": what is typed survives a reload, a refusal is said under the box, and the saved text is on the profile
//   2. a mentor application from the first step to "sent": step 2 survives a reload; the admin's page shows what was written
//   3. an approved mentor fills in "ჩემი გზა" from the profile-update email and the dashboard card, then sends new directions for a
//      check: the path is on the profile, the change is in the admin's queue
//   4. editing My details: saved, on the profile and in the admin's panel; a refused value is said under its box and stays
//   5. password reset from the email link: the new password signs in, the old one does not
//   6. a student asks a question and the mentor answers: both texts survive a reload; the mentor's dashboard and the admin see the question
//   and a refused save reaches the owner by email (server/saveAlerts.js).
// (named so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself; alone, it makes the admin)
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const tag = Date.now();
const people = {};

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
async function newPage(browser, { lang = 'en', phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : {});
  await ctx.addInitScript((l) => { try { if (!localStorage.getItem('wisecall_lang')) localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
  return { ctx, page: await ctx.newPage() };
}
const userRow = async (email, cols) => (await S.sql(`SELECT ${cols} FROM users WHERE email = $1`, [email]))[0];
// The draft of a field as the server has it for the signed-in person of this page (null: none).
const serverDraft = (page, key) => page.evaluate(async (k) => (await (await fetch('/api/me/drafts/' + encodeURIComponent(k))).json()).draft, key);
// (the page sends a draft to the server a moment after the last key: wait until it is there)
const untilServerDraft = (page, key, text) => expect.poll(async () => { const d = await serverDraft(page, key); return d ? d.value : null; }, { timeout: 10000 }).toContain(text);

test.beforeAll(async () => { people.admin = await adminClient(); });

test('@flow 1. sign-up, then About me: a reload keeps what was typed; too long is said under the box; saved, it is on the profile', async ({ browser }) => {
  const { ctx, page } = await newPage(browser);
  const email = `flow-signup-${tag}@e2e.test`;
  await S.signUp(page, { name: 'Flora Signup', email });
  const me = await userRow(email, 'id, username, email_verified');
  expect(me.email_verified).toBe(true);
  const ABOUT = 'I study architecture in Tbilisi and I am looking for advice about a first internship abroad.';

  await page.goto('/settings.html?tab=profile');
  await page.fill('#bio', ABOUT);
  await untilServerDraft(page, 'bio', 'first internship abroad');
  // a reload before saving: the text is back, marked as not saved yet; nothing was saved by itself
  await page.reload();
  await expect(page.locator('#bio')).toHaveValue(ABOUT);
  await expect(page.locator('#bioDraftNote')).toBeVisible();
  expect((await userRow(email, 'bio')).bio).toBeNull();
  // too long: said right under the box, and nothing is cleared
  await page.fill('#bio', 'a'.repeat(2001));
  await page.locator('#profileForm button[type="submit"]').first().click();
  await expect(page.locator('#bioError')).toHaveText(EN['profile.err.bioLong']);
  await expect(page.locator('#bio')).toHaveValue('a'.repeat(2001));
  // saved: on the public profile, and the draft is gone (here and on the server)
  await page.fill('#bio', ABOUT);
  if (!(await page.locator('#profileVisibility').isVisible())) await page.locator('#profileMore > summary').click();
  await page.selectOption('#profileVisibility', 'public');
  await page.locator('#profileForm button[type="submit"]').first().click();
  await expect.poll(async () => (await userRow(email, 'bio')).bio).toBe(ABOUT);
  await expect.poll(() => serverDraft(page, 'bio')).toBeNull();
  await page.reload();
  await expect(page.locator('#bio')).toHaveValue(ABOUT);
  await expect(page.locator('#bioDraftNote')).toBeHidden();
  // their profile page: the name for everyone; "About me" as they see it themselves (a new account shows that section only to its owner)
  const visitor = await newPage(browser);
  await visitor.page.goto(`/u/${me.username}`);
  await expect(visitor.page.locator('h1')).toContainText('Flora Signup');
  await visitor.ctx.close();
  await page.goto(`/u/${me.username}`);
  await expect(page.locator('h1')).toContainText('Flora Signup');
  await expect(page.locator('body')).toContainText(ABOUT);
  await ctx.close();
});

test('@flow 2. a mentor application from the first step to "sent": step 2 survives a reload; the admin sees what was written', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { lang: 'ka', phone: true });
  const email = `flow-apply-${tag}@e2e.test`;
  await S.signUp(page, { name: 'ნანა განმცხადებელი', email });
  await page.goto('/apply.html');
  await page.waitForURL(/\/apply\.html\?step=1$/);
  await page.fill('#apHeadline', 'გრაფიკული დიზაინერი, ბრენდინგის სტუდიის დამფუძნებელი');
  await page.fill('#apField', 'ბრენდინგი და გრაფიკული დიზაინი');
  await S.pickNiche(page, 'design');
  await page.selectOption('#apYears', '9');
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);

  // step 2: typed, not saved, the page reloaded: all of it is back
  await S.fillPath(page);
  await untilServerDraft(page, 'apply-story', S.PATH.how);
  await page.reload();
  await expect(page.locator('#ap-pathStart')).toHaveValue(S.PATH.start);
  await expect(page.locator('#ap-pathNow')).toHaveValue(S.PATH.now);
  await expect(page.locator('#ap-about')).toHaveValue(S.ABOUT);
  await expect(page.locator('[data-story-draft-note]')).toBeVisible();
  expect((await userRow(email, 'path_start')).path_start, 'not saved by itself').toBeNull();
  // a block too short: said under that block, and everything stays
  await page.fill('#ap-pathHow', 'ღამით ვსწავლობდი.');
  await page.click('.apply-next');
  await expect(page.locator('#ap-pathHow-err')).toBeVisible();
  await expect(page.locator('#ap-pathStart')).toHaveValue(S.PATH.start);
  expect(page.url()).toMatch(/step=2$/);
  await page.fill('#ap-pathHow', S.PATH.how);
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);
  await expect.poll(() => serverDraft(page, 'apply-story')).toBeNull(); // (saved: the draft is done)
  // back on step 2 from a later step: what was saved is there
  await page.locator('#applySteps [data-goto="1"]').click();
  await page.waitForURL(/step=2$/);
  await expect(page.locator('#ap-pathHow')).toHaveValue(S.PATH.how);
  await expect(page.locator('[data-story-draft-note]')).toBeHidden();
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);

  await page.fill('#apPrice', '35');
  await page.click('.apply-next');
  await page.waitForURL(/step=4$/);
  await page.fill('#apUrl', 'https://www.linkedin.com/in/nana-applicant-design');
  await page.click('[data-add-link]');
  await expect(page.locator('.apply-evidence li')).toHaveCount(1);
  await page.click('.apply-next');
  await page.waitForURL(/step=5$/);
  await expect(page.locator('#apMissing')).toHaveCount(0);
  await S.passIdCheck(page);
  await expect(page.locator('.apply-done')).toBeVisible();

  const row = await userRow(email, 'id, path_start, path_how, path_now, bio, price, application_submitted_at, verification_status');
  expect(row).toMatchObject({ path_start: S.PATH.start, path_how: S.PATH.how, path_now: S.PATH.now, bio: S.ABOUT, price: 35, verification_status: 'pending' });
  expect(row.application_submitted_at).not.toBeNull();
  // the admin's page: the application, with the path the mentor wrote
  const a = await newPage(browser);
  await S.logIn(a.page, { email: ADMIN.email }, '/admin.html?tab=mentors&status=all');
  const card = a.page.locator('.mv-card').filter({ hasText: email });
  await expect(card).toBeVisible();
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-application')).toContainText(S.PATH.how);
  await a.ctx.close();
  await ctx.close();
});

test('@flow 3. an approved mentor adds ჩემი გზა from the profile-update email and the dashboard card, then sends directions for a check', async ({ browser }) => {
  const email = `flow-path-${tag}@e2e.test`;
  const m = await S.listedMentor(people.admin, { name: 'გია გზის-ავტორი', email, niche: 'design', roleTitle: 'დიზაინერი', price: 30 });
  await S.sql(`UPDATE users SET language = 'ka', bio = $2 WHERE id = $1`, [m.id, S.ABOUT]);
  people.pathMentor = m;
  // the profile-update email, sent by the admin; its button leads to My details
  const sent = await people.admin.api('/admin/profile-update/send', { method: 'POST', body: { ids: [m.id], confirm: true } });
  expect(sent.sent.map((x) => x.id)).toEqual([m.id]);
  const mail = await S.waitForMail(email, 'ახალი რამ დავამატეთ');
  const link = (mail.html.match(/href="([^"]*settings\.html\?tab=details)"/) || [])[1];
  expect(link).toBeTruthy();

  const { ctx, page } = await newPage(browser, { lang: 'ka', phone: true });
  await page.goto(link); // (not signed in: the sign-in page, then straight back to My details)
  await page.waitForURL(/login\.html/);
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/settings\.html\?tab=details/);
  await expect(page.locator('#ds-pathStart')).toBeVisible();

  // typed, and the path's own button NOT pressed; then two more directions and "შესამოწმებლად გაგზავნა"
  await page.fill('#ds-pathStart', S.PATH.start);
  await page.fill('#ds-pathHow', S.PATH.how);
  await page.fill('#ds-pathNow', S.PATH.now);
  const more = page.locator('.fp-dirs-more');
  if (await more.count()) await more.first().click();
  const free = page.locator('.fp-dirs .fp-dir[data-direction][aria-pressed="false"]');
  await free.nth(0).click();
  await free.nth(0).click();
  await page.locator('#fieldsSave').click();
  await expect.poll(async () => (await S.sql(`SELECT 1 FROM mentor_changes WHERE user_id = $1 AND kind = 'fields' AND status = 'open'`, [m.id])).length).toBe(1);
  expect(await userRow(email, 'path_start, path_how, path_now')).toEqual({ path_start: S.PATH.start, path_how: S.PATH.how, path_now: S.PATH.now });
  await expect(page.locator('#ds-pathNow')).toHaveValue(S.PATH.now); // (the page drawn again: still there)

  // the dashboard card leads to the same form, with what was saved in it
  await page.goto('/ka/dashboard.html');
  const card = page.locator('#storyCard .story-card');
  await expect(card).toBeVisible(); // (the sample answer is still to add)
  await card.locator('a.btn').click();
  await page.waitForURL(/settings\.html\?tab=details#story$/);
  await expect(page.locator('#ds-pathHow')).toHaveValue(S.PATH.how);

  // on the profile, and in the admin's queue
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('.profile-path')).toContainText(S.PATH.start);
  await expect(page.locator('.profile-about')).toContainText(S.ABOUT.slice(0, 40));
  const a = await newPage(browser);
  await S.logIn(a.page, { email: ADMIN.email }, '/admin.html?tab=queue');
  await expect(a.page.locator('#adminContent')).toContainText('გია გზის-ავტორი');
  await a.ctx.close();
  await ctx.close();
});

test('@flow 4. editing My details: saved, on the profile and in the admin panel; a refused value is said under its box and stays', async ({ browser }) => {
  const m = people.pathMentor;
  const { ctx, page } = await newPage(browser, { lang: 'ka' });
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details');
  await expect(page.locator('#dSpecs')).toBeVisible();
  // refused: said under the box it is about, and what was typed stays
  await page.fill('#dSpecs', 'ლოგო, ტიპოგრაფია');
  await page.fill('#dRole', 'არტ-დირექტორი სარეკლამო სააგენტოში');
  await page.fill('#dYears', '99');
  await page.locator('#detailsForm button[type="submit"]').click();
  await expect(page.locator('#dYearsErr')).toBeVisible();
  await expect(page.locator('#dYearsErr')).not.toHaveText('');
  await expect(page.locator('#dSpecs')).toHaveValue('ლოგო, ტიპოგრაფია');
  await expect(page.locator('#dRole')).toHaveValue('არტ-დირექტორი სარეკლამო სააგენტოში');
  // fixed: saved
  await page.fill('#dYears', '11');
  await page.locator('#detailsForm button[type="submit"]').click();
  await expect.poll(async () => (await userRow(m.email, 'years_experience')).years_experience).toBe(11);
  const row = await userRow(m.email, 'specialty_tags, current_work, path_start');
  expect(row.specialty_tags).toEqual(['ლოგო', 'ტიპოგრაფია']);
  expect(row.current_work).toBe('არტ-დირექტორი სარეკლამო სააგენტოში');
  expect(row.path_start, 'the path saved before is untouched').toBe(S.PATH.start);
  // after a reload the form shows what was saved
  await page.reload();
  await expect(page.locator('#dRole')).toHaveValue('არტ-დირექტორი სარეკლამო სააგენტოში');
  await expect(page.locator('#dYears')).toHaveValue('11');
  // on the profile (as everyone sees it), and in the admin's panel
  const profile = await client(S.BASE).api(`/users/${m.username}`);
  expect(JSON.stringify(profile.profile)).toContain('ტიპოგრაფია');
  await page.goto(`/ka/u/${m.username}`);
  await expect(page.locator('body')).toContainText('ტიპოგრაფია');
  const a = await newPage(browser);
  await S.logIn(a.page, { email: ADMIN.email }, '/admin.html?tab=mentors&status=verified');
  const card = a.page.locator('.mv-card').filter({ hasText: m.email });
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-application')).toContainText('ტიპოგრაფია');
  await expect(card.locator('.mv-application')).toContainText('11');
  await a.ctx.close();
  await ctx.close();
});

test('@flow 5. password reset from the email: the new password signs in, the old one does not', async ({ browser }) => {
  const email = `flow-reset-${tag}@e2e.test`;
  await S.apiUser('Rezo Reset', email);
  const { ctx, page } = await newPage(browser);
  await page.goto('/forgot-password.html');
  await page.fill('#email', email);
  await page.click('#forgotForm button[type="submit"]');
  const mail = await S.waitForMail(email, 'password');
  const link = (mail.html.match(/href="([^"]*reset-password\.html\?token=[^"]+)"/) || [])[1];
  expect(link).toBeTruthy();
  await page.goto(link.replace(/&amp;/g, '&'));
  // too short: said on the page, nothing changes
  await page.fill('#newPassword', 'short');
  await page.click('#resetForm button[type="submit"]');
  expect((await client(S.BASE).api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } })).status, 'the old password still works').toBe(200);
  const NEW = 'a-brand-new-pass-2026';
  await page.fill('#newPassword', NEW);
  await page.click('#resetForm button[type="submit"]');
  await expect.poll(async () => (await client(S.BASE).api('/auth/login', { method: 'POST', body: { email, password: NEW } })).status, { timeout: 15000 }).toBe(200);
  expect((await client(S.BASE).api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } })).status).toBe(401);
  // in the browser: signs in with the new password, and the account is theirs
  await S.logIn(page, { email, password: NEW }, '/settings.html?tab=profile');
  await expect(page.locator('#name')).toHaveValue('Rezo Reset');
  await ctx.close();
});

test('@flow 6. a student asks and the mentor answers: both texts survive a reload; the mentor and the admin see the question', async ({ browser }) => {
  const m = people.pathMentor;
  const QUESTION = 'I am finishing school and want to study graphic design. Should I learn typography first or start with logo work, and how do I build a first portfolio?';
  const ANSWER = 'Start with typography: it is the base of every brand. Set one book cover a week for two months, show them to people who buy design, and keep the three best in your portfolio. Logo work comes easier after that, and clients trust a portfolio that shows real pages.';
  const email = `flow-asker-${tag}@e2e.test`;
  const s = await newPage(browser);
  await S.signUp(s.page, { name: 'Sandro Student', email });

  // the question: typed, the page reloaded, still there (in this browser and on the server)
  await s.page.goto(`/u/${m.username}`);
  await s.page.fill('#question', QUESTION);
  await untilServerDraft(s.page, `question:${m.id}`, 'first portfolio');
  await s.page.reload();
  await expect(s.page.locator('#question')).toHaveValue(QUESTION);
  // too short: said under the box, nothing sent
  await s.page.fill('#question', 'Too short?');
  await s.page.click('#askBtn');
  await expect(s.page.locator('#askError')).toHaveText(EN['expert.question.tooShort'].replace('{n}', 50));
  await s.page.fill('#question', QUESTION);
  await s.page.click('#askBtn');
  await s.page.waitForURL(/mock-bank\.html/);
  await s.page.click('#payBtn');
  await s.page.waitForURL(/\/u\/[^?]+\?.*booking=/);
  const bookingId = new URL(s.page.url()).searchParams.get('booking');
  await S.untilBooking(bookingId, (b) => b.status === 'paid', 'the question was not paid');
  expect((await S.bookingRow(bookingId)).question).toBe(QUESTION);
  await expect.poll(() => serverDraft(s.page, `question:${m.id}`)).toBeNull(); // (sent: the draft is done)

  // the mentor: the question is on the dashboard; the answer survives a reload, and is sent
  const t = await newPage(browser);
  await S.logIn(t.page, { email: m.email }, '/dashboard.html?tab=received');
  const form = t.page.locator(`.answer-form[data-id="${bookingId}"]`);
  await expect(t.page.locator('#receivedList')).toContainText('study graphic design');
  await form.locator('textarea').fill(ANSWER);
  await untilServerDraft(t.page, `answer:${bookingId}`, 'Start with typography');
  await t.page.reload();
  await expect(form.locator('textarea')).toHaveValue(ANSWER);
  await expect(form.locator('.draft-note')).toBeVisible();
  await form.locator('.answer-edit button[type="submit"]').click();
  await form.locator('.answer-send').click();
  const done = await S.untilBooking(bookingId, (b) => b.status === 'answered', 'the answer was not saved');
  expect(done.answer).toBe(ANSWER);
  await expect.poll(() => serverDraft(t.page, `answer:${bookingId}`)).toBeNull();

  // the admin: the question is in Bookings
  const a = await newPage(browser);
  await S.logIn(a.page, { email: ADMIN.email }, '/admin.html?tab=bookings&status=all');
  await expect(a.page.locator('#adminContent')).toContainText('study graphic design');
  for (const x of [s, t, a]) await x.ctx.close();
});

test('@flow a refused save reaches the owner by email: who, which page, which field, the error; never what was typed', async () => {
  const m = people.pathMentor;
  const before = S.mails().filter((x) => x.to === ADMIN.email && /a save failed/.test(x.subject)).length;
  const r = await m.client.api('/me/details', { method: 'PUT', body: { pathStart: S.PATH.start, pathHow: 'SECRET-TYPED-WORDS', pathNow: S.PATH.now },
    headers: { Referer: `${S.BASE}/ka/settings.html?tab=details` } });
  expect(r.status).toBe(400);
  const mail = await S.waitForMail(ADMIN.email, 'a save failed (path_short, pathHow)', { after: 0 });
  expect(mail.text).toContain(m.email);
  expect(mail.text).toContain('Page: /ka/settings.html');
  expect(mail.text).toContain('Field: pathHow');
  expect(mail.text).toContain('Error: 400 path_short');
  expect(mail.text + mail.html).not.toContain('SECRET-TYPED-WORDS');
  expect(S.mails().filter((x) => x.to === ADMIN.email && /a save failed/.test(x.subject)).length).toBeGreaterThan(before);
  expect(KA['draft.restored']).toBeTruthy();
});
