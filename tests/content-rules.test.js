// What a question and an answer must look like, and that an answer is written ONCE: never replaced, held for a check or not.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified, bookAndPay, addPayoutDetails, approveMentor, SAMPLE, wait } = require('./helpers');
const content = require('../server/content');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, mentor, mentorId;

// A real-looking answer of exactly the wanted length (never the same few words again and again).
const WORDS = 'start with the problem and write down who is stuck what they already tried and what a good outcome would look like then take the smallest step that tests it and check the result before building anything bigger because early feedback is cheap and late surprises are not'.split(' ');
function text(n) { let out = ''; for (let i = 0; out.length < n; i += 1) out += (i ? ' ' : '') + WORDS[i % WORDS.length] + (i >= WORDS.length ? String(Math.floor(i / WORDS.length)) : ''); return out.slice(0, n).trim(); }
const ANSWER = text(200);
const QUESTION = 'Should I register for VAT before my turnover reaches the limit, or wait? I run a small shop.';

const paid = async (q = QUESTION) => bookAndPay(base, seeker, mentorId, q);
const answerOf = async (id) => (await pool.query('SELECT answer, status, answered_at, answer_review FROM bookings WHERE id = $1', [id])).rows[0];
const post = (id, answer, who = mentor) => who.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer } });

before(async () => {
  await resetDatabase();
  srv = await startServer(4615, { PROBATION_ANSWERS: '1' }); // the first answer of a mentor is held for a check, as on a new site
  base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'business', price: 40, proofUrl: 'https://linkedin.com/in/dr-mentor', sampleAnswer: SAMPLE } });
  mentorId = (await mentor.api('/me')).user.id;
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the length of a question', () => {
  test('at least 50 characters, counted after trimming and with blanks counted once; at most 4000', async () => {
    const q = async (question) => seeker.api('/bookings', { method: 'POST', body: { mentorId, question } });
    for (const short of ['Is this ok?', 'x'.repeat(49), `   ${'y'.repeat(30)}      ${' '.repeat(40)}${'z'.repeat(10)}   `]) {
      const r = await q(short);
      assert.equal(r.status, 400, short);
      assert.equal(r.error, 'question_too_short');
      assert.equal(r.min, 50);
    }
    assert.equal((await q('x'.repeat(4001))).error, 'question_too_long');
    assert.equal((await q(['too', 'short'])).error, 'missing_fields');
    assert.equal((await q(undefined)).error, 'missing_fields');
    const fifty = 'A question of exactly fifty characters, right here!'.slice(0, 50);
    const ok = await q(`   ${fifty}   \n`);
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.booking.question, fifty, 'stored without the blanks at the ends');
    assert.equal(content.size(ok.booking.question), 50);
  });

  test('the number the pages show is the number the server checks', async () => {
    const cfg = await client(base).api('/config');
    assert.deepEqual([cfg.questionMin, cfg.questionMax, cfg.answerMin, cfg.answerMax], [50, 4000, 150, 8000]);
    // the pages count with WisecallAPI.textLength: the same function, letters of any alphabet (and emoji) as one character each
    const textLength = vm.runInNewContext(`(${fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8').match(/const textLength = (.*);/)[1]})`);
    for (const s of ['', '  hi  ', 'a   b\n\n c', 'გამარჯობა, როგორ ხარ?', 'ok 🙂 ok', 'x'.repeat(300), '\r\nline one\r\nline two  ']) {
      assert.equal(textLength(s), content.size(s), JSON.stringify(s));
    }
  });
});

describe('the length and the look of an answer', () => {
  test('too short, padded with blanks, or not real writing: refused, and nothing is saved', async () => {
    const b = await paid();
    const bad = [
      ['ok', 'answer_too_short'], ['x', 'answer_too_short'], [text(149), 'answer_too_short'],
      [`${text(100)}${' '.repeat(200)}`, 'answer_too_short'], [`   \n\n ${text(60)}    \n `, 'answer_too_short'],
      ['a'.repeat(200), 'answer_repetitive'], ['ok '.repeat(80), 'answer_repetitive'], ['abc'.repeat(70), 'answer_repetitive'], ['!'.repeat(200), 'answer_repetitive'],
      ['...... ---- ,,,, '.repeat(20), 'answer_repetitive'], ['yes no '.repeat(40), 'answer_repetitive'], [`${'hello world '.repeat(3)}${'ha'.repeat(90)}`, 'answer_repetitive'],
      ['word '.repeat(60), 'answer_repetitive'], [text(8001), 'answer_too_long'], [123, 'missing_answer'], [null, 'missing_answer'], [['a'], 'missing_answer']
    ];
    for (const [answer, error] of bad) {
      const r = await post(b.id, answer);
      assert.equal(r.status, 400, `${JSON.stringify(String(answer).slice(0, 20))} -> ${r.status} ${r.error}`);
      assert.equal(r.error, error, JSON.stringify(String(answer).slice(0, 30)));
    }
    assert.equal((await post(b.id, 'ok')).min, 150, 'the answer says how long it must be');
    const row = await answerOf(b.id);
    assert.equal(row.status, 'paid');
    assert.equal(row.answer, null);
    assert.equal(row.answered_at, null);
  });

  test('150 characters of real writing are accepted, stored without the blanks at the ends; other alphabets count too', async () => {
    const b = await paid('Should I hire a designer or learn the tools myself? I have a small budget.');
    const exact = text(150);
    assert.equal(content.size(exact), 150);
    const r = await post(b.id, `\n  ${exact}   \n`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.booking.status, 'answered');
    assert.equal((await answerOf(b.id)).answer, exact);

    const b2 = await paid('Can you help me with my company registration in Georgia? I am an individual entrepreneur.');
    const georgian = 'დაიწყე პრობლემის ჩამოწერით: ვინ არის გაჭირვებაში, რა სცადა უკვე და როგორი იქნებოდა კარგი შედეგი. შემდეგ აირჩიე ყველაზე პატარა ნაბიჯი, რომელიც ამას შეამოწმებს და შედეგი გადაამოწმე, სანამ რამე დიდს ააშენებ.';
    assert.ok(content.size(georgian) >= 150);
    assert.equal((await post(b2.id, georgian)).status, 200);
  });

  test('the same rules in the pure function: real text passes, junk does not', () => {
    for (const ok of [ANSWER, text(150), text(1000), 'Yes. '.repeat(3) + text(160)]) assert.equal(content.checkAnswer(ok).error, undefined, ok.slice(0, 20));
    for (const junk of ['a'.repeat(400), 'ok '.repeat(200), '12345678 '.repeat(30), '😀'.repeat(200), 'lorem '.repeat(50)]) assert.equal(content.checkAnswer(junk).error, 'answer_repetitive', junk.slice(0, 12));
  });
});

describe('an answer is written once', () => {
  test('a second answer to an answered question is refused with 409 and the first stays exactly as it was', async () => {
    const b = await paid('Which accounting software should a one-person company start with?');
    const first = text(180);
    assert.equal((await post(b.id, first)).status, 200);
    const before = await answerOf(b.id);
    for (const again of [text(200), first, ANSWER, 'ok']) {
      const r = await post(b.id, again);
      assert.equal(r.status, 409, again.slice(0, 10));
      assert.equal(r.error, 'already_answered');
    }
    assert.deepEqual(await answerOf(b.id), before, 'nothing changed');
    assert.equal(before.answer, first);
  });

  test('a held answer cannot be edited either (a mistake is for the admin to reject, which refunds the buyer), and neither can a released one', async () => {
    // this mentor has already had their one held answer above? the first of a new mentor is held: use a fresh mentor
    const fresh = await signupVerified(base, 'Fresh Mentor', 'fresh@example.com');
    await fresh.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'business', price: 20, proofUrl: 'https://linkedin.com/in/fresh', sampleAnswer: SAMPLE } });
    const freshId = (await fresh.api('/me')).user.id;
    await approveMentor(admin, fresh);
    await addPayoutDetails(fresh);
    const b = await bookAndPay(base, seeker, freshId, 'A question for the mentor whose first answer is held for a check?');
    const held = text(170);
    const r = await post(b.id, held, fresh);
    assert.equal(r.status, 200);
    assert.equal(r.booking.answerHeld, true, 'a new mentor\'s first answer waits for a check');

    const while_held = await post(b.id, text(220), fresh);
    assert.equal(while_held.status, 409);
    assert.equal(while_held.error, 'already_answered');
    assert.equal((await answerOf(b.id)).answer, held);

    assert.equal((await admin.api(`/admin/answers/${b.id}/approve`, { method: 'POST' })).status, 200);
    assert.equal((await answerOf(b.id)).answer_review, 'released');
    const after_release = await post(b.id, text(230), fresh);
    assert.equal(after_release.status, 409);
    assert.equal(after_release.error, 'already_answered');
    const stored = await answerOf(b.id);
    assert.equal(stored.answer, held, 'the buyer reads what the mentor sent, never anything else');
    assert.equal((await seeker.api(`/bookings/${b.id}`)).booking.answer, held);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [b.id])).rows[0].n, 1, 'one payout, not one per attempt');
  });

  test('two requests at the same moment: one is saved, the other is refused, one payout', async () => {
    const b = await paid('A question that two answers arrive for at exactly the same moment?');
    const [a, c] = await Promise.all([post(b.id, text(160)), post(b.id, text(170))]);
    assert.deepEqual([a.status, c.status].sort(), [200, 409]);
    const row = await answerOf(b.id);
    assert.ok([text(160), text(170)].includes(row.answer));
    assert.equal(row.answer, a.status === 200 ? text(160) : text(170), 'the one that was accepted is the one that is stored');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [b.id])).rows[0].n, 1);
  });

  test('only the mentor of a paid question can answer; an unpaid or refunded one cannot be answered', async () => {
    const b = await paid('A question that only its own mentor may answer, nobody else?');
    assert.equal((await post(b.id, text(160), seeker)).status, 400);
    assert.equal((await post(b.id, text(160), client(base))).status, 401);
    assert.equal((await post('not-an-id', text(160))).status, 404);
    // refunded
    assert.equal((await admin.api(`/admin/bookings/${b.id}/refund`, { method: 'POST' })).status, 200);
    const r = await post(b.id, text(160));
    assert.equal(r.status, 400);
    assert.equal(r.error, 'not_paid');
    // never paid
    const unpaid = (await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: QUESTION } })).booking;
    assert.equal((await post(unpaid.id, text(160))).error, 'not_paid');
  });
});

describe('what the pages do about it', () => {
  test('the mentor checks the answer before sending ("you can\'t change it after sending"), with a live count; texts in English and Georgian', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/dashboard.js'), 'utf8');
    for (const needle of ['answer-review', 'answer-preview', 'answer-back', 'answer-send', 'dash.answer.reviewWarn', 'WisecallAPI.textLength', 'answerMin', 'a-count', 'already_answered', 'answer_repetitive']) assert.ok(js.includes(needle), needle);
    assert.doesNotMatch(js, /minlength="2"/, 'the old two-character minimum is gone');
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8')), ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));
    const keys = ['dash.answer.check', 'dash.answer.needMore', 'dash.answer.longEnough', 'dash.answer.tooShort', 'dash.answer.reviewTitle', 'dash.answer.reviewWarn', 'dash.answer.back', 'dash.answer.err.repetitive', 'dash.answer.err.long', 'dash.answer.err.already', 'expert.question.needMore', 'expert.question.enough'];
    for (const k of keys) { assert.ok(en[k], k); assert.match(ka[k], /[ა-ჿ]/, `${k} in Georgian`); }
    assert.match(en['dash.answer.reviewWarn'], /can't change your answer after sending/i);
    assert.match(en['dash.answer.needMore'], /\{left\}/);
    assert.match(en['dash.answer.needMore'], /\{answerMin\}/);
  });

  test('the question box counts and explains, using the limits the server sends', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/profile.js'), 'utf8');
    assert.match(js, /questionMin: MIN_QUESTION/);
    assert.doesNotMatch(js, /MIN_QUESTION = 5\b/);
    for (const needle of ['qHelp', 'expert.question.needMore', 'expert.question.enough', 'WisecallAPI.textLength', 'question_too_short']) assert.ok(js.includes(needle), needle);
  });
});
