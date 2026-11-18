// A bank account (IBAN) is not needed to be shown on the site: a mentor adds it when they withdraw.
//   - an approved mentor with a price and no IBAN is listed, bookable, and earns; nothing asks for an IBAN before that
//   - a withdrawal without an IBAN asks for it right there (payout: { name, iban }): the same checks as Settings → ანაზღაურება, the account
//     holder must be the person on the verified ID (a wrong name is refused and nothing is saved), and then the request goes on
//   - money on the balance and no IBAN: the dashboard card (bankCard) and one email, "add your bank account to withdraw", at most once a
//     week, until the account is added
//   - Settings → ანაზღაურება still saves the details at any time; the admin's mentor row still says whether they exist
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, approveMentor, bookAndPay, longAnswer, wait, SAMPLE, GOOD_IBAN } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PASSWORD = 'test-pass-12345';
const REMINDER = 'Add your bank account to withdraw';
let srv, base, admin, asker, n = 0;

// An approved mentor with a price and no bank account. idName: the name on their (mock) verified ID.
async function mentor(name, email, { idName = name, price = 60 } = {}) {
  const c = await signupByEmail(resend, base, name, email);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price, sampleAnswer: SAMPLE } })).status, 200);
  const id = (await c.api('/me')).user.id;
  if (idName) {
    const k = await c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(k.status, 200, k.text);
    await client(base).api(`/mock-kyc/sessions/${k.url.split('session=')[1]}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: idName, dateOfBirth: '1985-04-12' } });
    for (let i = 0; i < 60; i++) { if ((await pool.query(`SELECT 1 FROM kyc_sessions WHERE user_id = $1 AND status = 'approved'`, [id])).rowCount) break; await wait(100); }
  }
  await approveMentor(admin, c);
  return { c, id, email, name };
}
// A paid, answered question: the mentor's share (48 ₾ of 60 ₾) is on their balance, available now (or still on hold).
async function earned(m, { available = true } = {}) {
  n += 1;
  const b = await bookAndPay(base, asker, m.id, `Question ${n}: how should I plan my first months in a new engineering job?`);
  assert.equal(b.status, 'paid', JSON.stringify(b));
  assert.equal((await m.c.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`Answer ${n}.`) } })).status, 200);
  if (available) await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE booking_id = $1`, [b.id]);
  return b.id;
}
const row = async (id) => (await pool.query('SELECT payout_name, payout_iban_enc, payout_iban_last4, payout_reminder_sent_at FROM users WHERE id = $1', [id])).rows[0];
const withdraw = (m, body) => m.c.api('/me/withdrawals', { method: 'POST', body: { currentPassword: PASSWORD, ...body } });
const reminders = (m) => resend.to(m.email, REMINDER);
const settle = () => wait(2600); // (two sweeps)

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4899, { RATE_LIMIT_MULTIPLIER: '50', PAYOUT_MIN_GEL: '40', SWEEP_INTERVAL_SECONDS: '1',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupByEmail(resend, base, 'Ana Asker', 'ana-asker@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('shown on the site without an IBAN', () => {
  let m;
  test('an approved mentor with a price and no IBAN is listed, on Browse and on their profile, and can be asked', async () => {
    m = await mentor('Nino Beridze', 'nino-noiban@example.com');
    const me = (await m.c.api('/me')).user;
    assert.equal(me.price, 60);
    assert.equal(me.hasPayoutDetails, false);
    assert.equal(me.isListedMentor, true, 'listed without a bank account');
    assert.equal(me.needsPayout, undefined, 'nothing says an IBAN is needed to be listed');
    const browse = await client(base).api('/experts');
    assert.ok(browse.experts.some((e) => e.id === m.id), 'in Browse experts');
    assert.equal((await client(base).api(`/experts/${m.id}`)).status, 200);
    assert.ok((await client(base).api(`/users/${me.username}`)).profile.mentor, 'a mentor profile');
    // asked, paid, answered: the money waits on the balance
    await earned(m);
    const b = await m.c.api('/me/balance');
    assert.equal(b.balance.available, 4800);
    assert.equal(b.needsPayoutDetails, true);
    assert.equal(b.canWithdraw, true, 'no bank account is not what stands in the way: the form asks for it');
    assert.equal(b.bankCard, true, 'the dashboard card');
  });

  test('changing the price, by the mentor or an admin, never asks for an IBAN or takes them off the site', async () => {
    const r = await m.c.api('/me', { method: 'PATCH', body: { price: 0 } });
    assert.equal(r.status, 200);
    const paid = await m.c.api('/me', { method: 'PATCH', body: { price: 60 } });
    assert.equal(paid.status, 200);
    assert.equal(paid.payoutNeeded, undefined);
    const byAdmin = await admin.api(`/admin/mentors/${m.id}/price`, { method: 'POST', body: { price: 55, reason: 'Agreed with the mentor by phone' } });
    assert.equal(byAdmin.status, 200, byAdmin.text);
    assert.equal(byAdmin.payoutNeeded, undefined);
    assert.equal((await m.c.api('/me')).user.isListedMentor, true);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { price: 60 } })).status, 200);
  });

  test('the admin still sees whether the bank account exists', async () => {
    const list = (await admin.api('/admin/mentors?status=verified')).mentors;
    assert.equal(list.find((x) => x.id === m.id).hasPayoutDetails, false);
    assert.equal((await admin.api(`/admin/mentors/${m.id}/verification`)).mentor.hasPayoutDetails, false);
    const src = fs.readFileSync(path.join(ROOT, 'public/js/admin-mentors.js'), 'utf8');
    assert.match(src, /m\.hasPayoutDetails \? 'admin\.mv\.payoutYes' : 'admin\.mv\.payoutNo'/);
  });

  describe('the withdrawal asks for it right there', () => {
    test('without the bank account the request is not made, and says what is needed; the password comes first', async () => {
      assert.equal((await m.c.api('/me/withdrawals', { method: 'POST', body: { currentPassword: 'not-my-password', payout: { name: 'Nino Beridze', iban: GOOD_IBAN } } })).error, 'wrong_password');
      const none = await withdraw(m, {});
      assert.equal(none.status, 409);
      assert.equal(none.error, 'no_payout_details');
      assert.equal((await withdraw(m, { payout: { name: 'Nino', iban: GOOD_IBAN } })).error, 'invalid_payout_name', 'a full name');
      assert.equal((await withdraw(m, { payout: { name: 'Nino Beridze', iban: 'GE00XX0000000000000000' } })).error, 'invalid_iban');
      assert.equal((await withdraw(m, { payout: { name: 'Nino Beridze' } })).error, 'missing_fields');
      assert.equal((await row(m.id)).payout_iban_enc, null, 'nothing saved by a refused request');
      assert.equal((await pool.query('SELECT 1 FROM payout_batches WHERE mentor_id = $1', [m.id])).rowCount, 0);
    });

    test('a wrong holder name (not the name on the ID) is refused, and nothing is saved', async () => {
      const r = await withdraw(m, { payout: { name: 'Giorgi Kapanadze', iban: GOOD_IBAN } });
      assert.equal(r.status, 409);
      assert.equal(r.error, 'payout_name_mismatch');
      const u = await row(m.id);
      assert.equal(u.payout_iban_enc, null);
      assert.equal(u.payout_name, null);
      assert.equal((await pool.query('SELECT 1 FROM payout_batches WHERE mentor_id = $1', [m.id])).rowCount, 0, 'no request');
      assert.equal((await pool.query(`SELECT 1 FROM mentor_flags WHERE mentor_id = $1 AND status = 'open'`, [m.id])).rowCount, 0, 'and no flag: it was simply refused');
    });

    test('the right name (in Georgian letters too): the account is saved and the request goes on', async () => {
      const r = await withdraw(m, { payout: { name: 'ნინო ბერიძე', iban: 'GE29 NB00 0000 0101 9049 17' } });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.request.amount, 4800);
      assert.equal(r.request.ibanLast4, '4917');
      const u = await row(m.id);
      assert.equal(u.payout_name, 'ნინო ბერიძე');
      assert.equal(u.payout_iban_last4, '4917');
      assert.ok(u.payout_iban_enc && !u.payout_iban_enc.includes('GE29'), 'stored encrypted');
      const me = (await m.c.api('/me')).user;
      assert.equal(me.hasPayoutDetails, true);
      const b = await m.c.api('/me/balance');
      assert.equal(b.needsPayoutDetails, false);
      assert.equal(b.bankCard, false);
      assert.equal(b.balance.requested, 4800);
      // (the request is paid to the details given with it)
      const batch = (await pool.query(`SELECT payout_name, iban_last4, status FROM payout_batches WHERE mentor_id = $1`, [m.id])).rows[0];
      assert.deepEqual(batch, { payout_name: 'ნინო ბერიძე', iban_last4: '4917', status: 'requested' });
      // the admin's row
      assert.equal((await admin.api('/admin/mentors?status=verified')).mentors.find((x) => x.id === m.id).hasPayoutDetails, true);
      // asked again: the same request, and the details are not asked for or changed
      const again = await withdraw(m, { payout: { name: 'Somebody Else', iban: GOOD_IBAN } });
      assert.equal(again.status, 200);
      assert.equal(again.existing, true);
      assert.equal((await row(m.id)).payout_name, 'ნინო ბერიძე');
    });
  });

  test('under the minimum, the details are not taken for a request that cannot be made', async () => {
    const low = await mentor('Low Balance', 'low-balance@example.com', { price: 20 });
    await earned(low); // (16 ₾ of 20 ₾: under the 40 ₾ minimum)
    const b = await low.c.api('/me/balance');
    assert.equal(b.canWithdraw, false);
    assert.ok(b.blockers.includes('below_minimum'));
    const r = await withdraw(low, { payout: { name: 'Low Balance', iban: GOOD_IBAN } });
    assert.equal(r.error, 'below_minimum');
    assert.equal((await row(low.id)).payout_iban_enc, null);
  });
});

describe('Settings → ანაზღაურება, at any time', () => {
  test('the details are saved there as before, with no money on the balance at all', async () => {
    const m = await mentor('Early Bird', 'early-bird@example.com');
    const r = await m.c.api('/me/payout', { method: 'PUT', body: { name: 'Early Bird', iban: GOOD_IBAN, currentPassword: PASSWORD } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.user.hasPayoutDetails, true);
    assert.equal((await m.c.api('/me/payout', { method: 'PUT', body: { name: 'Early', iban: GOOD_IBAN, currentPassword: PASSWORD } })).error, 'invalid_payout_name');
    assert.equal((await m.c.api('/me/balance')).needsPayoutDetails, false);
  });
});

describe('the reminder: money on the balance, no bank account', () => {
  let m, idle;
  test('one email, "add your bank account to withdraw"; not again within the week, however many sweeps', async () => {
    m = await mentor('Remind Me', 'remind-me@example.com');
    idle = await mentor('No Earnings', 'no-earnings@example.com');
    await earned(m, { available: false }); // (still on hold: it is on the balance all the same)
    const mail = await resend.waitFor(m.email, REMINDER, 15000);
    assert.equal(mail.body.subject, 'Add your bank account to withdraw your Wisecall earnings');
    assert.match(mail.body.text, /You have 48\.00 GEL on your Wisecall balance/);
    assert.match(mail.body.text, /settings\.html\?tab=payouts/);
    assert.ok((await row(m.id)).payout_reminder_sent_at, 'logged');
    await settle();
    assert.equal(reminders(m).length, 1, 'once');
    assert.equal(reminders(idle).length, 0, 'nothing on the balance: no email');
    assert.equal((await m.c.api('/me/balance')).bankCard, true);
    assert.equal((await idle.c.api('/me/balance')).bankCard, false);
  });

  test('a week later, still no bank account: once more; with the account added, never again', async () => {
    await pool.query(`UPDATE users SET payout_reminder_sent_at = now() - interval '6 days' WHERE id = $1`, [m.id]);
    await settle();
    assert.equal(reminders(m).length, 1, 'six days: not yet');
    await pool.query(`UPDATE users SET payout_reminder_sent_at = now() - interval '8 days' WHERE id = $1`, [m.id]);
    await resend.waitForNew(m.email, REMINDER, 1, 15000);
    await settle();
    assert.equal(reminders(m).length, 2, 'one more, and only one');
    // the account added in Settings: no card, and no more emails
    assert.equal((await m.c.api('/me/payout', { method: 'PUT', body: { name: 'Remind Me', iban: GOOD_IBAN, currentPassword: PASSWORD } })).status, 200);
    await pool.query(`UPDATE users SET payout_reminder_sent_at = now() - interval '30 days' WHERE id = $1`, [m.id]);
    await settle();
    assert.equal(reminders(m).length, 2);
    assert.equal((await m.c.api('/me/balance')).bankCard, false);
  });

  test('in Georgian for a Georgian-speaking mentor', () => {
    const { render } = require('../server/mail/templates');
    const ka = render('addBank', 'ka', { amount: '48.00 GEL' });
    assert.equal(ka.subject, 'დაამატე საბანკო ანგარიში Wisecall-იდან თანხის გასატანად');
    assert.match(ka.text, /ბალანსზე 48\.00 ₾ გაქვს/);
  });
});

describe('the texts', () => {
  test('nothing says an IBAN is needed to be shown: the site, the FAQ, the Terms, the guide and the approval email', () => {
    for (const l of ['en', 'ka']) {
      const all = fs.readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8');
      const d = JSON.parse(all);
      for (const k of ['settings.verify.approvedNoPayout', 'settings.payouts.needForListing', 'vt.status.verifiedNoPayout', 'vt.addPayout', 'settings.payouts.neededForPrice']) assert.equal(d[k], undefined, `${l} ${k}`);
      assert.doesNotMatch(all, l === 'en' ? /stays hidden|add your bank account first|until you add them|\(IBAN\) first/ : /დამალული რჩება|ჯერ საბანკო ანგარიში|სანამ არ დაამატებ/, l);
      for (const k of ['bal.bank.title', 'bal.bank.intro', 'bal.bank.err.name', 'dash.bank.title', 'dash.bank.body', 'dash.bank.cta']) assert.ok(d[k], `${l} ${k}`);
      const guide = fs.readFileSync(path.join(ROOT, 'docs/help', l, '05-become-a-mentor.md'), 'utf8');
      assert.doesNotMatch(guide, l === 'en' ? /payout details must be saved/ : /რეკვიზიტებიც შენახული უნდა იყოს/);
      const { render } = require('../server/mail/templates');
      assert.doesNotMatch(render('mentorApproved', l, { free: false }).text, /IBAN|last step|ბოლო ნაბიჯი/);
    }
  });

  test('the pages: the Withdraw form asks for the account; no page sends a mentor to add an IBAN to be listed', () => {
    const js = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
    assert.match(js('balance.js'), /body\.payout = \{ name: form\.payoutName\.value, iban: form\.payoutIban\.value \}/);
    for (const f of ['apply.js', 'dashboard.js', 'settings-verification.js', 'settings.js', 'price-block.js']) assert.doesNotMatch(js(f), /needsPayout\b|payoutNeeded/, f);
    assert.match(js('dashboard.js'), /bankBalance\.bankCard/);
  });
});
