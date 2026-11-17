// Shared helpers for the end-to-end tests: start the real server against the TEST database
// and talk to it over HTTP with a tiny cookie-keeping client.
require('dotenv').config({ quiet: true });
const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const TEST_DB = process.env.TEST_DATABASE_URL;

async function resetDatabase() {
  const pool = new Pool({ connectionString: TEST_DB });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
}

async function startServer(port, extraEnv = {}) {
  if (!TEST_DB) throw new Error('Set TEST_DATABASE_URL in .env (a separate database from the real one).');
  const env = {
    ...process.env,
    NODE_ENV: '',
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    DATABASE_URL: TEST_DB,
    SESSION_SECRET: 'test-secret-that-is-long-enough-1234567890',
    RESEND_API_KEY: '',
    PAYMENT_PROVIDER: 'mock',
    KYC_PROVIDER: 'mock', DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: '',
    BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: '', TBC_CLIENT_ID: '', TBC_CLIENT_SECRET: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_ISSUER: '', // (off unless a test switches it on with its own fake Google)
    ADMIN_EMAILS: 'qa-admin@example.com',
    ADMIN_EMAIL: '',
    // (admins sign in with a password in the tests that are not about two-step verification; tests/two-factor.test.js turns it on. A
    // production server never gets "off": it would refuse to start.)
    ...(extraEnv.NODE_ENV === 'production' ? { ADMIN_2FA: 'required' } : { ADMIN_2FA: 'off' }),
    SUPPORT_EMAIL: '', SOCIAL_FACEBOOK: '', SOCIAL_INSTAGRAM: '', SOCIAL_LINKEDIN: '', SOCIAL_X: '', SOCIAL_TIKTOK: '', SOCIAL_YOUTUBE: '',
    PLATFORM_FEE_PERCENT: '20',
    // Mentor verification: no real AI and no real web lookups in tests (a test that needs them starts its own fakes).
    ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', ANTHROPIC_MODEL: '', ANTHROPIC_FALLBACK_MODEL: 'claude-opus-5', ANTHROPIC_EFFORT: '',
    AUTO_APPROVE: 'off', RDAP_BASE_URL: 'http://127.0.0.1:9/rdap/', LINK_CHECK_ALLOW_PRIVATE: '',
    PROBATION_ANSWERS: '0', // the probation tests turn it on; every other test answers straight away
    LAUNCH_MODE: 'live', // (left empty the site starts in prelaunch until a mentor is listed; the launch tests cover that)
    LIVE_SESSIONS: '', // (on outside production; tests/live-switch.test.js switches it off)
    ATTRIBUTION_COOKIE: 'on', // (where visitors come from: tests/attribution.test.js)
    TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', TURNSTILE_VERIFY_URL: '', // (the "are you a person?" check: tests/turnstile.test.js turns it on)
    BOOKINGS_PER_HOUR: '0', MAX_OPEN_UNPAID_BOOKINGS: '0', // (tests/bookings-limits.test.js turns them on)
    ...extraEnv
  };
  const proc = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d; });
  proc.stderr.on('data', (d) => { logs += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { proc, base, logs: () => logs }; } catch (e) { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error('Server exited early:\n' + logs);
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('Server did not start:\n' + logs);
}

function client(base) {
  let cookie = '';
  const jar = new Map(); // every cookie the server set (the sign-in cookie, the device cookie...), sent back like a browser does
  const jarString = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
      redirect: 'manual'
    });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
    cookie = jarString();
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, ...json };
  };
  // An applicant needs at least 1 direction in their field to send an application (docs/CLAUDE-CODE-NEW-CATEGORIES.md), as the apply form
  // asks. When a test sets a mentor's field through the API (their niche or a field, without saying which directions), the field's first
  // direction is chosen too, the way a person on /apply.html would. A test that names its directions (even none) is left exactly as it is.
  call.api = async (p, o = {}) => {
    const res = await call('/api' + p, o);
    const setsField = ((p === '/me' && o.method === 'PATCH') || (p === '/verification/experience' && o.method === 'PUT'))
      && o.body && typeof o.body === 'object' && o.body.directions === undefined;
    const u = res.user;
    if (setsField && res.status === 200 && u && u.fieldId && !(u.directions || []).length) {
      const f = require('../server/categories').FIELD.get(u.fieldId);
      // (one that keeps the mentor's category as it is: same niche as theirs, else as the field's)
      const ok = (c) => !c.other && !c.moved;
      const first = f && (f.chips.find((c) => ok(c) && c.niche === u.niche) || f.chips.find((c) => ok(c) && c.niche === f.niche) || f.chips.find(ok));
      if (first) {
        const r = await call('/api/verification/experience', { method: 'PUT', body: { directions: [first.id] } }); // (only the direction: the field and any extra categories stay as the test set them)
        if (r.status === 200 && r.user) res.user = r.user;
      }
    }
    return res;
  };
  call.cookie = () => cookie; // (for tests that send raw requests with their own paths)
  call.getCookie = (name) => jar.get(name);
  call.setCookie = (name, value) => { jar.set(name, value); cookie = jarString(); };
  // For binary downloads: the raw fetch Response, signed in as this client.
  call.raw = (p) => fetch(base + p, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return call;
}

async function signupVerified(base, name, email, password = 'test-pass-12345', extra = {}) {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name, email, password, ...extra } });
  if (su.status !== 201) throw new Error('signup failed: ' + su.text);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } });
  if (v.status !== 200) throw new Error('verify failed: ' + v.text);
  return c;
}


const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Creates a booking and pays it at the FAKE bank (PAYMENT_PROVIDER=mock), then waits until the
// server has confirmed the payment with the bank. Returns the booking as the seeker sees it.
async function bookAndPay(base, seekerClient, mentorId, question, outcome = 'success') {
  const r = await seekerClient.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(question) } });
  if (r.status !== 201) throw new Error('booking failed: ' + r.text);
  await client(base).api(`/mock-bank/orders/${r.booking.providerOrderId}/complete`, { method: 'POST', body: { outcome } });
  await seekerClient.api(`/bookings/${r.booking.id}/sync`, { method: 'POST' });
  let booking = r.booking;
  for (let i = 0; i < 40 && booking.status === 'pending_payment'; i++) {
    await wait(100);
    booking = (await seekerClient.api(`/bookings/${r.booking.id}`)).booking;
  }
  return booking;
}


// Ratings are double-blind (see server/ratings.js): neither person sees the other's until both have rated, or 7 days after the
// answer became readable. To let a rating count at once, the tests first make the answer look 8 days old, then rate.
async function ageAnswer(bookingId, days = 8) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DB });
  try {
    await pool.query(
      `UPDATE bookings SET answered_at = LEAST(answered_at, now() - ($2 * interval '1 day')),
                           answer_released_at = CASE WHEN answer_released_at IS NULL THEN NULL ELSE LEAST(answer_released_at, now() - ($2 * interval '1 day')) END
        WHERE id = $1`, [bookingId, days]);
  } finally { await pool.end(); }
}
async function rate(clientOfRater, bookingId, stars, extra = {}) {
  await ageAnswer(bookingId);
  return clientOfRater.api(`/bookings/${bookingId}/ratings`, { method: 'POST', body: { stars, ...extra } });
}

// A question must be at least 50 characters and an answer at least 150 (server/content.js). Tests write short ones for readability:
// these keep the words they wrote at the start and add real-looking text after them until the minimum is reached.
const { LIMITS, size } = require('../server/content');
const QUESTION_TAIL = ' Please tell me exactly what you would do in my situation.';
const ANSWER_TAIL = ' Start by writing down who is stuck, what they already tried and what a good outcome would look like. Then take the smallest step that tests it, and check the result before you build anything bigger.';
const longQuestion = (text) => (size(text) >= LIMITS.questionMin ? text : text + QUESTION_TAIL);
const longAnswer = (text) => (size(text) >= LIMITS.answerMin ? text : text + ANSWER_TAIL);

const GOOD_IBAN = 'GE29NB0000000101904917';
// Mentors only appear in listings (and can be booked) once they have saved payout details.
async function addPayoutDetails(mentorClient, iban = GOOD_IBAN, name = 'Test Mentor', password = 'test-pass-12345') {
  const r = await mentorClient.api('/me/payout', { method: 'PUT', body: { name: name + ' Name', iban, currentPassword: password } });
  if (r.status !== 200) throw new Error('payout details failed: ' + r.text);
  return r;
}
// Gives a mentor every verification step their niche requires (written straight into the test
// database, since the real ID check, the Experience form, the analysis and the licence review have their own tests), marks the
// application as submitted, and then performs the real final approval as the admin. Returns the mentor's id.
async function approveMentor(adminClient, mentorClient) {
  const { Pool } = require('pg');
  const rules = require('../server/verification/rules');
  const me = (await mentorClient.api('/me')).user;
  const pool = new Pool({ connectionString: TEST_DB });
  try {
    await pool.query(
      `UPDATE users SET verification_status = 'pending', application_submitted_at = coalesce(application_submitted_at, now())
        WHERE id = $1 AND verification_status IN ('none', 'rejected', 'pending')`, [me.id]);
    for (const step of rules.requiredFor(me.niche)) {
      await pool.query(
        `INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now())
         ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed', reason = 'test setup', decided_at = now()`, [me.id, step]
      );
    }
  } finally { await pool.end(); }
  const res = await adminClient.api(`/admin/mentors/${me.id}/approve`, { method: 'POST' });
  if (res.status !== 200) throw new Error('approve failed: ' + res.text);
  return me.id;
}
const SAMPLE = 'This is a detailed sample answer that is comfortably longer than eighty characters to pass validation.';
// "შენ შესახებ" for an application a test sends: required, at least 150 characters (server/mentorStory.js aboutReason).
const ABOUT = 'For many years I have worked in this field, first as a junior in a small company and now leading a team of my own. I also teach beginners and can help with where to start and what to learn first.';

module.exports = { ROOT, resetDatabase, startServer, client, signupVerified, bookAndPay, ageAnswer, rate, addPayoutDetails, approveMentor, GOOD_IBAN, wait, SAMPLE, ABOUT, longQuestion, longAnswer };
