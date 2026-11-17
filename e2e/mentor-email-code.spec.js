// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A slow email never blocks a mentor's first four steps (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md), on a 375px phone in Georgian: the sign-up goes
// straight to the application; steps 1-4 are filled in before the code is entered; step 5 (the ID check, a paid partner check) waits for the
// email and shows the code box right there; "Use another email" keeps everything filled in; the dashboard shows the code box with "Resend";
// an application sent with the email still unconfirmed (possible while ID checks are closed, or from before this rule) says so on the admin
// card, has a grey chip in the review queue after the confirmed ones, and cannot be approved until the code is entered.
// E2E_EMAIL_SHOTS=<folder> saves the pictures the brief asks for.
const { test, expect } = require('@playwright/test');
const S = require('./support');

const SHOTS = process.env.E2E_EMAIL_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const top = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); };

test('a mentor with a slow company email: steps 1-4 before the code, step 5 waits for it, the dashboard, the admin card and the queue', async ({ browser }) => {
  const email = `partner-${Date.now()}@lawfirm.test`;
  const other = `partner-${Date.now()}@mail.test`;
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();

  await page.goto('/ka/signup.html?as=mentor');
  await expect(page.locator('#googleBtn')).toHaveCount(1); // ("Continue with Google" is on this screen when Google is set up)
  await page.fill('#name', 'გიორგი მაისურაძე');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.check('#adult');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/\/apply\.html\?step=1$/); // (no code first)
  await expect(page.locator('.verify-banner')).toHaveCount(0); // (no bar sending them to another page either)

  await S.applyAsMentor(page, {
    headline: 'იურიდიული ფირმის პარტნიორი, კორპორაციული სამართალი', field: 'ბიზნესის სტრატეგია', years: 20, price: 60,
    story: 'ოც წელზე მეტია, კომპანიებს ვურჩევ, როგორ გაიზარდონ, როგორ მოაწყონ გუნდი და როგორ მოემზადონ ინვესტორებთან შეხვედრისთვის. მანამდე დიდ საკონსულტაციო ფირმაში ვმუშაობდი.',
    url: 'https://www.linkedin.com/in/giorgi-maisuradze-partner', submit: false
  });

  // Step 5: the code box right there, with the 24 hours, Junk / Spam, "Resend" and "Use another email"; no ID check yet.
  const box = page.locator('.apply-email');
  await expect(box.locator('.email-code-title')).toHaveText('ჯერ ელ-ფოსტის დადასტურება');
  await expect(box.locator('.email-code-lead')).toHaveText(`შეიყვანე კოდი, რომელიც ${email}-ზე გამოგიგზავნეთ`);
  await expect(box).toContainText('კოდი 24 საათის განმავლობაში მოქმედებს.');
  await expect(box).toContainText('კოდი არ მოვიდა? შეამოწმე Junk / Spam საქაღალდე.');
  await expect(box.locator('[data-ec-switch]')).toHaveText('სხვა ელ-ფოსტის გამოყენება');
  await expect(box.locator('[data-ec-resend]')).toHaveText('კოდის ხელახლა გაგზავნა');
  await expect(page.locator('.id-card')).toHaveCount(0);
  await expect(page.locator('.apply-id-wait')).toHaveText('პირადობის შემოწმება ელ-ფოსტის დადასტურების შემდეგ გაიხსნება. შეიყვანე კოდი ზემოთ და აქვე გააგრძელე.');
  expect(await page.evaluate(async () => (await fetch('/api/verification/kyc/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: '{}' })).status)).toBe(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (SHOTS) {
    await page.waitForTimeout(3000); // (the "Saved" note from step 4 has gone)
    await top(page);
    await box.screenshot({ path: `${SHOTS}/1-code-box.png` });
    await page.screenshot({ path: `${SHOTS}/5-step5-unconfirmed.png`, fullPage: true });
  }

  // "Use another email": a new code goes to the new address, and everything filled in stays.
  await box.locator('[data-ec-switch]').click();
  await box.locator('[data-ec-switch-form] input[type="email"]').fill(other);
  await box.locator('[data-ec-switch-form] button[type="submit"]').click();
  await expect(box.locator('.email-code-lead')).toHaveText(`შეიყვანე კოდი, რომელიც ${other}-ზე გამოგიგზავნეთ`);
  await S.waitForMail(other);
  await page.goto('/apply.html?step=1');
  await expect(page.locator('#apHeadline')).toHaveValue('იურიდიული ფირმის პარტნიორი, კორპორაციული სამართალი');

  // The dashboard: the banner with the code box and "Resend the code".
  await page.goto('/dashboard.html');
  const banner = page.locator('#emailCodeBanner');
  await expect(banner.locator('.email-code-title')).toHaveText('ელ-ფოსტა დასადასტურებელია');
  await expect(banner.locator('[data-ec-resend]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (SHOTS) { await top(page); await page.screenshot({ path: `${SHOTS}/2-dashboard-banner.png` }); }

  // An application sent with the email unconfirmed (as while ID checks are closed, or sent before this rule): written straight into the
  // test database, since with ID checks open the page can no longer get there.
  await S.sql(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() WHERE email = $1`, [other]);
  // and a confirmed one sent later (by age alone it would come after: the queue puts it first)
  const okMentor = await S.apiUser('ნინო კაპანაძე', `confirmed-${Date.now()}@e2e.test`);
  expect((await okMentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30, headline: 'ოპერაციების ხელმძღვანელი' } })).status).toBe(200);
  expect((await okMentor.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მცირე ბიზნესის მართვა', niche: 'business', yearsExperience: 12,
    story: 'თორმეტი წელია, მცირე კომპანიების ყოველდღიურ საქმიანობას ვმართავ თბილისში: პირველი თანამშრომლების აყვანიდან მომწოდებლების მოძებნამდე.', about: S.ABOUT } })).status).toBe(200);
  expect((await okMentor.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://ops-${Date.now()}.invalid/` } })).status).toBe(200);
  expect((await okMentor.api('/verification/submit', { method: 'POST' })).status).toBe(200);

  const admin = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [admin.email])).length) await S.apiUser(admin.name, admin.email);
  const actx = await browser.newContext(PHONE);
  const apage = await actx.newPage();
  // The review queue: a grey chip, after the confirmed applications.
  await S.logIn(apage, admin, '/ka/admin.html?tab=mentors');
  const qcard = apage.locator('.mv-card').filter({ hasText: other });
  await expect(qcard.locator('.mv-email-chip')).toHaveText('ელ-ფოსტა დაუდასტურებელი');
  const order = await apage.locator('.mv-card').evaluateAll((cards) => cards.map((c) => Boolean(c.querySelector('.mv-email-chip'))));
  expect(order.indexOf(true)).toBeGreaterThanOrEqual(0);
  expect(order.slice(order.indexOf(true)).every(Boolean), 'unconfirmed ones after the confirmed ones').toBe(true);
  if (SHOTS) { await top(apage); await apage.screenshot({ path: `${SHOTS}/4-review-queue.png`, fullPage: true }); }

  // The admin card (the "Email not confirmed" filter): the badge, and approval is refused.
  await apage.goto('/ka/admin.html?tab=mentors&status=email_unconfirmed');
  const card = apage.locator('.mv-card').filter({ hasText: other });
  await expect(card.locator('.mv-email-unconfirmed')).toHaveText('ელ-ფოსტა დასადასტურებელია');
  await expect(card.locator('.mv-email-why')).toHaveText('დამტკიცება შეუძლებელია, სანამ მენტორი კოდს არ შეიყვანს.');
  await expect(apage.locator('[data-status="email_unconfirmed"]')).toHaveText('ელ-ფოსტა დაუდასტურებელი');
  if (SHOTS) { await top(apage); await apage.screenshot({ path: `${SHOTS}/3-admin-card.png`, fullPage: true }); }
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-blocked')).toContainText('ელფოსტა დადასტურებული არ არის');
  await expect(card.locator('.mv-approve')).toBeDisabled();

  // The code (hours later) from the dashboard: the banner goes, the card no longer says so, and the ID check can start.
  await banner.locator('.email-code-input').fill(S.codeIn(await S.waitForMail(other, 'კოდი')));
  await banner.locator('.email-code-form button[type="submit"]').click();
  await expect(banner).toBeHidden();
  await apage.goto('/ka/admin.html?tab=mentors&status=email_unconfirmed');
  await expect(apage.locator('.mv-card').filter({ hasText: other })).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch('/api/verification/kyc/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: '{}' })).status)).toBe(200);
  await actx.close();
  await ctx.close();
});
