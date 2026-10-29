// The simple mentor path (docs/CLAUDE-CODE-MENTOR-SIGNUP.md #5, docs/CLAUDE-CODE-UX-WALKTHROUGH.md F): a new visitor, on a 360px phone in
// Georgian, goes from the home page to "become a mentor", the mentor's sign-up, the email code, the five steps of /apply.html and
// "Submit", and never needs the Settings tabs. The application is then in the admin's review queue with no "Profile incomplete" label.
// The clicks from the home page to a finished account are counted (4: the hero button, "Start my application", "Create account",
// "Confirm"). The invite link (/mentor) leads to the same sign-up and is counted as "invite".
//
// E2E_MENTOR_SHOTS=<folder> also walks the path at 360px and 1280px, light and dark, in Georgian, and saves a picture of every step there
// (docs/quality-screens/mentor-signup/).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const STORY = '18 წელია, თბილისის სახელმწიფო უნივერსიტეტში მაკროეკონომიკას ვასწავლი და ეროვნული ბანკის ინფლაციის ანგარიშებზე ვმუშაობდი. სტუდენტები ხშირად მეკითხებიან, როგორ აირჩიონ მაგისტრატურა საზღვარგარეთ.';
let n = 0;

// The whole walk, as a person does it. -> { email, clicks, pages }
async function walk(page, { width, shots, tag }) {
  const email = `mentor-${tag}-${Date.now()}-${++n}@e2e.test`;
  const pages = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) pages.push(new URL(f.url()).pathname); });
  let clicks = 0;
  const click = async (locator) => { clicks += 1; await locator.click(); };
  // (from the top of the page: a full-page picture taken lower down shows the sticky header in the middle)
  const shot = async (name) => {
    if (!shots) return;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  };

  await page.goto('/ka/');
  await expect(page.locator('.hero-mentor-btn')).toHaveText('ექსპერტი ვარ – გავხდე მენტორი');
  await shot('01-home');
  await click(page.locator('.hero-mentor-btn'));
  await page.waitForURL(/become-a-mentor\.html/);
  await expect(page.locator('.become-link').first()).toBeVisible();
  await shot('02-become-a-mentor');
  await click(page.locator('.become-link').first());
  await page.waitForURL(/signup\.html\?as=mentor/);

  // The mentor's sign-up: their own heading and line, no username, no asker copy.
  await expect(page.locator('#authTitle [data-for-as="mentor"]')).toHaveText('შექმენი მენტორის ანგარიში');
  await expect(page.locator('#authTitle [data-for-as="mentor"]')).toBeVisible();
  await expect(page.locator('#authTitle [data-for-as="asker"]')).toBeHidden();
  await expect(page.locator('.auth-card > p[data-for-as="mentor"]')).toBeVisible();
  await expect(page.locator('.auth-card > p[data-for-as="asker"]')).toBeHidden();
  await expect(page.locator('#username')).toBeHidden();
  await page.fill('#name', 'ნინო ბერიძე');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.check('#adult');
  await shot('03-signup');
  await click(page.locator('#signupForm button[type="submit"]'));
  await page.waitForURL(/verify-email\.html.*as=mentor/);
  await shot('04-email-code');
  const mail = await S.waitForMail(email);
  await page.fill('#code', S.codeIn(mail));
  await click(page.locator('#verifyForm button[type="submit"]'));
  // Straight into the application, step 1: the account is a mentor applicant now.
  await page.waitForURL(/\/apply\.html\?step=1$/);
  await expect.poll(async () => (await S.sql('SELECT role FROM users WHERE email = $1', [email]))[0].role).toBe('mentor');

  // 1. About you: what I do, the field in my own words (its category comes by itself), years.
  await expect(page.locator('#applyProgressText')).toHaveText('ნაბიჯი 1: შენ შესახებ');
  await expect(page.locator('#applyDoneText')).toHaveText('დასრულებულია 0 / 5');
  await page.fill('#apHeadline', 'ეკონომიკის ასოცირებული პროფესორი თსუ-ში');
  await page.fill('#apField', 'მაკროეკონომიკა');
  await expect(page.locator('#apCategory [data-cat-name]')).toHaveText('ბიზნესი');
  await page.selectOption('#apYears', '18');
  await shot('05-step1-about');
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);

  // 2. The story, with a live counter and an example.
  await expect(page.locator('.apply-example')).toBeVisible();
  await page.fill('#apStory', 'ცოტა');
  await expect(page.locator('#apStoryCount')).toContainText('მინიმუმ 100');
  await page.click('.apply-next');
  await expect(page.locator('.apply-error')).toContainText('მინიმუმ 100'); // (not yet: it says what is missing)
  await page.fill('#apStory', STORY);
  await expect(page.locator('#apStoryCount')).toHaveClass(/is-ok/);
  await shot('06-step2-story');
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);

  // 3. The price: a suggested range, and what the mentor keeps.
  await expect(page.locator('#apPriceSuggest')).toContainText('20–50');
  await page.fill('#apPrice', '40');
  await expect(page.locator('#apPriceYou')).toContainText('32 ₾');
  await shot('07-step3-price');
  await page.click('.apply-next');
  await page.waitForURL(/step=4$/);

  // 4. Proof: a link is enough, its kind found from the address ("Next" with the link in the box adds it).
  await page.fill('#apUrl', 'https://www.linkedin.com/in/nino-beridze-economist');
  await shot('08-step4-proof');
  await page.click('.apply-next');
  await page.waitForURL(/step=5$/);
  const [ev] = await S.sql('SELECT e.kind FROM mentor_evidence e JOIN users u ON u.id = e.user_id WHERE u.email = $1', [email]);
  expect(ev.kind).toBe('linkedin');

  // 5. Everything else is done: "One step left: confirm your identity", and no "send" before it (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md).
  //    Once the (fake) ID check has passed, the application is sent by itself.
  await expect(page.locator('.apply-checklist .is-missing')).toHaveCount(0);
  await expect(page.locator('.id-card h1')).toHaveText('დარჩა ერთი ნაბიჯი: პირადობის დადასტურება');
  await shot('09-step5-submit');
  await S.passIdCheck(page);
  await expect(page.locator('.apply-done h1')).toHaveText('გმადლობთ! განაცხადი მიღებულია.');
  await expect(page.locator('.apply-done')).toContainText('2 სამუშაო დღეში');
  await shot('10-submitted');
  const [u] = await S.sql('SELECT verification_status, application_submitted_at, sample_answer, specialty_tags FROM users WHERE email = $1', [email]);
  expect(u.verification_status).toBe('pending');
  expect(u.application_submitted_at).not.toBeNull();
  expect(u.sample_answer).toBeNull(); // (never asked for)
  expect(u.specialty_tags).toEqual(['მაკროეკონომიკა']); // (made from the field)
  expect(pages.filter((p) => /settings\.html/.test(p)), 'never needs the Settings tabs').toEqual([]);
  if (shots) {
    // (Settings afterwards, for later changes: the tabs in sight, the profile's essentials first, a calm status)
    await page.goto('/settings.html');
    await page.waitForLoadState('networkidle');
    await shot('11-settings-profile');
    await page.goto('/settings.html?tab=profile'); // (the application card at the top: where it stands, one button to /apply.html)
    await page.waitForLoadState('networkidle');
    await shot('12-settings-application');
  }
  return { email, clicks, pages, width };
}

test('a new visitor on a 360px phone in Georgian: home -> become a mentor -> sign-up -> email code -> 5 steps -> submitted, in the review queue', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const r = await walk(page, { width: 360, tag: 'phone' });
  expect(r.clicks, 'clicks from the home page to a finished account').toBe(4);
  // Nothing on the way runs off the side of the phone.
  for (const url of ['/ka/', '/ka/become-a-mentor.html', '/ka/signup.html?as=mentor', '/apply.html?step=1']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBeLessThanOrEqual(0);
  }
  await ctx.close();

  // The admin's review queue: the application is there, with no "Profile incomplete" label.
  const admin = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [admin.email])).length) await S.apiUser(admin.name, admin.email);
  const actx = await browser.newContext();
  const apage = await actx.newPage();
  await S.logIn(apage, admin, '/admin.html');
  const card = apage.locator('.mv-card').filter({ hasText: r.email });
  await expect(card).toBeVisible();
  await expect(card.locator('.mv-incomplete')).toHaveCount(0);
  await actx.close();
});

test('the invite link /ka/mentor leads to the same sign-up, and the account says it came from an invite', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/ka/mentor');
  await page.waitForURL(/\/ka\/signup\.html\?as=mentor$/);
  await expect(page.locator('#authTitle [data-for-as="mentor"]')).toBeVisible();
  await expect(page.locator('#authTitle [data-for-as="asker"]')).toBeHidden();
  const email = `invited-${Date.now()}@e2e.test`;
  await page.fill('#name', 'ლევან არაბული');
  await page.fill('#email', email);
  await page.fill('#password', S.PASSWORD);
  await page.check('#adult');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', S.codeIn(await S.waitForMail(email)));
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL(/\/apply\.html\?step=1$/);
  const [u] = await S.sql('SELECT signup_source, role FROM users WHERE email = $1', [email]);
  expect(u.signup_source.source).toBe('invite');
  expect(u.role).toBe('mentor');
  // Signed in, the invite link goes straight to the application.
  await page.goto('/mentor');
  await page.waitForURL(/\/apply\.html/);
  await ctx.close();
});

// Pictures of every step: 360px and 1280px, light and dark, in Georgian.
const SHOTS = process.env.E2E_MENTOR_SHOTS;
for (const width of SHOTS ? [360, 1280] : []) {
  for (const scheme of ['light', 'dark']) {
    test(`pictures: ${width}px, ${scheme}`, async ({ browser }) => {
      const dir = `${SHOTS}/${width}-${scheme}`;
      fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, colorScheme: scheme, isMobile: width < 400, hasTouch: width < 400 });
      const page = await ctx.newPage();
      await walk(page, { width, shots: dir, tag: `${width}-${scheme}` });
      await ctx.close();
    });
  }
}
