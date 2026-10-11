// Attempts to ask a question that were never paid: hidden from the buyer's list (the page), never shown to the mentor, and deleted after 7 days.
require('dotenv').config({ quiet: true });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified, addPayoutDetails, approveMentor, bookAndPay, SAMPLE, longAnswer, wait } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, mentor, mentorId;
const Q = 'A question that will not be paid for, at the bank today?';

before(async () => {
  await resetDatabase();
  srv = await startServer(4617, { SWEEP_INTERVAL_SECONDS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Accountant', niche: 'business', price: 25, proofUrl: 'https://linkedin.com/in/dr-mentor', sampleAnswer: SAMPLE } });
  mentorId = (await mentor.api('/me')).user.id;
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const attempt = async (outcome) => bookAndPay(base, seeker, mentorId, `${Q} (${outcome} ${Math.random().toString(36).slice(2, 8)})`, outcome);
const age = (id, days) => pool.query(`UPDATE bookings SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [id, days]);
const exists = async (id) => (await pool.query('SELECT 1 FROM bookings WHERE id = $1', [id])).rowCount === 1;

describe('a mentor never sees an unpaid attempt', () => {
  test('cancelled, failed and unfinished attempts are in the buyer\'s list only; the mentor\'s list has paid questions only', async () => {
    const failed = await attempt('fail');
    assert.equal(failed.status, 'expired');
    const open = (await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: `${Q} (unfinished)` } })).booking; // never taken to the bank
    assert.equal(open.status, 'pending_payment');
    const paid = await bookAndPay(base, seeker, mentorId, `${Q} (this one is paid)`);
    assert.equal(paid.status, 'paid');

    const asked = (await seeker.api('/bookings/mine')).asked;
    assert.deepEqual(asked.map((b) => b.status).sort(), ['expired', 'paid', 'pending_payment'], 'the buyer\'s list has everything (the page hides the expired ones)');
    const received = (await mentor.api('/bookings/mine')).received;
    assert.deepEqual(received.map((b) => b.id), [paid.id]);
    assert.doesNotMatch(JSON.stringify(received), /this will not be paid|unfinished/);
  });
});

describe('unpaid attempts are deleted after 7 days', () => {
  test('only ones that were never paid and are older than a week: paid, answered and refunded questions and young attempts stay', async () => {
    const oldFailed = await attempt('fail');
    const oldOpen = (await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: `${Q} (an old attempt left open)` } })).booking;
    const youngFailed = await attempt('fail');
    const paidOld = await bookAndPay(base, seeker, mentorId, `${Q} (paid long ago, waiting)`);
    const answeredOld = await bookAndPay(base, seeker, mentorId, `${Q} (paid long ago, answered)`);
    assert.equal((await mentor.api(`/bookings/${answeredOld.id}/answer`, { method: 'POST', body: { answer: longAnswer('Answered.') } })).status, 200);
    const refundedOld = await bookAndPay(base, seeker, mentorId, `${Q} (paid long ago, refunded)`);
    assert.equal((await admin.api(`/admin/bookings/${refundedOld.id}/refund`, { method: 'POST' })).status, 200);
    const expiredEdge = await attempt('fail');

    for (const b of [oldFailed, oldOpen, paidOld, answeredOld, refundedOld]) await age(b.id, 40);
    await age(expiredEdge.id, 6); // six days: not yet
    // the housekeeping runs every second in this server
    for (let i = 0; i < 40 && (await exists(oldFailed.id) || await exists(oldOpen.id)); i++) await wait(200);

    assert.equal(await exists(oldFailed.id), false, 'a failed attempt older than a week is gone');
    assert.equal(await exists(oldOpen.id), false, 'so is one that was left open');
    assert.equal(await exists(youngFailed.id), true, 'a young attempt stays');
    assert.equal(await exists(expiredEdge.id), true, 'six days is not yet seven');
    for (const [name, b] of [['paid', paidOld], ['answered', answeredOld], ['refunded', refundedOld]]) assert.equal(await exists(b.id), true, `a ${name} question is never deleted, however old`);
    const left = (await seeker.api('/bookings/mine')).asked.map((b) => b.id);
    assert.ok(!left.includes(oldFailed.id) && left.includes(paidOld.id));
  });

  test('the number of days is a setting, shown in the page text; and the job never deletes a paid booking even if its status looks unpaid', async () => {
    assert.equal((await client(base).api('/config')).unpaidAttemptDays, 7);
    const b = await bookAndPay(base, seeker, mentorId, `${Q} (paid, then something odd happened to its status)`);
    await pool.query(`UPDATE bookings SET status = 'expired', created_at = now() - interval '30 days' WHERE id = $1`, [b.id]); // paid_at is set
    await wait(2500);
    assert.equal(await exists(b.id), true, 'anything that was ever paid (paid_at) is kept');
  });
});

describe('the page', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/dashboard.js'), 'utf8');
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
  const ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));

  test('unfinished attempts are behind a toggle with a count (aria-expanded), not full cards; texts in both languages', () => {
    for (const needle of ["b.status === 'expired'", 'unfinished-toggle', 'aria-expanded', 'aria-controls="unfinishedList"', 'dash.unfinished.show', 'dash.unfinished.hide']) assert.ok(js.includes(needle), needle);
    assert.match(en['dash.unfinished.show'], /^Show unfinished payments \(\{n\}\)$/);
    for (const k of ['dash.unfinished.show', 'dash.unfinished.hide', 'dash.unfinished.note']) assert.match(ka[k], /[ა-ჿ]/, k);
    assert.match(en['dash.unfinished.note'], /\{unpaidDays\}/);
    assert.match(ka['dash.unfinished.note'], /\{unpaidDays\}/);
  });
});
