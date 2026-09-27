// The admin overview: the first numbers an admin checks (sign-ups, applications, waiting list, questions, refunds, disputes, money),
// computed from the same rows as the other admin tabs. Admins only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId;

before(async () => {
  await resetDatabase();
  srv = await startServer(4719, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
  // An application waiting for review (sent), and one only started.
  const applicant = await signupVerified(base, 'Pat Pending', 'pat@example.com');
  await applicant.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'tech', price: 20, sampleAnswer: SAMPLE } });
  await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() WHERE email = 'pat@example.com'`);
  const drafter = await signupVerified(base, 'Dora Draft', 'dora@example.com');
  await drafter.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Writer', niche: 'tech', price: 20, sampleAnswer: SAMPLE } });
  await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = NULL WHERE email = 'dora@example.com'`);
  for (const email of ['w1@example.com', 'w2@example.com']) await client(base).api('/waitlist', { method: 'POST', body: { email, niche: 'tech', language: 'en' } });
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

test('only admins can see the overview', async () => {
  assert.equal((await asker.api('/admin/overview')).status, 403);
  assert.equal((await client(base).api('/admin/overview')).status, 401);
});

test('the numbers match what happened: sign-ups, applications, waiting list, questions, money and what mentors are owed', async () => {
  const one = await bookAndPay(base, asker, mentorId, 'How do I start learning Python from zero with one hour a day?');
  const two = await bookAndPay(base, asker, mentorId, 'Which laptop should I buy for web development on a small budget?');
  assert.equal((await mentor.api(`/bookings/${one.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with the basics.') } })).status, 200);

  const d = await admin.api('/admin/overview');
  assert.equal(d.status, 200);
  assert.equal(d.signups.total, 5);
  assert.equal(d.signups.week, 5);
  assert.equal(d.signups.mentors, 3);
  assert.equal(d.applications.byStatus.verified, 1);
  assert.equal(d.applications.byStatus.pending, 1, 'sent applications only');
  assert.equal(d.applications.byStatus.draft, 1);
  assert.equal(d.applications.waitingByRisk.none, 1, 'not analysed yet');
  assert.deepEqual(d.waitlist.byNiche, { tech: 2 });
  assert.equal(d.waitlist.total, 2);
  assert.equal(d.questions.byStatus.answered, 1);
  assert.equal(d.questions.byStatus.paid, 1);
  assert.equal(d.questions.paidLast30Days, 2);
  assert.equal(d.money.received, 5000, 'two questions of 25 GEL, in tetri');
  assert.equal(d.money.fee, 500, "20% of the answered one only");
  assert.equal(d.money.testPayments, 2, 'the fake bank is labelled as test money');
  assert.equal(d.payouts.holding, 2000, "the mentor's share of the answered question, on hold");
  assert.equal(d.payouts.payable, 0);
  assert.equal(d.refunds.full, 0);

  // A refund of the unanswered question takes it out of "received" and counts it as refunded.
  assert.equal((await admin.api(`/admin/bookings/${two.id}/refund`, { method: 'POST' })).status, 200);
  const after = await admin.api('/admin/overview');
  assert.equal(after.refunds.full + after.refunds.pending, 1);
  assert.equal(after.money.received, 2500);
  assert.equal(after.money.fee, 500);
  assert.doesNotMatch(JSON.stringify(after), /@example\.com|Mika|Ana Asker/, 'numbers only, nobody named');
});
