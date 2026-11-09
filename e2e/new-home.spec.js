// The new home page, Browse without login and the Jikhva logo (docs/CLAUDE-CODE-NEW-HOME.md), in launch mode, in Georgian. Runs after
// full-flow.spec.js (the admin account): files run in name order. Prelaunch: e2e/new-home-prelaunch.spec.js.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

const stamp = Date.now();
const QUESTION = 'თორმეტე კლასში ვარ და მინდა ექიმი გავხდე. რომელი საგნები ვისწავლო ახლავე, რომ ეროვნულ გამოცდებზე კარგი ქულა ავიღო?';
let admin;
let free;
test.beforeAll(async () => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  free = await S.listedMentor(admin, { name: 'ნინო ჰომი', email: `home-free-${stamp}@e2e.test`, price: 0, roleTitle: 'რეზიდენტი, კარდიოლოგია', niche: 'medicine' });
});
const ka = async (browser, width = 375, height = 812) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  return { ctx, page: await ctx.newPage() };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a visitor opens Browse and a mentor profile without an account; the question box is there, no login wall', async ({ browser }) => {
  const { ctx, page } = await ka(browser);
  await page.goto('/ka/experts.html');
  await expect(page.locator('#expertGrid .expert-card').first()).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.goto(`/ka/u/${encodeURIComponent(free.username)}`);
  await page.click('#askOpen');
  await expect(page.locator('#question')).toBeVisible();
  await expect(page.locator('#askBtn')).toBeVisible();
  await ctx.close();
});

test('"დასვი კითხვა" signed out: the sign-up sheet; after signing up the question is still there and is sent', async ({ browser }) => {
  const { ctx, page } = await ka(browser);
  await page.goto(`/ka/u/${encodeURIComponent(free.username)}`);
  await page.click('#askOpen');
  await page.fill('#question', QUESTION);
  await page.click('#askBtn');
  const sheet = page.locator('dialog#askSignup[open]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toHaveText('დარეგისტრირდი, რომ კითხვა გაიგზავნოს');
  expect(await fits(page)).toBe(true);
  await sheet.locator('a.btn-primary').click();
  await page.waitForURL(/signup\.html\?redirect=/);
  const email = `home-asker-${stamp}@e2e.test`;
  await page.fill('#name', 'ლუკა ახალი');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.selectOption('#birthYear', '1999');
  await page.selectOption('#birthMonth', '05');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', S.codeIn(await S.waitForMail(email)));
  await page.click('#verifyForm button[type="submit"]');
  // back on the profile: the kept question goes out by itself
  await page.waitForURL((u) => u.pathname.includes(`/u/${free.username}`));
  await expect(page.locator('.booking-result.success')).toBeVisible();
  await expect.poll(async () => (await S.sql('SELECT question FROM bookings b JOIN users u ON u.id = b.seeker_id WHERE u.email = $1', [email])).map((r) => r.question)[0]).toBe(QUESTION);
  expect(new URL(page.url()).searchParams.get('send')).toBeNull();
  await ctx.close();
});

test('the home page: only approved mentors who chose to be shown; the phone hidden until an admin chooses a Q&A, then the real one', async ({ browser }) => {
  // an approved mentor who chose it, and someone who is not approved (also "shown"): only the first appears
  await S.sql('UPDATE users SET show_on_home = true WHERE id = $1', [free.id]);
  const pending = await S.apiUser('არა დამტკიცებული', `home-pending-${stamp}@e2e.test`);
  await pending.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'იურისტი', niche: 'law', price: 20 } });
  await S.sql("UPDATE users SET show_on_home = true WHERE email = $1", [`home-pending-${stamp}@e2e.test`]);
  await admin.api('/admin/home-qa', { method: 'POST', body: { id: null } });

  const { ctx, page } = await ka(browser);
  await page.goto('/ka/');
  await expect(page.locator('#homeMentorsList')).toContainText('ნინო ჰომი');
  await expect(page.locator('#homeMentorsList')).not.toContainText('არა დამტკიცებული');
  await expect(page.locator('#homeQa')).toBeHidden();
  await expect(page.locator('#heroSearch')).toBeVisible();
  await expect(page.locator('#heroWait')).toHaveCount(0);
  expect(await page.locator('#heroChips li').count()).toBeLessThanOrEqual(5);
  expect(await fits(page)).toBe(true);

  // a real question and answer, both agreed and published: the admin chooses it, the phone shows it (the student is not named)
  const asker = (await S.sql('SELECT b.id, b.seeker_id FROM bookings b JOIN users u ON u.id = b.seeker_id WHERE b.mentor_id = $1 ORDER BY b.created_at DESC LIMIT 1', [free.id]))[0];
  const answer = 'დაიწყე ბიოლოგიითა და ქიმიით: ყოველდღე ერთი საათი, სასკოლო სახელმძღვანელოთი. ყოველ კვირა გააკეთე ერთი ტესტი და ჩაწერე, სად შეცდი. '.repeat(3);
  await S.sql("UPDATE bookings SET status = 'answered', answer = $2, answered_at = now(), answer_review = 'none' WHERE id = $1", [asker.id, answer]);
  const [pa] = await S.sql(`INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, status, asker_consent, asker_decided_at, mentor_consent, mentor_decided_at, question_public, answer_public, slug, published_at)
    VALUES ($1, $2, $3, 'medicine', 'published', true, now(), true, now(), $4, $5, $6, now()) RETURNING id`, [asker.id, free.id, asker.seeker_id, QUESTION, answer, `home-e2e-${stamp}`]);
  expect((await admin.api('/admin/home-qa', { method: 'POST', body: { id: pa.id } })).status).toBe(200);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // (the finished conversation, still)
  await page.reload();
  const phone = page.locator('#homeQa');
  await expect(phone).toBeVisible();
  await expect(phone.locator('.qa-qtext')).toHaveText(QUESTION);
  await expect(phone.locator('.qa-name')).toHaveText('ნინო ჰომი');
  await expect(phone.locator('.qa-atext')).toContainText('დაიწყე ბიოლოგიითა');
  expect([...(await phone.locator('.qa-atext').innerText())].length).toBeLessThanOrEqual(303);
  await expect(phone).not.toContainText('ლუკა');
  await admin.api('/admin/home-qa', { method: 'POST', body: { id: null } });
  // (the library's own tests count its answers: this one leaves again)
  await S.sql('DELETE FROM public_answers WHERE id = $1', [pa.id]);
  await ctx.close();
});

for (const width of [360, 1280]) {
  test(`the logo is not cut off at ${width}px (Jikhva's horns included)`, async ({ browser }) => {
    const { ctx, page } = await ka(browser, width, 800);
    await page.goto('/ka/');
    const logo = page.locator('#siteHeader .logo .jlogo');
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    const header = await page.locator('#siteHeader').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(50);
    // the head has loaded, and it sits inside the logo's own box (the viewBox leaves room for the horns)
    expect(await page.evaluate(() => fetch('/brand/jikhva-head.webp').then((r) => r.ok))).toBe(true);
    expect(await fits(page)).toBe(true);
    await ctx.close();
  });
}
