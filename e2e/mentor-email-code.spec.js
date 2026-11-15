// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A slow email never blocks a mentor (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md), on a 375px phone in Georgian: the sign-up goes straight to the
// application; all five steps are filled in before the code is entered; step 5 shows the code box before sending; "Use another email"
// keeps everything filled in; the application is sent with the email still unconfirmed; the dashboard shows the code box with "Resend";
// the admin card says "Email not confirmed yet" and approval is refused until the code is entered.
// E2E_EMAIL_SHOTS=<folder> saves the three pictures the brief asks for (the code box before sending, the dashboard banner, the admin card).
const { test, expect } = require('@playwright/test');
const S = require('./support');

const SHOTS = process.env.E2E_EMAIL_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

test('a mentor with a slow company email: everything before the code, the code box on step 5, the dashboard and the admin card', async ({ browser }) => {
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

  // Step 5: the code box before sending, with the 24 hours, Junk / Spam, "Resend" and "Use another email".
  const box = page.locator('.apply-email');
  await expect(box.locator('.email-code-lead')).toHaveText(`შეიყვანე კოდი, რომელიც ${email}-ზე გამოგიგზავნეთ`);
  await expect(box).toContainText('კოდი 24 საათის განმავლობაში მოქმედებს.');
  await expect(box).toContainText('კოდი არ მოვიდა? შეამოწმე Junk / Spam საქაღალდე.');
  await expect(box.locator('[data-ec-switch]')).toHaveText('სხვა ელ-ფოსტის გამოყენება');
  await expect(box.locator('[data-ec-resend]')).toHaveText('კოდის ხელახლა გაგზავნა');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await page.waitForTimeout(3000); await page.screenshot({ path: `${SHOTS}/1-step5-code-box.png` }); }

  // "Use another email": a new code goes to the new address, and everything filled in stays.
  await box.locator('[data-ec-switch]').click();
  await box.locator('[data-ec-switch-form] input[type="email"]').fill(other);
  await box.locator('[data-ec-switch-form] button[type="submit"]').click();
  await expect(box.locator('.email-code-lead')).toHaveText(`შეიყვანე კოდი, რომელიც ${other}-ზე გამოგიგზავნეთ`);
  await S.waitForMail(other);
  await page.goto('/apply.html?step=1');
  await expect(page.locator('#apHeadline')).toHaveValue('იურიდიული ფირმის პარტნიორი, კორპორაციული სამართალი');
  await page.goto('/apply.html?step=5');

  // Sent with the email still unconfirmed (the ID check does not wait for the code either): "Email not confirmed yet" with the code box.
  await S.passIdCheck(page);
  await expect(page.locator('.apply-done')).toBeVisible();
  await expect(page.locator('.apply-email .email-code-title')).toHaveText('ელ-ფოსტა დასადასტურებელია');
  const [row] = await S.sql('SELECT email_verified, application_submitted_at FROM users WHERE email = $1', [other]);
  expect(row.email_verified).toBe(false);
  expect(row.application_submitted_at).not.toBeNull();

  // The dashboard: the banner with the code box and "Resend the code".
  await page.goto('/dashboard.html');
  const banner = page.locator('#emailCodeBanner');
  await expect(banner.locator('.email-code-title')).toHaveText('ელ-ფოსტა დასადასტურებელია');
  await expect(banner).toContainText('განაცხადს დავამტკიცებთ მხოლოდ მაშინ, როცა ელ-ფოსტას დაადასტურებ.');
  await expect(banner.locator('[data-ec-resend]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/2-dashboard-banner.png` }); }

  // The admin card: "Email not confirmed yet", and approval is refused.
  const admin = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [admin.email])).length) await S.apiUser(admin.name, admin.email);
  const actx = await browser.newContext(PHONE);
  const apage = await actx.newPage();
  await S.logIn(apage, admin, '/ka/admin.html?tab=mentors&status=email_unconfirmed');
  const card = apage.locator('.mv-card').filter({ hasText: other });
  await expect(card.locator('.mv-email-unconfirmed')).toHaveText('ელ-ფოსტა დასადასტურებელია');
  await expect(card.locator('.mv-email-why')).toHaveText('დამტკიცება შეუძლებელია, სანამ მენტორი კოდს არ შეიყვანს.');
  await expect(apage.locator('[data-status="email_unconfirmed"]')).toHaveText('ელ-ფოსტა დაუდასტურებელი');
  if (SHOTS) { await apage.evaluate(() => window.scrollTo(0, 0)); await apage.waitForTimeout(300); await apage.screenshot({ path: `${SHOTS}/3-admin-card.png`, fullPage: true }); }
  await card.locator('.mv-open').click();
  await expect(card.locator('.mv-blocked')).toContainText('ელფოსტა დადასტურებული არ არის');
  await expect(card.locator('.mv-approve')).toBeDisabled();
  if (SHOTS) { await card.locator('.mv-final').scrollIntoViewIfNeeded(); await apage.evaluate(() => window.scrollBy(0, 120)); await apage.waitForTimeout(300); await card.locator('.mv-final').screenshot({ path: `${SHOTS}/3b-admin-approve-blocked.png` }); }

  // The code (hours later) from the dashboard: the banner goes, and the card no longer says so.
  await banner.locator('.email-code-input').fill(S.codeIn(await S.waitForMail(other, 'კოდი')));
  await banner.locator('.email-code-form button[type="submit"]').click();
  await expect(banner).toBeHidden();
  await apage.goto('/ka/admin.html?tab=mentors&status=email_unconfirmed');
  await expect(apage.locator('.mv-card').filter({ hasText: other })).toHaveCount(0);
  await actx.close();
  await ctx.close();
});
