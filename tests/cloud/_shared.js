// Shared setup for the tests in tests/cloud/ (they reuse tests/helpers.js; this file only adds a few small things).
// Not a test file itself: the runner picks up tests/cloud/*.test.js only.
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, addPayoutDetails, approveMentor, SAMPLE, wait } = require('../helpers');

// Settings every cloud test pins, so a developer's own .env (a log email provider, a rate-limit multiplier) cannot change the results.
const BASE_ENV = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '', RATE_LIMIT_MULTIPLIER: '20' };

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null; // (callers assert on the result, so a timeout reads as a normal failed assertion)
    await wait(200);
  }
}

const bookingRow = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const payoutRow = async (bookingId) => (await pool.query('SELECT * FROM payouts WHERE booking_id = $1', [bookingId])).rows[0] || null;

// A fresh database and server, an admin, a buyer ("seeker") and an approved, bookable mentor.
async function marketplace(port, env = {}, { price = 25, niche = 'tech' } = {}) {
  await resetDatabase();
  const srv = await startServer(port, { ...BASE_ENV, ...env });
  const base = srv.base;
  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  const mentor = await signupVerified(base, 'Mia Mentor', 'mentor@example.com');
  const r = await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche, price, sampleAnswer: SAMPLE } });
  if (r.status !== 200) throw new Error('mentor profile failed: ' + r.text);
  const mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mia Mentor');
  return { srv, base, admin, seeker, mentor, mentorId };
}

module.exports = { BASE_ENV, pool, waitFor, bookingRow, payoutRow, marketplace };
