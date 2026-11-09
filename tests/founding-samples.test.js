// What makes Wisecall ours (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4): "Founding mentor" for every mentor approved before
// launch; "University lecturer · <university>" from a checked page on a known Georgian university's site (an admin confirms or removes it);
// the home page's "our mentors", only for approved mentors who chose it; sample answers to the team's questions, checked by an admin like
// any public answer and marked "Sample"; and the answer tips.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const dict = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8'));
const ANSWER = 'Start from what you liked studying at school, then read the first-year course list of two or three faculties. Talk to a student in each, ask what a normal week looks like, and choose the one whose hard parts you can live with.';
let srv, base, admin, nino, gio;

async function mentor(name, email, extra = {}) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } });
  await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Associate professor', niche: 'teaching', customNiche: 'Pedagogy', ...extra } });
  return { c, id: (await c.api('/me')).user.id };
}
const badgesOf = async (id) => (await require('../server/verification/badges').badgesFor([id]))[id];

before(async () => {
  await resetDatabase();
  srv = await startServer(4783, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  nino = await mentor('Nino Founding', 'nino-founding@example.com');
  await nino.c.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/ka/staff/nino-founding' } });
  await approveMentor(admin, nino.c);
  await addPayoutDetails(nino.c, undefined, 'Nino Founding');
  gio = await mentor('Gio Waiting', 'gio-waiting@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('founding mentors and the university badge', () => {
  test('approved before launch: "Founding mentor", for good', async () => {
    const { rows: [r] } = await pool.query('SELECT founding_mentor_at FROM users WHERE id = $1', [nino.id]);
    assert.ok(r.founding_mentor_at);
    assert.ok((await badgesOf(nino.id)).some((b) => b.key === 'founding'));
    assert.deepEqual(await badgesOf(gio.id), [], 'nothing for a mentor who is not approved');
  });

  test('a checked page on a known university\'s site: "University lecturer · Tbilisi State University"', async () => {
    assert.ok(!(await badgesOf(nino.id)).some((b) => b.key === 'university'), 'not before the page is checked');
    await pool.query(`UPDATE mentor_evidence SET check_status = 'ok' WHERE user_id = $1 AND kind = 'university'`, [nino.id]);
    const uni = (await badgesOf(nino.id)).find((b) => b.key === 'university');
    assert.deepEqual(uni.university, { en: 'Tbilisi State University', ka: 'თბილისის სახელმწიფო უნივერსიტეტი' });
  });

  test('an admin removes it, goes back to automatic, or confirms it; each is logged', async () => {
    const act = (action) => admin.api(`/admin/mentors/${nino.id}/university-badge`, { method: 'POST', body: { action } });
    assert.equal((await act('remove')).status, 200);
    assert.ok(!(await badgesOf(nino.id)).some((b) => b.key === 'university'));
    assert.equal((await act('reset')).status, 200);
    assert.ok((await badgesOf(nino.id)).some((b) => b.key === 'university'));
    await pool.query(`UPDATE mentor_evidence SET check_status = 'unchecked' WHERE user_id = $1`, [nino.id]);
    assert.equal((await act('confirm')).universityDomain, 'tsu.ge');
    assert.ok((await badgesOf(nino.id)).some((b) => b.key === 'university'), 'confirmed by hand');
    assert.equal((await act('nonsense')).status, 400);
    assert.equal((await client(base).api(`/admin/mentors/${nino.id}/university-badge`, { method: 'POST', body: { action: 'remove' } })).status, 401);
    const { rows } = await pool.query(`SELECT action FROM verification_audit WHERE mentor_id = $1 AND action LIKE 'university_badge_%' ORDER BY created_at`, [nino.id]);
    assert.deepEqual(rows.map((r) => r.action), ['university_badge_remove', 'university_badge_reset', 'university_badge_confirm']);
  });
});

describe('the home page\'s "our mentors"', () => {
  test('off by default; only approved mentors who chose it; the count only from 5', async () => {
    assert.deepEqual((await client(base).api('/home-mentors')).mentors, []);
    assert.equal((await nino.c.api('/me', { method: 'PATCH', body: { showOnHome: 'yes' } })).status, 400);
    assert.equal((await nino.c.api('/me', { method: 'PATCH', body: { showOnHome: true } })).status, 200);
    await gio.c.api('/me', { method: 'PATCH', body: { showOnHome: true } });
    const r = await client(base).api('/home-mentors');
    assert.deepEqual(r.mentors.map((m) => m.name), ['Nino Founding'], 'not a mentor who is still waiting');
    assert.equal(r.mentors[0].founding, true);
    assert.equal(r.mentors[0].university.en, 'Tbilisi State University');
    assert.equal(r.mentors[0].email, undefined, 'nothing private');
    assert.equal(r.verifiedCount, null, 'fewer than 5');
  });

  test('the section is on the home page, hidden until there is one', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(html, /<section class="lsection lexperts" id="homeMentors"[^>]*hidden>/);
    assert.match(html, /<ul class="lexpert-grid" id="homeMentorsList">/);
    assert.equal(dict('ka')['home.mentors.prelaunch'], 'პირველი მენტორები, რომლებიც უკვე შემოგვიერთდნენ');
    assert.equal(dict('ka')['home.mentors.count'], '{n} გადამოწმებული მენტორი');
    assert.equal(dict('ka')['settings.mentor.showOnHome'], 'ჩემი პროფილი მთავარ გვერდზე გამოჩნდეს');
    assert.equal(dict('ka')['badge.founding'], 'პირველი მენტორი');
  });
});

describe('sample answers', () => {
  let qid, answerId;
  test('an admin adds a question; only approved mentors see it', async () => {
    assert.equal((await admin.api('/admin/sample-questions', { method: 'POST', body: { question: 'short' } })).status, 400);
    const r = await admin.api('/admin/sample-questions', { method: 'POST', body: { question: 'როგორ ავირჩიო ფაკულტეტი?  How do I choose a faculty?' } });
    assert.equal(r.status, 201, r.text);
    qid = r.question.id;
    assert.deepEqual((await gio.c.api('/answers/samples')).questions, []);
    assert.equal((await gio.c.api(`/answers/samples/${qid}`, { method: 'PUT', body: { answer: ANSWER } })).status, 403);
    assert.equal((await nino.c.api('/answers/samples')).questions[0].id, qid);
  });

  test('the answer is checked like any public answer; nothing is public before an admin approves it', async () => {
    assert.equal((await nino.c.api(`/answers/samples/${qid}`, { method: 'PUT', body: { answer: 'Too short.' } })).status, 400);
    const r = await nino.c.api(`/answers/samples/${qid}`, { method: 'PUT', body: { answer: ANSWER } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.publicAnswer.status, 'pending_review');
    assert.equal(r.publicAnswer.sample, true);
    answerId = r.publicAnswer.id;
    assert.deepEqual((await client(base).api('/answers')).answers, []);
    const queue = (await admin.api('/admin/public-answers')).queue;
    assert.equal(queue.find((a) => a.id === answerId).sample, true);
  });

  test('approved: on /answers and the profile, marked "Sample"; rewriting a published one needs a withdraw first', async () => {
    const ok = await admin.api(`/admin/public-answers/${answerId}/approve`, { method: 'POST', body: {} });
    assert.equal(ok.status, 200, ok.text);
    const list = (await client(base).api('/answers')).answers;
    assert.equal(list.length, 1);
    assert.equal(list[0].sample, true);
    assert.equal((await client(base).api(`/answers?mentor=${nino.id}`)).answers[0].sample, true);
    const page = await fetch(`${base}/ka/answers/${list[0].slug}`).then((x) => x.text());
    assert.match(page, /სანიმუშო/);
    assert.equal((await nino.c.api(`/answers/samples/${qid}`, { method: 'PUT', body: { answer: ANSWER + ' Again.' } })).status, 409);
    assert.equal((await nino.c.api(`/answers/${answerId}/withdraw`, { method: 'POST' })).status, 200);
    assert.equal((await nino.c.api(`/answers/samples/${qid}`, { method: 'PUT', body: { answer: ANSWER + ' Again.' } })).status, 200);
  });

  test('the database still refuses a published answer from a real question without the asker\'s yes', async () => {
    await assert.rejects(pool.query(`UPDATE public_answers SET status = 'published', slug = 'x-' || id, is_sample = false, booking_id = NULL WHERE id = $1`, [answerId]));
  });
});

test('the answer screen has the fixed tips, in both languages', () => {
  assert.equal(dict('ka')['dash.answer.tips'], 'კარგი პასუხი: 1) პირდაპირ პასუხი, 2) შენი გამოცდილებიდან მაგალითი, 3) შემდეგი ნაბიჯი');
  assert.match(dict('en')['dash.answer.tips'], /^A good answer: 1\) a direct answer, 2\) an example from your experience, 3\) a next step/);
  assert.match(fs.readFileSync(path.join(ROOT, 'public/js/dashboard.js'), 'utf8'), /answer-tips/);
});
