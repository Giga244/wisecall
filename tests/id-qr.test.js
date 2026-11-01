// The ID check's QR code (docs/CLAUDE-CODE-ID-QR-BUG.md): the start route never answers with an empty box.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startServer, signupVerified } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, didit, mentor;
before(async () => {
  await resetDatabase();
  didit = createFakeDidit();
  await didit.start();
  srv = await startServer(4794, { KYC_PROVIDER: 'didit', DIDIT_API_KEY: didit.API_KEY, DIDIT_WORKFLOW_ID: didit.WORKFLOW, DIDIT_WEBHOOK_SECRET: didit.SECRET, DIDIT_API_URL: didit.url, RATE_LIMIT_MULTIPLIER: '20' });
  mentor = await signupVerified(srv.base, 'Nino Beridze', 'nino@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
});
after(async () => { if (srv) srv.proc.kill(); if (didit) await didit.stop(); await pool.end(); });
const start = (body) => mentor.api('/verification/kyc/start', { method: 'POST', ...(body ? { body } : {}) });

test('with qr: true the answer has the link and a real SVG picture of it', async () => {
  const r = await start({ qr: true });
  assert.equal(r.status, 200, r.text);
  assert.match(r.url, /\/verify\//);
  assert.match(r.qr, /^<svg[\s\S]*<path[\s\S]*<\/svg>\s*$/);
});

test('without it, only the link, as before', async () => {
  const r = await start();
  assert.equal(r.status, 200, r.text);
  assert.ok(r.url);
  assert.equal(r.qr, undefined);
});

test('starting again gets the same session from the partner (as Didit does): the same link, no error, one row', async () => {
  const a = await start({ qr: true });
  const b = await start({ qr: true });
  const c = await start();
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal(c.status, 200, c.text);
  assert.equal(a.url, b.url);
  assert.equal(a.url, c.url);
  assert.ok(b.qr);
  const id = a.url.split('/').pop();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM kyc_sessions WHERE provider_session_id = $1', [id])).rows[0].n, 1);
});

test('a session id that belongs to another account is never handed out', async () => {
  const known = (await pool.query('SELECT provider_session_id AS id FROM kyc_sessions LIMIT 1')).rows[0].id;
  const other = await signupVerified(srv.base, 'Other Mentor', 'other@example.com');
  await other.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  didit.options.alwaysNew = true;
  didit.options.forceSessionId = known;
  try {
    const r = await other.api('/verification/kyc/start', { method: 'POST', body: { qr: true } });
    assert.equal(r.status, 502);
    assert.equal(r.error, 'kyc_error');
    assert.equal(r.url, undefined);
    assert.equal(r.qr, undefined);
  } finally { didit.options.alwaysNew = false; didit.options.forceSessionId = null; }
});

test('a code that cannot be made is an error code with the link, never an empty 200', async () => {
  didit.options.hugeLinks = true;
  try {
    // (a new mentor, so the partner makes a new link: the long one)
    const longOne = await signupVerified(srv.base, 'Long Link', 'long@example.com');
    await longOne.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    const r = await longOne.api('/verification/kyc/start', { method: 'POST', body: { qr: true } });
    assert.equal(r.status, 502);
    assert.equal(r.error, 'qr_failed');
    assert.match(r.url, /\/verify\//, 'the link to open on the phone');
    assert.equal(r.qr, undefined);
    assert.match(srv.logs(), /\[kyc\] could not draw the QR code/);
    assert.equal((await start()).status, 200, 'the big button still works with that link');
  } finally { didit.options.hugeLinks = false; }
});

test('a partner that does not answer is an error code too', async () => {
  const stopped = didit.stop();
  await stopped;
  const r = await start({ qr: true });
  assert.equal(r.status, 502);
  assert.equal(r.error, 'kyc_error');
  await didit.start();
});
