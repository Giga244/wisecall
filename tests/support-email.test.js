// A site with no public contact address says so at startup (and `npm run check:launch` says so too, see check-launch.test.js).
require('dotenv').config({ quiet: true });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer } = require('./helpers');

describe('SUPPORT_EMAIL', () => {
  const started = [];
  before(async () => { await resetDatabase(); });
  after(() => started.forEach((s) => s.proc.kill()));

  test('not set: a clear warning at startup that says what is missing and what to do', async () => {
    const s = await startServer(4611, { SUPPORT_EMAIL: '' }); started.push(s);
    const out = s.logs();
    assert.match(out, /\[WARNING\] SUPPORT_EMAIL is not set: no contact address appears in the footer, the Terms, the Privacy Policy or the emails/);
    assert.match(out, /Set it to a role address such as support@yourdomain\.ge before launch/);
  });

  test('set: no warning', async () => {
    const s = await startServer(4612, { SUPPORT_EMAIL: 'support@wisecall.test' }); started.push(s);
    assert.doesNotMatch(s.logs(), /SUPPORT_EMAIL is not set/);
  });

  test('the example settings file tells a developer what to use on their own computer', () => {
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    assert.match(example, /SUPPORT_EMAIL=\r?\n/);
    assert.match(example, /placeholder such as support@wisecall\.test/);
  });
});
