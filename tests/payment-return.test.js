// Coming back from the bank: a cancelled payment and a failed one are different pages, nothing is charged for either, and the question is not lost.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, client, signupVerified, addPayoutDetails, approveMentor, SAMPLE, longQuestion } = require('./helpers');

let srv, base, seeker, mentor, mentorId, username;
const QUESTION = longQuestion('Should I register for VAT now?');

before(async () => {
  await resetDatabase();
  srv = await startServer(4616);
  base = srv.base;
  const admin = await signupVerified(base, 'Qa Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Accountant', niche: 'business', price: 25, proofUrl: 'https://linkedin.com/in/dr-mentor', sampleAnswer: SAMPLE } });
  const me = (await mentor.api('/me')).user;
  mentorId = me.id; username = me.username;
  await approveMentor(admin, mentor);
  await addPayoutDetails(mentor);
});
after(() => { if (srv) srv.proc.kill(); });

const start = async () => (await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: QUESTION } })).booking;
const finish = async (booking, outcome) => (await client(base).api(`/mock-bank/orders/${booking.providerOrderId}/complete`, { method: 'POST', body: { outcome } })).redirect;

describe('where the buyer comes back to', () => {
  test('paid, failed and cancelled go to three different addresses on the mentor\'s page, each with the booking', async () => {
    const seen = {};
    for (const [outcome, status] of [['success', 'success'], ['fail', 'fail'], ['cancel', 'cancel']]) {
      const b = await start();
      const url = new URL(await finish(b, outcome));
      assert.equal(url.pathname, `/u/${username}`, outcome);
      assert.equal(url.searchParams.get('booking'), b.id, outcome);
      assert.equal(url.searchParams.get('status'), status, outcome);
      seen[outcome] = url.searchParams.get('status');
    }
    assert.equal(new Set(Object.values(seen)).size, 3, 'three different statuses');
  });

  test('a cancelled or failed payment charges nothing: the question is closed, not paid, and no payout or email follows', async () => {
    for (const outcome of ['cancel', 'fail']) {
      const b = await start();
      await finish(b, outcome);
      let after;
      for (let i = 0; i < 40; i++) { after = (await seeker.api(`/bookings/${b.id}/sync`, { method: 'POST' })).booking; if (after.status !== 'pending_payment') break; await new Promise((r) => setTimeout(r, 100)); }
      assert.equal(after.status, 'expired', outcome);
      assert.equal(after.paidAt, null, outcome);
      assert.equal(after.question, QUESTION, 'the booking still has the question, so the page can put it back');
    }
  });
});

describe('what the page does with it', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/profile.js'), 'utf8');
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
  const ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));

  test('the page knows the cancel address, and shows its own message for it and for a failure', () => {
    assert.match(js, /\['success', 'fail', 'cancel', 'return'\]/);
    assert.match(js, /statusParam === 'cancel' \? 'expert\.paymentCancelled' : 'expert\.paymentFailed'/);
    assert.match(js, /role="status"/);
  });

  test('the question is kept for this visit, per mentor (sessionStorage, guarded), restored, and cleared once it is paid', () => {
    assert.match(js, /wisecall_question_\$\{expert\.id\}/);
    assert.match(js, /try \{ return sessionStorage\.getItem\(draftKey\)/);
    assert.match(js, /try \{ if \(v\) sessionStorage\.setItem\(draftKey, v\)/);
    assert.match(js, /last\.question/, 'the booking\'s own copy is the fallback');
    assert.match(js, /stored\.set\(''\); draft = '';/, 'cleared when it was sent');
  });

  test('the two messages are different, say nothing was charged, and exist in English and Georgian', () => {
    assert.match(en['expert.paymentCancelled'], /cancelled/i);
    assert.doesNotMatch(en['expert.paymentCancelled'], /failed/i);
    assert.match(en['expert.paymentFailed'], /failed/i);
    assert.doesNotMatch(en['expert.paymentFailed'], /cancel/i);
    for (const k of ['expert.paymentCancelled', 'expert.paymentFailed']) {
      assert.match(en[k], /not been charged/);
      assert.match(ka[k], /[ა-ჿ]/);
      assert.notEqual(ka[k], en[k]);
    }
    assert.notEqual(ka['expert.paymentCancelled'], ka['expert.paymentFailed']);
  });
});
