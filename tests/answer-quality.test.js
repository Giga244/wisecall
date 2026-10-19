// Answer quality (docs/CLAUDE-CODE-ANSWER-QUALITY.md):
//   1. the "How to write a great answer" guide (English and Georgian), published, and linked from the mentor rules, the become-a-mentor
//      page and the mentor's dashboard
//   2. the four-point checklist above the answer box (open for a mentor's first 5 answers, folded after; never required)
//   3. the follow-up reply deadline: 3 days, a reminder after 2, the payout held until the reply or the deadline (also out of a withdrawal
//      request), and a missed deadline: the asker told and able to report it for 7 more days, the admins emailed (escaped)
//   4. the admins' email when an answer is held for review, with a link to the review queue (escaped)
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, bookAndPay, longAnswer, SAMPLE, GOOD_IBAN, wait } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('public/i18n/en.json'));
const ka = JSON.parse(read('public/i18n/ka.json'));
const OUTBOX = path.join(os.tmpdir(), `wisecall-answer-quality-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function mailTo(to, subject, from = 0) {
  for (let i = 0; i < 80; i++) {
    const m = outbox().slice(from).find((x) => x.to === to && subject.test(x.subject));
    if (m) return m;
    await wait(100);
  }
  return null;
}
const mailsTo = (to, subject, from = 0) => outbox().slice(from).filter((x) => x.to === to && subject.test(x.subject));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
const PASSWORD = 'test-pass-12345';
let srv, base, srv2, admin, asker, mentor, mentorId, n = 0;

async function signup(name, email) {
  const c = client(base);
  const from = outbox().length;
  assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: PASSWORD } })).status, 201);
  const code = (await mailTo(email, /./, from)).html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
async function newMentor(name, email) {
  const c = await signup(name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 60, sampleAnswer: SAMPLE } });
  const id = await approveMentor(admin, c);
  assert.equal((await c.api('/me/payout', { method: 'PUT', body: { name: 'Mika Mentor', iban: GOOD_IBAN, currentPassword: PASSWORD } })).status, 200);
  return { c, id };
}
// A paid, answered question whose earnings (48 GEL of a 60 GEL price) would be available now. Returns the booking id.
async function answered(question) {
  n += 1;
  const b = await bookAndPay(base, asker, mentorId, `${question} (${n})`);
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Here is what I would do in your place.') } })).status, 200);
  await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE booking_id = $1`, [b.id]);
  return b.id;
}
const threadOf = async (c, bookingId) => (await c.api(`/inbox/booking/${bookingId}`)).threadId;
const say = (c, thread, body) => c.api(`/inbox/threads/${thread}/messages`, { method: 'POST', body: { body } });
const available = async () => (await mentor.api('/me/balance')).balance.available;
const withdraw = () => mentor.api('/me/withdrawals', { method: 'POST', body: { currentPassword: PASSWORD } });
const days = (d) => (new Date(d).getTime() - Date.now()) / 86400000;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  const env = { RATE_LIMIT_MULTIPLIER: '20', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', PAYOUT_MIN_GEL: '1', SWEEP_INTERVAL_SECONDS: '1' };
  srv = await startServer(4743, env);
  base = srv.base;
  // (the same database, holding a new mentor's first 5 answers for review: item 4)
  srv2 = await startServer(4744, { ...env, PROBATION_ANSWERS: '5' });
  admin = await signup('QA Admin', 'qa-admin@example.com');
  asker = await signup('Ana Asker', 'ana@example.com');
  ({ c: mentor, id: mentorId } = await newMentor('Mika Mentor', 'mika@example.com'));
});
after(async () => { if (srv) srv.proc.kill(); if (srv2) srv2.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('1. "How to write a great answer"', () => {
  test('is written in English and Georgian, covers every point with a weak and a strong example, and is published in both', async () => {
    const enMd = read('docs/help/en/18-write-a-great-answer.md');
    const kaMd = read('docs/help/ka/18-write-a-great-answer.md');
    for (const w of [/exact question/i, /concrete steps|steps, examples/i, /outside your expertise/i, /who they should ask instead/i,
      /diagnosis, a legal opinion or a financial recommendation for their specific case/i, /section 3/, /phone numbers/i, /outside Wisecall/i,
      /career question/i, /A weak answer/, /A strong answer/, /first 5 answers/]) assert.match(enMd, w);
    for (const w of [/ზუსტად მის კითხვას/, /კონკრეტული/, /ექსპერტიზას/, /ვის მიმართოს/, /დიაგნოზი/, /მე-3/, /ტელეფონის ნომერი/, /Wisecall-ის გარეთ/,
      /კარიერაზე/, /სუსტი პასუხი/, /ძლიერი პასუხი/, /პირველ 5 პასუხს/]) assert.match(kaMd, w);
    assert.doesNotMatch(enMd + kaMd, /\[CHECK/, 'published (a [CHECK note would hide it)');
    const shape = (md) => [(md.match(/^> /gm) || []).length, (md.match(/\*\*[^*]+\*\*/g) || []).length];
    assert.deepEqual(shape(kaMd), shape(enMd), 'the same examples and headings in both languages');

    const page = await (await fetch(`${base}/help/write-a-great-answer`)).text();
    assert.match(page, /<h1[^>]*>How to write a great answer<\/h1>/);
    assert.match(page, /<blockquote>/);
    const kaPage = await (await fetch(`${base}/ka/help/write-a-great-answer`)).text();
    assert.match(kaPage, /როგორ დავწეროთ კარგი პასუხი/);
    assert.match(await (await fetch(`${base}/help.html`)).text(), /href="\/help\/write-a-great-answer"/);
  });

  test('is linked from the mentor rules, the become-a-mentor page and the mentor\'s dashboard', async () => {
    assert.match(read('docs/help/en/09-rules-for-mentors.md'), /\]\(\/help\/write-a-great-answer\)/);
    assert.match(read('docs/help/ka/09-rules-for-mentors.md'), /\]\(\/ka\/help\/write-a-great-answer\)/);
    assert.match(await (await fetch(`${base}/help/rules-for-mentors`)).text(), /<a href="\/help\/write-a-great-answer">/);
    const become = await (await fetch(`${base}/become-a-mentor.html`)).text();
    assert.match(become, /<a href="\/help\/write-a-great-answer"[^>]*data-i18n="help.greatAnswer"[^>]*>How to write a great answer<\/a>/);
    assert.match(await (await fetch(`${base}/ka/become-a-mentor.html`)).text(), /როგორ დავწეროთ კარგი პასუხი/);
    assert.match(read('public/dashboard.html'), /<a class="plain-link" href="\/help\/write-a-great-answer" data-i18n="help.greatAnswer">/);
    assert.equal(en['help.greatAnswer'], 'How to write a great answer');
    assert.equal(ka['help.greatAnswer'], 'როგორ დავწეროთ კარგი პასუხი');
  });
});

describe('2. the checklist above the answer box', () => {
  test('four reminders with a link to the guide: open for a mentor\'s first 5 answers, folded after; nothing to tick', () => {
    const js = read('public/js/dashboard.js');
    const src = js.slice(js.indexOf('const greatAnswerHref'), js.indexOf('function renderReceived'));
    const checklistHtml = vm.runInNewContext(`(() => { ${src}; return checklistHtml; })()`, { t: (k) => `[${k}]`, WisecallI18n: { getLang: () => 'ka' } });
    const open = checklistHtml(true);
    const folded = checklistHtml(false);
    assert.match(open, /<details class="answer-checklist" open>/);
    assert.match(folded, /<details class="answer-checklist">/);
    assert.deepEqual([...open.matchAll(/<li>\[([^\]]+)\]<\/li>/g)].map((m) => m[1]),
      ['dash.answer.checklist.exact', 'dash.answer.checklist.concrete', 'dash.answer.checklist.limits', 'dash.answer.checklist.contact']);
    assert.match(open, /href="\/ka\/help\/write-a-great-answer"/);
    assert.doesNotMatch(open, /<input|required|checkbox/, 'a reminder, not something to tick');
    assert.match(js, /\$\{checklistHtml\(answeredSoFar < 5\)\}/, 'open until the 5th answer');
    assert.deepEqual(['exact', 'concrete', 'limits', 'contact'].map((k) => en[`dash.answer.checklist.${k}`]),
      ['I answered their exact question', 'I gave concrete steps or examples', 'I said what is outside my expertise', 'No contact details']);
    for (const k of ['title', 'exact', 'concrete', 'limits', 'contact']) {
      assert.ok(ka[`dash.answer.checklist.${k}`] && ka[`dash.answer.checklist.${k}`] !== en[`dash.answer.checklist.${k}`], `Georgian ${k}`);
    }
  });
});

describe('3. the follow-up reply deadline', () => {
  test('3 days, shown to both; the payout waits (and leaves a withdrawal request) until the reply, which releases it', async () => {
    const id = await answered('Should I ask for a raise now or after my yearly review?');
    assert.equal((await withdraw()).status, 201, 'a request with this payout, made before the follow-up');
    const [request] = await sql(`SELECT id FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentorId]);
    const thread = await threadOf(asker, id);
    const from = outbox().length;
    assert.equal((await say(asker, thread, 'Thanks! And what if my manager says there is no budget this year?')).status, 201);
    const seen = (await asker.api(`/inbox/threads/${thread}`)).followUp;
    assert.ok(days(seen.replyBy) > 2.99 && days(seen.replyBy) <= 3, 'the mentor replies within 3 days');
    assert.equal(seen.missed, false);
    const mentorSeen = (await mentor.api(`/inbox/threads/${thread}`)).followUp;
    assert.equal(mentorSeen.canReply, true);
    assert.equal(mentorSeen.replyBy, seen.replyBy);
    assert.match((await mailTo('mika@example.com', /asked a follow-up question/i, from)).text, /reply within 3 days/);
    // The payout is held: out of the request (nothing else was in it, so it is closed, and why), and nothing to withdraw.
    const [closed] = await sql('SELECT status, reject_reason FROM payout_batches WHERE id = $1', [request.id]);
    assert.equal(closed.status, 'rejected');
    assert.match(closed.reject_reason, /follow-up question is waiting for your reply/);
    assert.equal(await available(), 0);
    assert.equal((await withdraw()).error, 'nothing_available');
    // The reply releases it.
    assert.equal((await say(mentor, thread, 'Then ask what result would earn it next year, and write it down together with your manager.')).status, 201);
    assert.equal(await available(), 4800);
    assert.equal((await sql('SELECT follow_up_replied_at FROM threads WHERE id = $1', [thread]))[0].follow_up_replied_at !== null, true);
  });

  test('a reminder after 2 days; after 3 the asker is told and may report it for 7 more days, the admins are emailed, the payout is free', async () => {
    const id = await answered('How do I tell my team that I am leaving the company?');
    const thread = await threadOf(asker, id);
    assert.equal((await say(asker, thread, 'Should I tell <b>my manager</b> before the team?')).status, 201);
    const before = await available();
    // Two days later (a day left): one reminder to the mentor, however many sweeps run.
    const from = outbox().length;
    await pool.query(`UPDATE threads SET follow_up_due_at = now() + interval '23 hours' WHERE id = $1`, [thread]);
    const reminder = await mailTo('mika@example.com', /Please reply to the follow-up question/, from);
    assert.ok(reminder, 'reminded');
    assert.match(reminder.text, /Ana Asker asked a follow-up question/);
    await wait(2500);
    assert.equal(mailsTo('mika@example.com', /Please reply to the follow-up question/, from).length, 1, 'once');
    // The answer's own report window is over; a "no reply" report is not open before the deadline.
    await pool.query(`UPDATE bookings SET answered_at = now() - interval '20 days' WHERE id = $1`, [id]);
    assert.equal((await asker.api(`/bookings/${id}/dispute`, { method: 'POST', body: { reason: 'not_an_answer' } })).error, 'window_closed');
    assert.equal((await asker.api(`/bookings/${id}/dispute`, { method: 'POST', body: { reason: 'mentor_ignored_follow_up' } })).error, 'window_closed');
    // The deadline passes.
    await pool.query(`UPDATE threads SET follow_up_due_at = now() - interval '1 minute' WHERE id = $1`, [thread]);
    const notice = await mailTo('qa-admin@example.com', /did not reply to a follow-up question/, from);
    assert.ok(notice, 'the admins are told');
    assert.match(notice.html, /Should I tell &lt;b&gt;my manager&lt;\/b&gt; before the team\?/);
    assert.doesNotMatch(notice.html, /<b>my manager<\/b>/, 'escaped');
    const view = await asker.api(`/inbox/threads/${thread}`);
    assert.equal(view.followUp.missed, true);
    assert.ok(days(view.followUp.reportUntil) > 6.9 && days(view.followUp.reportUntil) <= 7);
    assert.ok(view.messages.some((m) => m.event === 'follow_up_missed'));
    assert.ok((await asker.api('/inbox/notifications')).notifications.some((x) => x.kind === 'follow_up_missed'));
    assert.equal(await available(), before + 4800, 'the payout is no longer held');
    const mine = (await asker.api('/bookings/mine')).asked.find((b) => b.id === id);
    assert.deepEqual(mine.disputeReasons, ['mentor_ignored_follow_up']);
    assert.ok(days(mine.disputeUntil) > 6.9);
    const d = await asker.api(`/bookings/${id}/dispute`, { method: 'POST', body: { reason: 'mentor_ignored_follow_up', details: 'No reply at all.' } });
    assert.equal(d.status, 201, d.text);
    assert.equal(d.dispute.reason, 'mentor_ignored_follow_up');
  });

  test('the "no reply" report closes 7 days after the deadline', async () => {
    const id = await answered('Is a master\'s degree worth it for a product manager?');
    const thread = await threadOf(asker, id);
    assert.equal((await say(asker, thread, 'And part-time or full-time study?')).status, 201);
    await pool.query(`UPDATE threads SET follow_up_due_at = now() - interval '1 minute' WHERE id = $1`, [thread]);
    for (let i = 0; i < 40 && !(await sql('SELECT follow_up_missed_at FROM threads WHERE id = $1', [thread]))[0].follow_up_missed_at; i++) await wait(150);
    await pool.query(`UPDATE threads SET follow_up_missed_at = now() - interval '8 days' WHERE id = $1`, [thread]);
    assert.equal((await asker.api(`/bookings/${id}/dispute`, { method: 'POST', body: { reason: 'mentor_ignored_follow_up' } })).error, 'window_closed');
  });

  test('the Terms say it, in English and Georgian', () => {
    const six = (dict) => dict['legal.terms.sections'].find((s) => /^6\./.test(s.h)).p.join(' ');
    assert.match(six(en), /Mentors reply to the free follow-up question within 3 days\./);
    assert.match(six(ka), /მენტორი უფასო დამატებით კითხვას 3 დღეში პასუხობს\./);
  });
});

describe('4. an answer held for review', () => {
  test('emails the admins at once with a link to the review queue; names escaped, the answer itself not sent', async () => {
    const { id: newId } = await newMentor('<i>Nia</i> New', 'nia@example.com');
    const b = await bookAndPay(base, asker, newId, 'What should a junior designer put in a first portfolio?');
    const nia = client(srv2.base); // (this server holds a new mentor's first answers)
    assert.equal((await nia.api('/auth/login', { method: 'POST', body: { email: 'nia@example.com', password: PASSWORD } })).status, 200);
    const from = outbox().length;
    const r = await nia.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Three projects with the problem, your process and the result.') } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.booking.answerHeld, true);
    const mail = await mailTo('qa-admin@example.com', /An answer is waiting for review/, from);
    assert.ok(mail, 'the admins are told');
    assert.match(mail.html, new RegExp(`<a href="${srv2.base.replace(/[.]/g, '\\.')}/admin\\.html\\?tab=queue">`));
    assert.match(mail.html, /&lt;i&gt;Nia&lt;\/i&gt; New/);
    assert.doesNotMatch(mail.html, /<i>Nia<\/i>/);
    assert.match(mail.html, /answer 1 of their first 5/);
    assert.doesNotMatch(mail.html, /Three projects/, 'not the answer');
    // (the admin page opens that tab from the link)
    assert.match(read('public/js/admin.js'), /const params = new URLSearchParams\(location\.search\);\n  const wanted = tabs\.querySelector\(.\.chip\[data-tab="\$\{CSS\.escape\(params\.get\('tab'\)/);
  });
});
