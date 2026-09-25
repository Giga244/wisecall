// Two-way ratings: the rules, the double-blind reveal, what is public, replies, reports, admin hiding, flags and reminders.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, addPayoutDetails, approveMentor, bookAndPay, ageAnswer, wait, SAMPLE } = require('./helpers');
const { longAnswer } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, mentor, mentorId, mentorName = 'Dr Mentor';
const askers = {};

const post = (c, id, body) => c.api(`/bookings/${id}/ratings`, { method: 'POST', body });
const view = async (c, id) => (await c.api(`/bookings/${id}/ratings`)).rating;
const anon = () => client(base);

async function newAsker(key, name = key) {
  askers[key] = await signupByEmail(resend, base, name, `${key}@example.com`);
  return askers[key];
}
// An asker asks, the mentor answers: returns the booking id.
async function answered(asker, m = mentor, mid = mentorId, q = 'How do I plan my first year in this field?') {
  const b = await bookAndPay(base, asker, mid, q);
  assert.equal(b.status, 'paid', JSON.stringify(b));
  const a = await m.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with the basics, then build a small project every month.') } });
  assert.equal(a.status, 200, a.text);
  return b.id;
}
const reviews = async (id = mentorId) => (await anon().api(`/experts/${id}/reviews`));
const ratingRow = async (bookingId, direction) => (await pool.query('SELECT * FROM ratings WHERE booking_id = $1 AND direction = $2', [bookingId, direction])).rows[0];
const openFlags = async (id, kind) => (await pool.query(`SELECT * FROM mentor_flags WHERE mentor_id = $1 AND kind = $2 AND status = 'open'`, [id, kind])).rows;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4603, {
    SWEEP_INTERVAL_SECONDS: '1', RATE_LIMIT_MULTIPLIER: '30',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: ''
  });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupByEmail(resend, base, mentorName, 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/drmentor', sampleAnswer: SAMPLE } });
  mentorId = (await mentor.api('/me')).user.id;
  await addPayoutDetails(mentor);
  await approveMentor(admin, mentor);
  await newAsker('sam', 'Sam Seeker');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('who can rate, and what', () => {
  let bookingId;
  before(async () => { bookingId = await answered(askers.sam); });

  test('only the two people of a paid, answered booking; strangers and visitors are refused', async () => {
    const stranger = await newAsker('stranger');
    assert.equal((await post(stranger, bookingId, { stars: 5 })).status, 404);
    assert.equal((await stranger.api(`/bookings/${bookingId}/ratings`)).status, 404);
    assert.equal((await post(anon(), bookingId, { stars: 5 })).status, 401);
    assert.equal((await post(askers.sam, '00000000-0000-0000-0000-000000000000', { stars: 5 })).status, 404);
  });

  test('a question that has not been answered yet cannot be rated, by anybody', async () => {
    const b = await bookAndPay(base, askers.sam, mentorId, 'A question that is still waiting for its answer?');
    assert.equal((await post(askers.sam, b.id, { stars: 5 })).error, 'not_rateable');
    assert.equal((await post(mentor, b.id, { stars: 5 })).error, 'not_rateable');
    const v = await view(askers.sam, b.id);
    assert.equal(v.rateable, false);
    assert.equal(v.canRate, false);
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is the answer, a little late.') } });
  });

  test('a refunded question cannot be rated', async () => {
    const b = await answered(askers.sam, mentor, mentorId, 'A question that will be refunded later on?');
    assert.equal((await admin.api(`/admin/bookings/${b}/refund`, { method: 'POST', body: { reason: 'test refund' } })).status, 200);
    assert.equal((await post(askers.sam, b, { stars: 5 })).error, 'not_rateable');
  });

  test('stars are a whole number from 1 to 5', async () => {
    for (const bad of [undefined, null, 0, 6, 3.5, -1, 'five', {}, [5], NaN]) {
      const r = await post(askers.sam, bookingId, { stars: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.error, 'invalid_rating');
    }
  });

  test('the tags are the ones for that direction; text fields are text and have limits', async () => {
    const m = (body) => post(mentor, bookingId, { stars: 4, ...body });
    const a = (body) => post(askers.sam, bookingId, { stars: 4, ...body });
    assert.equal((await a({ tags: ['respectful'] })).error, 'invalid_tags', 'a mentor tag on an asker rating');
    assert.equal((await m({ tags: ['helpful'] })).error, 'invalid_tags', 'an asker tag on a mentor rating');
    assert.equal((await a({ tags: ['helpful', 'made-up'] })).error, 'invalid_tags');
    assert.equal((await a({ tags: ['helpful', 'detailed', 'clear', 'fast', 'helpful'].concat(['fast']) })).error, 'invalid_tags', 'too many');
    assert.equal((await a({ tags: 'helpful' })).error, 'invalid_tags');
    assert.equal((await a({ tags: [1] })).error, 'invalid_tags');
    assert.equal((await a({ review: 'x'.repeat(1001) })).error, 'review_too_long');
    assert.equal((await a({ review: { a: 1 } })).error, 'invalid_field');
    assert.equal((await a({ privateNote: 'for the team' })).error, 'invalid_field', 'only a mentor writes a private note');
    assert.equal((await m({ review: 'a public review of an asker' })).error, 'invalid_field', 'an asker gets no written review');
    assert.equal((await m({ privateNote: 'x'.repeat(1001) })).error, 'note_too_long');
    assert.equal((await pool.query('SELECT 1 FROM ratings WHERE booking_id = $1', [bookingId])).rowCount, 0, 'nothing was saved by a refused request');
  });
});

describe('double-blind: neither sees the other\'s rating until both have rated, or 7 days after the answer', () => {
  let bookingId, sam;
  before(async () => { sam = askers.sam; bookingId = await answered(sam, mentor, mentorId, 'How should I choose a specialty in medicine?'); });

  test('the asker rates first: it is theirs alone, and changes nothing public', async () => {
    const r = await post(sam, bookingId, { stars: 5, tags: ['helpful', 'detailed'], review: 'Very clear and practical.' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.rating.mine.stars, 5);
    assert.deepEqual(r.rating.mine.tags, ['helpful', 'detailed']);
    assert.equal(r.rating.mine.revealed, false);
    assert.equal(r.rating.theirs, null);
    assert.equal(r.rating.canRate, true, 'still editable');

    const asMentor = await view(mentor, bookingId);
    assert.equal(asMentor.theirs, null, 'the mentor does not see it');
    assert.doesNotMatch(JSON.stringify(asMentor), /Very clear and practical|helpful/);
    assert.doesNotMatch((await mentor.api('/bookings/mine')).text, /Very clear and practical/);
    assert.equal((await reviews()).summary.count, 0, 'not in the mentor\'s numbers');
    assert.equal((await reviews()).reviews.length, 0, 'not on the profile');
    assert.equal((await anon().api(`/experts/${mentorId}`)).expert.reviewCount, 0);
    assert.equal((await anon().api(`/users/${(await mentor.api('/me')).user.username}`)).profile.mentor.ratingAvg, null);
  });

  test('it can be changed while it is hidden', async () => {
    const r = await post(sam, bookingId, { stars: 4, tags: ['clear'], review: 'Very clear, and I have changed my mind about the stars.' });
    assert.equal(r.status, 201);
    assert.equal(r.rating.mine.stars, 4);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ratings WHERE booking_id = $1', [bookingId])).rows[0].n, 1, 'still one rating, not two');
    assert.ok((await ratingRow(bookingId, 'asker_to_mentor')).edited_at);
  });

  test('the mentor rates second: both become visible at once', async () => {
    const r = await post(mentor, bookingId, { stars: 5, tags: ['clear_question', 'respectful'], privateNote: 'A very thoughtful person, no concerns at all.' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.rating.mine.revealed, true);
    assert.equal(r.rating.mine.privateNote, 'A very thoughtful person, no concerns at all.', 'the mentor sees their own note');
    assert.equal(r.rating.theirs.stars, 4, 'and now sees the asker\'s rating and written review');
    assert.equal(r.rating.theirs.review, 'Very clear, and I have changed my mind about the stars.');

    const asAsker = await view(sam, bookingId);
    assert.equal(asAsker.mine.revealed, true);
    assert.equal(asAsker.theirs.stars, 5, 'the asker sees the stars and tags the mentor gave');
    assert.deepEqual(asAsker.theirs.tags, ['clear_question', 'respectful']);
    assert.equal(asAsker.theirs.review, undefined);
    // the mentor's note to the Wisecall team is never shown to the asker, in any answer
    assert.doesNotMatch(JSON.stringify(asAsker) + (await sam.api('/bookings/mine')).text + JSON.stringify((await anon().api(`/users/sam`))), /thoughtful person|privateNote/);
    assert.equal((await ratingRow(bookingId, 'mentor_to_asker')).private_note, 'A very thoughtful person, no concerns at all.', 'it is stored for the team');
  });

  test('now the mentor\'s public numbers and reviews include it', async () => {
    const rv = await reviews();
    assert.equal(rv.summary.count, 1);
    assert.equal(rv.summary.avg, 4);
    assert.deepEqual(rv.summary.tags, { clear: 1 });
    assert.equal(rv.reviews.length, 1);
    assert.equal(rv.reviews[0].review, 'Very clear, and I have changed my mind about the stars.');
    assert.equal(rv.reviews[0].reviewer.name, 'Sam Seeker');
    assert.equal(rv.reviews[0].reviewer.username, 'sam-seeker');
    assert.match(rv.reviews[0].reviewer.photoUrl || '', /^$|^\/api\/photo\//);
    const e = (await anon().api(`/experts/${mentorId}`)).expert;
    assert.equal(e.ratingAvg, 4);
    assert.equal(e.reviewCount, 1);
  });

  test('after the reveal nobody can change a rating; and each person rates once', async () => {
    assert.equal((await post(sam, bookingId, { stars: 1 })).error, 'already_revealed');
    assert.equal((await post(mentor, bookingId, { stars: 1 })).error, 'already_revealed');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ratings WHERE booking_id = $1', [bookingId])).rows[0].n, 2);
    const v = await view(sam, bookingId);
    assert.equal(v.canRate, false);
    assert.equal(v.mine.stars, 4, 'unchanged');
  });
});

describe('the seven-day reveal and the thirty-day window', () => {
  test('a rating nobody answered becomes visible 7 days after the answer became readable, and is then public', async () => {
    const sam = askers.sam;
    const b = await answered(sam, mentor, mentorId, 'What is a realistic first-year salary in this field?');
    assert.equal((await post(sam, b, { stars: 3, tags: ['fast'], review: 'Fine, but rather short.' })).status, 201);
    assert.equal((await reviews()).reviews.some((r) => r.review === 'Fine, but rather short.'), false);
    assert.equal((await view(mentor, b)).theirs, null);

    await ageAnswer(b, 6.5);
    assert.equal((await view(mentor, b)).theirs, null, 'day 6.5: still hidden');
    await ageAnswer(b, 7.5);
    const v = await view(mentor, b); // (reading also reveals what is due, the sweep does it too)
    assert.equal(v.theirs.stars, 3);
    assert.equal(v.theirs.review, 'Fine, but rather short.');
    assert.equal((await reviews()).reviews.some((r) => r.review === 'Fine, but rather short.'), true);
    assert.equal((await pool.query('SELECT revealed_at FROM ratings WHERE booking_id = $1', [b])).rows[0].revealed_at !== null, true);
    assert.equal((await post(sam, b, { stars: 5 })).error, 'already_revealed', 'no editing after the reveal');

    // the mentor may still rate later (day 10): their rating is visible at once, because the 7 days are over
    await ageAnswer(b, 10);
    const late = await post(mentor, b, { stars: 4, tags: ['clear_question'] });
    assert.equal(late.status, 201);
    assert.equal(late.rating.mine.revealed, true);
    assert.equal((await view(sam, b)).theirs.stars, 4);
  });

  test('ratings can be given for 30 days after the answer, not longer', async () => {
    const sam = askers.sam;
    const b = await answered(sam, mentor, mentorId, 'Is it worth doing a second degree in this field?');
    await ageAnswer(b, 31);
    assert.equal((await post(sam, b, { stars: 5 })).error, 'window_closed');
    assert.equal((await post(mentor, b, { stars: 5 })).error, 'window_closed');
    const v = await view(sam, b);
    assert.equal(v.canRate, false);
    assert.equal(v.rateable, true);
    await ageAnswer(b, 29);
  });

  test('the clock starts when the buyer can first read the answer: after the check, not when it was written', async () => {
    const sam = askers.sam;
    const b = await answered(sam, mentor, mentorId, 'Which conferences should a beginner attend each year?');
    // written 20 days ago, but only released (readable) a day ago
    await pool.query(`UPDATE bookings SET answered_at = now() - interval '20 days', answer_released_at = now() - interval '1 day' WHERE id = $1`, [b]);
    assert.equal((await post(sam, b, { stars: 5, review: 'Helpful, thank you.' })).status, 201);
    const v = await view(mentor, b);
    assert.equal(v.theirs, null, 'not revealed: only one day since the buyer could read it');
    const days = (new Date(v.revealsAt) - Date.now()) / 86400000;
    assert.ok(days > 5.9 && days < 6.1, `reveals in about 6 days (${days})`);
    await ageAnswer(b, 8);
  });

  test('the sweep job reveals what is due and does not need anybody to look', async () => {
    const sam = askers.sam;
    const b = await answered(sam, mentor, mentorId, 'How do I find a good mentor at a hospital?');
    await post(sam, b, { stars: 5, review: 'Excellent advice.' });
    await ageAnswer(b, 8);
    for (let i = 0; i < 30; i++) { // (the sweep runs every second in this test server)
      if ((await ratingRow(b, 'asker_to_mentor')).revealed_at) break;
      await wait(250);
    }
    assert.ok((await ratingRow(b, 'asker_to_mentor')).revealed_at, 'revealed by the job');
  });
});

describe('a mentor\'s public review page', () => {
  test('lists written reviews newest first with the reviewer, counts every rating and every tag', async () => {
    const rv = await reviews();
    assert.ok(rv.reviews.length >= 3);
    const newest = (await pool.query(`SELECT id FROM ratings WHERE ratee_id = $1 AND direction = 'asker_to_mentor' AND revealed_at IS NOT NULL AND hidden_at IS NULL AND review <> '' ORDER BY revealed_at DESC, submitted_at DESC LIMIT 1`, [mentorId])).rows[0].id;
    assert.equal(rv.reviews[0].id, newest, 'the most recently revealed review comes first');
    assert.ok(rv.summary.count >= rv.reviews.length);
    assert.ok(rv.summary.avg >= 1 && rv.summary.avg <= 5);
    assert.equal(Object.values(rv.summary.distribution).reduce((a, b) => a + b, 0), rv.summary.count);
    assert.ok(rv.summary.tags.clear >= 1 && rv.summary.tags.fast >= 1, JSON.stringify(rv.summary.tags));
  });

  test('a star-only rating counts in the numbers but has no written review to show', async () => {
    const before = (await reviews()).summary.count;
    const shown = (await reviews()).reviews.length;
    const b = await answered(askers.sam, mentor, mentorId, 'Should I learn a second language for this work?');
    await ageAnswer(b, 8);
    assert.equal((await post(askers.sam, b, { stars: 2 })).status, 201);
    const rv = await reviews();
    assert.equal(rv.summary.count, before + 1);
    assert.equal(rv.reviews.length, shown, 'no text, so no card');
  });

  test('an asker whose profile is private is shown as "Anonymous asker"', async () => {
    const shy = await newAsker('shy', 'Shy Person');
    assert.equal((await shy.api('/me', { method: 'PATCH', body: { profileVisibility: 'contacts' } })).status, 200);
    const b = await answered(shy);
    await ageAnswer(b, 8);
    assert.equal((await post(shy, b, { stars: 5, review: 'A review from somebody who prefers privacy.' })).status, 201);
    const card = (await reviews()).reviews.find((r) => r.review.startsWith('A review from somebody'));
    assert.ok(card);
    assert.equal(card.reviewer, null);
    assert.doesNotMatch(JSON.stringify(await reviews()), /Shy Person|shy@example\.com/);
  });

  test('a hidden mentor page (not listed) has no reviews to read', async () => {
    assert.equal((await anon().api(`/experts/${'00000000-0000-0000-0000-000000000000'}/reviews`)).status, 404);
  });
});

describe('the mentor\'s public reply', () => {
  let reviewId, otherMentor, hiddenBooking;
  before(async () => {
    reviewId = (await reviews()).reviews.find((r) => r.review === 'Excellent advice.').id;
    otherMentor = await signupByEmail(resend, base, 'Other Mentor', 'other-mentor@example.com');
    const b = await answered(askers.sam, mentor, mentorId, 'A question whose rating stays private for now?');
    await post(askers.sam, b, { stars: 5, review: 'Still hidden.' });
    hiddenBooking = b;
  });

  test('the mentor of the review may reply once, in public; nobody else may', async () => {
    assert.equal((await askers.sam.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'I write about myself.' } })).status, 403);
    assert.equal((await otherMentor.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'Not my review.' } })).status, 403);
    assert.equal((await anon().api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'Visitor.' } })).status, 401);
    assert.equal((await mentor.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: '   ' } })).error, 'empty');
    assert.equal((await mentor.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'x'.repeat(1001) } })).error, 'too_long');
    const ok = await mentor.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'Thank you, I am glad it helped!' } });
    assert.equal(ok.status, 201);
    assert.equal((await mentor.api(`/ratings/${reviewId}/reply`, { method: 'POST', body: { body: 'A second reply.' } })).error, 'already_replied');
    const card = (await reviews()).reviews.find((r) => r.id === reviewId);
    assert.equal(card.reply.body, 'Thank you, I am glad it helped!');
    // the asker sees it on their own rating too
    const b = (await pool.query('SELECT booking_id FROM ratings WHERE id = $1', [reviewId])).rows[0].booking_id;
    assert.equal((await view(askers.sam, b)).mine.reply, 'Thank you, I am glad it helped!');
  });

  test('a review that is not public yet cannot be replied to or reported', async () => {
    const id = (await ratingRow(hiddenBooking, 'asker_to_mentor')).id;
    assert.equal((await mentor.api(`/ratings/${id}/reply`, { method: 'POST', body: { body: 'Early reply.' } })).error, 'not_available');
    assert.equal((await otherMentor.api(`/ratings/${id}/report`, { method: 'POST', body: { reason: 'spam' } })).status, 404);
    assert.equal((await mentor.api(`/ratings/nonsense/reply`, { method: 'POST', body: { body: 'x' } })).status, 404);
  });
});

describe('reports and admin moderation', () => {
  let target, reporter;
  before(async () => {
    reporter = await newAsker('reporter', 'Rita Reporter');
    const b = await answered(askers.sam, mentor, mentorId, 'Any advice on handling exam stress in medical school?');
    await ageAnswer(b, 8);
    assert.equal((await post(askers.sam, b, { stars: 1, tags: [], review: 'This is a rude and unfair review with a phone number 555 123.' })).status, 201);
    target = (await ratingRow(b, 'asker_to_mentor')).id;
  });

  test('anybody signed in can report a public review, once; not their own; with a valid reason', async () => {
    assert.equal((await anon().api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'abusive' } })).status, 401);
    assert.equal((await reporter.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'nonsense' } })).error, 'invalid_reason');
    assert.equal((await reporter.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'abusive', details: 'x'.repeat(1001) } })).error, 'details_too_long');
    assert.equal((await askers.sam.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'abusive' } })).status, 404, 'not your own review');
    assert.equal((await reporter.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'personal_info', details: 'It has a phone number in it.' } })).status, 201);
    assert.equal((await reporter.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'abusive' } })).error, 'already_reported');
    assert.equal((await mentor.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'false', details: 'This never happened.' } })).status, 201, 'the mentor can report it too');
    await resend.waitFor('qa-admin@example.com', 'review was reported');
  });

  test('the admin sees the queue with the review, the reason and who reported; nobody else may', async () => {
    assert.equal((await mentor.api('/admin/reviews')).error, 'not_admin');
    assert.equal((await anon().api('/admin/reviews')).status, 401);
    const q = await admin.api('/admin/reviews');
    assert.equal(q.status, 200);
    const mine = q.reports.filter((r) => r.ratingId === target);
    assert.equal(mine.length, 2);
    assert.ok(mine.some((r) => r.reason === 'personal_info' && r.reporter.email === 'reporter@example.com' && r.details.includes('phone number')));
    assert.equal(mine[0].rating.stars, 1);
    assert.match(mine[0].rating.review, /rude and unfair/);
    assert.equal(mine[0].rating.rater.email, 'sam@example.com');
  });

  test('hiding needs a written reason; then it is gone from the profile and from the numbers, and the reports are closed', async () => {
    const before = await reviews();
    assert.equal((await admin.api(`/admin/reviews/${target}/hide`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    assert.equal((await mentor.api(`/admin/reviews/${target}/hide`, { method: 'POST', body: { reason: 'I do not like it' } })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/reviews/${target}/hide`, { method: 'POST', body: { reason: 'Contains a phone number and is abusive' } })).status, 200);
    const after = await reviews();
    assert.equal(after.summary.count, before.summary.count - 1);
    assert.ok(!after.reviews.some((r) => r.id === target));
    assert.notEqual(after.summary.avg, before.summary.avg);
    assert.equal((await anon().api(`/experts/${mentorId}`)).expert.reviewCount, after.summary.count);
    const q = await admin.api('/admin/reviews');
    assert.equal(q.reports.filter((r) => r.ratingId === target).length, 0, 'reports about it are closed');
    const h = q.hidden.find((x) => x.id === target);
    assert.equal(h.reason, 'Contains a phone number and is abusive');
    assert.equal(h.by, 'qa-admin@example.com');
    const log = (await pool.query('SELECT * FROM rating_audit WHERE rating_id = $1', [target])).rows;
    assert.deepEqual(log.map((l) => [l.action, l.by_email]), [['hidden', 'qa-admin@example.com']]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM review_reports WHERE rating_id = $1 AND status = 'resolved' AND resolution = 'hidden'`, [target])).rows[0].n, 2);
    // a hidden review can no longer be reported or replied to
    assert.equal((await reporter.api(`/ratings/${target}/report`, { method: 'POST', body: { reason: 'spam' } })).status, 404);
    assert.equal((await admin.api(`/admin/reviews/${target}/hide`, { method: 'POST', body: { reason: 'Hiding it again for no reason' } })).status, 404);
  });

  test('unhiding brings it back (with a reason, also logged)', async () => {
    assert.equal((await admin.api(`/admin/reviews/${target}/unhide`, { method: 'POST', body: { reason: 'ok' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/reviews/${target}/unhide`, { method: 'POST', body: { reason: 'The reviewer removed the phone number' } })).status, 200);
    assert.ok((await reviews()).reviews.some((r) => r.id === target));
    assert.deepEqual((await pool.query('SELECT action FROM rating_audit WHERE rating_id = $1 ORDER BY created_at', [target])).rows.map((r) => r.action), ['hidden', 'unhidden']);
  });

  test('a report can also be dismissed, with a reason', async () => {
    const b = await answered(askers.sam, mentor, mentorId, 'How long does it take to become a consultant?');
    await ageAnswer(b, 8);
    await post(askers.sam, b, { stars: 4, review: 'Good answer, slightly slow.' });
    const id = (await ratingRow(b, 'asker_to_mentor')).id;
    await reporter.api(`/ratings/${id}/report`, { method: 'POST', body: { reason: 'other' } });
    const rep = (await admin.api('/admin/reviews')).reports.find((r) => r.ratingId === id);
    assert.equal((await admin.api(`/admin/review-reports/${rep.id}/resolve`, { method: 'POST', body: { decision: 'nonsense', reason: 'A long enough reason' } })).error, 'invalid_decision');
    assert.equal((await admin.api(`/admin/review-reports/${rep.id}/resolve`, { method: 'POST', body: { decision: 'dismiss', reason: 'x' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/review-reports/${rep.id}/resolve`, { method: 'POST', body: { decision: 'dismiss', reason: 'A fair review, nothing wrong with it' } })).status, 200);
    assert.ok((await reviews()).reviews.some((r) => r.id === id), 'still public');
    assert.equal((await admin.api(`/admin/review-reports/${rep.id}/resolve`, { method: 'POST', body: { decision: 'dismiss', reason: 'A fair review, nothing wrong with it' } })).status, 404, 'closed once');
  });
});

describe('asking well: how mentors rate askers', () => {
  let dana, ids = [];
  const rateAsker = async (b, stars, tags) => { await ageAnswer(b, 8); return post(mentor, b, { stars, tags }); };

  test('a mentor sees the asker\'s rating on the question in their dashboard, from the first rating on', async () => {
    dana = await newAsker('dana', 'Dana Askerson');
    const b1 = await answered(dana, mentor, mentorId, 'What certificates matter most for a junior doctor?');
    let received = (await mentor.api('/bookings/mine')).received.find((x) => x.id === b1);
    assert.equal(received.askerRating, null, 'a new asker has no rating yet');
    assert.equal((await rateAsker(b1, 5, ['clear_question', 'respectful'])).status, 201);
    const b2 = await answered(dana, mentor, mentorId, 'Which textbooks do you recommend for the first year?');
    received = (await mentor.api('/bookings/mine')).received.find((x) => x.id === b2);
    assert.equal(received.askerRating.count, 1);
    assert.equal(received.askerRating.avg, 5);
    assert.deepEqual(received.askerRating.topTags.map((t) => t.tag).sort(), ['clear_question', 'respectful']);
    ids = [b1, b2];
  });

  test('on their public profile there is no rating at all under 3 ratings', async () => {
    assert.equal((await anon().api('/users/dana-askerson')).profile.asker, null);
    await rateAsker(ids[1], 4, ['gave_context']);
    assert.equal((await anon().api('/users/dana-askerson')).profile.asker, null, 'two ratings are still not enough');
  });

  test('from 3 ratings on: a friendly badge and the top tags, never the individual ratings or notes', async () => {
    const b3 = await answered(dana, mentor, mentorId, 'How do I prepare for an interview with a hospital board?');
    await rateAsker(b3, 5, ['clear_question', 'thankful']);
    const p = (await anon().api('/users/dana-askerson')).profile;
    assert.equal(p.asker.count, 3);
    assert.equal(p.asker.avg, 4.7);
    assert.equal(p.asker.great, true);
    assert.equal(p.asker.topTags[0].tag, 'clear_question');
    assert.equal(p.asker.topTags[0].count, 2);
    assert.deepEqual(Object.keys(p.asker).sort(), ['avg', 'count', 'great', 'topTags']);
    assert.doesNotMatch(JSON.stringify(p), /Dr Mentor|mentor@example|privateNote|private_note/);
  });

  test('an average under 2.5 after 3 ratings opens a flag for the admins (and 2 ratings do not)', async () => {
    const carl = await newAsker('carl', 'Carl Careless');
    const bs = [];
    for (let i = 0; i < 3; i++) bs.push(await answered(carl, mentor, mentorId, `Question number ${i + 1} typed in a big hurry?`));
    await rateAsker(bs[0], 1, []);
    await rateAsker(bs[1], 2, []);
    assert.equal((await openFlags((await carl.api('/me')).user.id, 'asker_low_rating')).length, 0, 'two ratings: too early');
    await rateAsker(bs[2], 2, []); // 1,2,2 -> 1.7
    const carlId = (await carl.api('/me')).user.id;
    const flag = (await openFlags(carlId, 'asker_low_rating'))[0];
    assert.ok(flag, 'flagged');
    assert.equal(Number(flag.detail.average), 1.7);
    await resend.waitFor('qa-admin@example.com', 'low rating');
    const q = await admin.api('/admin/reviews');
    const row = q.askers.find((a) => a.userId === carlId);
    assert.equal(row.average, 1.7);
    assert.equal(row.email, 'carl@example.com');
    assert.equal((await admin.api(`/admin/flags/${row.flagId}/resolve`, { method: 'POST', body: { reason: 'Looked at the questions: fine' } })).status, 200);
    assert.equal((await openFlags(carlId, 'asker_low_rating')).length, 0);
    // three low-ish stars is not a public badge either way: the badge is friendly
    assert.equal((await anon().api('/users/carl-careless')).profile.asker.great, false);
  });

  test('an exactly-2.5 average is not flagged', async () => {
    const eli = await newAsker('eli', 'Eli Edge');
    const eliId = (await eli.api('/me')).user.id;
    for (const [i, stars] of [3, 2, 3, 2].entries()) {
      const b = await answered(eli, mentor, mentorId, `Edge case question number ${i + 1}?`);
      await rateAsker(b, stars, []);
    }
    assert.equal((await openFlags(eliId, 'asker_low_rating')).length, 0);
  });
});

describe('reminder emails after 2 and after 6 days', () => {
  let ada, adaBooking;
  const mails = (to) => resend.to(to, 'rate your Wisecall question');
  before(async () => {
    ada = await newAsker('ada', 'Ada Reminder');
    adaBooking = await answered(ada, mentor, mentorId, 'A question that will be followed by reminders?');
  });

  test('nothing is sent before day 2', async () => {
    await ageAnswer(adaBooking, 1.5);
    await wait(2500);
    assert.equal(mails('ada@example.com').length, 0);
  });

  test('after 2 days both people who have not rated get one email, in their language, with the link to the dashboard', async () => {
    await ada.api('/me', { method: 'PATCH', body: { language: 'ka' } });
    await ageAnswer(adaBooking, 2.5);
    await resend.waitFor('ada@example.com', 'შეაფასე', 10000);
    const toAsker = resend.to('ada@example.com', 'შეაფასე');
    assert.equal(toAsker.length, 1);
    assert.match(toAsker[0].body.html, /როგორი იყო პასუხი/);
    assert.match(toAsker[0].body.html, /Dr Mentor/);
    assert.match(toAsker[0].body.html, /\/dashboard\.html/);
    assert.doesNotMatch(toAsker[0].body.html, /ბოლო შეხსენებაა/, 'the first one is not the last');
    const forAda = () => resend.to('mentor@example.com', 'rate your Wisecall question').filter((m) => /Ada Reminder/.test(m.body.html));
    for (let i = 0; i < 40 && forAda().length < 1; i++) await wait(250); // (the two emails are sent one after the other)
    const toMentor = forAda();
    assert.equal(toMentor.length, 1);
    assert.match(toMentor[0].body.html, /How was the question from Ada Reminder/);
  });

  test('a person who has already rated is not reminded; the others get the last reminder at day 6, once', async () => {
    assert.equal((await post(mentor, adaBooking, { stars: 5, tags: ['respectful'] })).status, 201);
    await ageAnswer(adaBooking, 6.5);
    for (let i = 0; i < 30 && resend.to('ada@example.com', 'შეაფასე').length < 2; i++) await wait(250);
    const toAsker = resend.to('ada@example.com', 'შეაფასე');
    assert.equal(toAsker.length, 2, 'the second and last one');
    assert.match(toAsker[1].body.html, /ბოლო შეხსენებაა/);
    assert.equal(resend.to('mentor@example.com', 'rate your Wisecall question').filter((m) => /Ada Reminder/.test(m.body.html)).length, 1, 'the mentor had rated: no last reminder');
    await wait(2500);
    assert.equal(resend.to('ada@example.com', 'შეაფასე').length, 2, 'never twice');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM rating_reminders WHERE booking_id = $1', [adaBooking])).rows[0].n, 3);
  });

  test('after the 30 days nobody is reminded', async () => {
    const ben = await newAsker('ben', 'Ben Late');
    const b = await answered(ben, mentor, mentorId, 'A question nobody rates in time?');
    await ageAnswer(b, 31);
    await wait(3000);
    assert.equal(mails('ben@example.com').length, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM rating_reminders WHERE booking_id = $1', [b])).rows[0].n, 0);
  });
});

describe('the reviews that existed before ratings were double-blind', () => {
  test('are kept, as revealed ratings from asker to mentor', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '015_ratings.sql'), 'utf8');
    const copy = sql.slice(sql.lastIndexOf('INSERT INTO ratings'));
    const b = await answered(await newAsker('old', 'Old Reviewer'), mentor, mentorId, 'A question reviewed in the old way, long ago?');
    await pool.query(`UPDATE bookings SET rating = 4, review = 'An old review.', reviewed_at = now() - interval '40 days' WHERE id = $1`, [b]);
    await pool.query(copy);
    const r = await ratingRow(b, 'asker_to_mentor');
    assert.equal(r.stars, 4);
    assert.equal(r.review, 'An old review.');
    assert.ok(r.revealed_at, 'it was public, so it stays public');
    assert.deepEqual(r.tags, []);
    await pool.query('DELETE FROM ratings WHERE booking_id = $1', [b]);
  });
});

describe('texts', () => {
  test('every new text is in English and Georgian, with the same placeholders', () => {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
    const ka = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
    const keys = Object.keys(en).filter((k) => /^(rate\.|admin\.rv\.|report\.review\.|dash\.rate\.)/.test(k));
    assert.ok(keys.length > 50, `only ${keys.length} rating texts`);
    const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) {
      assert.ok(ka[k], `${k} has no Georgian text`);
      assert.notEqual(ka[k], en[k], `${k} is not translated`);
      assert.equal(holes(ka[k]), holes(en[k]), `${k}: different {placeholders}`);
    }
  });

  test('the Terms have the review rules (EN and KA) and the lawyer is asked to check them', () => {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
    const ka = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
    const sec = (d) => d['legal.terms.sections'].find((s) => /Ratings and reviews|შეფასებები და მიმოხილვები/.test(s.h));
    assert.ok(sec(en) && sec(ka), 'a section about ratings and reviews');
    assert.match(sec(en).p.join(' '), /7 days/);
    assert.match(sec(en).p.join(' '), /hide/i);
    const nums = (d) => d['legal.terms.sections'].map((s) => Number(s.h.match(/^(\d+)\./)[1]));
    assert.deepEqual(nums(en), nums(en).map((_, i) => i + 1), 'the sections are numbered 1..n in English');
    assert.deepEqual(nums(ka), nums(ka).map((_, i) => i + 1), 'and in Georgian');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'LEGAL-REVIEW.md'), 'utf8'), /Ratings and reviews/);
  });
});
