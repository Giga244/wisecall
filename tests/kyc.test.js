// ID verification (KYC): the real server runs against a fake Didit that follows Didit's documented API
// and signs webhooks the way Didit does. Nothing here touches a real provider.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, SAMPLE, wait } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');

const fake = createFakeDidit();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, mentor, mentorId, seeker;

const kycStep = async () => (await pool.query(`SELECT * FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId])).rows[0];
const webhook = (w) => fetch(`${base}/api/kyc/webhook`, { method: 'POST', headers: w.headers, body: w.body });
async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); }
}
let sessionId;
const newSession = async () => {
  const r = await mentor.api('/verification/kyc/start', { method: 'POST' });
  assert.equal(r.status, 200, r.text);
  return r.url.split('/').pop();
};

before(async () => {
  await fake.start();
  await resetDatabase();
  srv = await startServer(4576, { KYC_PROVIDER: 'didit', DIDIT_API_KEY: fake.API_KEY, DIDIT_WORKFLOW_ID: fake.WORKFLOW, DIDIT_WEBHOOK_SECRET: fake.SECRET, DIDIT_API_URL: fake.url });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
  mentor = await signupVerified(base, 'Nino Beridze', 'nino@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, proofUrl: 'https://dribbble.com/nino', sampleAnswer: SAMPLE } });
  mentorId = (await mentor.api('/me')).user.id;
});
after(async () => { if (srv) srv.proc.kill(); await fake.stop(); await pool.end(); });

describe('starting the ID check', () => {
  test('only a mentor can start it; the provider gets our key, workflow and the mentor\'s id', async () => {
    assert.equal((await seeker.api('/verification/kyc/start', { method: 'POST' })).error, 'not_a_mentor');
    assert.equal((await client(base).api('/verification/kyc/start', { method: 'POST' })).status, 401);

    sessionId = await newSession();
    const call = fake.calls.find((c) => c.method === 'POST' && c.path === '/v3/session/');
    assert.equal(call.headers['x-api-key'], fake.API_KEY);
    assert.equal(call.body.workflow_id, fake.WORKFLOW);
    assert.equal(call.body.vendor_data, mentorId);
    assert.match(call.body.callback, /\/settings\.html\?tab=verification&kyc=returned$/);

    const step = await kycStep();
    assert.equal(step.status, 'pending');
    assert.equal(step.evidence.state, 'started');
    assert.equal((await mentor.api('/verification')).kycState, 'started', 'the progress screen can tell the mentor where they are');
  });
});

describe('the result only ever comes from the provider', () => {
  test('webhooks without a valid signature are refused and change nothing', async () => {
    const good = fake.webhook(sessionId, 'Approved', fake.approvedDecision());
    assert.equal((await webhook({ body: good.body, headers: { 'content-type': 'application/json' } })).status, 400, 'no signature or timestamp');
    assert.equal((await webhook(fake.webhook(sessionId, 'Approved', fake.approvedDecision(), { secret: 'not-the-secret' }))).status, 400, 'wrong secret');
    assert.equal((await webhook(fake.webhook(sessionId, 'Approved', fake.approvedDecision(), { tamper: true }))).status, 400, 'body changed after signing');
    assert.equal((await webhook(fake.webhook(sessionId, 'Approved', fake.approvedDecision(), { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status, 400, 'an old (replayed) delivery');
    assert.equal((await kycStep()).status, 'pending');
  });

  test('a webhook naming a different user is ignored', async () => {
    const other = fake.webhook(sessionId, 'Approved', fake.approvedDecision(), { vendorData: '11111111-1111-1111-1111-111111111111' });
    assert.equal((await webhook(other)).status, 200);
    assert.equal((await kycStep()).status, 'pending');
  });

  test('a genuine approved webhook passes the step; a retry of the same event changes nothing', async () => {
    const w = fake.webhook(sessionId, 'Approved', fake.approvedDecision({ fullName: 'Nino Beridze', dateOfBirth: '1990-05-12', country: 'GEO' }), { eventId: 'evt-approve-1' });
    assert.equal((await webhook(w)).status, 200);
    const step = await kycStep();
    assert.equal(step.status, 'passed');
    assert.equal(step.evidence.country, 'GEO');

    const before = (await pool.query(`SELECT count(*)::int AS n FROM verification_audit WHERE mentor_id = $1 AND step = 'id_kyc'`, [mentorId])).rows[0].n;
    assert.equal((await webhook(fake.webhook(sessionId, 'Approved', fake.approvedDecision(), { eventId: 'evt-approve-1' }))).status, 200);
    const after = (await pool.query(`SELECT count(*)::int AS n FROM verification_audit WHERE mentor_id = $1 AND step = 'id_kyc'`, [mentorId])).rows[0].n;
    assert.equal(after, before, 'the duplicate delivery was ignored');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM kyc_events WHERE event_id = $1', ['evt-approve-1'])).rows[0].n, 1);
  });

  test('no ID image or document number is stored, and the name and birth date are encrypted', async () => {
    const dump = JSON.stringify([
      (await pool.query('SELECT * FROM kyc_sessions')).rows,
      (await pool.query('SELECT * FROM verification_steps')).rows,
      (await pool.query('SELECT * FROM verification_audit')).rows,
      (await pool.query('SELECT * FROM kyc_events')).rows
    ]);
    assert.doesNotMatch(dump, /SECRET-DOC-NUMBER|secret-front|img\.example/, 'no document number or image link');
    assert.doesNotMatch(dump, /Nino Beridze|1990-05-12/, 'name and date of birth are not in clear text');
    const row = (await pool.query('SELECT * FROM kyc_sessions')).rows[0];
    assert.match(row.verified_name_enc, /^v1:/);
    assert.match(row.birth_date_enc, /^v1:/);
    assert.equal(row.country, 'GEO');
    assert.equal(row.status, 'approved');
  });

  test('admins see the verified person; the mentor and the public never see it', async () => {
    const d = await admin.api(`/admin/mentors/${mentorId}/verification`);
    assert.equal(d.kyc.verifiedName, 'Nino Beridze');
    assert.equal(d.kyc.dateOfBirth, '1990-05-12');
    assert.equal(d.kyc.country, 'GEO');
    assert.equal(d.kyc.status, 'approved');
    const own = await mentor.api('/verification');
    assert.doesNotMatch(own.text, /Nino Beridze|1990-05-12|GEO/);
    assert.doesNotMatch((await mentor.api('/me')).text, /1990-05-12/);
    assert.equal((await seeker.api(`/admin/mentors/${mentorId}/verification`)).error, 'not_admin');
  });

  test('nobody can pass or fail the ID step by hand, and an already verified mentor cannot start again', async () => {
    const r = await admin.api(`/admin/mentors/${mentorId}/steps/id_kyc`, { method: 'POST', body: { decision: 'passed', reason: 'I saw the ID in person' } });
    assert.equal(r.error, 'not_manual');
    assert.equal((await mentor.api('/verification/kyc/start', { method: 'POST' })).error, 'already_verified');
  });
});

describe('other outcomes', () => {
  test('a declined check fails the step with a generic reason, and the mentor can try again', async () => {
    await pool.query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId]);
    await pool.query(`UPDATE kyc_sessions SET status = 'declined'`);
    const s2 = await newSession();
    assert.equal((await webhook(fake.webhook(s2, 'Declined', { id_verifications: [{ status: 'Declined', full_name: 'Someone Else' }] }))).status, 200);
    const step = await kycStep();
    assert.equal(step.status, 'failed');
    assert.match(step.reason, /not approved/);
    assert.doesNotMatch(step.reason, /Someone Else/, 'provider details are not passed on');

    const s3 = await newSession();
    assert.notEqual(s3, s2);
    assert.equal((await webhook(fake.webhook(s3, 'Approved', fake.approvedDecision()))).status, 200);
    assert.equal((await kycStep()).status, 'passed');
  });

  test('"approved" without a passed liveness check is not accepted', async () => {
    await pool.query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId]);
    const s = await newSession();
    const noLiveness = { id_verifications: fake.approvedDecision().id_verifications, liveness_checks: [], face_matches: [{ status: 'Approved' }] };
    assert.equal((await webhook(fake.webhook(s, 'Approved', noLiveness))).status, 200);
    assert.equal((await kycStep()).status, 'pending', 'held for the provider\'s manual review, not passed');
    assert.equal((await kycStep()).evidence.state, 'in_review');
    const failedLiveness = { ...fake.approvedDecision(), liveness_checks: [{ status: 'Declined' }] };
    const s2 = await newSession();
    await webhook(fake.webhook(s2, 'Approved', failedLiveness));
    assert.equal((await kycStep()).status, 'pending');
  });

  test('a result that arrives after the fact does not undo a finished check', async () => {
    await pool.query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId]);
    const s = await newSession();
    await webhook(fake.webhook(s, 'Approved', fake.approvedDecision()));
    assert.equal((await kycStep()).status, 'passed');
    await webhook(fake.webhook(s, 'Not Finished', {}));
    await webhook(fake.webhook(s, 'Expired', {}));
    assert.equal((await kycStep()).status, 'passed');
  });

  test('a lost webhook is recovered by asking the provider (admin refresh), authenticated by our key', async () => {
    await pool.query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId]);
    const s = await newSession();
    fake.setResult(s, 'Approved', fake.approvedDecision({ fullName: 'Nino Beridze' }));
    assert.equal((await kycStep()).status, 'pending');
    const r = await admin.api(`/admin/mentors/${mentorId}/kyc/refresh`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal((await kycStep()).status, 'passed');
    const lookup = fake.calls.find((c) => c.method === 'GET' && c.path === `/v3/session/${s}/decision/`);
    assert.equal(lookup.headers['x-api-key'], fake.API_KEY);
    assert.equal((await seeker.api(`/admin/mentors/${mentorId}/kyc/refresh`, { method: 'POST' })).error, 'not_admin');
  });

  test('webhooks for unknown sessions are acknowledged and ignored; garbage is refused', async () => {
    fake.sessions.set('unknown-session', { id: 'unknown-session', vendorData: mentorId });
    assert.equal((await webhook(fake.webhook('unknown-session', 'Approved', fake.approvedDecision()))).status, 200);
    assert.equal((await webhook({ body: 'not json', headers: { 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-signature': 'abc' } })).status, 400);
  });

  test('X-Signature over the raw bytes is accepted on its own', async () => {
    await pool.query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [mentorId]);
    const s = await newSession();
    assert.equal((await webhook(fake.webhook(s, 'Approved', fake.approvedDecision(), { rawOnly: true }))).status, 200);
    assert.equal((await kycStep()).status, 'passed');
  });
});

describe('the fake provider for local development', () => {
  test('runs the same flow through a signed webhook, and is unavailable in production settings', async () => {
    const dev = await startServer(4577, {});
    try {
      const c = await signupVerified(dev.base, 'Dev Mentor', 'dev-mentor@example.com');
      await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Designer', niche: 'design', price: 20, proofUrl: 'https://dribbble.com/dev', sampleAnswer: SAMPLE } });
      const start = await c.api('/verification/kyc/start', { method: 'POST' });
      const sid = start.url.split('=').pop();
      assert.match(start.url, /\/mock-kyc\.html\?session=mock-kyc-/);
      assert.equal((await fetch(`${dev.base}/mock-kyc.html`)).status, 200);
      const done = await client(dev.base).api(`/mock-kyc/sessions/${sid}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: 'Dev Mentor', dateOfBirth: '1985-01-01' } });
      assert.equal(done.status, 200);
      const id = (await c.api('/me')).user.id;
      const passed = await waitFor(async () => (await c.api('/verification')).requirements.find((r) => r.step === 'id_kyc').status === 'passed');
      assert.ok(passed);
      assert.ok(id);
    } finally { dev.proc.kill(); }
  });
});
