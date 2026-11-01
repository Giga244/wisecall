// A 16-year-old's whole journey, on a phone, in Georgian (docs/CLAUDE-CODE-ASKERS-16-PLUS.md): signing up with a parent's permission, asking a free mentor, a
// contact detail stopped, the mentor's view, the admin's check, and reading the answer. Then under 16, and the box for a paid mentor.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.use({ viewport: { width: 360, height: 740 } });

function bornAgo(years) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - 1, 1));
  return { year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, '0') };
}
const fillAge = async (page, years) => {
  const { year, month } = bornAgo(years);
  await page.selectOption('#birthYear', year);
  await page.selectOption('#birthMonth', month);
};
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  const r = await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const ANSWER = 'დაიწყე იმით, რომ ჩამოწერო სამი უნივერსიტეტის პროგრამა და შეადარო, რას აკეთებენ მათი კურსდამთავრებულები სამი წლის შემდეგ. ეს უფრო მეტს გეტყვის, ვიდრე ნებისმიერი ბროშურა, ამიტომ პირველ რიგში ეს გააკეთე და შემდეგ მიიღე გადაწყვეტილება.';
const QUESTION = 'თორმეტე კლასში ვარ და მინდა კომპიუტერული მეცნიერება ვისწავლო. როგორ ავირჩიო უნივერსიტეტი თბილისში?';

test('under 16: a kind message, and no account', async ({ page }) => {
  await page.goto('/ka/signup.html');
  const email = `under16-${Date.now()}@e2e.test`;
  await page.fill('#name', 'პატარა ნიკა');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await fillAge(page, 15);
  await expect(page.locator('#ageParent')).toBeHidden();
  await page.click('#signupForm button[type="submit"]');
  await expect(page.locator('.age-under16')).toContainText('Wisecall 16 წლიდან არის ხელმისაწვდომი. დაგელოდებით!');
  expect(await fits(page)).toBe(true);
  const c = client(S.BASE);
  expect((await c.api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } })).status).toBe(401);
});

test('the whole journey of a 16-year-old', async ({ page, browser }) => {
  const admin = await adminClient();
  const stamp = Date.now();
  const mentor = await S.listedMentor(admin, { name: 'თამარ მენტორი', email: `free-mentor-${stamp}@e2e.test`, price: 0, roleTitle: 'პროგრამისტი' });

  // ---- sign-up: without the permission box it cannot finish
  const email = `minor-${stamp}@e2e.test`;
  await page.goto('/ka/signup.html');
  await page.fill('#name', 'ლუკა კაპანაძე');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await expect(page.locator('#adult')).toBeHidden();
  await expect(page.locator('#birthMonth option[value="01"]')).toHaveText('იანვარი');
  await fillAge(page, 16);
  await expect(page.locator('#ageParent')).toBeVisible();
  await expect(page.locator('#ageParent')).toContainText('მშობლებისთვის');
  await page.click('#signupForm button[type="submit"]');
  await expect(page.locator('#formError')).toHaveText('დაადასტურე, რომ მშობელი ან მეურვე თანახმაა.');
  await page.check('#parentPermission');
  expect(await fits(page)).toBe(true);
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', S.codeIn(await S.waitForMail(email)));
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname.endsWith('/dashboard.html'));
  // being a mentor is from 18
  await page.goto('/ka/apply.html');
  await expect(page.locator('#applyRoot')).toContainText('მენტორობა 18 წლიდან არის შესაძლებელი.');

  // ---- asking: a phone number is stopped, the text stays to be edited
  await page.goto(`/ka/u/${encodeURIComponent(mentor.username)}`);
  await page.click('#askOpen');
  await page.fill('#question', `${QUESTION} დამირეკე 555 12 34 56`);
  await page.click('#askBtn');
  await expect(page.locator('#askError')).toHaveText('უსაფრთხოების მიზნით, კონტაქტის გაზიარება Wisecall-ზე არ შეიძლება. ყველაფერი წერილობით, აქ რჩება.');
  await expect(page.locator('#question')).toHaveValue(/555 12 34 56/);
  await page.fill('#question', QUESTION);
  expect(await fits(page)).toBe(true);
  await page.click('#askBtn');
  await expect(page.locator('.booking-result.success')).toBeVisible();

  // ---- the mentor: the tag, the guidance, only the first name; an answer with a social link is stopped
  const mentorContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const mentorPage = await mentorContext.newPage();
  await S.logIn(mentorPage, { email: mentor.email }, '/ka/dashboard.html');
  await mentorPage.goto('/ka/dashboard.html?tab=received');
  const card = mentorPage.locator('#receivedList .booking-card').first();
  await expect(card.locator('.minor-tag')).toHaveText('16–17 წლის');
  await expect(card.locator('.minor-guidance')).toContainText('პირადი კონტაქტი არ შეიძლება.');
  await expect(card.locator('.card-name')).toHaveText('ლუკა');
  await expect(card.locator('.card-name a')).toHaveCount(0);
  await expect(card).not.toContainText('კაპანაძე');
  await card.locator('.answer-form textarea').fill(`${ANSWER} მეტი აქ: https://www.instagram.com/tamar`);
  await card.locator('.answer-form button[type="submit"]').click();
  await card.locator('.answer-send').click();
  await expect(card.locator('.answer-send-error')).toContainText('კონტაქტის გაზიარება');
  await card.locator('.answer-back').click();
  await card.locator('.answer-form textarea').fill(ANSWER);
  await card.locator('.answer-form button[type="submit"]').click();
  await card.locator('.answer-send').click();
  await expect(mentorPage.locator('#receivedList .booking-note').first()).toContainText('18 წლამდე');
  await mentorContext.close();

  // ---- the minor: the answer is there, but not readable until it is checked
  await page.goto('/ka/dashboard.html');
  const mine = page.locator('.booking-card').first();
  await expect(mine.locator('.booking-note')).toContainText('18 წლამდე');
  await expect(mine.locator('.booking-answer')).toHaveCount(0);

  // ---- the admin: one tap
  const { answers } = await admin.api('/admin/answers');
  const held = answers.find((a) => a.answer === ANSWER);
  expect(held.minorHold).toBe(true);
  expect((await admin.api(`/admin/answers/${held.id}/approve`, { method: 'POST' })).status).toBe(200);

  // ---- the minor reads it, and can report it
  await page.goto('/ka/dashboard.html');
  await expect(page.locator('.booking-card').first().locator('.booking-answer')).toContainText('კურსდამთავრებულები');
  const report = page.locator('.booking-card').first().locator('.report-button');
  await expect(report.locator('summary')).toHaveText('შეტყობინება');
  await report.locator('summary').click();
  await report.locator('select').selectOption('contact_request');
  await report.locator('textarea').fill('მომწერა, სხვაგან დამიკავშირდიო');
  await report.locator('button[type="submit"]').click();
  await expect(report).toContainText('გმადლობთ');
  expect(await fits(page)).toBe(true);
  // the admin sees it, and the minor under the filter
  const { reports } = await admin.api('/admin/reports');
  expect(reports.find((r) => r.bookingId === held.id).askerMinor).toBe(true);
  const { people } = await admin.api('/admin/people?minor=1');
  const me = people.find((p) => p.email === email);
  expect(me.parentPermissionAt).toBeTruthy();
  expect(me.blocked).toBe(1);
});

test('a paid mentor: the adult-payer box, on the same form', async ({ page }) => {
  const admin = await adminClient();
  const stamp = Date.now();
  const mentor = await S.listedMentor(admin, { name: 'გიორგი ფასიანი', email: `paid-mentor-${stamp}@e2e.test`, price: 30, roleTitle: 'კონსულტანტი' });
  const c = client(S.BASE);
  const email = `minor-paid-${stamp}@e2e.test`;
  const { year, month } = bornAgo(17);
  const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'ანა ბერიძე', email, password: S.PASSWORD, birthYm: `${year}-${month}`, parentPermission: true } });
  expect(su.status).toBe(201);
  await S.logIn(page, { email });
  await page.goto(`/ka/u/${encodeURIComponent(mentor.username)}`);
  await page.click('#askOpen');
  await expect(page.locator('#adultPayer')).toBeVisible();
  await page.fill('#question', QUESTION);
  await page.click('#askBtn');
  await expect(page.locator('#askError')).toContainText('გადამხდელი 18 წლის ან უფროსია');
  expect(await fits(page)).toBe(true);
  await page.check('#adultPayer');
  await page.click('#askBtn');
  await page.waitForURL(/mock-bank/);
});
