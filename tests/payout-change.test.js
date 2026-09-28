// Payout details (docs/FIX-PROMPT.md): saving them needs the current password (or a recent sign-in for an account without one); changing
// saved details emails the mentor and holds their payouts for PAYOUT_CHANGE_HOLD_HOURS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, bookAndPay, longAnswer, SAMPLE, GOOD_IBAN, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-payout-change-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const OTHER_IBAN = 'GE60NB0000000123456789';
let srv, base, admin, asker, mentor, mentorId;

async function signup(name, email) {
  const c = client(base);
  await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345' } });
  let mail;
  for (let i = 0; i < 60 && !mail; i++) { mail = outbox().find((m) => m.to === email); if (!mail) await wait(100); }
  const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
const save = (body) => mentor.api('/me/payout', { method: 'PUT', body: { name: 'Mika Mentor', iban: GOOD_IBAN, ...body } });

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4724, { RATE_LIMIT_MULTIPLIER: '20', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', PAYOUT_HOLD_DAYS: '7' });
  base = srv.base;
  admin = await signup('QA Admin', 'qa-admin@example.com');
  asker = await signup('Ana Asker', 'ana@example.com');
  mentor = await signup('Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

test('the current password is needed, even for the first details', async () => {
  assert.equal((await save({})).error, 'password_required');
  assert.equal((await save({ currentPassword: 'not-my-password' })).error, 'wrong_password');
  const ok = await save({ currentPassword: 'test-pass-12345' });
  assert.equal(ok.status, 200);
  assert.equal(ok.user.payoutHoldUntil, null, 'the first details are not a change: nothing is held');
  assert.equal(outbox().filter((m) => m.to === 'mika@example.com' && /changed/i.test(m.subject)).length, 0);
});

test('a change emails the mentor and holds their payouts for 72 hours; the admin cannot pay them meanwhile', async () => {
  const b = await bookAndPay(base, asker, mentorId, 'Which laptop should I buy for web development?');
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('A mid-range one is enough.') } })).status, 200);
  await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE mentor_id = $1`, [mentorId]);
  const owed = async () => (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
  assert.equal((await owed()).payable, 2000);

  const r = await save({ iban: OTHER_IBAN, currentPassword: 'test-pass-12345' });
  assert.equal(r.status, 200);
  const hours = (new Date(r.user.payoutHoldUntil) - Date.now()) / 3600000;
  assert.ok(hours > 71.9 && hours <= 72, `held for 72 hours (${hours})`);
  let mail;
  for (let i = 0; i < 40 && !mail; i++) { mail = outbox().find((m) => m.to === 'mika@example.com' && /changed/i.test(m.subject)); if (!mail) await wait(100); }
  assert.ok(mail, 'the mentor is told');
  assert.match(mail.text, /ending in 4917/);
  assert.match(mail.text, /ending in 6789/);
  assert.doesNotMatch(mail.text, /GE60NB0000000123456789|GE29NB0000000101904917/, 'never the full account number');
  const now = await owed();
  assert.equal(now.payable, 0);
  assert.equal(now.holding, 2000);
  assert.equal((await admin.api(`/admin/payouts/${mentorId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'TR-1' } })).status, 409);
  const audit = (await pool.query(`SELECT reason FROM verification_audit WHERE mentor_id = $1 AND action = 'payout_changed'`, [mentorId])).rows;
  assert.match(audit[0].reason, /4917 -> 6789/);
  // After the hold the money is payable again.
  await pool.query(`UPDATE users SET payout_hold_until = now() - interval '1 minute' WHERE id = $1`, [mentorId]);
  assert.equal((await owed()).payable, 2000);
});

test('an account without a password must have signed in within the last 10 minutes', async () => {
  await pool.query(`UPDATE users SET password_hash = NULL WHERE id = $1`, [mentorId]);
  await pool.query(`UPDATE sessions SET created_at = now() - interval '11 minutes' WHERE user_id = $1`, [mentorId]);
  const old = await save({ iban: GOOD_IBAN });
  assert.equal(old.status, 403);
  assert.equal(old.error, 'reauth_required');
  await pool.query(`UPDATE sessions SET created_at = now() WHERE user_id = $1`, [mentorId]);
  assert.equal((await save({ iban: GOOD_IBAN })).status, 200);
});
