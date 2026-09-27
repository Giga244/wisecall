// The Inbox: a thread per paid booking with ONE free follow-up question and ONE reply, support conversations that reach the admins,
// system messages, notifications and the unread count, reports, and the email settings. Contact details and outside payments are
// refused in booking threads. Mock bank; Resend is faked so the emails can be read.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, wait } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, mentor, mentorId, other;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4708, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupByEmail(resend, base, 'Ana Asker', 'ana@example.com');
  other = await signupByEmail(resend, base, 'Otto Other', 'otto@example.com');
  mentor = await signupByEmail(resend, base, 'Mika Mentor', 'mika@example.com', 'ka');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

const threadOf = async (c, bookingId) => (await c.api(`/inbox/booking/${bookingId}`)).threadId;
const send = (c, threadId, body) => c.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body } });

describe('a booking thread', () => {
  let booking, threadId;

  test('a paid question opens a thread for the asker and the mentor only; the mentor is notified', async () => {
    booking = await bookAndPay(base, asker, mentorId, 'How do I plan a database migration without downtime?');
    assert.equal(booking.status, 'paid');
    threadId = await threadOf(asker, booking.id);
    assert.ok(threadId);
    assert.equal(await threadOf(mentor, booking.id), threadId);
    assert.equal((await other.api(`/inbox/booking/${booking.id}`)).status, 404);
    assert.equal((await other.api(`/inbox/threads/${threadId}`)).status, 404, 'nobody else can read it');

    const m = await mentor.api(`/inbox/threads/${threadId}`);
    assert.equal(m.thread.role, 'mentor');
    assert.match(m.booking.question, /database migration/);
    assert.ok(m.messages.some((x) => x.kind === 'event' && x.event === 'paid'));
    assert.ok((await mentor.api('/inbox/notifications')).notifications.some((n) => n.kind === 'new_question'));
  });

  test('no follow-up before the answer can be read; nothing to reply to for the mentor', async () => {
    assert.equal((await send(asker, threadId, 'Can I ask something before you answer?')).error, 'follow_up_not_open');
    assert.equal((await send(mentor, threadId, 'Hello there, I am the mentor.')).error, 'nothing_to_reply');
  });

  test('the answer shows in the thread and notifies the asker (the unread count goes up, then down when read)', async () => {
    const before = (await asker.api('/inbox/unread')).count;
    const r = await mentor.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Run both schemas side by side and switch reads first.') } });
    assert.equal(r.status, 200, r.text);
    await wait(300);
    assert.equal((await asker.api('/inbox/unread')).count, before + 1);
    const t = await asker.api(`/inbox/threads/${threadId}`);
    assert.match(t.booking.answer, /side by side/);
    assert.ok(t.messages.some((x) => x.event === 'answered'));
    assert.equal(t.followUp.canAsk, true);
    assert.equal((await asker.api('/inbox/unread')).count, before, 'reading the thread marks its notifications read');
  });

  test('a phone number, an email, a messenger handle and an outside payment are refused (EN and KA); the text is not kept', async () => {
    for (const [text, kind] of [
      ['Thanks! Can you call me on +995 555 12 34 56 to explain?', 'phone'],
      ['Could you write to me at ana.asker@gmail.com please?', 'email'],
      ['მომწერე ვაცაპზე, იქ უფრო მარტივია ჩემთვის', 'messenger'],
      ['I can pay you directly with Revolut for more help later', 'external_payment']
    ]) {
      const r = await send(asker, threadId, text);
      assert.equal(r.status, 422, text);
      assert.equal(r.error, 'contact_details');
      assert.ok(r.reasons.includes(kind), `${text} -> ${r.reasons}`);
    }
    const blocked = (await pool.query('SELECT * FROM blocked_messages')).rows;
    assert.equal(blocked.length, 4);
    assert.ok(!JSON.stringify(blocked).includes('555'), 'only the kind is stored, never the text');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM messages WHERE kind = 'follow_up_question'`)).rows[0].n, 0);
  });

  test('ONE follow-up question: the second is refused; the mentor is emailed', async () => {
    const r = await send(asker, threadId, 'Would you <b>switch writes</b> in the same release or later?');
    assert.equal(r.status, 201, r.text);
    assert.equal(r.message.body, 'Would you <b>switch writes</b> in the same release or later?', 'stored as plain text, as typed');
    assert.equal((await send(asker, threadId, 'And one more thing, please?')).error, 'follow_up_used');
    const mail = await resend.waitFor('mika@example.com', 'დამატებითი კითხვა');
    assert.match(mail.body.text, /switch writes/);
    assert.ok(!mail.body.html.includes('<b>switch'), 'escaped in the email');
  });

  test('ONE reply from the mentor closes the thread; nobody can write after it', async () => {
    const r = await send(mentor, threadId, 'Later: keep writes on the old schema for one more release.');
    assert.equal(r.status, 201, r.text);
    assert.equal((await send(mentor, threadId, 'Oh, and another thing I forgot.')).error, 'thread_closed');
    assert.equal((await send(asker, threadId, 'Thanks, one more follow-up?')).status, 409);
    const t = await asker.api(`/inbox/threads/${threadId}`);
    assert.equal(t.thread.status, 'closed');
    assert.equal(t.followUp.closed, true);
    assert.ok(t.messages.some((x) => x.event === 'follow_up_closed'));
    await resend.waitFor('ana@example.com', 'replied to your follow-up');
  });

  test('a message can be reported by the other person (once), and admins see it', async () => {
    const t = await mentor.api(`/inbox/threads/${threadId}`);
    const q = t.messages.find((x) => x.kind === 'follow_up_question');
    assert.equal((await asker.api(`/inbox/messages/${q.id}/report`, { method: 'POST', body: { reason: 'abuse' } })).error, 'cannot_report_self');
    assert.equal((await other.api(`/inbox/messages/${q.id}/report`, { method: 'POST', body: { reason: 'abuse' } })).status, 404);
    assert.equal((await mentor.api(`/inbox/messages/${q.id}/report`, { method: 'POST', body: { reason: 'spam', details: 'test' } })).status, 201);
    assert.equal((await mentor.api(`/inbox/messages/${q.id}/report`, { method: 'POST', body: { reason: 'spam' } })).error, 'already_reported');
    const list = await admin.api('/admin/support/reports');
    const rep = list.reports.find((x) => x.message.id === q.id);
    assert.ok(rep);
    assert.equal(rep.reporter.email, 'mika@example.com');
    assert.equal((await admin.api(`/admin/support/reports/${rep.id}/resolve`, { method: 'POST', body: { resolution: 'Spoke to both' } })).status, 200);
    assert.equal((await asker.api('/admin/support/reports')).status, 403);
  });
});

describe('support', () => {
  let threadId;

  test('anyone signed in can write to support; it reaches the admins (list and email)', async () => {
    const r = await other.api('/inbox/support', { method: 'POST', body: { subject: 'Payment question', body: 'My bank shows <script>alert(1)</script> twice.' } });
    assert.equal(r.status, 201, r.text);
    threadId = r.id;
    const list = await admin.api('/admin/support?status=open');
    const th = list.threads.find((x) => x.id === threadId);
    assert.ok(th);
    assert.equal(th.waitingForUs, true);
    assert.equal(th.user.email, 'otto@example.com');
    const mail = await resend.waitFor('qa-admin@example.com', 'support conversation');
    assert.ok(!mail.body.html.includes('<script>'), 'escaped');
  });

  test('an admin replies (the person is notified and emailed) and adds an internal note the person never sees', async () => {
    assert.equal((await admin.api(`/admin/support/${threadId}/messages`, { method: 'POST', body: { body: 'We checked: only one payment went through.' } })).status, 201);
    assert.equal((await admin.api(`/admin/support/${threadId}/messages`, { method: 'POST', body: { body: 'Internal: bank confirmed', internal: true } })).status, 201);
    const t = await other.api(`/inbox/threads/${threadId}`);
    assert.ok(t.messages.some((m) => m.senderRole === 'support' && /only one payment/.test(m.body)));
    assert.ok(!JSON.stringify(t).includes('Internal: bank confirmed'), 'internal notes stay with the admins');
    assert.ok((await other.api('/inbox/notifications')).notifications.some((n) => n.kind === 'support_reply'));
    await resend.waitFor('otto@example.com', 'support replied');
    const a = await admin.api(`/admin/support/${threadId}`);
    assert.ok(a.messages.some((m) => m.kind === 'internal_note'));
  });

  test('the person answers in the same thread; an admin can assign and close it; nobody else can read it', async () => {
    assert.equal((await send(other, threadId, 'Great, thank you!')).status, 201);
    assert.equal((await asker.api(`/inbox/threads/${threadId}`)).status, 404);
    assert.equal((await admin.api(`/admin/support/${threadId}`, { method: 'PATCH', body: { assign: 'me', status: 'closed' } })).thread.status, 'closed');
    assert.equal((await admin.api('/admin/support?status=closed')).threads[0].assignedTo, 'qa-admin@example.com');
    assert.equal((await other.api('/admin/support')).status, 403);
  });

  test('the contact form from a signed-in person becomes a support conversation', async () => {
    const r = await asker.api('/contact', { method: 'POST', body: { name: 'Ana Asker', email: 'ana@example.com', message: 'I have a question about refunds, please help.' } });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.threadId);
    const t = await asker.api(`/inbox/threads/${r.threadId}`);
    assert.equal(t.thread.kind, 'support');
  });

  test('there is no way to start a conversation with another user', async () => {
    const r = await asker.api('/inbox/threads', { method: 'POST', body: { to: mentorId, body: 'Hi, can we talk outside?' } });
    assert.equal(r.status, 404);
  });
});

describe('system messages, notifications and email settings', () => {
  test('application decisions arrive as system messages (read-only)', async () => {
    const list = await mentor.api('/inbox');
    const sys = list.threads.find((th) => th.kind === 'system');
    assert.ok(sys, 'the approval made a system thread');
    const t = await mentor.api(`/inbox/threads/${sys.id}`);
    assert.ok(t.messages.some((m) => m.event === 'approved'));
    assert.equal((await send(mentor, sys.id, 'Thanks a lot for approving me!')).error, 'read_only');
  });

  test('notifications can be marked read', async () => {
    await asker.api('/inbox/notifications/read', { method: 'POST', body: {} });
    assert.equal((await asker.api('/inbox/unread')).count, 0);
  });

  test('only optional emails can be turned off, and an unsubscribe link works without signing in', async () => {
    assert.deepEqual((await asker.api('/inbox/email-settings')).optional.map((o) => o.on), [true, true]);
    assert.equal((await asker.api('/inbox/email-settings', { method: 'PUT', body: { off: ['payments'] } })).error, 'not_optional');
    const s = await asker.api('/inbox/email-settings', { method: 'PUT', body: { off: ['tips'] } });
    assert.deepEqual(s.optional.find((o) => o.key === 'tips').on, false);

    // The link as server/inbox.js makes it, signed with the test server's SESSION_SECRET (tests/helpers.js).
    const me = (await asker.api('/me')).user;
    const payload = `${me.id}.rating_reminders`;
    const sig = require('crypto').createHmac('sha256', 'test-secret-that-is-long-enough-1234567890').update('unsubscribe:' + payload).digest('base64url').slice(0, 32);
    const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;
    const r = await client(base).api('/inbox/unsubscribe', { method: 'POST', body: { token } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.category, 'rating_reminders');
    assert.equal((await asker.api('/inbox/email-settings')).optional.find((o) => o.key === 'rating_reminders').on, false);
    const forged = `${Buffer.from(`${me.id}.tips`).toString('base64url')}.${sig}`;
    assert.equal((await client(base).api('/inbox/unsubscribe', { method: 'POST', body: { token: forged } })).error, 'invalid_token');
  });
});
