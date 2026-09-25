// The development-only "fast-forward" tool: moves one booking's clock forward and runs the housekeeping, so the 7-day automatic refund, the
// release of a held answer, the reveal of ratings and the moment earnings become payable can be tried without waiting. It does not exist in production.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, client, bookAndPay, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

let srv, base, admin, seeker, mentor, mentorId;
const started = [];
const ff = (id, days, who = admin) => who.api(`/admin/dev/bookings/${id}/fast-forward`, { method: 'POST', body: days === undefined ? {} : { days } });

before(async () => {
  await resetDatabase();
  srv = await startServer(4613, { PROBATION_ANSWERS: '1' }); // the first answer of a mentor is held for a check, as on a new site
  base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'business', price: 25, proofUrl: 'https://linkedin.com/in/dr-mentor', sampleAnswer: SAMPLE } });
  mentorId = (await mentor.api('/me')).user.id;
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
});
after(() => { [srv, ...started].forEach((s) => s && s.proc.kill()); });

describe('who may use it, and what it accepts', () => {
  test('only an admin: a visitor gets 401, everybody else 403', async () => {
    const b = await bookAndPay(base, seeker, mentorId, 'A question to fast-forward, for the permission test?');
    assert.equal((await ff(b.id, 7, client(base))).status, 401);
    assert.equal((await ff(b.id, 7, seeker)).status, 403);
    assert.equal((await ff(b.id, 7, mentor)).status, 403);
    assert.equal((await seeker.api('/bookings/' + b.id)).booking.status, 'paid', 'nothing moved');
  });

  test('the number of days must be a whole number from 1 to 90; the booking must exist', async () => {
    const b = (await seeker.api('/bookings/mine')).asked[0];
    for (const days of [0, -1, 91, 1.5, '7', null]) assert.equal((await ff(b.id, days)).status, 400, JSON.stringify(days));
    assert.equal((await ff('not-a-booking')).status, 404);
    assert.equal((await ff('00000000-0000-4000-8000-000000000000')).status, 404);
  });
});

describe('what a fast-forward makes happen', () => {
  test('an unanswered question is refunded automatically after its 7 days', async () => {
    const b = await bookAndPay(base, seeker, mentorId, 'Nobody will answer this one, so it must come back?');
    assert.equal(b.status, 'paid');
    const before = (await ff(b.id, 1)).after;
    assert.equal(before.status, 'paid', 'one day is not enough');
    const r = await ff(b.id, 7);
    assert.equal(r.status, 200);
    assert.equal(r.before.status, 'paid');
    assert.equal(r.after.status, 'refunded');
    assert.equal(r.after.refundReason, 'no_answer_deadline');
    const listed = (await admin.api('/admin/bookings?status=refunded')).bookings.find((x) => x.id === b.id);
    assert.ok(listed, 'it shows in the admin list of refunded bookings');
    assert.equal((await ff(b.id, 7)).after.status, 'refunded', 'doing it again changes nothing');
  });

  test('a held first answer is released, ratings stay hidden until both have rated or 7 days pass, and the earnings become payable', async () => {
    const b = await bookAndPay(base, seeker, mentorId, 'A question with an answer, so its whole life can be followed?');
    const answered = await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: SAMPLE } });
    assert.equal(answered.booking.answerReview, 'held', 'a new mentor\'s first answer waits for a check');
    const asker = (await seeker.api(`/bookings/${b.id}`)).booking;
    assert.equal(asker.answer, null, 'the buyer cannot read it yet');
    assert.equal(asker.answerHeld, true);

    // one day: the check window (24 hours) is over, so it is released and the buyer can read it (from that moment the 7 days start)
    const released = await ff(b.id, 1);
    assert.equal(released.before.answerReview, 'held');
    assert.equal(released.after.answerReview, 'released');
    assert.equal((await seeker.api(`/bookings/${b.id}`)).booking.answer, SAMPLE);

    // the earnings are on hold for 7 days after the buyer could read the answer
    assert.equal(released.after.payableNow, false);
    const holding = (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
    assert.equal(holding.payable, 0);
    assert.equal(holding.holding, 2000, '80% of 25.00 lari');

    // double-blind ratings: the asker rates; the mentor sees nothing of it yet
    assert.equal((await seeker.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 5, tags: ['clear'], review: 'Very clear.' } })).status, 201);
    assert.equal((await mentor.api(`/bookings/${b.id}/ratings`)).rating.theirs, null, 'hidden until both have rated');
    const after3 = await ff(b.id, 3);
    assert.equal(after3.after.ratingsRevealed, 0, 'not yet: 3 days after the answer became readable');
    assert.equal(after3.after.payableNow, false);

    // 7 days after the buyer could read it: ratings are revealed and the earnings can be paid
    const after7 = await ff(b.id, 4);
    assert.equal(after7.before.ratingsRevealed, 0);
    assert.equal(after7.after.ratingsRevealed, 1, 'revealed after the 7 days');
    assert.equal(after7.after.payableNow, true, 'payable now');
    const theirs = (await mentor.api(`/bookings/${b.id}/ratings`)).rating.theirs;
    assert.equal(theirs.stars, 5);
    const payable = (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
    assert.equal(payable.payable, 2000, 'it is in the admin Payouts tab as payable');
    assert.equal(payable.holding, 0);
  });

  test('both rating before the 7 days reveals at once (no fast-forward needed), so it is the days that were being tested above', async () => {
    const b = await bookAndPay(base, seeker, mentorId, 'A second answered question, this time rated by both people?');
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: SAMPLE } }); // (not the first answer any more: not held)
    assert.equal((await seeker.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 4 } })).status, 201);
    assert.equal((await mentor.api(`/bookings/${b.id}/ratings`)).rating.theirs, null);
    assert.equal((await mentor.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars: 5 } })).status, 201);
    assert.equal((await mentor.api(`/bookings/${b.id}/ratings`)).rating.theirs.stars, 4);
    assert.equal((await seeker.api(`/bookings/${b.id}/ratings`)).rating.theirs.stars, 5);
  });
});

describe('it exists only on a developer\'s computer', () => {
  test('the settings say so here, the admin script shows the buttons only then, and both languages have the texts', async () => {
    assert.equal((await client(base).api('/config')).devMode, true);
    const adminJs = (await admin('/js/admin.js')).text;
    assert.match(adminJs, /WisecallI18n\.devMode\(\)/);
    assert.match(adminJs, /\/admin\/dev\/bookings\//);
    const [en, ka] = ['en', 'ka'].map((l) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/admin-${l}.json`), 'utf8')));
    const keys = Object.keys(en).filter((k) => k.startsWith('admin.dev.'));
    assert.ok(keys.length >= 10, keys.join());
    for (const k of keys) { assert.ok(ka[k] && ka[k] !== en[k], `${k} is translated`); assert.match(ka[k], /[ა-ჿ]/, k); }
    for (const [key, holes] of [['admin.dev.done', ['{days}']], ['admin.dev.changed.status', ['{from}', '{to}']]]) for (const h of holes) { assert.ok(en[key].includes(h) && ka[key].includes(h), `${key} keeps ${h}`); }
  });

  test('in production the route is not there at all (404 for everybody, even a visitor), and the configuration has no devMode', async () => {
    const s = await startServer(4614, {
      NODE_ENV: 'production', PUBLIC_URL: 'https://wisecall.example', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: 'http://localhost:9/emails',
      EMAIL_FROM: 'Wisecall <hello@wisecall.example>', PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'id_for_test', BOG_CLIENT_SECRET: 'secret_for_test',
      DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345', KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'key_for_test', DIDIT_WORKFLOW_ID: 'workflow_for_test', DIDIT_WEBHOOK_SECRET: 'whsec_for_test'
    });
    started.push(s);
    assert.ok(!('devMode' in (await client(s.base).api('/config'))));
    const id = '00000000-0000-4000-8000-000000000000';
    assert.equal((await client(s.base).api(`/admin/dev/bookings/${id}/fast-forward`, { method: 'POST', body: { days: 7 } })).status, 404);
    // a booking-specific admin route that does exist answers a visitor differently (401), so the 404 above is "no such route"
    assert.equal((await client(s.base).api(`/admin/bookings/${id}/refund`, { method: 'POST' })).status, 401);
  });
});
