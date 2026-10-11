// REVIEW-2: deleting an account. After the grace period nobody can sign in to it, the money records stay (pointing at an anonymous
// account), and the text the person wrote is gone, also in their reports and disputes (REVIEW-2 #6). The password asked for before
// deleting cannot be guessed at full speed (REVIEW-2 #5).
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pool, sql, until, marketplace, client, signupVerified, answered } = require('./_shared');

const PASSWORD = 'test-pass-12345'; // (tests/helpers.js signupVerified)
const PRIVATE = 'my brother lost his job at the factory last spring';
let ctx, dina, dinaId, bookingId;

before(async () => {
  // (the regular sweep every second: it is what deletes an account once the grace period is over; real rate limits, no multiplier)
  ctx = await marketplace(4854, { SWEEP_INTERVAL_SECONDS: '1', RATE_LIMIT_MULTIPLIER: '1' });
  dina = await signupVerified(ctx.base, 'Dina Delete', 'dina@example.com');
  dinaId = (await dina.api('/me')).user.id;
  bookingId = await answered(ctx, 'How do I move from support into a junior developer role at my company?', dina);
  // Dina asks a follow-up, the mentor replies, and Dina reports the reply and the answer, each time with words of her own.
  const threadId = (await dina.api(`/inbox/booking/${bookingId}`)).threadId;
  assert.equal((await dina.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body: `One more thing: ${PRIVATE}. Does that change anything?` } })).status, 201);
  assert.equal((await ctx.mentor.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body: 'It does not change the plan: start with the same first step.' } })).status, 201);
  const reply = (await dina.api(`/inbox/threads/${threadId}`)).messages.find((m) => m.kind === 'follow_up_reply');
  assert.equal((await dina.api(`/inbox/messages/${reply.id}/report`, { method: 'POST', body: { reason: 'other', details: `Rude about ${PRIVATE}` } })).status, 201);
  assert.equal((await dina.api(`/bookings/${bookingId}/dispute`, { method: 'POST', body: { reason: 'other', details: `It ignored that ${PRIVATE}` } })).status, 201);
  const [d] = await sql('SELECT id FROM disputes WHERE booking_id = $1', [bookingId]);
  assert.equal((await ctx.admin.api(`/admin/disputes/${d.id}/resolve`, { method: 'POST', body: { outcome: 'rejected', note: 'The answer covers the question.' } })).status, 200);
});
after(async () => { if (ctx) ctx.srv.proc.kill(); await pool.end(); });

describe('deleting an account', () => {
  test('signed out at once; after the grace period nobody can sign in; the payment records stay', async () => {
    const del = await dina.api('/me', { method: 'DELETE', body: { password: PASSWORD } });
    assert.equal(del.status, 200, del.text);
    assert.equal((await dina.api('/me')).user, null, 'signed out on this device');
    // (the grace period has passed)
    await pool.query(`UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1`, [dinaId]);
    await until(async () => (await sql('SELECT deleted_at FROM users WHERE id = $1', [dinaId]))[0].deleted_at, 'the sweep deleted the account', 20000);

    const login = await client(ctx.base).api('/auth/login', { method: 'POST', body: { email: 'dina@example.com', password: PASSWORD } });
    assert.equal(login.status, 401, login.text);
    const forgot = await client(ctx.base).api('/auth/forgot-password', { method: 'POST', body: { email: 'dina@example.com' } });
    assert.equal(forgot.status, 200);
    assert.ok(!forgot.resetUrl, 'no reset link for the old address'); // (outside production the link is handed back when one is made)
    const [u] = await sql('SELECT name, email, password_hash, username FROM users WHERE id = $1', [dinaId]);
    assert.deepEqual([u.name, u.password_hash, u.username], ['Deleted user', null, null]);
    assert.ok(!u.email.includes('dina'));
    // (the law needs the money records: the booking, its receipt and the mentor's payout are still there)
    assert.equal((await sql('SELECT amount FROM bookings WHERE id = $1', [bookingId]))[0].amount, 2500);
    assert.ok((await sql('SELECT 1 FROM receipts WHERE booking_id = $1', [bookingId])).length >= 1);
    assert.equal((await sql('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [bookingId]))[0].n, 1);
    assert.equal((await sql(`SELECT body FROM messages WHERE sender_id = $1 AND kind = 'follow_up_question'`, [dinaId]))[0].body, '');
  });

  test('the words the person wrote in reports and disputes are gone too', async () => {
    await until(async () => (await sql('SELECT deleted_at FROM users WHERE id = $1', [dinaId]))[0].deleted_at, 'deleted', 20000);
    const left = [
      ...(await sql('SELECT details AS text FROM disputes WHERE opened_by = $1', [dinaId])),
      ...(await sql('SELECT details AS text FROM message_reports WHERE reporter_id = $1', [dinaId]))
    ].filter((r) => r.text && r.text.includes('brother'));
    assert.equal(left.length, 0, `still kept: ${left.map((r) => JSON.stringify(r.text)).join(', ')}`);
  });
});

describe('the password asked for before deleting', () => {
  test('cannot be guessed at full speed', async () => {
    const rita = await signupVerified(ctx.base, 'Rita Guess', 'rita@example.com');
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await rita.api('/me', { method: 'DELETE', body: { password: `guess-number-${i}` } })).status);
    assert.ok((await rita.api('/me')).user, 'the account is untouched');
    assert.ok(statuses.includes(429), `25 wrong passwords in a row, answers: ${[...new Set(statuses)].join(', ')}`);
  });
});
