// Profiles in a real browser: pick a username at sign-up, fill in the profile with a live preview, upload a photo, and what a
// visitor sees at /u/<username> (and what they do not see once the profile is private).
const { test, expect } = require('@playwright/test');
const sharp = require('sharp');
const S = require('./support');

const EMAIL = 'maia.profile@e2e.test';
let photo;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#e0413a' } }).png().toBuffer();
});

async function overflows(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

test('sign up with a username of your own: it is suggested from the name, checked while typing, and used for the profile address', async ({ page }) => {
  await page.goto('/signup.html');
  await page.fill('#name', 'Maia Profile');
  await expect(page.locator('#username')).toHaveValue('maia-profile');
  await expect(page.locator('#usernameStatus')).toHaveText(/free/i);
  await expect(page.locator('#usernameHint')).toContainText('/u/maia-profile');

  await page.fill('#username', 'settings');
  await expect(page.locator('#usernameStatus')).toHaveText(/can.t be used/i);
  await page.fill('#username', 'Maia P!');
  await expect(page.locator('#usernameStatus')).toHaveText(/3–30/);
  await page.fill('#username', 'maia-p');
  await expect(page.locator('#usernameStatus')).toHaveText(/free/i);

  await page.fill('#email', EMAIL);
  await page.fill('#password', S.PASSWORD);
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await page.fill('#code', S.codeIn(await S.waitForMail(EMAIL)));
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
  expect((await S.sql('SELECT username FROM users WHERE email = $1', [EMAIL]))[0].username).toBe('maia-p');
});

test('a taken username is refused at sign-up with a clear message', async ({ page }) => {
  await page.goto('/signup.html');
  await page.fill('#username', 'maia-p');
  await expect(page.locator('#usernameStatus')).toHaveText(/already taken/i);
  await page.fill('#name', 'Other Person');
  await page.fill('#email', 'other.person@e2e.test');
  await page.fill('#password', S.PASSWORD);
  await page.click('#signupForm button[type="submit"]');
  await expect(page.locator('#formError')).toHaveText(/already taken/i);
  await expect(page).toHaveURL(/signup\.html/);
});

test('Settings → Profile: everything can be edited, and the preview follows what is typed', async ({ page }) => {
  await S.logIn(page, { email: EMAIL }, '/settings.html?tab=profile');
  await expect(page.locator('#username')).toHaveValue('maia-p');
  await expect(page.locator('#profilePreview')).toContainText('Maia Profile');

  await page.fill('#headline', 'Economics student');
  await page.fill('#currentWork', 'TSU, 3rd year');
  await page.fill('#city', 'Kutaisi');
  await page.fill('#bio', 'I ask a lot of questions about careers.');
  await page.locator('#languageChecks label', { hasText: 'Georgian' }).click();
  await page.locator('#languageChecks label', { hasText: 'English' }).click();
  // live, before anything is saved
  const preview = page.locator('#profilePreview');
  await expect(preview).toContainText('Economics student');
  await expect(preview).toContainText('I ask a lot of questions about careers.');
  await expect(preview).toContainText('Kutaisi');
  await expect(preview).toContainText('Georgian, English');

  // the bio limit is 500 and is counted
  await page.fill('#bio', 'x'.repeat(120));
  await expect(page.locator('#bioCount')).toHaveText('120 / 500 characters');
  await page.fill('#bio', 'I ask a lot of questions about careers.');

  await page.fill('#linkedinUrl', 'https://example.com/not-linkedin');
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#profileError')).toHaveText(/LinkedIn/);
  await page.fill('#linkedinUrl', 'linkedin.com/in/maia-profile');
  await page.fill('#websiteUrl', 'https://maia.example.com');
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#toast')).toContainText(/saved/i);
  await expect(page.locator('#linkedinUrl')).toHaveValue('https://linkedin.com/in/maia-profile');

  await page.reload();
  await expect(page.locator('#headline')).toHaveValue('Economics student');
  await expect(page.locator('#languageChecks input:checked')).toHaveCount(2);
});

test('a photo: a wrong file is refused, a real picture is shown at once, and it can be removed', async ({ page }) => {
  await S.logIn(page, { email: EMAIL }, '/settings.html?tab=profile');
  await expect(page.locator('#photoPreview .avatar')).toHaveText('MP'); // initials until there is a photo
  await expect(page.locator('#photoRemove')).toBeHidden();

  await page.setInputFiles('#photoFile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('#photoError')).toHaveText(/JPG, PNG or WebP/);

  await page.setInputFiles('#photoFile', { name: 'me.png', mimeType: 'image/png', buffer: photo });
  await expect(page.locator('#photoPreview img.avatar-photo')).toBeVisible();
  await expect(page.locator('#profilePreview img.avatar-photo')).toBeVisible();
  await expect.poll(() => page.locator('#photoPreview img').evaluate((i) => i.complete && i.naturalWidth)).toBe(512);
  await expect(page.locator('#photoRemove')).toBeVisible();
  await expect(page.locator('#photoError')).toHaveText('');
  expect((await S.sql('SELECT length(data) AS n, mime FROM user_photos'))[0].mime).toBe('image/webp');

  // the header and other pages use it too
  await page.goto('/u/maia-p');
  await expect.poll(() => page.locator('.profile-head img.avatar-photo').evaluate((i) => i.complete && i.naturalWidth)).toBe(512);
});

test('a visitor sees the public profile, and nothing private', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/u/maia-p');
  await expect(page.locator('h1')).toHaveText('Maia Profile');
  const card = page.locator('.profile-card');
  await expect(card).toContainText('Economics student');
  await expect(card).toContainText('TSU, 3rd year');
  await expect(card).toContainText('Kutaisi');
  await expect(card).toContainText('Georgian, English');
  await expect(page.locator('.profile-about')).toContainText('I ask a lot of questions about careers.');
  await expect(card.locator('a', { hasText: 'LinkedIn' })).toHaveAttribute('href', 'https://linkedin.com/in/maia-profile');
  await expect(card.locator('a', { hasText: 'maia.example.com' })).toHaveAttribute('rel', /nofollow/);
  await expect(page.locator('.ask-panel')).toHaveCount(0); // an asker has no question box
  const body = await page.locator('body').innerText();
  expect(body).not.toContain(EMAIL);
  await expect(page.locator('img.avatar-photo').first()).toBeVisible();
  expect(await page.locator('head meta[name="robots"]').getAttribute('content')).toBe('noindex');
  expect(await page.title()).toBe('Maia Profile — Wisecall');
  await ctx.close();
});

test('changing the username: the old address keeps working (once a month at most)', async ({ page, browser }) => {
  await S.logIn(page, { email: EMAIL }, '/settings.html?tab=profile');
  await expect(page.locator('#usernameSave')).toBeDisabled(); // nothing changed yet
  await page.fill('#username', 'maia-new');
  await expect(page.locator('#usernameStatus')).toHaveText(/free/i);
  await page.click('#usernameSave');
  await expect(page.locator('#toast')).toContainText(/changed/i);
  await expect(page.locator('#usernameHint')).toContainText(/can change it again on/i);

  await page.fill('#username', 'maia-third');
  await expect(page.locator('#usernameSave')).toBeDisabled();

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto('/u/maia-p');
  await expect(visitor).toHaveURL(/\/u\/maia-new$/);
  await expect(visitor.locator('h1')).toHaveText('Maia Profile');
  await ctx.close();
});

test('only people I have had a question with: a visitor is told the profile is private (and the photo is not served)', async ({ page, browser }) => {
  await S.logIn(page, { email: EMAIL }, '/settings.html?tab=profile');
  await page.selectOption('#profileVisibility', 'contacts');
  await expect(page.locator('#visibilityHint')).toContainText(/Search engines can.t find it/);
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#toast')).toContainText(/saved/i);
  const photoUrl = await page.locator('#photoPreview img').getAttribute('src');

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  const res = await visitor.goto('/u/maia-new');
  expect(res.status()).toBe(200);
  await expect(visitor.locator('h1')).toHaveText('This profile is private');
  const text = await visitor.locator('body').innerText();
  for (const secret of ['Maia Profile', 'Economics student', 'Kutaisi', 'I ask a lot of questions']) expect(text).not.toContain(secret);
  expect((await visitor.request.get(photoUrl)).status()).toBe(404);
  expect(await visitor.title()).toBe('This profile is private — Wisecall');
  await ctx.close();

  // the owner still sees it, and is reminded who else can
  await page.goto('/u/maia-new');
  await expect(page.locator('h1')).toHaveText('Maia Profile');
  await expect(page.locator('.profile-self')).toContainText(/Only people you.ve had a question with/);
});

test('in Georgian too, and nothing runs off the side of the screen at phone, tablet and laptop widths', async ({ page }) => {
  await S.logIn(page, { email: EMAIL }, '/settings.html?tab=profile');
  await page.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(page.locator('#previewTitle')).toHaveText(/როგორ ხედავენ/);
  await expect(page.locator('label[for="headline"]')).toContainText('რას ვაკეთებ');
  await expect(page.locator('#languageChecks')).toContainText('ქართული');
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const url of ['/settings.html?tab=profile', '/u/maia-new', '/signup.html']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await overflows(page), `${url} at ${w}px runs off the side`).toBe(false);
    }
  }
  await page.locator('.lang-btn[data-lang="en"]').first().click().catch(() => {});
});
