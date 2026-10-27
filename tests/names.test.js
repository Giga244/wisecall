// Name matching: the matcher itself, and how it drives the verification step, flags and payouts.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const names = require('../server/verification/names');
const { resetDatabase, startServer, signupVerified, client, bookAndPay, addPayoutDetails, approveMentor, SAMPLE, wait } = require('./helpers');
const { longAnswer } = require('./helpers');

describe('the matcher', () => {
  const same = (a, b) => assert.equal(names.compareNames(a, b).match, true, `${a} should match ${b}`);
  const different = (a, b) => assert.equal(names.compareNames(a, b).match, false, `${a} should not match ${b}`);

  test('Georgian script matches Latin script', () => {
    assert.equal(names.transliterate('ნინო ბერიძე'), 'nino beridze');
    assert.equal(names.transliterate('ქეთევან წერეთელი'), 'ketevan tsereteli');
    same('ნინო ბერიძე', 'Nino Beridze');
    same('თამარ გელაშვილი', 'Tamar Gelashvili');
    same('ქეთევან წერეთელი', 'KETEVAN TSERETELI');
    same('გიორგი ჯაფარიძე', 'Giorgi Japaridze');
  });

  test('common spelling variants of Georgian names match', () => {
    same('Nino Kapanadze', 'Nino Kapanadse');
    same('Giorgy Beridze', 'Giorgi Beridze');
    same('Tamar Gelashvili', 'Tamar Gelasvili');
    same('Levan Khubutia', 'Levan Xubutia');
    same('Mariam Japaridze', 'Mariam Djaparidze');
    same('Ketevan Tsereteli', 'Ketevan Cereteli');
  });

  test('word order, titles, accents, case and a missing middle name do not matter', () => {
    same('Beridze Giorgi', 'Giorgi Beridze');
    same('Dr. Nino Beridze', 'NINO BERIDZE');
    same('Prof. Ana-Maria Éliade', 'Ana Maria Eliade');
    same('Nino Beridze', 'Nino Beridze-Kapanadze');
    same('Nino Beridze', 'Nino Tamazi Beridze');
    same('N. Beridze', 'Nino Beridze');
  });

  test('different people do not match', () => {
    different('Nino Beridze', 'Ana Kapanadze');
    different('Giorgi Beridze', 'Giorgi Bakuradze');
    different('Nino Beridze', 'Tamar Beridze');
    different('Nino', 'Nino');           // one word is never enough
    different('', 'Nino Beridze');
  });
});

describe('name match in the verification flow (with the fake ID check)', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let srv, base, admin, seeker, mentor, mentorId;
  const step = async () => (await pool.query(`SELECT * FROM verification_steps WHERE user_id = $1 AND step = 'name_match'`, [mentorId])).rows[0];
  const flagsOpen = async () => (await pool.query(`SELECT kind FROM mentor_flags WHERE mentor_id = $1 AND status = 'open' ORDER BY kind`, [mentorId])).rows.map((r) => r.kind);
  async function passId(c, fullName) {
    const start = await c.api('/verification/kyc/start', { method: 'POST' });
    const sid = start.url.split('=').pop();
    await client(base).api(`/mock-kyc/sessions/${sid}/complete`, { method: 'POST', body: { outcome: 'approve', fullName, dateOfBirth: '1990-05-12' } });
    for (let i = 0; i < 40; i++) { if ((await c.api('/verification')).requirements.find((r) => r.step === 'id_kyc').status === 'passed') return; await wait(100); }
    throw new Error('the ID check did not pass');
  }

  before(async () => {
    await resetDatabase();
    srv = await startServer(4578, { PAYOUT_CHANGE_HOLD_HOURS: '0' }); // (the 72-hour hold after a change has its own tests)
    base = srv.base;
    admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
    mentor = await signupVerified(base, 'ნინო ბერიძე', 'nino@example.com');   // profile name in Georgian script
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, proofUrl: 'https://dribbble.com/nino', sampleAnswer: SAMPLE } });
    mentorId = (await mentor.api('/me')).user.id;
  });
  after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

  test('there is nothing to compare until the ID check is approved', async () => {
    assert.equal(await step(), undefined);
  });

  test('when every name matches, the step passes by itself (Georgian profile vs Latin ID)', async () => {
    await passId(mentor, 'Nino Beridze');
    // (the name is compared just after the ID check passes, server/verification/kyc.js afterApproved: wait for it rather than race it)
    let s;
    for (let i = 0; i < 50 && !(s && s.status === 'passed'); i++) { s = await step(); if (!(s && s.status === 'passed')) await wait(100); }
    assert.equal(s.status, 'passed');
    assert.equal(s.decided_by, null, 'decided by the system');
    assert.ok(s.evidence.results.some((r) => /Profile name.*matches/.test(r)));
    assert.deepEqual(await flagsOpen(), []);
  });

  test('a name that does not match is flagged for an admin and never approved automatically', async () => {
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Ana Kapanadze' } });
    const s = await step();
    assert.equal(s.status, 'pending');
    assert.ok(s.evidence.results.some((r) => /DOES NOT MATCH/.test(r)));
    assert.deepEqual(await flagsOpen(), ['name_mismatch']);
    const d = await admin.api(`/admin/mentors/${mentorId}/verification`);
    assert.equal(d.flags.length, 1);
    assert.equal(d.flags[0].detail.idName, undefined, 'the ID name is never stored in a flag');
    assert.equal(d.kyc.verifiedName, 'Nino Beridze', 'admins read it from the encrypted ID record');
    assert.equal(d.requirements.find((r) => r.step === 'name_match').status, 'pending');
    // Changing the name back clears it again.
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Nino Beridze' } });
    assert.equal((await step()).status, 'passed');
    assert.deepEqual(await flagsOpen(), []);
  });

  test('an admin can accept a mismatch with a reason; that decision stands until a name changes', async () => {
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Nino B. Kapanadze-Beridze' } });
    assert.equal((await step()).status, 'passed', 'a longer double surname still matches');
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Ana Kapanadze' } });
    assert.equal((await step()).status, 'pending');
    // (refusing a name needs a reason the mentor can read; accepting one does not)
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/steps/name_match`, { method: 'POST', body: { decision: 'failed', reason: 'ok' } })).error, 'reason_required');
    const ok = await admin.api(`/admin/mentors/${mentorId}/steps/name_match`, { method: 'POST', body: { decision: 'passed', reason: 'Married name confirmed with a marriage certificate' } });
    assert.equal(ok.status, 200);
    assert.equal((await step()).status, 'passed');
    assert.notEqual((await step()).decided_by, null, 'decided by an admin');
    assert.deepEqual(await flagsOpen(), [], 'the flag was closed by the decision');
    // Re-saving the same profile does not reopen it.
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Ana Kapanadze', bio: 'Same name again' } });
    assert.equal((await step()).status, 'passed');
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Nino Beridze' } });
    assert.equal((await step()).status, 'passed');
  });

  test('a live mentor whose public name stops matching the ID goes back to review', async () => {
    await approveMentor(admin, mentor);
    await addPayoutDetails(mentor, undefined, 'Nino Beridze');
    assert.equal((await client(base).api('/experts')).experts.length, 1);
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Somebody Else' } });
    assert.equal((await mentor.api('/me')).user.verificationStatus, 'pending');
    assert.equal((await client(base).api('/experts')).experts.length, 0);
    assert.ok(await flagsOpen().then((f) => f.includes('name_mismatch')));
    // Fixing the name does not bring them back by itself: an admin approves again.
    await mentor.api('/me', { method: 'PATCH', body: { name: 'Nino Beridze' } });
    assert.equal((await mentor.api('/me')).user.verificationStatus, 'pending');
    assert.equal((await admin.api(`/admin/mentors/${mentorId}/approve`, { method: 'POST' })).status, 200);
  });

  test('a payout account holder who does not match holds the payout until an admin resolves it', async () => {
    // The mentor answers a paid question, and the earnings become payable.
    const b = await bookAndPay(base, seeker, mentorId, 'A question for a payout test');
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('An answer.') } });
    await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE mentor_id = $1`, [mentorId]);
    const before = (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
    assert.equal(before.flagged, false);

    // The account belongs to somebody else.
    const put = await addPayoutDetails(mentor, undefined, 'Levan Bakuradze');
    assert.equal(put.status, 200);
    assert.ok((await flagsOpen()).includes('payout_name_mismatch'));
    assert.equal((await mentor.api('/me')).user.verificationStatus, 'verified', 'still listed: only the payout is held');
    const row = (await admin.api('/admin/payouts')).mentors.find((m) => m.mentorId === mentorId);
    assert.equal(row.flagged, true);
    const pay = await admin.api(`/admin/payouts/${mentorId}/pay`, { method: 'POST', body: { amount: row.net, reference: 'TR-1' } });
    assert.equal(pay.error, 'name_mismatch');
    const csv = await (await fetch(`${base}/api/admin/payouts.csv`, { headers: { cookie: await cookieOf() } })).text();
    assert.doesNotMatch(csv, /nino@example\.com/, 'a held payout is not in the transfer list');

    // Fixing the account, or an admin resolving the flag with a reason, releases it.
    await addPayoutDetails(mentor, undefined, 'Nino Beridze');
    assert.ok(!(await flagsOpen()).includes('payout_name_mismatch'));
    const ok = await admin.api(`/admin/payouts/${mentorId}/pay`, { method: 'POST', body: { amount: row.net, reference: 'TR-2' } });
    assert.equal(ok.status, 200);
  });

  test('flags can only be resolved by admins, with a reason', async () => {
    await addPayoutDetails(mentor, undefined, 'Someone Different');
    const flag = (await pool.query(`SELECT id FROM mentor_flags WHERE mentor_id = $1 AND status = 'open' LIMIT 1`, [mentorId])).rows[0];
    assert.ok(flag);
    assert.equal((await seeker.api(`/admin/flags/${flag.id}/resolve`, { method: 'POST', body: { reason: 'sure, why not' } })).error, 'not_admin');
    assert.equal((await admin.api(`/admin/flags/${flag.id}/resolve`, { method: 'POST', body: { reason: '' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/flags/${flag.id}/resolve`, { method: 'POST', body: { reason: 'Account belongs to her husband, confirmed by phone' } })).status, 200);
    const audit = (await admin.api(`/admin/mentors/${mentorId}/verification`)).audit;
    assert.ok(audit.some((a) => a.action === 'flag_resolved' && /husband/.test(a.reason)));
  });

  async function cookieOf() {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ email: 'qa-admin@example.com', password: 'test-pass-12345' }) });
    return res.headers.get('set-cookie').split(';')[0];
  }
});
