// What happens to a question from a 16-17-year-old (docs/CLAUDE-CODE-ASKERS-16-PLUS.md).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE, wait, longQuestion, longAnswer } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, adult, minor, paidMentor, paidMentorId, freeMentor, freeMentorId;

function bornAgo(years) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const signupMinor = (name, email) => signupVerified(base, name, email, 'test-pass-12345', { birthYm: bornAgo(17), parentPermission: true });
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(200);
  }
}
const row = async (id) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
// (at most a few open free questions per person: earlier ones of these tests are closed first)
const ask = async (c, mentorId, extra = {}) => {
  const me = (await c.api('/me')).user.id;
  await pool.query(`UPDATE bookings SET status = 'refunded', refunded_at = now() WHERE seeker_id = $1 AND amount = 0 AND status = 'paid' AND answered_at IS NULL`, [me]);
  return c.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Which university should I choose for computer science?'), ...extra } });
};
async function payAtBank(c, booking) {
  await client(base).api(`/mock-bank/orders/${booking.providerOrderId}/complete`, { method: 'POST', body: { outcome: 'success' } });
  await c.api(`/bookings/${booking.id}/sync`, { method: 'POST' });
  return waitFor(async () => { const b = await row(booking.id); return b.status === 'paid' ? b : null; });
}
async function makeMentor(name, email, price, niche = 'business') {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Career coach', niche, price, ...(price === 0 ? { freeWeeklyCap: 100 } : {}), proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  return { c, id: (await c.api('/me')).user.id };
}

before(async () => {
  await resetDatabase();
  srv = await startServer(4792, { SWEEP_INTERVAL_SECONDS: '1', RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  adult = await signupVerified(base, 'Ana Adult', 'ana-adult@example.com');
  minor = await signupMinor('Luka Kapanadze', 'luka@example.com');
  ({ c: paidMentor, id: paidMentorId } = await makeMentor('Paid Pat', 'pat@example.com', 40));
  ({ c: freeMentor, id: freeMentorId } = await makeMentor('Free Fred', 'fred@example.com', 0));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('payments', () => {
  test('a minor asks a free mentor as normal, with no extra box', async () => {
    const r = await ask(minor, freeMentorId);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.free, true);
    const b = await row(r.booking.id);
    assert.equal(b.asker_minor, true);
    assert.equal(b.adult_payer_confirmed_at, null);
    assert.equal(b.amount, 0);
  });

  test('a paid mentor needs the adult-payer box from a minor, and nothing goes to the bank without it', async () => {
    const before_ = (await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
    const r = await ask(minor, paidMentorId);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'adult_payer_required');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, before_);
    const paid = await ask(minor, paidMentorId, { adultPayer: true });
    assert.equal(paid.status, 201, paid.text);
    assert.ok(paid.checkoutUrl);
    const b = await row(paid.booking.id);
    assert.ok(b.adult_payer_confirmed_at, 'the time they confirmed it is kept');
    assert.equal(b.asker_minor, true);
    // (the price, the fee and the mentor's share are what an adult's question has)
    assert.equal(b.amount, 4000);
    assert.equal(b.platform_fee_amount, 800);
    assert.equal(b.mentor_net_amount, 3200);
  });

  test('an adult is not asked, and the question is not marked as a minor\'s', async () => {
    const r = await ask(adult, paidMentorId);
    assert.equal(r.status, 201, r.text);
    const b = await row(r.booking.id);
    assert.equal(b.asker_minor, false);
    assert.equal(b.adult_payer_confirmed_at, null);
  });

  test('the refund after 7 days with no answer still works for a minor', async () => {
    const r = await ask(minor, paidMentorId, { adultPayer: true });
    const paid = await payAtBank(minor, r.booking);
    assert.ok(paid.paid_at);
    await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [r.booking.id]);
    const b = await waitFor(async () => { const x = await row(r.booking.id); return x.status === 'refunded' ? x : null; });
    assert.equal(b.refund_reason, 'no_answer_deadline');
    assert.equal(b.refunded_amount === null ? b.amount : b.refunded_amount, 4000);
  });
});

describe('contact details', () => {
  test('a question with a phone number is refused with the kinds, nothing is sent, and the attempt is counted without its text', async () => {
    const before_ = (await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
    const q = longQuestion('Please call me on 555 12 34 56 about choosing a university');
    const r = await adult.api('/bookings', { method: 'POST', body: { mentorId: paidMentorId, question: q } });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'contact_blocked');
    assert.ok(r.kinds.includes('phone'), r.kinds.join());
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, before_, 'nothing went to the bank');
    const { rows } = await pool.query(`SELECT b.* FROM contact_blocks b JOIN users u ON u.id = b.user_id WHERE u.email = 'ana-adult@example.com'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].surface, 'question');
    assert.ok(rows[0].kinds.includes('phone'));
    assert.equal(rows[0].minor, false);
    assert.doesNotMatch(JSON.stringify(rows[0]), /555/);
  });

  test('a minor is held to the strict rule: naming a messenger is refused for them, not for an adult', async () => {
    const q = longQuestion('Is it worth learning to build Telegram bots before university starts?');
    assert.equal((await minor.api('/bookings', { method: 'POST', body: { mentorId: freeMentorId, question: q } })).error, 'contact_blocked');
    assert.equal((await adult.api('/bookings', { method: 'POST', body: { mentorId: paidMentorId, question: q } })).status, 201);
  });

  test('an answer: public links are fine for everybody; an answer to a minor cannot carry a social link or contact details, and can be sent once edited', async () => {
    const adultQ = await ask(adult, paidMentorId);
    await payAtBank(adult, adultQ.booking);
    const withLink = longAnswer('Read the programme page at https://www.tsu.ge/en/faculties before you decide.');
    assert.equal((await paidMentor.api(`/bookings/${adultQ.booking.id}/answer`, { method: 'POST', body: { answer: withLink } })).status, 200);

    const minorQ = await ask(minor, freeMentorId);
    const social = longAnswer('You can follow my notes at https://www.instagram.com/fred.notes for more on this.');
    const refused = await freeMentor.api(`/bookings/${minorQ.booking.id}/answer`, { method: 'POST', body: { answer: social } });
    assert.equal(refused.error, 'contact_blocked');
    assert.equal((await row(minorQ.booking.id)).answer, null, 'not saved');
    const { rows } = await pool.query(`SELECT b.* FROM contact_blocks b JOIN users u ON u.id = b.user_id WHERE u.email = 'fred@example.com'`);
    assert.equal(rows[0].surface, 'answer');
    assert.equal(rows[0].minor, true);
    assert.equal((await freeMentor.api(`/bookings/${minorQ.booking.id}/answer`, { method: 'POST', body: { answer: withLink } })).status, 200, 'edited, it goes through');
  });
});

describe('what a mentor sees', () => {
  let id;
  before(async () => {
    const r = await ask(minor, freeMentorId);
    id = r.booking.id;
    await pool.query(`UPDATE users SET photo_updated_at = now() WHERE email = 'luka@example.com'`);
  });
  test('the first name and the question, a tag, and nothing else about the person', async () => {
    const { received } = await freeMentor.api('/bookings/mine');
    const b = received.find((x) => x.id === id);
    assert.equal(b.askerMinor, true);
    assert.equal(b.otherPartyName, 'Luka');
    assert.equal(b.otherPartyUsername, null);
    assert.equal(b.otherPartyPhotoUrl, null);
    assert.equal(b.seekerId, undefined);
    assert.doesNotMatch(JSON.stringify(received), /Kapanadze|luka@example|birth/i);
  });
  test('the same in the Inbox', async () => {
    const th = await waitFor(async () => { const r = await freeMentor.api('/inbox'); return (r.threads || []).find((t) => t.bookingId === id); });
    assert.equal(th.other.name, 'Luka');
    assert.equal(th.other.username, null);
    const one = await freeMentor.api(`/inbox/threads/${th.id}`);
    assert.equal(one.thread.other.name, 'Luka');
    assert.equal(one.booking.askerMinor, true);
    assert.doesNotMatch(JSON.stringify(one), /Kapanadze|luka@example|birth/i);
  });
  test('an adult\'s name is shown as before, and the asker sees the mentor as before', async () => {
    const r = await ask(adult, freeMentorId);
    const b = (await freeMentor.api('/bookings/mine')).received.find((x) => x.id === r.booking.id);
    assert.equal(b.askerMinor, false);
    assert.equal(b.otherPartyName, 'Ana Adult');
    assert.ok(b.otherPartyUsername);
    const mine = (await minor.api('/bookings/mine')).asked.find((x) => x.id === id);
    assert.equal(mine.otherPartyName, 'Free Fred');
  });
  test('the minor\'s profile and photo stay closed to the mentor they asked', async () => {
    const username = (await minor.api('/me')).user.username;
    const seen = await freeMentor.api(`/users/${username}`);
    assert.equal(seen.private, true);
    assert.equal(seen.profile, undefined);
    assert.equal((await minor.api(`/users/${username}`)).private, undefined, 'they see their own');
  });
  test('a minor is not offered to publish their question, and cannot', async () => {
    const r = await minor.api('/answers/offer', { method: 'POST', body: { bookingId: id } });
    assert.equal(r.status, 404);
  });
});

describe('the check on answers to minors', () => {
  const ANSWER = longAnswer('Start with the entry requirements of each programme, then compare what graduates do three years later.');
  const heldQueue = async () => (await admin.api('/admin/answers')).answers;
  let id;
  before(async () => {
    const r = await ask(minor, freeMentorId);
    id = r.booking.id;
    assert.equal((await freeMentor.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer: ANSWER } })).status, 200);
  });

  test('the answer is invisible to the minor until an admin approves it; the mentor still sees theirs', async () => {
    const seen = (await minor.api('/bookings/mine')).asked.find((b) => b.id === id);
    assert.equal(seen.answer, null);
    assert.equal(seen.answerHeld, true);
    assert.equal(seen.status, 'answered');
    assert.equal((await minor.api(`/bookings/${id}`)).booking.answer, null);
    assert.equal((await freeMentor.api(`/bookings/${id}`)).booking.answer, ANSWER);
    const q = (await heldQueue()).find((a) => a.id === id);
    assert.equal(q.minorHold, true);
  });

  test('it is never released by itself, and the deadline passing changes nothing: the mentor met it when they answered', async () => {
    // (the check window is long over, and so is the answer deadline)
    await pool.query(`UPDATE bookings SET answer_held_until = now() - interval '2 days', answer_deadline = now() - interval '1 minute' WHERE id = $1`, [id]);
    await wait(2500);
    const b = await row(id);
    assert.equal(b.answer_review, 'held');
    assert.equal(b.status, 'answered', 'not refunded or closed for being late');
    assert.equal((await minor.api('/bookings/mine')).asked.find((x) => x.id === id).answer, null);
  });

  test('after 24 hours the admins get a reminder, again a day later, not on every sweep', async () => {
    assert.equal((await row(id)).minor_hold_reminded_at, null, 'not before 24 hours');
    await pool.query(`UPDATE bookings SET answer_minor_hold_at = now() - interval '25 hours' WHERE id = $1`, [id]);
    const first = await waitFor(async () => (await row(id)).minor_hold_reminded_at);
    await wait(2500);
    assert.equal(+(await row(id)).minor_hold_reminded_at, +first, 'once per day');
    assert.match(srv.logs(), /reminded the admins of 1 answer/);
    await pool.query(`UPDATE bookings SET minor_hold_reminded_at = now() - interval '25 hours' WHERE id = $1`, [id]);
    await waitFor(async () => +(await row(id)).minor_hold_reminded_at > Date.now() - 60000);
  });

  test('one tap in admin: the minor can read it now', async () => {
    assert.equal((await admin.api(`/admin/answers/${id}/approve`, { method: 'POST' })).status, 200);
    const seen = (await minor.api('/bookings/mine')).asked.find((b) => b.id === id);
    assert.equal(seen.answer, ANSWER);
    assert.equal(seen.answerHeld, false);
    assert.ok(!(await heldQueue()).some((a) => a.id === id));
    assert.ok((await row(id)).answer_released_at);
  });

  test('a paid answer: the earnings wait for the approval, and the hold counts from it', async () => {
    const r = await ask(minor, paidMentorId, { adultPayer: true });
    await payAtBank(minor, r.booking);
    assert.equal((await paidMentor.api(`/bookings/${r.booking.id}/answer`, { method: 'POST', body: { answer: ANSWER } })).status, 200);
    const count = async () => (await pool.query('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [r.booking.id])).rows[0].n;
    assert.equal(await count(), 0, 'no earnings while it waits');
    assert.equal((await admin.api(`/admin/answers/${r.booking.id}/approve`, { method: 'POST' })).status, 200);
    const { rows: [p] } = await pool.query('SELECT amount, payable_at FROM payouts WHERE booking_id = $1', [r.booking.id]);
    assert.equal(p.amount, 3200, 'the same 80 %');
    assert.ok(Math.abs(+new Date(p.payable_at) - Date.now() - 7 * 86400000) < 60000, 'the usual 7 days from now');
  });

  test('an adult\'s answer is not held for this', async () => {
    const r = await ask(adult, freeMentorId);
    assert.equal((await freeMentor.api(`/bookings/${r.booking.id}/answer`, { method: 'POST', body: { answer: ANSWER } })).status, 200);
    assert.equal((await row(r.booking.id)).answer_review, 'none');
  });

  test('the check ends 3 months after the first live day', async () => {
    await waitFor(async () => (await pool.query(`SELECT 1 FROM site_facts WHERE key = 'first_live'`)).rows[0]);
    await pool.query(`UPDATE site_facts SET at = now() - interval '4 months' WHERE key = 'first_live'`);
    const r = await ask(minor, freeMentorId);
    assert.equal((await freeMentor.api(`/bookings/${r.booking.id}/answer`, { method: 'POST', body: { answer: ANSWER } })).status, 200);
    const b = await row(r.booking.id);
    assert.equal(b.answer_review, 'none');
    assert.equal(b.answer_minor_hold_at, null);
    await pool.query(`UPDATE site_facts SET at = now() WHERE key = 'first_live'`);
  });
});

describe('reports and the admin view', () => {
  let answered, unsafeMentor, unsafeMentorId;
  before(async () => {
    const r = await ask(minor, paidMentorId, { adultPayer: true });
    await payAtBank(minor, r.booking);
    answered = r.booking.id;
    await paidMentor.api(`/bookings/${answered}/answer`, { method: 'POST', body: { answer: longAnswer('Compare the programmes by what their graduates do, not by their brochures.') } });
    await admin.api(`/admin/answers/${answered}/approve`, { method: 'POST' });
    ({ c: unsafeMentor, id: unsafeMentorId } = await makeMentor('Unsafe Una', 'una@example.com', 0));
  });

  test('the asker reports an answer: it reaches the admin queue with the answer', async () => {
    const sent = await minor.api(`/experts/${paidMentorId}/report`, { method: 'POST', body: { reason: 'contact_request', details: 'Asked me to write to them elsewhere', bookingId: answered } });
    assert.ok([200, 201].includes(sent.status), sent.text);
    const { reports } = await admin.api('/admin/reports');
    const r = reports.find((x) => x.bookingId === answered);
    assert.equal(r.reason, 'contact_request');
    assert.equal(r.askerMinor, true);
    assert.ok(r.answer);
    assert.equal(r.reporter.email, 'luka@example.com');
  });

  test('the mentor reports a question: once, only their own, and no money moves', async () => {
    const q = await ask(adult, freeMentorId);
    const res = await freeMentor.api(`/bookings/${q.booking.id}/report-question`, { method: 'POST', body: { reason: 'inappropriate', details: 'Not a study question' } });
    assert.equal(res.status, 201, res.text);
    assert.equal((await freeMentor.api(`/bookings/${q.booking.id}/report-question`, { method: 'POST', body: { reason: 'spam' } })).error, 'already_reported');
    assert.equal((await paidMentor.api(`/bookings/${q.booking.id}/report-question`, { method: 'POST', body: { reason: 'spam' } })).status, 404, 'not their question');
    assert.equal((await freeMentor.api(`/bookings/${q.booking.id}/report-question`, { method: 'POST', body: { reason: 'nonsense' } })).error, 'invalid_reason');
    assert.equal((await row(q.booking.id)).status, 'paid');
    const { reports } = await admin.api('/admin/question-reports');
    const r = reports.find((x) => x.bookingId === q.booking.id);
    assert.equal(r.asker.email, 'ana-adult@example.com');
    assert.equal((await admin.api(`/admin/question-reports/${r.id}/resolve`, { method: 'POST', body: { resolution: 'dismissed', note: 'A fair question' } })).status, 200);
    assert.ok(!(await admin.api('/admin/question-reports')).reports.some((x) => x.id === r.id));
  });

  test('admin: the minor filter, the permission time, blocked counts per person. Not for everybody else', async () => {
    assert.equal((await minor.api('/admin/people')).status, 403);
    const { people } = await admin.api('/admin/people?minor=1');
    const luka = people.find((p) => p.email === 'luka@example.com');
    assert.equal(luka.minor, true);
    assert.ok(luka.parentPermissionAt);
    assert.ok(luka.blocked >= 1, 'the Telegram question counted');
    assert.ok(!people.some((p) => p.email === 'ana-adult@example.com'), 'only minors under that filter');
    const all = (await admin.api('/admin/people')).people;
    assert.ok(all.find((p) => p.email === 'ana-adult@example.com').blocked >= 1, 'an adult with a stopped number is on the full list');
    assert.ok(all.find((p) => p.email === 'fred@example.com').blocked >= 1, 'and a mentor');
  });

  test('"unsafe" suspends the mentor pending review, with a flag; reinstating closes it', async () => {
    const q = await ask(adult, unsafeMentorId);
    assert.equal((await admin.api(`/admin/people/${unsafeMentorId}/unsafe`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/people/${unsafeMentorId}/unsafe`, { method: 'POST', body: { reason: 'Asked a student for their number' } })).status, 200);
    const u = (await unsafeMentor.api('/me')).user;
    assert.equal(u.verificationStatus, 'suspended');
    const open = async () => (await pool.query(`SELECT count(*)::int AS n FROM mentor_flags WHERE mentor_id = $1 AND kind = 'unsafe' AND status = 'open'`, [unsafeMentorId])).rows[0].n;
    assert.equal(await open(), 1);
    assert.ok((await admin.api('/admin/people')).people.find((p) => p.id === unsafeMentorId).unsafe);
    assert.equal((await unsafeMentor.api(`/bookings/${q.booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('x y z') } })).error, 'suspended');
    assert.ok(!(await client(base).api('/experts')).experts.some((e) => e.id === unsafeMentorId), 'off the site');
    const back = await admin.api(`/admin/mentors/${unsafeMentorId}/reinstate`, { method: 'POST', body: { reason: 'Looked at it: nothing happened' } });
    assert.equal(back.status, 200, back.text);
    assert.equal(await open(), 0);
  });

  test('clearing a wrong birth year and month: they are asked again', async () => {
    const c = await signupMinor('Typo Tamta', 'tamta@example.com');
    const id = (await c.api('/me')).user.id;
    assert.equal((await admin.api(`/admin/people/${id}/clear-age`, { method: 'POST' })).status, 200);
    const me = (await c.api('/me')).user;
    assert.equal(me.needsAge, true);
    assert.equal(me.parentPermissionAt, null);
    assert.equal((await c.api('/me/age', { method: 'POST', body: { birthYm: '1990-01' } })).user.ageGroup, 'adult');
  });
});
