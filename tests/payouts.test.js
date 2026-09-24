// Mentor payout details and the payout ledger (manual bank transfers), run against the fake test bank.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, bookAndPay, addPayoutDetails, GOOD_IBAN, SAMPLE, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-payout-outbox-${process.pid}.jsonl`);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

let srv, base, admin, seeker, mentorA, mentorB, aId, bId;

// Books, pays at the fake bank, and has the mentor answer. Returns the booking id.
async function answered(mentor, mentorId, question) {
  const b = await bookAndPay(base, seeker, mentorId, question);
  assert.equal(b.status, 'paid');
  const a = await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: 'Here is a helpful answer.' } });
  assert.equal(a.booking.status, 'answered');
  return b.id;
}
const makePayable = (mentorId) => pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE mentor_id = $1 AND status = 'pending'`, [mentorId]);
const owed = async () => (await admin.api('/admin/payouts')).mentors;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4573, { PAYOUT_HOLD_DAYS: '7', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, SUPPORT_EMAIL: 'help@example.com', EMAIL_FROM: 'Wisecall <hi@example.com>' });
  base = srv.base;
  // With email on, the verification code is only in the email, so read it from the outbox.
  const signupViaOutbox = async (name, email) => {
    const c = client(base);
    await c.api('/auth/signup', { method: 'POST', body: { name, email, password: 'test-pass-12345' } });
    let mail;
    for (let i = 0; i < 60 && !mail; i++) { mail = outbox().find((m) => m.to === email); if (!mail) await wait(100); }
    const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
    assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
    return c;
  };
  admin = await signupViaOutbox('QA Admin', 'qa-admin@example.com');
  seeker = await signupViaOutbox('Sam Seeker', 'seeker@example.com');
  const mk = async (name, email, price, language) => {
    const c = await signupViaOutbox(name, email);
    if (language) await c.api('/me', { method: 'PATCH', body: { language } });
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Expert', niche: 'business', price, proofUrl: 'https://linkedin.com/in/' + email.split('@')[0], sampleAnswer: SAMPLE } });
    const id = (await c.api('/me')).user.id;
    await admin.api(`/admin/mentors/${id}/review`, { method: 'POST', body: { approve: true, checks: { identity: true, credential: true, sample: true } } });
    return { c, id };
  };
  ({ c: mentorA, id: aId } = await mk('Nino Beridze', 'nino@example.com', 25, 'ka'));
  ({ c: mentorB, id: bId } = await mk('=HYPERLINK("http://evil","x")', 'bee@example.com', 10));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('payout details', () => {
  test('the IBAN is validated: format, country and check digits', async () => {
    const put = (name, iban) => mentorA.api('/me/payout', { method: 'PUT', body: { name, iban } });
    assert.equal((await put('Nino Beridze', 'GE30NB0000000101904917')).error, 'invalid_iban', 'wrong check digits');
    assert.equal((await put('Nino Beridze', 'DE89370400440532013000')).error, 'invalid_iban', 'not Georgian');
    assert.equal((await put('Nino Beridze', 'GE29NB000000010190491')).error, 'invalid_iban', 'too short');
    assert.equal((await put('Nino Beridze', 'GE29 NB00 0000 0101 90')).error, 'invalid_iban');
    assert.equal((await put('Nino', GOOD_IBAN)).error, 'invalid_payout_name', 'first and last name are required');
    assert.equal((await put('Nino Beridze', { a: 1 })).status, 400);
    assert.equal((await seeker.api('/me/payout', { method: 'PUT', body: { name: 'Sam Seeker', iban: GOOD_IBAN } })).error, 'not_a_mentor');
  });

  test('a mentor without payout details is approved but hidden and not bookable', async () => {
    assert.equal((await client(base).api('/experts')).experts.length, 0);
    assert.equal((await client(base).api(`/experts/${aId}`)).status, 404);
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId: aId, question: 'Can I book someone with no payout details?' } });
    assert.equal(r.status, 404);
    const me = (await mentorA.api('/me')).user;
    assert.equal(me.verificationStatus, 'verified');
    assert.equal(me.hasPayoutDetails, false);
  });

  test('saving accepts spaces and lower case, stores the IBAN encrypted, and lists the mentor', async () => {
    const r = await mentorA.api('/me/payout', { method: 'PUT', body: { name: '  Nino   Beridze ', iban: 'ge29 nb00 0000 0101 9049 17' } });
    assert.equal(r.status, 200);
    assert.equal(r.iban, 'GE29 NB00 0000 0101 9049 17');
    assert.equal(r.name, 'Nino Beridze');
    await addPayoutDetails(mentorB, 'GE29NB0000000101904917', 'Bee Keeper');

    const db = (await pool.query('SELECT payout_iban_enc, payout_iban_last4, payout_name FROM users WHERE id = $1', [aId])).rows[0];
    assert.match(db.payout_iban_enc, /^v1:/);
    assert.ok(!db.payout_iban_enc.includes('GE29') && !db.payout_iban_enc.includes('0101904917'), 'IBAN is not stored in clear text');
    assert.equal(db.payout_iban_last4, '4917');
    assert.equal((await client(base).api('/experts')).experts.length, 2, 'both mentors are listed now');
  });

  test('only the mentor and admins can read the IBAN', async () => {
    const own = await mentorA.api('/me/payout');
    assert.equal(own.iban, 'GE29 NB00 0000 0101 9049 17');
    assert.equal(own.hasPayoutDetails, true);
    assert.equal((await seeker.api('/me/payout')).iban, '', 'another user gets nothing');
    assert.equal((await client(base).api('/me/payout')).status, 401);
    // Never in the profile, the public listing or another mentor's data.
    const me = await mentorA.api('/me');
    assert.doesNotMatch(me.text, /GE29|payoutIbanEnc|v1:/);
    assert.doesNotMatch((await client(base).api('/experts')).text, /GE29|payout|iban/i);
    assert.doesNotMatch((await client(base).api(`/experts/${aId}`)).text, /GE29|payout|iban/i);
    assert.equal((await seeker.api('/admin/payouts')).error, 'not_admin');
    assert.equal((await mentorA.api('/admin/payouts.csv')).status, 403);
  });
});

describe('earnings ledger and manual payouts', () => {
  let bookingA1, bookingA2;

  test('an answered booking creates one pending payout, payable after the hold period', async () => {
    bookingA1 = await answered(mentorA, aId, 'What should I focus on this year?');
    const row = (await pool.query('SELECT * FROM payouts WHERE booking_id = $1', [bookingA1])).rows[0];
    assert.equal(row.amount, 2000, '25 GEL minus the 20% fee');
    assert.equal(row.status, 'pending');
    assert.equal(row.currency, 'gel');
    const days = (new Date(row.payable_at) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1, `payable in ~7 days (${days})`);

    // Editing the answer must not create a second payout.
    await mentorA.api(`/bookings/${bookingA1}/answer`, { method: 'POST', body: { answer: 'A better answer.' } });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payouts WHERE booking_id = $1', [bookingA1])).rows[0].n, 1);
  });

  test('the mentor sees earnings on hold; the admin sees nothing payable yet', async () => {
    const e = await mentorA.api('/me/earnings');
    assert.equal(e.balance.holding, 2000);
    assert.equal(e.balance.payable, 0);
    assert.equal(e.items.length, 1);
    assert.equal(e.items[0].status, 'pending');
    const list = await owed();
    const a = list.find((m) => m.mentorId === aId);
    assert.equal(a.holding, 2000);
    assert.equal(a.net, 0);
    const pay = await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'TR-0' } });
    assert.equal(pay.error, 'nothing_to_pay');
  });

  test('after the hold the admin sees the IBAN and amount, and can download the transfers as CSV', async () => {
    await makePayable(aId);
    const a = (await owed()).find((m) => m.mentorId === aId);
    assert.equal(a.payable, 2000);
    assert.equal(a.net, 2000);
    assert.equal(a.payoutName, 'Nino Beridze');
    assert.equal(a.iban, 'GE29 NB00 0000 0101 9049 17');

    const res = await fetch(`${base}/api/admin/payouts.csv`, { headers: { cookie: await cookieOf(admin) } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'byte-order mark so Excel reads Georgian text');
    const csv = bytes.toString('utf8');
    assert.match(csv, /mentor_name,mentor_email,account_holder,iban,amount_gel,currency/);
    assert.match(csv, /Nino Beridze,nino@example\.com,Nino Beridze,GE29NB0000000101904917,20\.00,GEL,1/);
  });

  test('CSV cells that could run as spreadsheet formulas are neutralised', async () => {
    const bId1 = await answered(mentorB, bId, 'Formula injection question');
    assert.ok(bId1);
    await makePayable(bId);
    const csv = await (await fetch(`${base}/api/admin/payouts.csv`, { headers: { cookie: await cookieOf(admin) } })).text();
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/, 'leading = is escaped with an apostrophe');
  });

  test('mark as paid: needs a reference and the amount the admin saw; a stale amount is refused', async () => {
    assert.equal((await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: '  ' } })).error, 'reference_required');
    assert.equal((await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 1500, reference: 'TR-1' } })).error, 'amount_changed');
    assert.equal((await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: '2000', reference: 'TR-1' } })).error, 'invalid_amount');
    assert.equal((await seeker.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'TR-1' } })).error, 'not_admin');
    const ok = await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'BOG-TR-0001' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.batch.amount, 2000);
    assert.equal(ok.batch.reference, 'BOG-TR-0001');
    // Doing it again (a double click) finds nothing left to pay.
    assert.equal((await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'BOG-TR-0001' } })).error, 'nothing_to_pay');
  });

  test('the mentor sees the payout in their history, and is emailed in their own language', async () => {
    const e = await mentorA.api('/me/earnings');
    assert.equal(e.balance.paid, 2000);
    assert.equal(e.balance.payable, 0);
    assert.equal(e.batches[0].reference, 'BOG-TR-0001');
    assert.equal(e.items[0].status, 'paid');
    for (let i = 0; i < 40 && !outbox().some((m) => m.to === 'nino@example.com' && /BOG-TR-0001/.test(m.html)); i++) await wait(100);
    const mail = outbox().find((m) => m.to === 'nino@example.com' && /BOG-TR-0001/.test(m.html));
    assert.ok(mail, 'payout email was sent');
    assert.match(mail.subject, /ანაზღაურება/, 'Georgian, the mentor’s language');
    assert.match(mail.html, /20\.00 GEL/);
    assert.match(mail.html, /4917/);
    assert.doesNotMatch(mail.html, /GE29NB/, 'the full IBAN is never emailed');

    const hist = await admin.api('/admin/payouts/history');
    assert.equal(hist.batches[0].reference, 'BOG-TR-0001');
    assert.equal(hist.batches[0].mentorName, 'Nino Beridze');
  });

  test('refunding an answered booking before it is paid out voids the payout', async () => {
    bookingA2 = await answered(mentorA, aId, 'This one will be refunded early');
    assert.equal((await mentorA.api('/me/earnings')).balance.holding, 2000);
    const r = await admin.api(`/admin/bookings/${bookingA2}/refund`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.mentorOwesBack, false);
    const p = (await pool.query('SELECT status FROM payouts WHERE booking_id = $1', [bookingA2])).rows[0];
    assert.equal(p.status, 'void');
    const e = await mentorA.api('/me/earnings');
    assert.equal(e.balance.holding, 0);
    assert.equal(e.items.find((i) => i.bookingId === bookingA2).status, 'void');
  });

  test('refunding after the payout was paid records a debt that is deducted from the next payout', async () => {
    // The first booking was already paid out to the mentor. Refund it now.
    const admin1 = (await admin.api('/admin/bookings?status=answered')).bookings.find((b) => b.id === bookingA1);
    assert.equal(admin1.payoutStatus, 'paid', 'the admin list shows the mentor was already paid');
    const r = await admin.api(`/admin/bookings/${bookingA1}/refund`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.mentorOwesBack, true);
    let e = await mentorA.api('/me/earnings');
    assert.equal(e.balance.debt, 2000);
    assert.equal((await owed()).find((m) => m.mentorId === aId).debt, 2000);

    // New earnings are reduced by the debt. Here they cancel out exactly: no transfer, just a settlement.
    const bookingA3 = await answered(mentorA, aId, 'A fresh question after the refund');
    assert.ok(bookingA3);
    await makePayable(aId);
    const row = (await owed()).find((m) => m.mentorId === aId);
    assert.equal(row.payable, 2000);
    assert.equal(row.debt, 2000);
    assert.equal(row.net, 0);
    assert.equal((await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 2000, reference: 'WRONG' } })).error, 'amount_changed', 'must be the net amount, not the gross');
    const settle = await admin.api(`/admin/payouts/${aId}/pay`, { method: 'POST', body: { amount: 0, reference: 'SETTLED-1' } });
    assert.equal(settle.status, 200);
    assert.equal(settle.batch.amount, 0);
    e = await mentorA.api('/me/earnings');
    assert.equal(e.balance.debt, 0, 'the debt is settled');
    assert.equal(e.balance.payable, 0);
    assert.equal((await owed()).find((m) => m.mentorId === aId), undefined, 'nothing is owed to or by this mentor any more');
  });
});

// Reads the session cookie of a test client by asking it to log in again is not possible, so the
// admin client is re-authenticated here to get a cookie for plain fetch() calls (CSV downloads).
async function cookieOf() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' },
    body: JSON.stringify({ email: 'qa-admin@example.com', password: 'test-pass-12345' })
  });
  return res.headers.get('set-cookie').split(';')[0];
}
