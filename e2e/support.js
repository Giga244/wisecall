// Helpers shared by the end-to-end specs: the database (for moving the clock forward), the mail log, and the
// signup / login steps a person does in the browser.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { expect } = require('@playwright/test');
require('dotenv').config();
const { client, approveMentor, addPayoutDetails, SAMPLE, GOOD_IBAN } = require('../tests/helpers');

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
// Creates an account on the sign-up page, types the code from the email, and ends up signed in.
async function signUp(page, { name, email, password = PASSWORD }) {
  await page.goto('/signup.html');
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', password);
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
  const su = await c.api('/auth/signup', { method: 'POST', body: { name, email, password: PASSWORD, language: 'en' } });
  if (su.status !== 201) throw new Error('signup failed: ' + su.text);
  const mail = await waitForMail(email);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: codeIn(mail) } });
  if (v.status !== 200) throw new Error('verify failed: ' + v.text);
  return c;
}

// A verified, listed mentor (every required step passed, payout details saved), ready to be asked questions.
async function listedMentor(admin, { name, email, niche = 'business', price = 20, roleTitle = 'Founder' }) {
  const m = await apiUser(name, email);
  const r = await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle, niche, price, proofUrl: 'https://linkedin.com/in/' + email.split('@')[0], sampleAnswer: SAMPLE } });
  if (r.status !== 200) throw new Error('mentor setup failed: ' + r.text);
  await approveMentor(admin, m);
  await addPayoutDetails(m, GOOD_IBAN, name);
  const me = (await m.api('/me')).user;
  return { client: m, id: me.id, username: me.username, name, email, price };
}

// Asks a question in the browser and pays (or not) on the fake bank's page. Returns the page's booking id.
async function askAndPay(page, mentor, question, outcome = 'pay') {
  await page.goto(`/u/${mentor.username}`);
  await page.fill('#question', question);
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

module.exports = { BASE, PASSWORD, sql, pool, mails, waitForMail, codeIn, signUp, logIn, apiUser, listedMentor, askAndPay, bookingRow, untilBooking, GOOD_IBAN, SAMPLE };
