// The server side of the fixes from the student–mentor flow review (docs/FLOW-REVIEW.md): the contact check before sending an answer (5),
// the share and the withdrawal minimum on the earnings tab (6), a 16–17-year-old's review shown with the first name only (8), and the
// Georgian emails (9, 7, 13).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, bookAndPay, rate, SAMPLE, longQuestion, longAnswer } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, minor, paid, paidId, free, freeId;

function bornAgo(years) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
async function makeMentor(name, email, price) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Career coach', niche: 'business', price, ...(price === 0 ? { freeWeeklyCap: 100 } : {}), proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  return { c, id: (await c.api('/me')).user.id };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4855, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Ana Adult', 'ana-flow@example.com');
  minor = await signupVerified(base, 'Luka Kapanadze', 'luka-flow@example.com', 'test-pass-12345', { birthYm: bornAgo(17), parentPermission: true });
  ({ c: paid, id: paidId } = await makeMentor('Nino Paid', 'nino-flow@example.com', 15));
  ({ c: free, id: freeId } = await makeMentor('Giorgi Free', 'giorgi-flow@example.com', 0));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the contact check before sending an answer', () => {
  let bookingId;
  test('the mentor of the question gets what was found, nothing is logged; anybody else gets nothing', async () => {
    const b = await bookAndPay(base, seeker, paidId, 'How do I prepare for the IELTS writing part in three months?');
    bookingId = b.id;
    const before = (await pool.query('SELECT count(*)::int AS n FROM contact_blocks')).rows[0].n;
    const found = await paid.api(`/bookings/${bookingId}/answer/check`, { method: 'POST', body: { answer: longAnswer('Write to me on Telegram @nino_ielts or call +995 555 12 34 56.') } });
    assert.equal(found.status, 200);
    assert.ok(found.kinds.includes('phone'), JSON.stringify(found.kinds));
    assert.ok(found.kinds.length >= 2, 'the handle or the messenger too');
    assert.deepEqual((await paid.api(`/bookings/${bookingId}/answer/check`, { method: 'POST', body: { answer: longAnswer('Write two essays a week.') } })).kinds, []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM contact_blocks')).rows[0].n, before, 'a check is not a send: nothing logged');
    assert.equal((await free.api(`/bookings/${bookingId}/answer/check`, { method: 'POST', body: { answer: 'x' } })).status, 404);
    assert.equal((await seeker.api(`/bookings/${bookingId}/answer/check`, { method: 'POST', body: { answer: 'x' } })).status, 404);
  });

  test('sending still refuses it, and says which kinds', async () => {
    const r = await paid.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: longAnswer('Call me on +995 555 12 34 56.') } });
    assert.equal(r.error, 'contact_blocked');
    assert.ok(r.kinds.includes('phone'));
  });

  test('earnings say the share and the withdrawal minimum', async () => {
    assert.equal((await paid.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer: longAnswer('Write two Task 2 essays a week and compare them with the band descriptors.') } })).status, 200);
    const e = await paid.api('/me/earnings');
    assert.equal(e.sharePercent, 80);
    assert.equal(e.payoutMin, 100);
  });
});

describe("a 16–17-year-old's review", () => {
  test('shows the first name only: no surname, photo or profile link', async () => {
    const asked = await minor.api('/bookings', { method: 'POST', body: { mentorId: freeId, question: longQuestion('Which university should I choose for computer science in Tbilisi?') } });
    assert.equal(asked.status, 201, asked.text);
    const id = asked.booking.id;
    assert.equal((await free.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer: longAnswer('Compare three programmes and what their graduates do.') } })).status, 200);
    assert.equal((await admin.api(`/admin/answers/${id}/approve`, { method: 'POST' })).status, 200);
    const r = await rate(minor, id, 5, { review: 'Very clear and useful advice, thank you!' });
    assert.equal(r.status, 201, r.text);
    await rate(free, id, 5);
    const { reviews } = await client(base).api(`/experts/${freeId}/reviews`);
    const mine = reviews.find((x) => x.review === 'Very clear and useful advice, thank you!');
    assert.ok(mine, JSON.stringify(reviews));
    assert.equal(mine.reviewer.name, 'Luka');
    assert.equal(mine.reviewer.username, undefined);
    assert.equal(mine.reviewer.photoUrl, undefined);
    assert.ok(!JSON.stringify(mine).includes('Kapanadze'));
  });
});

describe('Georgian emails', () => {
  const render = (name, data) => require('../server/mail').render(name, 'ka', data);
  test('no case ending glued to a name, lari as ₾, the refund points to another mentor and its receipt says so', () => {
    const answered = render('answered', { mentor: 'გიორგი ხარაზი', answer: 'x' });
    assert.doesNotMatch(answered.subject + answered.text, /ხარაზი-მ/);
    const refund = render('refundSeeker', { mentor: 'ნინო გელაშვილი', amount: '15.00 GEL', reason: 'no_answer_deadline' });
    assert.match(refund.text, /15\.00 ₾/);
    assert.doesNotMatch(refund.text, /GEL|გელაშვილი-სთვის/);
    assert.match(refund.html, /\/experts\.html/);
    assert.match(render('receipt', { kind: 'refund', mentor: 'ნინო', number: 'R-3', date: 'x', amount: '15.00 GEL', url: 'u' }).subject, /დაბრუნების ქვითარი R-3/);
    assert.match(render('receipt', { kind: 'payment', mentor: 'ნინო', number: 'R-2', date: 'x', amount: '15.00 GEL', url: 'u' }).subject, /^შენი Wisecall-ის ქვითარი R-2$/);
  });
  test("the mentor's new-question email says when the asker is 16–17, and opens their questions", () => {
    const m = render('newFreeQuestion', { question: 'q', minor: true });
    assert.match(m.text, /16–17 წლის/);
    assert.match(m.html, /dashboard\.html\?tab=received/);
    assert.doesNotMatch(render('newFreeQuestion', { question: 'q', minor: false }).text, /16–17 წლის/);
  });
});
