// Public answers (PART 7A): published only when the asker (after a 4–5★ rating) AND the mentor agreed AND an admin approved; the question
// is cleaned of names, emails, phones, links, @handles and long numbers; either person can withdraw (410 Gone); a regulated field needs
// the admin's explicit permission; nothing unpublished is reachable or indexed; "Helpful" counts once per visitor.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE } = require('./helpers');
const { redact } = require('../server/publicAnswers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId, doctor, doctorId;

async function answeredAndRated(m, mId, stars, question) {
  const b = await bookAndPay(base, asker, mId, question);
  assert.equal((await m.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with one small project and finish it.') } })).status, 200);
  await pool.query(`UPDATE bookings SET answered_at = now() - interval '8 days' WHERE id = $1`, [b.id]);
  assert.equal((await asker.api(`/bookings/${b.id}/ratings`, { method: 'POST', body: { stars } })).status, 201);
  return b.id;
}
const paOf = async (who, bookingId) => {
  const mine = await who.api('/bookings/mine');
  return [...mine.asked, ...mine.received].find((b) => b.id === bookingId).publicAnswer;
};

before(async () => {
  await resetDatabase();
  srv = await startServer(4726, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupVerified(base, 'Nino Beridze', 'nino@example.com');
  mentor = await signupVerified(base, 'Giorgi Kapanadze', 'giorgi@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 20, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Giorgi Kapanadze');
  doctor = await signupVerified(base, 'Doctor Dali', 'dali@example.com');
  await doctor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'medicine', price: 20, sampleAnswer: SAMPLE } });
  doctorId = await approveMentor(admin, doctor);
  await addPayoutDetails(doctor, undefined, 'Doctor Dali');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('cleaning the question', () => {
  test('names, emails, phones, links, @handles and IBAN-like numbers are removed', () => {
    const s = redact('Hi Giorgi, I am Nino Beridze (nino.b@mail.ge, +995 599 12 34 56, @nino_b, www.nino.ge, GE29NB0000000101904917). How do I start?', ['Nino Beridze', 'Giorgi Kapanadze']);
    assert.doesNotMatch(s, /Nino|Beridze|Giorgi|nino\.b@|599|@nino_b|www\.nino|GE29/);
    assert.match(s, /\[name\].*\[email\].*\[number\].*\[handle\].*\[link\].*\[number\]/);
    assert.match(s, /How do I start\?/);
    assert.equal(redact('ნინო ბერიძე ვარ, რას მირჩევ?', ['ნინო ბერიძე']), '[name] ვარ, რას მირჩევ?', 'Georgian names too');
  });
});

describe('consent', () => {
  let bookingId;
  test('only after a 4–5★ rating can the asker offer it, with the question already cleaned', async () => {
    const low = await answeredAndRated(mentor, mentorId, 3, 'How should Nino Beridze plan the first year as a developer?');
    assert.equal(await paOf(asker, low), null, 'no offer under 4 stars');
    assert.equal((await asker.api('/answers/offer', { method: 'POST', body: { bookingId: low } })).error, 'rating_needed');
    bookingId = await answeredAndRated(mentor, mentorId, 5, 'I am Nino Beridze: how should I plan my first year as a developer?');
    // (a question from before contact details were refused in questions: the draft still cleans it)
    await pool.query('UPDATE bookings SET question = $2 WHERE id = $1', [bookingId, 'I am Nino Beridze, call me on 599123456: how should I plan my first year as a developer?']);
    const offer = await paOf(asker, bookingId);
    assert.equal(offer.canOffer, true);
    assert.doesNotMatch(offer.draft, /Nino|599123456/);
    assert.equal(await paOf(mentor, bookingId), null, 'the mentor sees nothing until the asker agrees');
  });

  test('the asker alone is not enough; the mentor agrees (and may edit); then it waits for an admin, still not public', async () => {
    const r = await asker.api('/answers/offer', { method: 'POST', body: { bookingId, question: 'How should I plan my first year as a developer? My email is me@example.com' } });
    assert.equal(r.status, 201);
    assert.equal(r.publicAnswer.status, 'pending_mentor');
    assert.doesNotMatch(r.publicAnswer.question, /me@example\.com/, 'cleaned again on the server');
    const forMentor = await paOf(mentor, bookingId);
    assert.equal(forMentor.status, 'pending_mentor');
    assert.equal((await asker.api(`/answers/${forMentor.id}/mentor`, { method: 'POST', body: { agree: true } })).status, 404, 'only the mentor decides for the mentor');
    const ok = await mentor.api(`/answers/${forMentor.id}/mentor`, { method: 'POST', body: { agree: true, answer: longAnswer('Finish one real project before you learn the next tool.') } });
    assert.equal(ok.publicAnswer.status, 'pending_review');
    assert.deepEqual((await client(base).api('/answers')).answers, [], 'nothing public before an admin approves');
  });

  test('an admin approves it: the page exists, in both languages, with structured data; the list and the sitemap show it', async () => {
    const { queue } = await admin.api('/admin/public-answers');
    assert.equal(queue.length, 1);
    assert.equal((await asker.api(`/admin/public-answers/${queue[0].id}/approve`, { method: 'POST' })).status, 403);
    const p = await admin.api(`/admin/public-answers/${queue[0].id}/approve`, { method: 'POST', body: {} });
    assert.equal(p.status, 200);
    const slug = p.publicAnswer.slug;
    assert.match(slug, /^how-should-i-plan-my-first-year-as-[0-9a-f]{6}$/, "the first 8 words and a short id");
    const page = await fetch(`${base}/answers/${slug}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /"@type":"QAPage"/);
    assert.match(html, /Finish one real project/);
    assert.match(html, /name="robots" content="index, follow"/);
    assert.doesNotMatch(html, /Nino|Beridze/, 'the asker is never named');
    assert.match(await (await fetch(`${base}/ka/answers/${slug}`)).text(), /<html lang="ka"/);
    assert.equal((await client(base).api('/answers')).answers.length, 1);
    assert.match(await (await fetch(`${base}/sitemap.xml`)).text(), new RegExp(`/answers/${slug}`));
    // Helpful: once per visitor.
    const visitor = 'a'.repeat(32);
    assert.equal((await client(base).api(`/answers/${slug}/helpful`, { method: 'POST', body: { visitor } })).helpful, 1);
    assert.equal((await client(base).api(`/answers/${slug}/helpful`, { method: 'POST', body: { visitor } })).helpful, 1, 'the same visitor again');
    assert.equal((await client(base).api(`/answers/${slug}/helpful`, { method: 'POST', body: { visitor: 'b'.repeat(32) } })).helpful, 2);
  });

  test('either person can withdraw it: the page is gone at once (410) and leaves the list and the sitemap', async () => {
    const pa = await paOf(asker, bookingId);
    assert.equal(pa.status, 'published');
    assert.equal((await asker.api(`/answers/${pa.id}/withdraw`, { method: 'POST' })).status, 200);
    const page = await fetch(`${base}/answers/${pa.slug}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /name="robots" content="noindex"/);
    assert.equal((await client(base).api('/answers')).answers.length, 0);
    assert.doesNotMatch(await (await fetch(`${base}/sitemap.xml`)).text(), new RegExp(pa.slug));
  });

  test('a mentor who never publishes is never asked; one who always allows skips the question', async () => {
    await mentor.api('/me', { method: 'PATCH', body: { publicAnswersPref: 'never' } });
    const never = await answeredAndRated(mentor, mentorId, 5, 'Which laptop should I buy for web development on a small budget?');
    assert.equal(await paOf(asker, never), null);
    await mentor.api('/me', { method: 'PATCH', body: { publicAnswersPref: 'always' } });
    const always = await answeredAndRated(mentor, mentorId, 4, 'Should I learn TypeScript before my first job or after it?');
    const r = await asker.api('/answers/offer', { method: 'POST', body: { bookingId: always } });
    assert.equal(r.publicAnswer.status, 'pending_review', 'straight to the admin');
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { publicAnswersPref: 'sometimes' } })).status, 400);
  });
});

describe('the admin and regulated fields', () => {
  test('a regulated field is published only when the admin explicitly allows it, and the page says it is not professional advice', async () => {
    await doctor.api('/me', { method: 'PATCH', body: { publicAnswersPref: 'always' } });
    const b = await answeredAndRated(doctor, doctorId, 5, 'How do I prepare for a long night shift as a junior doctor in a busy hospital?');
    assert.equal((await asker.api('/answers/offer', { method: 'POST', body: { bookingId: b } })).status, 201);
    const item = (await admin.api('/admin/public-answers')).queue.find((x) => x.regulated);
    assert.ok(item);
    assert.equal((await admin.api(`/admin/public-answers/${item.id}/approve`, { method: 'POST', body: {} })).error, 'regulated_needs_permission');
    const ok = await admin.api(`/admin/public-answers/${item.id}/approve`, { method: 'POST', body: { allowRegulated: true } });
    assert.equal(ok.status, 200);
    assert.match(await (await fetch(`${base}/answers/${ok.publicAnswer.slug}`)).text(), /not medical, legal or financial advice/);
  });

  test('an admin can refuse with a reason; an unknown or unpublished answer is simply not found', async () => {
    const left = (await admin.api('/admin/public-answers')).queue[0];
    assert.equal((await admin.api(`/admin/public-answers/${left.id}/reject`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/public-answers/${left.id}/reject`, { method: 'POST', body: { reason: 'Too personal to publish.' } })).status, 200);
    assert.equal((await fetch(`${base}/answers/not-a-real-answer-123456`)).status, 404);
    assert.equal((await fetch(`${base}/answers.html`)).status, 404, 'the raw template is not served');
  });

  test('closing an account takes its public answers down at once', async () => {
    const live = (await client(base).api('/answers')).answers;
    assert.equal(live.length, 1, "the doctor's answer, asked by Nino");
    const del = await asker.api('/me', { method: 'DELETE', body: { password: 'test-pass-12345' } });
    assert.equal(del.status, 200, del.text);
    assert.equal((await client(base).api('/answers')).answers.length, 0);
    assert.equal((await fetch(`${base}/answers/${live[0].slug}`)).status, 410);
  });
});
