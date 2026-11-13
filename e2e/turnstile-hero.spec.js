// The "are you a person?" box never covers the email field (docs/CLAUDE-CODE-TURNSTILE-FIX.md). Its own server before launch, with the check
// on: a fake Cloudflare siteverify (tokens "good-..." pass) and, in the browser, a stand-in for Cloudflare's script that behaves like the test
// key that always asks the person to click (3x00000000000000000000FF): it calls before-interactive, shows a box, and gives a token on the click.
// With the normal key the stand-in passes without showing anything, as "interaction-only" does.
const { test, expect } = require('@playwright/test');
const http = require('http');
const S = require('./support');
const { startServer } = require('../tests/helpers');

const ASK_KEY = '3x00000000000000000000FF';
let srv, fake;
const stamp = Date.now();

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(/^good-/.test(p.get('response') || '') ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer(4626, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '100', TURNSTILE_SITE_KEY: ASK_KEY, TURNSTILE_SECRET_KEY: 'test-secret-key',
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${fake.address().port}/siteverify` });
});
test.afterAll(() => { if (srv) srv.proc.kill(); if (fake) fake.close(); });

// The stand-in for https://challenges.cloudflare.com/turnstile/v0/api.js: records the options it was given.
const STANDIN = `window.__ts = [];
window.turnstile = {
  render(el, o) {
    window.__ts.push({ appearance: o.appearance });
    const id = window.__ts.length;
    if (!/^3x/.test(o.sitekey)) { setTimeout(() => o.callback('good-' + id), 50); return id; }
    setTimeout(() => {
      o['before-interactive-callback'] && o['before-interactive-callback']();
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fake-cf'; b.textContent = 'Verify you are human';
      b.style.cssText = 'display:block;width:100%;height:65px';
      b.onclick = () => { b.textContent = 'Success!'; o.callback('good-' + id); o['after-interactive-callback'] && o['after-interactive-callback'](); };
      el.appendChild(b);
    }, 100);
    return id;
  },
  reset() {}
};`;

async function open(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  await ctx.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STANDIN }));
  const page = await ctx.newPage();
  await page.goto(`${srv.base}/ka/`);
  await expect(page.locator('#heroWait .waitlist-form')).toBeVisible();
  return { ctx, page };
}
const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;

for (const width of [360, 1280]) {
  test(`${width}px: the box shows under the email row, never over the email or the button; joining works`, async ({ browser }) => {
    const { ctx, page } = await open(browser, width);
    const form = page.locator('#heroWait .waitlist-form');
    const email = form.locator('input[type="email"]');
    const before = await email.boundingBox();
    await email.click();
    await email.fill(`ts-${width}-${stamp}@e2e.test`);
    const box = form.locator('.turnstile-slot .fake-cf');
    await expect(box).toBeVisible();
    expect(await page.evaluate(() => window.__ts[0].appearance)).toBe('interaction-only');
    // (in its slot after the row, not inside it; the count line may sit between them)
    expect(await form.locator('.wlc-row .turnstile-box').count()).toBe(0);
    expect(await form.locator('.wlc-row ~ .turnstile-slot .turnstile-box').count()).toBe(1);
    const [e, b, c, row] = await Promise.all([email.boundingBox(), form.locator('button[type="submit"]').boundingBox(), box.boundingBox(), form.locator('.wlc-row').boundingBox()]);
    expect(e.width, 'the email keeps its size').toBeCloseTo(before.width, 0);
    expect(overlap(c, e), 'nothing over the email').toBe(false);
    expect(overlap(c, b), 'nothing over the button').toBe(false);
    expect(c.y, 'under the row').toBeGreaterThanOrEqual(row.y + row.height);
    expect(c.width, 'full width').toBeGreaterThan(row.width - 4);
    expect(await email.inputValue()).toBe(`ts-${width}-${stamp}@e2e.test`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // the person clicks it, then joins; the same address again gets the same friendly words
    await box.click();
    await form.locator('input[name="over16"]').check();
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('#heroWait .waitlist-done')).toContainText('გმადლობთ! ეს მისამართი სიაშია');
    expect((await S.sql('SELECT count(*)::int AS n FROM waitlist WHERE lower(email) = lower($1)', [`ts-${width}-${stamp}@e2e.test`]))[0].n).toBe(1);
    await page.reload();
    const again = page.locator('#heroWait .waitlist-form');
    await again.locator('input[type="email"]').fill(`ts-${width}-${stamp}@e2e.test`);
    await again.locator('.turnstile-slot .fake-cf').click();
    await again.locator('input[name="over16"]').check();
    await again.locator('button[type="submit"]').click();
    await expect(page.locator('#heroWait .waitlist-done')).toContainText('გმადლობთ! ეს მისამართი სიაშია');
    await ctx.close();
  });
}

test('every form that uses the check has its slot outside any input row', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  for (const [path, form] of [['/login.html', '#loginForm'], ['/signup.html', '#signupForm'], ['/contact.html', '#contactForm'], ['/forgot-password.html', '#forgotForm'], ['/find-a-mentor.html', '#requestForm']]) {
    await page.goto(srv.base + path);
    const slot = page.locator(`${form} > .turnstile-slot`);
    await expect(slot, path).toHaveCount(1);
    expect(await slot.evaluate((el) => el.parentElement.querySelector('button[type="submit"]').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING), path).toBeTruthy();
  }
  await ctx.close();
});
