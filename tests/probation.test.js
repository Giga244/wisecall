// A new mentor's first answers are held for an admin; and buyers can report a mentor.
// Probation is set to 2 answers here (PROBATION_ANSWERS) so the test stays short.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, addPayoutDetails, approveMentor, bookAndPay, wait, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, seeker2, mentor, mentorId, other, otherId;

async function listedMentor(name, email, niche = 'design') {
  const c = await signupByEmail(resend, base, name, email);
  const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  assert.equal(r.status, 200, r.text);
  await addPayoutDetails(c);
  return { c, id: await approveMentor(admin, c) };
}
const answer = (m, bookingId, text = 'Here is my detailed answer to your question.') => m.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: text } });
const row = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const payoutOf = async (id) => (await pool.query('SELECT * FROM payouts WHERE booking_id = $1', [id])).rows[0];
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); }
}
const asked = async (c, id) => (await c.api('/bookings/mine')).asked.find((b) => b.id === id);

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4583, {
    PROBATION_ANSWERS: '2', SWEEP_INTERVAL_SECONDS: '1',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: ''
  });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupByEmail(resend, base, 'Sam Seeker', 'sam@example.com');
  seeker2 = await signupByEmail(resend, base, 'Sara Seeker', 'sara@example.com');
  const m = await listedMentor('Nino Beridze', 'nino@example.com');
  mentor = m.c; mentorId = m.id;
  const o = await listedMentor('Levan Other', 'levan@example.com');
  other = o.c; otherId = o.id;
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('probation: the first answers are held', () => {
  let first, second, third;

  test('the default is five answers; the variable exists only for tests', () => {
    const out = spawnSync('node', ['-e', "console.log(require('./server/verification/rules').LIMITS.probationAnswers)"], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PROBATION_ANSWERS: '' }, encoding: 'utf8'
    });
    assert.equal(out.stdout.trim(), '5');
  });

  test('the first answer is saved but hidden from the buyer, with no email and no payout yet', async () => {
    first = await bookAndPay(base, seeker, mentorId, 'How do I get my first design clients?');
    assert.equal(first.status, 'paid');
    const r = await answer(mentor, first.id);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.booking.answerHeld, true);
    assert.equal(r.booking.answer, 'Here is my detailed answer to your question.', 'the mentor sees their own answer');

    const b = await asked(seeker, first.id);
    assert.equal(b.status, 'answered');
    assert.equal(b.answer, null, 'the buyer cannot see it yet');
    assert.equal(b.answerHeld, true);
    assert.equal((await seeker.api(`/bookings/${first.id}`)).booking.answer, null);
    assert.doesNotMatch((await seeker.api('/bookings/mine')).text, /detailed answer/);
    assert.equal(await payoutOf(first.id), undefined, 'no payout row while held');
    assert.equal(resend.to('sam@example.com', 'answered your question').length, 0, 'the buyer is not emailed yet');
    assert.equal((await seeker.api(`/bookings/${first.id}/ratings`, { method: 'POST', body: { stars: 5 } })).error, 'not_rateable', 'no rating of an answer they cannot see');

    const mine = (await mentor.api('/bookings/mine')).received.find((x) => x.id === first.id);
    assert.equal(mine.answerHeld, true);
  });

  test('the admin queue shows it with the mentor and which answer it is', async () => {
    assert.equal((await seeker.api('/admin/answers')).error, 'not_admin');
    const q = await admin.api('/admin/answers');
    assert.equal(q.answers.length, 1);
    assert.equal(q.answers[0].id, first.id);
    assert.equal(q.answers[0].answerNumber, 1);
    assert.equal(q.answers[0].of, 2);
    assert.equal(q.answers[0].mentor.email, 'nino@example.com');
    assert.equal(q.answers[0].answer, 'Here is my detailed answer to your question.');
    assert.ok(new Date(q.answers[0].heldUntil) > new Date(Date.now() + 23 * 3600000), 'held for about 24 hours');
  });

  test('approving releases it: the buyer sees it and is emailed, and the payout hold starts now', async () => {
    assert.equal((await mentor.api(`/admin/answers/${first.id}/approve`, { method: 'POST' })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/answers/${first.id}/approve`, { method: 'POST' })).status, 200);
    const b = await asked(seeker, first.id);
    assert.equal(b.answer, 'Here is my detailed answer to your question.');
    assert.equal(b.answerHeld, false);
    await resend.waitFor('sam@example.com', 'answered your question');
    const p = await payoutOf(first.id);
    assert.ok(p, 'payout row created at release');
    const days = (new Date(p.payable_at) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days <= 7.01, `payable in about 7 days (${days})`);
    assert.equal((await admin.api(`/admin/answers/${first.id}/approve`, { method: 'POST' })).error, 'not_found', 'nothing to approve twice');
    assert.equal((await seeker.api(`/bookings/${first.id}/ratings`, { method: 'POST', body: { stars: 5, review: 'Helpful' } })).status, 201);
    const log = (await admin.api(`/admin/mentors/${mentorId}/verification`)).audit.map((a) => a.action);
    assert.ok(log.includes('answer_released'));
  });

  test('a flagged answer is never released on its own; rejecting it refunds the buyer', async () => {
    second = await bookAndPay(base, seeker2, mentorId, 'What should I put in my portfolio?');
    assert.equal((await answer(mentor, second.id, 'Buy my course at spam.example, it is the best!')).booking.answerHeld, true);
    assert.equal((await admin.api(`/admin/answers/${second.id}/flag`, { method: 'POST' })).status, 200);
    await pool.query(`UPDATE bookings SET answer_held_until = now() - interval '1 hour' WHERE id = $1`, [second.id]);
    await wait(3500); // three sweeps
    assert.equal((await row(second.id)).answer_review, 'held', 'the time is up but it was flagged');
    assert.equal((await asked(seeker2, second.id)).answer, null);

    assert.equal((await admin.api(`/admin/answers/${second.id}/reject`, { method: 'POST', body: { reason: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/answers/${second.id}/reject`, { method: 'POST', body: { reason: 'It is an advert, not an answer' } })).status, 200);
    const b = await row(second.id);
    assert.equal(b.answer_review, 'rejected');
    assert.ok(['refund_pending', 'refunded'].includes(b.status), `refunded (${b.status})`);
    assert.equal(b.refund_reason, 'answer_rejected');
    assert.equal(await payoutOf(second.id), undefined, 'the mentor earns nothing for it');
    const mail = await resend.waitFor('sara@example.com', 'refunded');
    assert.match(mail.body.text, /did not meet our standards/);
    assert.equal((await admin.api('/admin/answers')).answers.length, 0);
  });

  test('after the probation answers, answers go straight to the buyer', async () => {
    third = await bookAndPay(base, seeker, mentorId, 'How much should I charge per project?');
    const r = await answer(mentor, third.id, 'Start from your hourly rate and add a margin for revisions.');
    assert.equal(r.booking.answerHeld, false);
    assert.equal((await asked(seeker, third.id)).answer, 'Start from your hourly rate and add a margin for revisions.');
    assert.ok(await payoutOf(third.id), 'the payout is recorded at once');
    await resend.waitFor('sam@example.com', 'answered your question');
    // The public profile shows how long buyers really waited (held time counts; refunded and held answers do not).
    const expert = (await client(base).api(`/experts/${mentorId}`)).expert;
    assert.equal(typeof expert.avgAnswerSeconds, 'number');
    assert.ok(expert.avgAnswerSeconds >= 0);
    assert.equal(expert.answeredCount, 2, 'the released first answer and this one (the rejected one is not counted)');
  });

  test('an unflagged answer is released automatically once the window has passed', async () => {
    const b = await bookAndPay(base, seeker, otherId, 'Is a design degree worth it?');
    assert.equal((await answer(other, b.id, 'It depends on what you want to do next.')).booking.answerHeld, true);
    await pool.query(`UPDATE bookings SET answer_held_until = now() - interval '1 minute' WHERE id = $1`, [b.id]);
    await waitFor(async () => (await row(b.id)).answer_review === 'released');
    assert.equal((await asked(seeker, b.id)).answer, 'It depends on what you want to do next.');
    assert.ok(await payoutOf(b.id));
    const log = (await admin.api(`/admin/mentors/${otherId}/verification`)).audit.find((a) => a.action === 'answer_released');
    assert.equal(log.by, 'system');
  });

  test('a mentor with an open flag is not released automatically', async () => {
    const b = await bookAndPay(base, seeker2, otherId, 'Which tools should I learn first?');
    assert.equal((await answer(other, b.id, 'Start with Figma, then learn the basics of layout.')).booking.answerHeld, true);
    await pool.query(`INSERT INTO mentor_flags (mentor_id, kind, detail) VALUES ($1, 'low_rating', '{}')`, [otherId]);
    await pool.query(`UPDATE bookings SET answer_held_until = now() - interval '1 minute' WHERE id = $1`, [b.id]);
    await wait(3000);
    assert.equal((await row(b.id)).answer_review, 'held');
    await pool.query(`UPDATE mentor_flags SET status = 'resolved' WHERE mentor_id = $1`, [otherId]);
    await waitFor(async () => (await row(b.id)).answer_review === 'released');
  });
});

describe('suspending a mentor whose answer is still held', () => {
  test('the held answer is refunded too and never reaches the buyer', async () => {
    const fresh = await listedMentor('Held Answer', 'held@example.com');
    const b = await bookAndPay(base, seeker, fresh.id, 'Will my answer be held?');
    assert.equal((await answer(fresh.c, b.id, 'A first answer that is being checked.')).booking.answerHeld, true);
    const r = await admin.api(`/admin/mentors/${fresh.id}/suspend`, { method: 'POST', body: { reason: 'Identity could not be confirmed' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.refunded, 1);
    const row2 = await row(b.id);
    assert.equal(row2.answer_review, 'rejected');
    assert.ok(['refund_pending', 'refunded'].includes(row2.status));
    assert.equal((await asked(seeker, b.id)).answer, null, 'the buyer never sees it');
    assert.equal(await payoutOf(b.id), undefined);
    assert.equal((await admin.api('/admin/answers')).answers.some((a) => a.id === b.id), false, 'it leaves the queue');
  });
});

describe('reporting a mentor', () => {
  let bookingId;

  test('only signed-in people can report, with a valid reason', async () => {
    assert.equal((await client(base).api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'spam' } })).status, 401);
    assert.equal((await seeker.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'because' } })).error, 'invalid_reason');
    assert.equal((await seeker.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'spam', details: 'x'.repeat(1001) } })).error, 'details_too_long');
    assert.equal((await mentor.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'spam' } })).error, 'cannot_report_self');
    assert.equal((await seeker.api('/experts/11111111-1111-1111-1111-111111111111/report', { method: 'POST', body: { reason: 'spam' } })).error, 'not_found');
    assert.equal((await seeker.api(`/experts/${seeker2 && otherId}/report`, { method: 'POST', body: { reason: 'spam', bookingId: '11111111-1111-1111-1111-111111111111' } })).error, 'invalid_booking');
  });

  test('a report from an answer must be about a question the reporter asked that mentor', async () => {
    bookingId = (await asked(seeker, (await pool.query(`SELECT id FROM bookings WHERE seeker_id = (SELECT id FROM users WHERE email = 'sam@example.com') AND mentor_id = $1 LIMIT 1`, [mentorId])).rows[0].id)).id;
    assert.equal((await seeker2.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'misleading', bookingId } })).error, 'invalid_booking', 'not their question');
    assert.equal((await seeker.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'misleading', details: 'The answer contradicts itself', bookingId } })).status, 201);
  });

  test('one open report per person, and one report does not flag the mentor', async () => {
    assert.equal((await seeker.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'spam' } })).error, 'already_reported');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM mentor_flags WHERE mentor_id = $1 AND kind = 'reports'`, [mentorId])).rows[0].n, 0);
    await resend.waitFor('qa-admin@example.com', 'reported');
  });

  test('a second person reporting flags the mentor; only admins see who reported', async () => {
    assert.equal((await seeker2.api(`/experts/${mentorId}/report`, { method: 'POST', body: { reason: 'fake_credentials', details: 'Not who they say' } })).status, 201);
    const flag = (await pool.query(`SELECT * FROM mentor_flags WHERE mentor_id = $1 AND kind = 'reports' AND status = 'open'`, [mentorId])).rows[0];
    assert.ok(flag, 'flagged after two reporters');
    assert.equal(flag.detail.count, 2);

    assert.equal((await seeker.api('/admin/reports')).error, 'not_admin');
    const q = (await admin.api('/admin/reports')).reports;
    assert.equal(q.length, 2);
    assert.deepEqual(q.map((r) => r.reporter.email).sort(), ['sam@example.com', 'sara@example.com']);
    assert.equal(q[0].openForMentor, 2);
    assert.doesNotMatch((await client(base).api(`/experts/${mentorId}`)).text, /sam@example|sara@example|reporter/);
    assert.doesNotMatch((await mentor.api('/me')).text, /sam@example|sara@example|reporter/);
    const list = (await admin.api('/admin/mentors')).mentors.find((m) => m.id === mentorId);
    assert.ok(list.verification.openFlags >= 1);
  });

  test('closing a report needs a note; closing enough of them closes the flag', async () => {
    const [r1, r2] = (await admin.api('/admin/reports')).reports;
    assert.equal((await admin.api(`/admin/reports/${r1.id}/resolve`, { method: 'POST', body: { resolution: 'dismissed', note: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/reports/${r1.id}/resolve`, { method: 'POST', body: { resolution: 'maybe', note: 'Looked at it' } })).error, 'invalid_resolution');
    assert.equal((await mentor.api(`/admin/reports/${r1.id}/resolve`, { method: 'POST', body: { resolution: 'dismissed', note: 'Looked at it' } })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/reports/${r1.id}/resolve`, { method: 'POST', body: { resolution: 'dismissed', note: 'The answer was fine' } })).status, 200);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM mentor_flags WHERE mentor_id = $1 AND kind = 'reports' AND status = 'open'`, [mentorId])).rows[0].n, 0, 'one report left: the flag closes');
    assert.equal((await admin.api(`/admin/reports/${r1.id}/resolve`, { method: 'POST', body: { resolution: 'dismissed', note: 'Again' } })).error, 'not_found');
    assert.equal((await admin.api(`/admin/reports/${r2.id}/resolve`, { method: 'POST', body: { resolution: 'upheld', note: 'Credentials could not be confirmed' } })).status, 200);
    assert.equal((await admin.api('/admin/reports')).reports.length, 0);
    const log = (await admin.api(`/admin/mentors/${mentorId}/verification`)).audit.map((a) => a.action);
    for (const a of ['report_received', 'report_dismissed', 'report_upheld']) assert.ok(log.includes(a), `${a} is logged`);
  });
});
