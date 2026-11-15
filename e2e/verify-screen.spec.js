// The "enter your code" screen (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 1), in Georgian: it says where the code went, offers
// "change email" for a typo (the new code goes to the new address), "resend code" waits a minute with a countdown, and the Spam / Junk line
// is there. (A mentor's sign-up no longer stops here: the code box waits on step 5 of the application, docs/CLAUDE-CODE-EMAIL-CODE-FIX.md;
// an asker's sign-up still comes to this screen.)
const { test, expect } = require('@playwright/test');
const S = require('./support');

test('where the code went, a corrected address gets the code, resend counts down, and the Spam line', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const typo = `nana-${Date.now()}@hotmial.e2e.test`;
  const fixed = typo.replace('hotmial', 'hotmail');
  await page.goto('/ka/signup.html');
  await page.fill('#name', 'ნანა ბერიძე');
  await page.fill('#email', typo);
  await page.fill('#password', S.PASSWORD);
  await page.selectOption('#birthYear', '1990');
  await page.selectOption('#birthMonth', '01');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await expect(page.locator('#verifyToText')).toHaveText(`კოდი გავაგზავნეთ მისამართზე: ${typo}`);
  await expect(page.locator('.verify-spam')).toHaveText('კოდი არ მოვიდა? შეამოწმე Junk / Spam საქაღალდე. კოდი 24 საათის განმავლობაში მოქმედებს, მაშინაც, თუ დაგვიანებით მოვა.');
  await expect(page.locator('#resendBtn')).toBeDisabled();
  await expect(page.locator('#resendBtn')).toContainText('წამში');
  // the typo, corrected
  await page.click('#changeEmailBtn');
  await page.fill('#newEmail', fixed);
  await page.click('#changeEmailForm button[type="submit"]');
  await expect(page.locator('#verifyToText')).toHaveText(`კოდი გავაგზავნეთ მისამართზე: ${fixed}`);
  const mail = await S.waitForMail(fixed);
  expect(mail.subject).toMatch(/^Wisecall – შენი კოდი: \d{6}$/);
  await page.fill('#code', S.codeIn(mail));
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL(/\/dashboard\.html/);
});
