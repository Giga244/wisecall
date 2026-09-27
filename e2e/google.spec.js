// "Continue with Google" in a real browser, against the fake Google (tests/fakeGoogle.js): the browser really is redirected to
// another site, the person really picks an account there, and comes back to our callback.
const { test, expect } = require('@playwright/test');
const S = require('./support');

const NEW = { email: 'giorgi.google@e2e.test', name: 'Giorgi Google', pick: 'newcomer' };
const EXISTING = { email: 'existing.person@e2e.test', name: 'Existing Person', pick: 'existing' };
const UNVERIFIED_HERE = { email: 'unverified.here@e2e.test', name: 'Unverified Here', pick: 'existing2' };

test.describe.configure({ mode: 'serial' });

const chooseAccount = async (page, pick) => {
  await expect(page.locator('#chooser')).toBeVisible(); // now we are on the fake Google's own page (another address)
  expect(new URL(page.url()).port).toBe('4630');
  await page.locator(`a[data-account="${pick}"]`).click();
};
const meOf = (page) => page.evaluate(async () => (await (await fetch('/api/me')).json()).user);

test('the button is above the email form, with an "or" line between, and looks like Google\'s', async ({ page }) => {
  for (const url of ['/login.html', '/signup.html']) {
    await page.goto(url);
    const button = page.locator('#googleBtn');
    await expect(button).toBeVisible();
    await expect(button).toContainText('Continue with Google');
    await expect(button.locator('svg')).toBeVisible();
    const firstField = page.locator('form input').first();
    expect((await button.boundingBox()).y).toBeLessThan((await firstField.boundingBox()).y);
    await expect(page.locator('.or-divider')).toBeVisible();
    const css = await button.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, width: s.borderTopWidth, h: el.getBoundingClientRect().height }; });
    expect(css.bg).toBe('rgb(255, 255, 255)');
    expect(css.color).toBe('rgb(31, 31, 31)');
    expect(css.border).toBe('rgb(116, 119, 117)');
    expect(css.width).toBe('1px');
    expect(css.h).toBeGreaterThanOrEqual(44);
    // no Google script is loaded (the CSP stays strict): the button is a plain link to our own server
    expect(await button.getAttribute('href')).toMatch(/^\/api\/auth\/google\/start\?mode=(login|signup)/);
    expect(await page.locator('script[src]').evaluateAll((els) => els.map((e) => e.getAttribute('src')).filter((s) => /^https?:/.test(s)))).toEqual([]);
  }
});

test('new person: pick a Google account, land on "choose your username" with their Google name and picture, then on the dashboard', async ({ page }) => {
  await page.goto('/signup.html?redirect=%2Fdashboard.html');
  await page.click('#googleBtn');
  await chooseAccount(page, NEW.pick);
  await page.waitForURL((u) => u.pathname === '/choose-username.html');
  await expect(page.locator('#chooseWho')).toContainText('Giorgi Google');
  await expect.poll(() => page.locator('#chooseWho img.avatar-photo').evaluate((i) => i.complete && i.naturalWidth)).toBe(512); // the Google picture
  await expect(page.locator('#username')).toHaveValue('giorgi-google');

  // a taken or reserved one is refused with a message, a free one is accepted
  await page.fill('#username', 'settings');
  await expect(page.locator('#usernameStatus')).toHaveText(/can.t be used/i);
  await page.fill('#username', 'giorgi-g');
  await expect(page.locator('#usernameStatus')).toHaveText(/free/i);
  // a new account from Google confirms here that the person is 18 or older
  await page.click('#chooseForm button[type="submit"]');
  await expect(page.locator('#formError')).toContainText('18 or older');
  await page.check('#adult');
  await page.click('#chooseForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');

  const me = await meOf(page);
  expect(me.email).toBe(NEW.email);
  expect(me.username).toBe('giorgi-g');
  expect(me.usernameConfirmed).toBe(true);
  expect(me.adultConfirmedAt).toBeTruthy();
  expect(me.emailVerified).toBe(true);
  expect(me.hasPassword).toBe(false);
  // their public profile
  await page.goto('/u/giorgi-g');
  await expect(page.locator('h1')).toHaveText('Giorgi Google');
  await expect(page.locator('.profile-head img.avatar-photo')).toBeVisible();
  // the page they pass through only once
  await page.goto('/choose-username.html');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
});

test('signing out and back in with Google is the same person, and ?redirect= is kept', async ({ page }) => {
  await page.goto('/login.html?redirect=%2Fsettings.html%3Ftab%3Daccount');
  await page.click('#googleBtn');
  await chooseAccount(page, NEW.pick);
  await page.waitForURL((u) => u.pathname === '/settings.html');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('account');
  expect((await meOf(page)).email).toBe(NEW.email);
  expect(await S.sql('SELECT count(*)::int AS n FROM users WHERE email = $1', [NEW.email])).toEqual([{ n: 1 }]);
});

test('cancelling at Google: back on the login page with a friendly message, and nobody is signed in', async ({ page }) => {
  await page.goto('/login.html');
  await page.click('#googleBtn');
  await expect(page.locator('#chooser')).toBeVisible();
  await page.click('#cancel');
  await page.waitForURL((u) => u.pathname === '/login.html');
  await expect(page.locator('#googleError')).toContainText(/cancelled/i);
  expect(await meOf(page)).toBeNull();
  expect(new URL(page.url()).search).toBe(''); // the address is tidied
  // ...and in Georgian
  await page.locator('.lang-btn[data-lang="ka"]').first().click();
  await expect(page.locator('#googleError')).toContainText('გააუქმე,');
  await expect(page.locator('#googleBtn')).toContainText('გაგრძელება Google-ით');
  await expect(page.locator('.or-divider')).toHaveText('ან');
});

test('an existing verified account: Google is linked to it and they are signed in as themselves', async ({ page, browser }) => {
  await S.signUp(page, { name: EXISTING.name, email: EXISTING.email });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/login.html');
  await p.click('#googleBtn');
  await chooseAccount(p, EXISTING.pick);
  await p.waitForURL((u) => u.pathname === '/dashboard.html');
  expect((await meOf(p)).email).toBe(EXISTING.email);
  expect(await S.sql(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [EXISTING.email])).toEqual([{ n: 1 }]);
  expect(await S.sql(`SELECT count(*)::int AS n FROM user_identities i JOIN users u ON u.id = i.user_id WHERE u.email = $1`, [EXISTING.email])).toEqual([{ n: 1 }]);
  await ctx.close();
});

test('an existing account whose email is not verified: not linked, and told to log in with the password first; then Connect works in Settings', async ({ page, browser }) => {
  // made by email and password, never verified
  const setup = await browser.newContext();
  const sp = await setup.newPage();
  await sp.goto('/signup.html');
  await sp.fill('#name', UNVERIFIED_HERE.name);
  await sp.fill('#email', UNVERIFIED_HERE.email);
  await sp.fill('#password', S.PASSWORD);
  await sp.check('#adult');
  await sp.click('#signupForm button[type="submit"]');
  await sp.waitForURL(/verify-email\.html/);
  await setup.close();

  await page.goto('/login.html');
  await page.click('#googleBtn');
  await chooseAccount(page, UNVERIFIED_HERE.pick);
  await page.waitForURL((u) => u.pathname === '/login.html');
  await expect(page.locator('#googleError')).toContainText(/log in with your password first/i);
  expect(await meOf(page)).toBeNull();
  expect(await S.sql(`SELECT count(*)::int AS n FROM user_identities i JOIN users u ON u.id = i.user_id WHERE u.email = $1`, [UNVERIFIED_HERE.email])).toEqual([{ n: 0 }]);

  // password first, then Settings → Account → Connect
  await page.fill('#email', UNVERIFIED_HERE.email);
  await page.fill('#password', S.PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
  await page.goto('/settings.html?tab=account');
  await expect(page.locator('#connectedCard')).toBeVisible();
  await expect(page.locator('#googleStatus')).toHaveText('Not connected');
  await page.click('#googleToggle');
  await chooseAccount(page, UNVERIFIED_HERE.pick);
  await page.waitForURL((u) => u.pathname === '/settings.html');
  await expect(page.locator('#toast')).toContainText(/Google is connected/i);
  await expect(page.locator('#googleStatus')).toContainText(`Connected as ${UNVERIFIED_HERE.email}`);
  expect(new URL(page.url()).searchParams.get('google')).toBeNull();

  // they have a password, so Google can be disconnected again
  await page.click('#googleToggle');
  await expect(page.locator('#googleStatus')).toHaveText('Not connected');
  await expect(page.locator('#toast')).toContainText(/disconnected/i);
});

test('Google is the only way in: it cannot be disconnected until a password is set', async ({ page }) => {
  await page.goto('/login.html');
  await page.click('#googleBtn');
  await chooseAccount(page, NEW.pick);
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
  await page.goto('/settings.html?tab=account');
  await expect(page.locator('#googleStatus')).toContainText(`Connected as ${NEW.email}`);
  // no "current password" field for someone who has none
  await expect(page.locator('#currentPasswordField')).toBeHidden();
  await expect(page.locator('#passwordTitle')).toHaveText('Set a password');

  await page.click('#googleToggle');
  await expect(page.locator('#googleAccountError')).toContainText(/only way you can log in/i);
  await expect(page.locator('#googleStatus')).toContainText('Connected as');
  await expect(page.locator('#newPassword')).toBeFocused();

  await page.fill('#newPassword', 'a-brand-new-password');
  await page.click('#passwordForm button[type="submit"]');
  await expect(page.locator('#toast')).toContainText(/password/i);
  await expect(page.locator('#currentPasswordField')).toBeVisible();
  await page.click('#googleToggle');
  await expect(page.locator('#googleStatus')).toHaveText('Not connected');
});

test('nothing runs off the side at phone, tablet and laptop widths, and the button stays tappable', async ({ page }) => {
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const url of ['/login.html', '/signup.html', '/settings.html?tab=account']) {
      await page.goto(url.startsWith('/settings') ? '/login.html' : url);
      if (url.startsWith('/settings')) {
        await S.logIn(page, { email: EXISTING.email }, url);
      }
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `${url} at ${w}px runs off the side`).toBe(false);
      if (url !== '/settings.html?tab=account') {
        const box = await page.locator('#googleBtn').boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(w);
      }
    }
  }
});
