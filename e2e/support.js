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
  await page.selectOption('#birthYear', '1990');
  await page.selectOption('#birthMonth', '01');
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
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name, email, password: PASSWORD, language: 'en' } });
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
// Chooses, on step 1, the field and chip that mean this category (server/categories.js).
async function pickNiche(page, niche) {
  const hit = require('../server/categories').fromNiche(niche);
  if (!hit) return;
  const field = page.locator(`[data-field="${hit.fieldId}"]`);
  // (the picker shows 8 fields until "+ N more" is pressed: public/js/field-picker.js)
  if (!(await field.count()) && (await page.locator('[data-fp-more]').count())) await page.locator('[data-fp-more]').click();
  if (await field.getAttribute('aria-pressed') !== 'true') await field.click();
  if (hit.chip) await page.locator(`[data-direction="${hit.chip}"]`).click();
  await oneDirection(page);
}
// At least one direction (docs/CLAUDE-CODE-NEW-CATEGORIES.md): the field's first one, when none is chosen yet.
async function oneDirection(page) {
  if (await page.locator('.fp-dirs [data-direction][aria-pressed="true"]').count()) return;
  const first = page.locator('.fp-dirs .fp-dir[data-direction]').first();
  if (await first.count()) await first.click();
}

// Step 2 of /apply.html, "My path" (docs/CLAUDE-CODE-MENTOR-STORY.md): three short blocks in place of the free-text story.
const PATH = {
  start: 'ქუთაისიდან ჩამოვედი თბილისში, ინგლისური თითქმის არ ვიცოდი და ნაცნობიც არავინ მყავდა.',
  how: 'ღამით უფასო კურსებით ვსწავლობდი, დღისით ვმუშაობდი და პირველი შეკვეთა ოც ლარად ავიღე.',
  now: 'უკვე მრავალი წელია ამ სფეროში ვმუშაობ და სტუდენტებს ვასწავლი. ხშირად მეკითხებიან, საიდან დაიწყონ.'
};
async function fillPath(page, p = {}) {
  await page.fill('#ap-pathStart', p.start || PATH.start);
  await page.fill('#ap-pathHow', p.how || PATH.how);
  await page.fill('#ap-pathNow', p.now || PATH.now);
}

async function applyAsMentor(page, a) {
  await page.goto('/apply.html');
  await page.waitForURL(/\/apply\.html\?step=1$/);
  await page.fill('#apHeadline', a.headline);
  await page.fill('#apField', a.field);
  if (a.niche) await pickNiche(page, a.niche);
  else { // (the field suggested from the words: one of its directions)
    await page.locator('.fp-dirs .fp-dir').first().waitFor({ timeout: 8000 }).catch(() => {});
    await oneDirection(page);
  }
  await page.selectOption('#apYears', String(a.years));
  if (a.title || a.tags) {
    await page.locator('form[data-step="0"] .apply-optional > summary').click();
    if (a.title) await page.fill('#apTitle', a.title);
    if (a.tags) await page.fill('#apTags', a.tags);
  }
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  await fillPath(page, a.path);
  // (optional: a sample question with a short sample answer, shown on the profile labelled "Sample answer")
  if (a.sample) {
    await page.locator('form[data-step="1"] .story-opt[data-opt="sample"] > summary').click();
    await page.fill('#ap-sampleQuestion', a.sampleQuestion || 'როგორ დავიწყო ამ სფეროში ნულიდან?');
    await page.fill('#ap-sampleReply', a.sample);
  }
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

module.exports = { fakeWeb, BASE, PASSWORD, sql, pool, mails, waitForMail, codeIn, signUp, logIn, apiUser, listedMentor, applyAsMentor, fillPath, PATH, pickNiche, oneDirection, passIdCheck, askAndPay, bookingRow, untilBooking, confirm, GOOD_IBAN, SAMPLE };
