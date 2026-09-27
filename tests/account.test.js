// Download my data, and delete my account: re-authentication, refused while something is open, closed at once (signed out, not
// listed), kept by "keep my account", and after the grace period emptied of personal details while payment records stay.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;
const PW = 'test-pass-12345';

before(async () => {
  await resetDatabase();
  srv = await startServer(4713, { RATE_LIMIT_MULTIPLIER: '20', SWEEP_INTERVAL_SECONDS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const signedIn = async (c) => Boolean((await c.api('/me')).user);

describe('download my data', () => {
  test('a JSON file with the account, questions, messages and more; nothing secret', async () => {
    const c = await signupVerified(base, 'Nino Export', 'nino@example.com', PW);
    await c.api('/me', { method: 'PATCH', body: { city: 'Kutaisi' } });
    const res = await c.raw('/api/me/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="wisecall-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    const data = await res.json();
    assert.equal(data.account.email, 'nino@example.com');
    assert.equal(data.account.city, 'Kutaisi');
    assert.ok(Array.isArray(data.questionsAsked) && Array.isArray(data.messagesWritten) && Array.isArray(data.signedInDevices));
    const text = JSON.stringify(data);
    assert.doesNotMatch(text, /password_hash|passwordHash|\$2[aby]\$|email_code|reset_token/i, 'no secrets');
    assert.equal((await client(base).raw('/api/me/export')).status, 401);
  });
});

describe('delete my account', () => {
  let mentor, mentorId, asker;

  before(async () => {
    mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com', PW);
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
    mentorId = await approveMentor(admin, mentor);
    await addPayoutDetails(mentor, undefined, 'Mika Mentor');
    asker = await signupVerified(base, 'Ana Asker', 'ana@example.com', PW);
  });

  test('the password is required; open questions block it with a clear list', async () => {
    assert.equal((await asker.api('/me', { method: 'DELETE', body: { password: 'wrong-password' } })).error, 'wrong_password');
    const b = await bookAndPay(base, asker, mentorId, 'How do I choose my first programming language for data work?');
    const r = await asker.api('/me', { method: 'DELETE', body: { password: PW } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.items, ['questions_waiting']);
    assert.deepEqual((await mentor.api('/me', { method: 'DELETE', body: { password: PW } })).items.sort(), ['questions_to_answer']);
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Python: most data tools use it.') } });
    assert.deepEqual((await mentor.api('/me', { method: 'DELETE', body: { password: PW } })).items, ['money_to_pay_out'], 'earnings must be paid out first');
  });

  test('asking closes the account at once: signed out everywhere, a mentor leaves Browse experts; signing in again and "keep" undoes it', async () => {
    const other = client(base);
    await other.api('/auth/login', { method: 'POST', body: { email: 'ana@example.com', password: PW } });
    const r = await asker.api('/me', { method: 'DELETE', body: { password: PW } });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.deletesOn);
    assert.equal(await signedIn(asker), false);
    assert.equal(await signedIn(other), false);
    const again = client(base);
    assert.equal((await again.api('/auth/login', { method: 'POST', body: { email: 'ana@example.com', password: PW } })).status, 200);
    assert.ok((await again.api('/me')).user.deletionRequestedAt);
    assert.equal((await again.api('/me/delete/cancel', { method: 'POST' })).status, 200);
    assert.equal((await again.api('/me')).user.deletionRequestedAt, null);
    asker = again;
  });

  test('after the grace period the details are gone, the payment records stay, and nobody can sign in', async () => {
    const quiet = await signupVerified(base, 'Quiet Person', 'quiet@example.com', PW);
    await quiet.api('/me', { method: 'PATCH', body: { city: 'Batumi', headline: 'Student' } });
    const qid = (await quiet.api('/me')).user.id;
    assert.equal((await quiet.api('/me', { method: 'DELETE', body: { password: PW } })).status, 200);
    await pool.query(`UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1`, [qid]);
    for (let i = 0; i < 40; i++) {
      const u = (await pool.query('SELECT * FROM users WHERE id = $1', [qid])).rows[0];
      if (u.deleted_at) {
        assert.equal(u.name, 'Deleted user');
        assert.match(u.email, /@deleted\.invalid$/);
        assert.equal(u.city, null);
        assert.equal(u.password_hash, null);
        assert.equal(u.username, null);
        const login = await client(base).api('/auth/login', { method: 'POST', body: { email: 'quiet@example.com', password: PW } });
        assert.equal(login.status, 401);
        return;
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    assert.fail('the account was not deleted by the sweep');
  });

  test('a deleted asker\'s bookings stay (pseudonymised) for the records', async () => {
    const a = await signupVerified(base, 'Temp Asker', 'temp@example.com', PW);
    const b = await bookAndPay(base, a, mentorId, 'What should I read to understand databases better as a beginner?');
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with a book on SQL basics.') } });
    const aid = (await a.api('/me')).user.id;
    assert.equal((await a.api('/me', { method: 'DELETE', body: { password: PW } })).status, 200);
    await pool.query(`UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1`, [aid]);
    for (let i = 0; i < 40; i++) {
      if ((await pool.query('SELECT deleted_at FROM users WHERE id = $1', [aid])).rows[0].deleted_at) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    const row = (await pool.query('SELECT seeker_id, amount, status FROM bookings WHERE id = $1', [b.id])).rows[0];
    assert.equal(row.seeker_id, aid);
    assert.equal(row.amount, 3000);
    const receipts = (await pool.query('SELECT count(*)::int AS n FROM receipts WHERE booking_id = $1', [b.id])).rows[0].n;
    assert.equal(receipts, 1, 'the receipt stays');
  });
});
