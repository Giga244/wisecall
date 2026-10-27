// Admin: approve a mentor with one tap, no typing (docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md). Passing a step or confirming evidence needs no
// reason (the note is "Approved by admin", with the admin and the time); failing still does. "Approve" with { all: true } passes what waits
// for a person (the licence or diploma, its document, the evidence), each with its own audit entry, then approves; it never passes what the
// automatic checks decide (the email, the ID check, 18+) and never approves an application that was not sent.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const STORY = 'I have taught educational psychology and the history of psychology at Tbilisi State University for twenty years and supervise doctoral students.';
let srv, admin;

// A psychology applicant (no licence exists: a diploma's details and its copy) with one evidence link, sent for review; the ID check and
// 18+ passed unless told otherwise. -> { c, id }
async function applicant(name, email, { idPassed = true, send = true } = {}) {
  const c = await signupVerified(srv.base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Professor of psychology', price: 30 } });
  await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Educational psychology', niche: 'psychology', yearsExperience: 20, story: STORY } });
  await c.api('/verification/evidence', { method: 'POST', body: { url: `https://tsu.example.org/staff/${email.split('@')[0]}` } });
  const id = (await c.api('/me')).user.id;
  const lic = await c.api('/verification/license', { method: 'POST', body: { number: 'TSU-2004-118', issuingBody: 'Tbilisi State University', holderName: name, validUntil: '' } });
  assert.equal(lic.status, 200, JSON.stringify(lic));
  // (the copy of the diploma, uploaded: its step is waiting for a person)
  await pool.query(`INSERT INTO verification_steps (user_id, step, status, reason) VALUES ($1, 'license_document', 'pending', 'uploaded') ON CONFLICT (user_id, step) DO UPDATE SET status = 'pending'`, [id]);
  if (idPassed) {
    for (const step of ['id_kyc', 'age', 'name_match']) {
      await pool.query(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now())
        ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [id, step]);
    }
  }
  if (send) {
    const sent = await c.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, JSON.stringify(sent));
    // (the automatic analysis checks the link in the background once the ID check has passed: its verdict comes before the test sets its own)
    if (idPassed) for (let i = 0; i < 60 && !(await pool.query("SELECT 1 FROM verification_reviews WHERE user_id = $1 AND status <> 'running'", [id])).rows.length; i++) await new Promise((r) => setTimeout(r, 250));
  }
  await pool.query(`UPDATE mentor_evidence SET check_status = 'admin_check' WHERE user_id = $1`, [id]); // (the automatic check left it to a person)
  return { c, id };
}
const stepRow = async (id, step) => (await pool.query('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [id, step])).rows[0];
const auditOf = async (id) => (await pool.query('SELECT action, step, reason, actor_id FROM verification_audit WHERE mentor_id = $1 ORDER BY created_at', [id])).rows;

before(async () => {
  await resetDatabase();
  srv = await startServer(4779);
  admin = await signupVerified(srv.base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('passing needs no reason; failing does', () => {
  let m, adminId;
  before(async () => {
    m = await applicant('Nana One', 'nana-one@example.com');
    adminId = (await admin.api('/me')).user.id;
  });

  test('a step passed without a reason is saved with "Approved by admin", the admin and the time', async () => {
    const r = await admin.api(`/admin/mentors/${m.id}/steps/license`, { method: 'POST', body: { decision: 'passed' } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const s = await stepRow(m.id, 'license');
    assert.equal(s.status, 'passed');
    assert.equal(s.reason, 'Approved by admin');
    assert.equal(s.decided_by, adminId);
    assert.ok(s.decided_at);
    assert.ok((await auditOf(m.id)).some((a) => a.action === 'step_passed' && a.step === 'license' && a.reason === 'Approved by admin' && a.actor_id === adminId));
  });

  test('failing without a reason (or with one too short) is refused, and nothing changes', async () => {
    for (const body of [{ decision: 'failed' }, { decision: 'failed', reason: 'no' }]) {
      const r = await admin.api(`/admin/mentors/${m.id}/steps/license_document`, { method: 'POST', body });
      assert.equal(r.error, 'reason_required');
    }
    assert.equal((await stepRow(m.id, 'license_document')).status, 'pending');
    // rejecting and suspending still need one too
    assert.equal((await admin.api(`/admin/mentors/${m.id}/reject`, { method: 'POST', body: {} })).error, 'reason_required');
  });

  test('evidence: confirmed without a reason, refused only with one', async () => {
    const ev = (await pool.query('SELECT id FROM mentor_evidence WHERE user_id = $1', [m.id])).rows[0].id;
    assert.equal((await admin.api(`/admin/mentors/${m.id}/evidence/${ev}`, { method: 'POST', body: { decision: 'failed' } })).error, 'reason_required');
    assert.equal((await admin.api(`/admin/mentors/${m.id}/evidence/${ev}`, { method: 'POST', body: { decision: 'ok' } })).status, 200);
    assert.equal((await pool.query('SELECT check_status FROM mentor_evidence WHERE id = $1', [ev])).rows[0].check_status, 'ok');
    assert.ok((await auditOf(m.id)).some((a) => a.action === 'evidence_confirmed' && /Approved by admin/.test(a.reason)));
  });
});

describe('one tap', () => {
  test('with the diploma details, its copy and the evidence waiting: the detail says what it will count; one tap passes each and approves', async () => {
    const m = await applicant('Nana Two', 'nana-two@example.com');
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.deepEqual(d.oneTap.willPass, ['license', 'license_document']);
    assert.equal(d.oneTap.evidence.length, 1);
    assert.deepEqual(d.oneTap.blockedBy, []);
    assert.equal(d.oneTap.canApprove, true);
    assert.equal(d.ready, false, 'not ready by the old rule: one tap is what makes it one action');

    const r = await admin.api(`/admin/mentors/${m.id}/approve`, { method: 'POST', body: { all: true } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await pool.query('SELECT verification_status FROM users WHERE id = $1', [m.id])).rows[0].verification_status, 'verified');
    for (const step of ['license', 'license_document']) assert.equal((await stepRow(m.id, step)).status, 'passed', step);
    assert.equal((await pool.query('SELECT check_status FROM mentor_evidence WHERE user_id = $1', [m.id])).rows[0].check_status, 'ok');
    const audit = await auditOf(m.id);
    for (const step of ['license', 'license_document']) assert.ok(audit.some((a) => a.action === 'step_passed' && a.step === step && a.reason === 'Approved by admin'), `an audit entry for ${step}`);
    assert.ok(audit.some((a) => a.action === 'evidence_confirmed'), 'an audit entry for the evidence');
    assert.ok(audit.some((a) => a.action === 'approved'));
  });

  test('the ID check (and 18+) not passed: refused with the reason, and nothing is passed', async () => {
    const m = await applicant('Nana Three', 'nana-three@example.com', { idPassed: false });
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.equal(d.oneTap.canApprove, false);
    assert.ok(d.oneTap.blockedBy.includes('id_kyc') && d.oneTap.blockedBy.includes('age'), JSON.stringify(d.oneTap.blockedBy));
    const r = await admin.api(`/admin/mentors/${m.id}/approve`, { method: 'POST', body: { all: true } });
    assert.equal(r.status, 409);
    assert.equal(r.error, 'cannot_approve');
    assert.ok(r.missing.includes('id_kyc'));
    assert.equal((await stepRow(m.id, 'license')).status, 'pending', 'nothing passed');
    assert.equal((await pool.query('SELECT verification_status FROM users WHERE id = $1', [m.id])).rows[0].verification_status, 'pending');
    // the admin cannot pass the ID check by hand either
    assert.equal((await admin.api(`/admin/mentors/${m.id}/steps/id_kyc`, { method: 'POST', body: { decision: 'passed' } })).error, 'not_manual');
  });

  test('an application not sent yet, or a name that does not match the ID: refused, with what blocks it', async () => {
    const draft = await applicant('Nana Four', 'nana-four@example.com', { send: false });
    const r = await admin.api(`/admin/mentors/${draft.id}/approve`, { method: 'POST', body: { all: true } });
    assert.equal(r.error, 'cannot_approve');
    assert.ok(r.missing.includes('not_submitted'));
    const mismatch = await applicant('Nana Five', 'nana-five@example.com');
    await pool.query(`UPDATE verification_steps SET status = 'pending' WHERE user_id = $1 AND step = 'name_match'`, [mismatch.id]);
    const r2 = await admin.api(`/admin/mentors/${mismatch.id}/approve`, { method: 'POST', body: { all: true } });
    assert.equal(r2.error, 'cannot_approve');
    assert.deepEqual(r2.missing, ['name_match'], 'decided on its own, never by one tap');
  });

  test('the words, in English and Georgian', () => {
    const fs = require('fs');
    const path = require('path');
    const dict = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `admin-${l}.json`), 'utf8'));
    assert.equal(dict('ka')['admin.oneTap.confirmWith'].replace('{name}', 'ნანა').replace('{list}', 'დიპლომი, მტკიცებულება'), 'დაადასტურო ნანა მენტორად? ეს ჩაითვლება: დიპლომი, მტკიცებულება.');
    assert.equal(dict('ka')['admin.oneTap.yes'], 'დადასტურება');
    assert.equal(dict('ka')['admin.oneTap.no'], 'გაუქმება');
    for (const l of ['en', 'ka']) for (const k of ['admin.oneTap.approve', 'admin.oneTap.blocked', 'admin.oneTap.block.not_submitted', 'admin.oneTap.block.email', 'admin.mv.reasonToFail']) assert.ok(dict(l)[k], `${l} ${k}`);
  });
});
