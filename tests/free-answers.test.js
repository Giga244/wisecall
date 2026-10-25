// Free answers (docs/CLAUDE-CODE-FREE-ANSWERS.md): a mentor sets their price to 0 and answers for free. A free question makes no payment,
// receipt, ledger or payout row and no bank call; it keeps the deadline, probation, the follow-up, ratings and reports; when it ends
// unanswered it is closed (not refunded); and it has its own limits (a confirmed email, 2 open per mentor, 5 open in all, the mentor's
// weekly number). An existing paid mentor can switch to free and back.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, addPayoutDetails, approveMentor, SAMPLE, wait, longQuestion, longAnswer } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, seeker, mentor, mentorId, mentorUsername, paidMentorId, busy;

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
const ask = (c, question = 'How do I choose between two job offers in Tbilisi?', extra = {}) =>
  c.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion(question), ...extra } });
// No money record of any kind for these bookings.
async function noMoney(ids) {
  const q = async (sql) => (await pool.query(sql, [ids])).rows[0].n;
  assert.equal(await q('SELECT count(*)::int AS n FROM receipts WHERE booking_id = ANY($1::uuid[])'), 0, 'no receipt');
  assert.equal(await q('SELECT count(*)::int AS n FROM payouts WHERE booking_id = ANY($1::uuid[])'), 0, 'no payout');
  assert.equal(await q(`SELECT count(*)::int AS n FROM bookings WHERE id = ANY($1::uuid[]) AND (amount <> 0 OR platform_fee_amount <> 0 OR mentor_net_amount <> 0
    OR provider <> 'free' OR provider_order_id IS NOT NULL OR provider_refund_id IS NOT NULL OR refunded_amount IS NOT NULL)`), 0, 'no fee, no bank');
}
async function makeMentor(name, email, price) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Career coach', niche: 'business', price, proofUrl: 'https://linkedin.com/in/' + email.split('@')[0], sampleAnswer: SAMPLE } });
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  return { c, me: (await c.api('/me')).user };
}

before(async () => {
  await resetDatabase();
  // (PROBATION_ANSWERS 1: the mentor's first answer is held for a check, as a new mentor's are)
  srv = await startServer(4775, { SWEEP_INTERVAL_SECONDS: '1', PROBATION_ANSWERS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  // An approved mentor at 5 ₾, like the first real one.
  ({ c: mentor, me: { id: mentorId, username: mentorUsername } } = await makeMentor('Nino Free', 'nino@example.com', 5));
  ({ me: { id: paidMentorId } } = await makeMentor('Paid Pat', 'pat@example.com', 40));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the price', () => {
  test('an existing mentor at 5 ₾ switches to free (0) and stays listed; 1 to 4 ₾ and an empty price are still refused', async () => {
    for (const price of [3, 4, '', -1, 2001]) assert.equal((await mentor.api('/me', { method: 'PATCH', body: { price } })).error, 'invalid_price', String(price));
    const r = await mentor.api('/me', { method: 'PATCH', body: { price: 0 } });
    assert.equal(r.status, 200);
    assert.equal(r.user.price, 0);
    assert.equal(r.user.freeWeeklyCap, 10, 'ten free questions a week unless the mentor changes it');
    assert.equal((await pool.query('SELECT price FROM users WHERE id = $1', [mentorId])).rows[0].price, 0);
    const listed = (await client(base).api('/experts')).experts.find((e) => e.id === mentorId);
    assert.ok(listed, 'still in Browse experts');
    assert.equal(listed.price, 0);
    assert.equal(listed.freeFull, false);
  });

  test('from free to a paid price and back, and the weekly number is 1 to 100', async () => {
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { price: 30 } })).user.price, 30);
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { price: 0 } })).user.price, 0);
    for (const n of [0, 101, 2.5, 'x']) assert.equal((await mentor.api('/me', { method: 'PATCH', body: { freeWeeklyCap: n } })).error, 'invalid_free_cap', String(n));
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { freeWeeklyCap: 4 } })).user.freeWeeklyCap, 4);
  });

  test('the database allows 0 and 5–2000 only', async () => {
    await assert.rejects(pool.query('UPDATE users SET price = 2 WHERE id = $1', [mentorId]), /users_price_check/);
    await assert.rejects(pool.query('UPDATE users SET free_weekly_cap = 0 WHERE id = $1', [mentorId]), /free_weekly_cap/);
  });
});

describe('Browse and the profile', () => {
  test('"Free" is a filter, and the card, the profile and the server-drawn pages say Free instead of a price', async () => {
    const all = (await client(base).api('/experts')).experts.map((e) => e.id);
    assert.ok(all.includes(mentorId) && all.includes(paidMentorId));
    const free = (await client(base).api('/experts?free=1')).experts.map((e) => e.id);
    assert.deepEqual(free, [mentorId]);
    const p = await client(base).api(`/users/${mentorUsername}`);
    assert.equal(p.profile.mentor.price, 0);
    assert.equal(p.profile.mentor.freeFull, false);
    const html = await (await fetch(`${base}/u/${mentorUsername}`)).text();
    assert.match(html, /Free/);
    assert.doesNotMatch(html, /0 GEL per question/);
    const ka = await (await fetch(`${base}/ka/u/${mentorUsername}`)).text();
    assert.match(ka, /უფასო/);
    // (the front end shows "Free" from formatPrice, and the "Free" chip in Browse)
    const api = await (await fetch(`${base}/js/api.js`)).text();
    assert.match(api, /Number\(lari\) === 0 \? \(\(window\.WisecallI18n && WisecallI18n\.t\('price\.free'\)\)/);
    assert.match(await (await fetch(`${base}/js/main.js`)).text(), /data-free aria-pressed/);
    for (const l of ['en', 'ka']) {
      const d = await (await fetch(`${base}/i18n/${l}.json`)).json();
      for (const k of ['price.free', 'experts.filter.free', 'expert.freeFull', 'expert.sendFree', 'price.mode.free', 'price.mode.paid', 'dash.status.free.refunded']) assert.ok(d[k], `${l}: ${k}`);
    }
  });
});

describe('a free question', () => {
  let first;
  test('is sent at once: no bank, no receipt, no ledger or payout row, no fee', async () => {
    const r = await ask(seeker);
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal(r.free, true);
    assert.equal(r.checkoutUrl, undefined);
    first = r.booking.id;
    const b = await row(first);
    assert.equal(b.status, 'paid');
    assert.equal(b.amount, 0);
    assert.equal(b.provider, 'free');
    assert.ok(b.paid_at && b.answer_deadline, 'the usual answer deadline');
    assert.ok(Math.abs(new Date(b.answer_deadline) - Date.now() - 7 * 86400000) < 60000, '7 days');
    await noMoney([first]);
    // the mentor sees it, as a free question
    const received = (await mentor.api('/bookings/mine')).received;
    assert.ok(received.find((x) => x.id === first && x.amount === 0));
    const n = await waitFor(async () => (await pool.query(`SELECT kind FROM notifications WHERE user_id = $1 AND kind = 'new_free_question'`, [mentorId])).rows.length);
    assert.equal(n, 1);
  });

  test('a discount code does not apply to a free question', async () => {
    assert.equal((await ask(seeker, 'Another question with a code', { discountCode: 'WC-ABCD-EFGH' })).error, 'free_no_code');
  });

  test('probation still holds a new mentor\'s free answer; released, it is readable and still makes no payout', async () => {
    const r = await mentor.api(`/bookings/${first}/answer`, { method: 'POST', body: { answer: longAnswer('Write down what each offer teaches you in a year.') } });
    assert.equal(r.status, 200, JSON.stringify(r));
    let b = await row(first);
    assert.equal(b.status, 'answered');
    assert.equal(b.answer_review, 'held', 'held for a check, like a paid answer');
    const asker = (await seeker.api(`/bookings/${first}`)).booking;
    assert.ok(!asker.answer, 'the asker cannot read it yet');
    assert.equal((await admin.api(`/admin/answers/${first}/approve`, { method: 'POST' })).status, 200);
    b = await row(first);
    assert.equal(b.answer_review, 'released');
    assert.ok((await seeker.api(`/bookings/${first}`)).booking.answer);
    await wait(1500);
    await noMoney([first]);
  });

  test('a report about a free answer: no refund options, but it can be upheld', async () => {
    const d = await seeker.api(`/bookings/${first}/dispute`, { method: 'POST', body: { reason: 'wrong_or_harmful', details: 'This advice could hurt someone.' } });
    assert.equal(d.status, 201, JSON.stringify(d));
    const list = (await admin.api('/admin/disputes')).disputes;
    const dis = list.find((x) => x.bookingId === first);
    assert.equal(dis.amount, 0);
    for (const outcome of ['full_refund', 'partial_refund']) {
      assert.equal((await admin.api(`/admin/disputes/${dis.id}/resolve`, { method: 'POST', body: { outcome, amount: 1, note: 'Refund it please.' } })).error, 'invalid_outcome', outcome);
    }
    const ok = await admin.api(`/admin/disputes/${dis.id}/resolve`, { method: 'POST', body: { outcome: 'upheld', note: 'The answer was unsafe; we spoke to the mentor.' } });
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.equal((await row(first)).status, 'answered', 'the question stays answered');
    await noMoney([first]);
  });

  test('a paid question\'s report cannot be "upheld" without money', async () => {
    const r = await pool.query(`INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount, status, provider, provider_order_id, paid_at, answered_at, answer)
      VALUES ((SELECT id FROM users WHERE email = 'seeker@example.com'), $1, $2, 4000, 'gel', 20, 800, 3200, 'answered', 'mock', 'test-order-upheld', now(), now(), $3) RETURNING id`,
    [paidMentorId, longQuestion('A paid one'), longAnswer('A paid answer')]);
    const d = await pool.query(`INSERT INTO disputes (booking_id, opened_by, reason) VALUES ($1, (SELECT id FROM users WHERE email = 'seeker@example.com'), 'other') RETURNING id`, [r.rows[0].id]);
    assert.equal((await admin.api(`/admin/disputes/${d.rows[0].id}/resolve`, { method: 'POST', body: { outcome: 'upheld', note: 'Not for paid ones.' } })).error, 'invalid_outcome');
    await pool.query('DELETE FROM disputes WHERE id = $1', [d.rows[0].id]);
    await pool.query('DELETE FROM bookings WHERE id = $1', [r.rows[0].id]);
  });
});

describe('when a free question ends without an answer', () => {
  test('the deadline closes it: no refund attempt, no money record, and the asker is told', async () => {
    const r = await ask(seeker, 'What should I ask in a first interview?');
    assert.equal(r.status, 201, JSON.stringify(r));
    await pool.query(`UPDATE bookings SET answer_deadline = now() - interval '1 minute' WHERE id = $1`, [r.booking.id]);
    const b = await waitFor(async () => { const x = await row(r.booking.id); return x.status === 'refunded' ? x : null; });
    assert.equal(b.refund_reason, 'no_answer_deadline');
    assert.ok(b.refunded_at);
    assert.equal(b.refund_error, null);
    await noMoney([b.id]);
    const n = await waitFor(async () => (await pool.query(`SELECT 1 FROM notifications WHERE booking_id = $1 AND kind = 'free_closed'`, [b.id])).rows.length);
    assert.equal(n, 2, 'the asker and the mentor');
    assert.match(srv.logs(), /auto-refunded unanswered booking/);
    assert.doesNotMatch(srv.logs(), new RegExp(`refund of ${b.id} failed`));
  });

  test('the mentor declines it: closed at once, nothing to refund', async () => {
    const r = await ask(seeker, 'Is it worth moving to Batumi for work?');
    const d = await mentor.api(`/bookings/${r.booking.id}/decline`, { method: 'POST', body: { reason: 'not_qualified', note: '' } });
    assert.equal(d.status, 200, JSON.stringify(d));
    const b = await row(r.booking.id);
    assert.equal(b.status, 'refunded');
    assert.equal(b.refund_reason, 'declined_not_qualified');
    await noMoney([b.id]);
  });
});

describe('the limits', () => {
  test('the asker needs a confirmed email', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'New Person', email: 'unconfirmed@example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201);
    const r = await ask(c, 'A question before confirming my email');
    assert.equal(r.status, 403);
    assert.equal(r.error, 'email_not_verified');
  });

  test('at most 2 open free questions with one mentor, and 5 in all', async () => {
    const asker = busy = await signupVerified(base, 'Busy Asker', 'busy@example.com');
    const askerId = (await asker.api('/me')).user.id;
    await mentor.api('/me', { method: 'PATCH', body: { freeWeeklyCap: 100 } });
    const a1 = await ask(asker, 'First open one');
    assert.equal(a1.status, 201);
    assert.equal((await ask(asker, 'Second open one')).status, 201);
    const third = await ask(asker, 'Third open one');
    assert.equal(third.status, 409);
    assert.equal(third.error, 'free_limit_mentor');
    // An answer frees a place with this mentor ...
    assert.equal((await mentor.api(`/bookings/${a1.booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('An answer that frees a place.') } })).status, 200);
    // ... but with 4 open free questions elsewhere (written directly, with other accounts as the mentors) the asker has 5 open in all.
    const othersIds = (await pool.query(`SELECT id FROM users WHERE email IN ('qa-admin@example.com', 'pat@example.com', 'seeker@example.com', 'unconfirmed@example.com')`)).rows.map((r) => r.id);
    assert.equal(othersIds.length, 4);
    for (let i = 0; i < 4; i++) {
      const id = othersIds[i];
      await pool.query(`INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount, status, provider, paid_at, answer_deadline)
        VALUES ($1, $2, $3, 0, 'gel', 0, 0, 0, 'paid', 'free', now(), now() + interval '7 days')`, [askerId, id, longQuestion('Elsewhere ' + i)]);
    }
    const sixth = await ask(asker, 'One more, over the total');
    assert.equal(sixth.status, 409);
    assert.equal(sixth.error, 'free_limit_total');
    await pool.query(`UPDATE bookings SET status = 'refunded', refunded_at = now(), refund_reason = 'other' WHERE seeker_id = $1 AND status = 'paid'`, [askerId]);
    assert.equal((await ask(asker, 'Room again once they are closed')).status, 201);
  });

  test('"Free questions are full this week" when the mentor\'s weekly number is reached', async () => {
    const used = (await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE mentor_id = $1 AND amount = 0 AND created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [mentorId])).rows[0].n;
    await mentor.api('/me', { method: 'PATCH', body: { freeWeeklyCap: used + 1 } });
    assert.equal((await ask(seeker, 'The last free one this week')).status, 201);
    const full = await ask(busy, 'One too many this week');
    assert.equal(full.status, 409);
    assert.equal(full.error, 'free_full');
    assert.equal((await client(base).api(`/experts/${mentorId}`)).expert.freeFull, true);
    assert.equal((await client(base).api(`/users/${mentorUsername}`)).profile.mentor.freeFull, true);
    // last week's questions do not count
    await pool.query(`UPDATE bookings SET created_at = created_at - interval '8 days' WHERE mentor_id = $1 AND amount = 0`, [mentorId]);
    assert.equal((await client(base).api(`/experts/${mentorId}`)).expert.freeFull, false);
  });
});

describe('the rest of the site', () => {
  test('the admin overview counts free and paid questions apart, and the money figures still work', async () => {
    const o = await admin.api('/admin/overview');
    assert.equal(o.status, 200, JSON.stringify(o));
    assert.ok(o.questions.free.total >= 5);
    assert.ok(o.questions.free.byStatus.answered >= 1);
    assert.ok(o.questions.free.byStatus.refunded >= 2);
    assert.equal(o.questions.byStatus.answered || 0, 0, 'no paid answered question in this test');
    assert.equal(o.money.received, 0);
    assert.equal(o.money.fee, 0);
    assert.equal(o.payouts.payable + o.payouts.holding, 0);
    const w = await admin.api('/admin/withdrawals');
    assert.equal(w.status, 200, JSON.stringify(w));
  });

  test('back to a paid price: the next question goes to the bank again', async () => {
    await mentor.api('/me', { method: 'PATCH', body: { price: 20 } });
    const r = await ask(seeker, 'A paid question again');
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.ok(r.checkoutUrl);
    assert.equal(r.booking.status, 'pending_payment');
    assert.equal(r.booking.amount, 2000);
    await mentor.api('/me', { method: 'PATCH', body: { price: 0 } });
  });

  test('the database refuses a free booking with a fee, a share or a bank, and the data profile finds no problem with free questions', async () => {
    const ids = (await pool.query(`SELECT seeker_id, mentor_id FROM bookings WHERE amount = 0 LIMIT 1`)).rows[0];
    const ins = (amount, fee, net, provider) => pool.query(`INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount, status, provider)
      VALUES ($1, $2, 'x', $3, 'gel', 0, $4, $5, 'paid', $6)`, [ids.seeker_id, ids.mentor_id, amount, fee, net, provider]);
    await assert.rejects(ins(0, 0, 0, 'mock'), /bookings_free_check/);
    await assert.rejects(ins(0, 1, 0, 'free'), /bookings_free_check/);
    await assert.rejects(ins(100, 20, 80, 'free'), /bookings_free_check/);
    await assert.rejects(ins(-1, 0, 0, 'free'), /bookings_amount_check|bookings_free_check/);
    const out = execFileSync(process.execPath, ['scripts/profile-db.js', '--stdout'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8' });
    assert.match(out, /free question \(amount 0\) with a receipt, a payout, a fee, a share or a bank order \| 0 \|/);
    const problems = out.split(/\n## /).find((s) => /^Problems found/i.test(s)) || '';
    assert.doesNotMatch(problems, /provider_order_id|refunded amount|free question/);
  });
});
