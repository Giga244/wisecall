// Reinstating a suspended mentor puts them back in review ON PURPOSE (a step may have run out while they were away). The panel says so, and
// when every step is still valid one click reinstates and approves again.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4618);
  base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

async function suspendedMentor(name, email) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'business', price: 30, proofUrl: `https://linkedin.com/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
  const id = await approveMentor(admin, c);
  await addPayoutDetails(c);
  assert.equal((await admin.api(`/admin/mentors/${id}/suspend`, { method: 'POST', body: { reason: 'Complaints about advice' } })).status, 200);
  return { c, id };
}
const detail = async (id) => admin.api(`/admin/mentors/${id}/verification`);
const listed = async (id) => (await client(base).api('/experts')).experts.some((e) => e.id === id);
const audit = async (id) => (await detail(id)).audit;

describe('reinstate and re-approve in one click', () => {
  test('every step still valid: the panel says so, and one request reinstates and approves; the mentor is listed again and both are logged', async () => {
    const { c, id } = await suspendedMentor('Ready Again', 'ready@example.com');
    assert.equal(await listed(id), false, 'suspended: not in Browse');
    const d = await detail(id);
    assert.equal(d.ready, true, 'nothing was lost while suspended');
    assert.equal(d.mentor.verificationStatus, 'suspended');

    const r = await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Reports were unfounded', reapprove: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.reapproved, true);
    assert.equal((await c.api('/me')).user.verificationStatus, 'verified');
    assert.equal(await listed(id), true, 'listed again at once');
    const log = await audit(id);
    const actions = log.map((a) => a.action);
    assert.ok(actions.includes('reinstated') && actions.filter((a) => a === 'approved').length === 2, 'reinstated, and approved a second time');
    assert.match(log.find((a) => a.action === 'approved' && /again on reinstatement/.test(a.reason || '')).reason, /Reports were unfounded/);
    assert.equal((await detail(id)).standing.backInReview, false, 'not "back in review" any more');
  });

  test('a step that is no longer valid: reinstated but NOT approved, and the answer says what is missing', async () => {
    const { c, id } = await suspendedMentor('Lost A Step', 'lost@example.com');
    await pool.query(`UPDATE verification_steps SET status = 'failed', reason = 'the name changed while away' WHERE user_id = $1 AND step = 'name_match'`, [id]);
    assert.equal((await detail(id)).ready, false);
    const r = await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Reports were unfounded', reapprove: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.reapproved, false);
    assert.ok(r.missing && r.missing.length, 'what is missing');
    assert.equal((await c.api('/me')).user.verificationStatus, 'pending');
    assert.equal(await listed(id), false);
  });
});

describe('plain reinstate: back in review, with a note and a "Re-approve"', () => {
  test('the mentor is pending, marked as back in review in the list and in the detail, and approving clears the mark', async () => {
    const { c, id } = await suspendedMentor('Review Again', 'again@example.com');
    const r = await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Reports were unfounded' } });
    assert.equal(r.status, 200);
    assert.equal(r.reapproved, false);
    assert.equal((await c.api('/me')).user.verificationStatus, 'pending');
    assert.equal(await listed(id), false, 'not listed until approved again');

    const d = await detail(id);
    assert.deepEqual(d.standing, { wasApproved: true, backInReview: true });
    assert.equal(d.ready, true);
    const row = (await admin.api('/admin/mentors?status=pending')).mentors.find((m) => m.id === id);
    assert.equal(row.verification.backInReview, true);

    assert.equal((await admin.api(`/admin/mentors/${id}/approve`, { method: 'POST' })).status, 200);
    assert.equal(await listed(id), true);
    assert.deepEqual((await detail(id)).standing, { wasApproved: true, backInReview: false });
    assert.equal((await admin.api('/admin/mentors?status=verified')).mentors.find((m) => m.id === id).verification.backInReview, false);
  });

  test('a mentor who was never suspended is not "back in review", and the button says Approve (not Re-approve) for a first approval', async () => {
    const c = await signupVerified(base, 'Brand New', 'brandnew@example.com');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'business', price: 30, proofUrl: 'https://linkedin.com/in/brandnew', sampleAnswer: SAMPLE } });
    const id = (await c.api('/me')).user.id;
    assert.deepEqual((await detail(id)).standing, { wasApproved: false, backInReview: false });
  });
});

describe('the rules', () => {
  test('a reason is needed, only a suspended mentor can be reinstated, reapprove must be true or false, and only admins can do it', async () => {
    const { c, id } = await suspendedMentor('Rules Mentor', 'rules@example.com');
    assert.equal((await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reapprove: true } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Fine now', reapprove: 'yes' } })).status, 400);
    assert.equal((await c.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Let me back in', reapprove: true } })).status, 403);
    assert.equal((await c.api('/me')).user.verificationStatus, 'suspended', 'nothing changed');
    assert.equal((await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Fine now', reapprove: true } })).status, 200);
    assert.equal((await admin.api(`/admin/mentors/${id}/reinstate`, { method: 'POST', body: { reason: 'Again', reapprove: true } })).error, 'invalid_state');
  });
});

describe('the panel', () => {
  test('says "Reinstated mentors go back to review. Approve again to list them.", offers Re-approve and a one-click reinstate, in English and Georgian', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/admin-mentors.js'), 'utf8');
    for (const needle of ['admin.mv.reinstateNote', 'mv-reinstate-approve', 'reapprove: true', 'admin.reapprove', 'd.standing.wasApproved', 'v.backInReview', "d.ready ? 'admin.mv.reinstateReadyNote' : 'admin.mv.reinstateNotReady'"]) assert.ok(js.includes(needle), needle);
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin-en.json'), 'utf8')), ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin-ka.json'), 'utf8'));
    assert.equal(en['admin.mv.reinstateNote'], 'Reinstated mentors go back to review. Approve again to list them.');
    for (const k of ['admin.mv.reinstateNote', 'admin.mv.reinstateReadyNote', 'admin.mv.reinstateNotReady', 'admin.mv.reinstateApprove', 'admin.mv.backInReview', 'admin.reapprove', 'admin.mv.reinstated', 'admin.mv.reapproved']) {
      assert.ok(en[k], k);
      assert.match(ka[k], /[ა-ჿ]/, k);
    }
  });
});
