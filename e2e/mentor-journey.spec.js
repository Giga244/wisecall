// The mentor's journey, clearer (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2), on a 360px phone and a 1280px computer in
// Georgian: the 5 steps with their minutes before signing up, the years chosen from a list, a headline example that follows the field,
// a lecturer's and a practitioner's story example, the price hint, a university page recognised by name, the ID check explained (and a
// QR code on a computer), and "what happens next" on screen and by email.
//
// E2E_JOURNEY_SHOTS=<folder> also saves a full-page picture of each step at 360px (docs/MENTOR-JOURNEY-SUMMARY.md).
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = require('../public/i18n/ka.json');
const STORY = '18 წელია, თბილისის სახელმწიფო უნივერსიტეტში მაკროეკონომიკას ვასწავლი და ეროვნული ბანკის ინფლაციის ანგარიშებზე ვმუშაობდი. სტუდენტები ხშირად მეკითხებიან, როგორ აირჩიონ მაგისტრატურა საზღვარგარეთ.';
let n = 0;
const SHOTS = process.env.E2E_JOURNEY_SHOTS;

for (const width of [360, 1280]) {
  test(`the whole journey at ${width}px in Georgian`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 } });
    const page = await ctx.newPage();
    const email = `journey-${width}-${Date.now()}-${++n}@e2e.test`;
    const shot = async (name) => {
      if (!SHOTS || width !== 360) return;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    };

    // Before signing up: the steps, the minutes, what to have ready, the line for lecturers.
    await page.goto('/ka/become-a-mentor.html');
    const preview = page.locator('.apply-preview');
    await expect(preview.locator('h2')).toHaveText(KA['mentors.flow.title']);
    await expect(preview.locator('.apply-preview-steps li')).toHaveCount(5);
    await expect(preview.locator('.apply-preview-ready li')).toHaveCount(2);
    await expect(preview).toContainText(KA['mentors.ready.lecturers']);
    await preview.scrollIntoViewIfNeeded();
    if (SHOTS && width === 360) await preview.screenshot({ path: `${SHOTS}/00-before-signing-up.png` });

    await page.goto('/ka/signup.html?as=mentor');
    await page.fill('#name', 'ლევან კაპანაძე');
    await page.fill('#email', email);
    await page.fill('#password', S.PASSWORD);
    await page.check('#adult');
    await page.click('#signupForm button[type="submit"]');
    await page.waitForURL(/verify-email\.html/);
    await page.fill('#code', S.codeIn(await S.waitForMail(email)));
    await page.click('#verifyForm button[type="submit"]');
    await page.waitForURL((u) => !/verify-email/.test(u.pathname));

    // Step 1: the years from a list; errors under the field; the headline example follows the field.
    await page.goto('/ka/apply.html');
    await page.waitForURL(/apply\.html\?step=1$/);
    await expect(page.locator('#apYears option').first()).toHaveText(KA['apply.f.years.choose']);
    await expect(page.locator('#apYears option[value="0"]')).toHaveText(KA['apply.f.years.lessThanOne']);
    await page.fill('#apHeadline', 'ეკონომიკის პროფესორი');
    await page.fill('#apField', 'მაკროეკონომიკა');
    await page.click('[data-cat-change]');
    await page.selectOption('#apNiche', 'business');
    await expect(page.locator('#apHeadline')).toHaveAttribute('placeholder', KA['apply.ex.money.headline']);
    await shot('01-step-1-about-you');
    await page.click('.apply-next');
    await expect(page.locator('#apYearsErr')).toHaveText(KA['apply.err.yearsEmpty']);
    await expect(page.locator('#apYearsErr')).toBeInViewport();
    await page.selectOption('#apYears', '18');
    await page.click('.apply-next');

    // Step 2: two examples that fit the field.
    await page.waitForURL(/step=2$/);
    const example = page.locator('.apply-example');
    await expect(example).toContainText(KA['apply.story.exampleLecturer']);
    await expect(example).toContainText(KA['apply.ex.money.lecturer']);
    await expect(example).toContainText(KA['apply.ex.money.practitioner']);
    await page.fill('#apStory', STORY);
    await shot('02-step-2-story');
    await page.click('.apply-next');

    // Step 3: what mentors in the field ask (or the general range while there are too few).
    await page.waitForURL(/step=3$/);
    await expect(page.locator('#apPriceSuggest')).toContainText(/\d+–\d+ ₾/);
    await page.fill('#apPrice', '30');
    await shot('03-step-3-price');
    await page.click('.apply-next');

    // Step 4: a university page, recognised by name as it is typed.
    await page.waitForURL(/step=4$/);
    await page.fill('#apUrl', `https://www.tsu.ge/ka/staff/journey-${width}`);
    await expect(page.locator('#apUniHint')).toHaveText(KA['apply.uni.named'].replace('{name}', 'თბილისის სახელმწიფო უნივერსიტეტი'));
    await page.click('[data-add-link]');
    await expect(page.locator('.apply-evidence li')).toHaveCount(1);
    await shot('04-step-4-proof');
    await page.click('.apply-next');

    // Step 5: "One step left: confirm your identity", before any "send" (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md); on a computer, a QR code to
    // do it on a phone.
    await page.waitForURL(/step=5$/);
    await expect(page.locator('.id-card h1')).toHaveText(KA['idcard.title']);
    await expect(page.locator('[data-submit]')).toHaveCount(0);
    const qr = page.locator('[data-id-qr]');
    if (width >= 900) {
      await expect(qr).toHaveText(KA['idcard.qr']);
      await qr.click();
      await expect(page.locator('.id-card-qr svg')).toBeVisible();
    } else {
      await expect(qr).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
    await shot('05-step-5-id-check');
    await S.passIdCheck(page);

    // The ID check passed: the application is sent by itself; what happens next, on screen and by email.
    await expect(page.locator('.apply-done')).toBeVisible();
    await expect(page.locator('.apply-next-steps h2')).toHaveText(KA['apply.done.next.title']);
    await expect(page.locator('.apply-next-steps li')).toHaveCount(3);
    await shot('06-sent-what-happens-next');
    const mail = await S.waitForMail(email, 'განაცხადი Wisecall-ზე მიღებულია');
    expect(mail.text).toMatch(/სამუშაო დღ/);
    await ctx.close();
  });
}
