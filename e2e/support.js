// Helpers shared by the end-to-end specs: the database (for moving the clock forward), the mail log, and the
// signup / login steps a person does in the browser.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { expect } = require('@playwright/test');
require('dotenv').config({ quiet: true });
const { client, approveMentor, addPayoutDetails, SAMPLE, GOOD_IBAN, longQuestion } = require('../tests/helpers');

const BASE = 'http://localhost:4620';
const MAIL = path.join(__dirname, '.tmp', 'mail.jsonl');
const PASSWORD = 'e2e-pass-12345';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
const sql = async (text, params) => (await pool.query(text, params)).rows;

// ---- The mail log: every email the server "sent" ----------------------------------------------------------------
const mails = () => fs.readFileSync(MAIL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
async function waitForMail(to, subjectPart, { after = 0, timeout = 15000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const found = mails().filter((m) => m.to === to && (!subjectPart || m.subject.includes(subjectPart)));
    if (found.length > after) return found[found.length - 1];
    if (Date.now() > end) throw new Error(`no email to ${to} matching "${subjectPart || ''}". Mail so far: ${mails().map((m) => `${m.to}: ${m.subject}`).join(' | ')}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const codeIn = (mail) => (mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</) || [])[1];

// ---- Steps a person does in the browser -------------------------------------------------------------------------
// Answers the site's confirmation dialog (public/js/dialog.js) with its action button ("Refund 25.00 ₾"), as a person would.
async function confirm(page) {
  const dialog = page.locator('dialog.wc-dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-ok]').click();
  await expect(dialog).toBeHidden();
}

// Creates an account on the sign-up page, types the code from the email, and ends up signed in.
async function signUp(page, { name, email, password = PASSWORD }) {
  await page.goto('/signup.html');
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.check('#adult');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForURL(/verify-email\.html/);
  await expect(page.locator('#devCodeBox')).toBeHidden(); // the code is only in the email, never on screen
  const mail = await waitForMail(email, undefined);
  await page.fill('#code', codeIn(mail));
  await page.click('#verifyForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
}

async function logIn(page, { email, password = PASSWORD }, to = '/dashboard.html') {
  await page.goto('/login.html');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/dashboard.html');
  if (to !== '/dashboard.html') await page.goto(to);
}

// ---- Set-up shortcuts for the specs that are not about signing up (the API, exactly as the pages call it) --------
async function apiUser(name, email) {
  const c = client(BASE);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: PASSWORD, language: 'en' } });
  if (su.status !== 201) throw new Error('signup failed: ' + su.text);
  const mail = await waitForMail(email);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: codeIn(mail) } });
  if (v.status !== 200) throw new Error('verify failed: ' + v.text);
  return c;
}

// A signed-in person applies as a mentor at /apply.html, the one place to apply (docs/CLAUDE-CODE-ONE-APPLY-PATH.md), step by step as a
// person would. a: { headline, field, niche (chosen with "Change"; otherwise the suggestion stands), years, title, tags, story, sample,
// price, url, licence: { number, body, until }, submit (default true) }. Ends on "Thank you" (or on step 5 when submit is false). The ID
// check comes before sending (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md): "submit" takes the (fake) ID check with the account's name, and the
// application is sent by itself once it has passed.
async function applyAsMentor(page, a) {
  await page.goto('/apply.html');
  await page.waitForURL(/\/apply\.html\?step=1$/);
  await page.fill('#apHeadline', a.headline);
  await page.fill('#apField', a.field);
  if (a.niche) { await page.click('[data-cat-change]'); await page.selectOption('#apNiche', a.niche); }
  await page.selectOption('#apYears', String(a.years));
  if (a.title || a.tags) {
    await page.locator('form[data-step="0"] .apply-optional > summary').click();
    if (a.title) await page.fill('#apTitle', a.title);
    if (a.tags) await page.fill('#apTags', a.tags);
  }
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  await page.fill('#apStory', a.story);
  if (a.sample) { await page.locator('form[data-step="1"] .apply-optional > summary').click(); await page.fill('#apSample', a.sample); }
  await page.click('.apply-next');
  await page.waitForURL(/step=3$/);
  await page.fill('#apPrice', String(a.price));
  await page.click('.apply-next');
  await page.waitForURL(/step=4$/);
  await page.fill('#apUrl', a.url);
  await page.click('[data-add-link]');
  await expect(page.locator('.apply-evidence li')).toHaveCount(1);
  if (a.licence) {
    const lic = page.locator('.apply-licence');
    await lic.locator('[name="number"]').fill(a.licence.number);
    await lic.locator('[name="issuingBody"]').fill(a.licence.body);
    await lic.locator('[name="validUntil"]').fill(a.licence.until);
    await lic.locator('[data-save-licence]').click();
    await expect(lic.locator('.ap-ok')).toBeVisible();
  }
  await page.click('.apply-next');
  await page.waitForURL(/step=5$/);
  await expect(page.locator('#apMissing')).toHaveCount(0);
  if (a.submit === false) return;
  await passIdCheck(page);
  await expect(page.locator('.apply-done')).toBeVisible();
}

// The (fake) ID check from the "One step left" card on /apply.html, with the account's own name (so the names match); back on /apply.html.
async function passIdCheck(page, name) {
  await expect(page.locator('[data-submit]')).toHaveCount(0);
  const who = name || (await page.evaluate(async () => (await (await fetch('/api/me')).json()).user.name));
  await page.click('[data-id-start]');
  await page.waitForURL(/mock-kyc\.html/);
  await page.fill('#fullName', who);
  await page.click('#mockKycForm button[type="submit"]');
  await page.waitForURL(/apply\.html/);
}

// A verified, listed mentor (every required step passed, payout details saved), ready to be asked questions.
async function listedMentor(admin, { name, email, niche = 'business', price = 20, roleTitle = 'Founder', customNiche }) {
  const m = await apiUser(name, email);
  const r = await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle, ...(niche === 'other' ? {} : { niche }), price, proofUrl: 'https://linkedin.com/in/' + email.split('@')[0], sampleAnswer: SAMPLE } });
  if (r.status !== 200) throw new Error('mentor setup failed: ' + r.text);
  if (customNiche || niche === 'other') {
    const f = await m.api('/verification/experience', { method: 'PUT', body: { niche, customNiche: customNiche || roleTitle } });
    if (f.status !== 200) throw new Error('field setup failed: ' + f.text);
  }
  await approveMentor(admin, m);
  await addPayoutDetails(m, GOOD_IBAN, name, PASSWORD);
  const me = (await m.api('/me')).user;
  return { client: m, id: me.id, username: me.username, name, email, price };
}

// Asks a question in the browser and pays (or not) on the fake bank's page. Returns the page's booking id.
async function askAndPay(page, mentor, question, outcome = 'pay') {
  await page.goto(`/u/${mentor.username}`);
  await page.fill('#question', longQuestion(question)); // (a question must be at least 50 characters)
  await page.click('#askBtn');
  await page.waitForURL(/mock-bank\.html/);
  await page.click({ pay: '#payBtn', fail: '#failBtn', cancel: '#cancelBtn' }[outcome]);
  await page.waitForURL(/\/u\/[^?]+\?.*booking=/);
  return new URL(page.url()).searchParams.get('booking');
}

const bookingRow = async (id) => (await sql('SELECT * FROM bookings WHERE id = $1', [id]))[0];
async function untilBooking(id, predicate, message, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const b = await bookingRow(id);
    if (predicate(b)) return b;
    if (Date.now() > end) throw new Error(`${message} (booking ${id} is ${b && b.status}/${b && b.answer_review})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Where the fake evidence pages are (e2e/global-setup.js writes it): /p/<name-with-dashes> shows that name.
const fakeWeb = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.tmp', 'fakes.json'), 'utf8')).web;

module.exports = { fakeWeb, BASE, PASSWORD, sql, pool, mails, waitForMail, codeIn, signUp, logIn, apiUser, listedMentor, applyAsMentor, passIdCheck, askAndPay, bookingRow, untilBooking, confirm, GOOD_IBAN, SAMPLE };
