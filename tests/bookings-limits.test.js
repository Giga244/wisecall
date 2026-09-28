// Limits on asking (docs/FIX-PROMPT.md): per account, at most MAX_OPEN_UNPAID_BOOKINGS unpaid attempts open at once and
// BOOKINGS_PER_HOUR questions started per hour; and what buyers and mentors get of a booking leaves out the bank's internals.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, bookAndPay, longQuestion, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId;

before(async () => {
  await resetDatabase();
  srv = await startServer(4723, { RATE_LIMIT_MULTIPLIER: '20', MAX_OPEN_UNPAID_BOOKINGS: '3', BOOKINGS_PER_HOUR: '5' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const ask = (n) => asker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(`Question number ${n} about my first job in tech.`) } });

test('at most 3 unpaid attempts open at once; an old one that the bank has closed does not count', async () => {
  for (let i = 1; i <= 3; i++) assert.equal((await ask(i)).status, 201);
  const refused = await ask(4);
  assert.equal(refused.status, 409);
  assert.equal(refused.error, 'too_many_unpaid');
  assert.equal(refused.max, 3);
  // An attempt older than the bank's payment window is not open any more.
  await pool.query(`UPDATE bookings SET created_at = now() - interval '50 minutes' WHERE id = (SELECT id FROM bookings ORDER BY created_at LIMIT 1)`);
  assert.equal((await ask(5)).status, 201);
});

test('at most 5 questions started per hour, paid or not', async () => {
  await pool.query(`UPDATE bookings SET status = 'expired'`); // (none of them is open now)
  assert.equal((await ask(6)).status, 201, 'the fifth this hour');
  const r = await ask(7);
  assert.equal(r.status, 429, 'the fifth attempt this hour was the last');
  assert.equal(r.error, 'too_many_bookings');
  await pool.query(`UPDATE bookings SET created_at = now() - interval '2 hours'`);
  const paid = await bookAndPay(base, asker, mentorId, 'Should I learn Go or Rust first for backend work?');
  assert.equal(paid.status, 'paid');
});

test("buyers and mentors never see the bank's internal ids or error messages; admins do", async () => {
  const { rows: [b] } = await pool.query(`SELECT id FROM bookings WHERE status = 'paid' LIMIT 1`);
  await pool.query(`UPDATE bookings SET refund_error = 'bank said no (internal)', provider_refund_id = 'refund-123' WHERE id = $1`, [b.id]);
  for (const c of [asker, mentor]) {
    const one = (await c.api(`/bookings/${b.id}`)).booking;
    const mine = await c.api('/bookings/mine');
    for (const shown of [one, ...mine.asked, ...mine.received]) {
      assert.equal(shown.refundError, undefined);
      assert.equal(shown.providerRefundId, undefined);
      assert.equal(shown.providerOrderId, undefined);
    }
  }
  const adminView = (await admin.api('/admin/bookings?status=paid')).bookings.find((x) => x.id === b.id);
  assert.equal(adminView.refundError, 'bank said no (internal)');
});
