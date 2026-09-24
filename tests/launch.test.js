// Launch safety: warnings for fake providers, the launch mode, and the launch check.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { resetDatabase } = require('./helpers');

describe('development warnings', () => {
  let srv;
  before(async () => { await resetDatabase(); srv = await startServer(4587); });
  after(() => { if (srv) srv.proc.kill(); });

  test('a server with fake providers says so clearly at startup', async () => {
    const out = srv.logs();
    assert.match(out, /\[WARNING\] Development mode/);
    assert.match(out, /MOCK BANK is active/);
    assert.match(out, /MOCK ID CHECK is active/);
    assert.match(out, /EMAIL IS OFF/);
    assert.match(out, /PUBLIC_URL is http:\/\/localhost:4587/);
    assert.match(out, /ID check: MOCK/);
  });

  test('development pages and helpers are available here, and /api/config says devMode', async () => {
    const cfg = await (await fetch(`${srv.base}/api/config`)).json();
    assert.equal(cfg.devMode, true);
    assert.equal((await fetch(`${srv.base}/mock-bank.html`)).status, 200);
  });
});
