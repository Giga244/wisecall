// The ID check's QR code (docs/CLAUDE-CODE-ID-QR-BUG.md): the start route never answers with an empty box.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startServer, signupVerified } = require('./helpers');
const { createFakeDidit } = require('./fakeDidit');

let srv, didit, mentor;
before(async () => {
  await resetDatabase();
  didit = createFakeDidit();
  await didit.start();
  srv = await startServer(4794, { KYC_PROVIDER: 'didit', DIDIT_API_KEY: didit.API_KEY, DIDIT_WORKFLOW_ID: didit.WORKFLOW, DIDIT_WEBHOOK_SECRET: didit.SECRET, DIDIT_API_URL: didit.url, RATE_LIMIT_MULTIPLIER: '20' });
  mentor = await signupVerified(srv.base, 'Nino Beridze', 'nino@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
});
after(async () => { if (srv) srv.proc.kill(); if (didit) await didit.stop(); });
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

test('a code that cannot be made is an error code with the link, never an empty 200', async () => {
  didit.options.hugeLinks = true;
  try {
    const r = await start({ qr: true });
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
