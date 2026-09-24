const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, resetDatabase, startServer, client } = require('./helpers');

let srv;
const seedEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  JWT_SECRET: 'test-secret-that-is-long-enough-1234567890',
  ...extra
});
const runSeed = (args = [], extra = {}) =>
  spawnSync('node', [path.join('scripts', 'seed-demo.js'), ...args], { cwd: ROOT, encoding: 'utf8', env: seedEnv(extra) });

before(async () => { await resetDatabase(); srv = await startServer(4572); });
after(() => { if (srv) srv.proc.kill(); });

test('the demo seed refuses to run in production or against a remote database', () => {
  const prod = runSeed([], { NODE_ENV: 'production' });
  assert.notEqual(prod.status, 0);
  assert.match(prod.stderr, /production/);

  const remote = runSeed([], { DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /not this computer/);
});

test('the demo seed adds listable mentors with reviews, and can remove them again', async () => {
  const c = client(srv.base);
  assert.equal((await c.api('/experts')).experts.length, 0);

  const added = runSeed();
  assert.equal(added.status, 0, added.stderr);
  const list = (await c.api('/experts')).experts;
  assert.equal(list.length, 6);
  assert.ok(list.some((e) => e.reviewCount > 0 && e.ratingAvg >= 4), 'some demo mentors have reviews');
  assert.equal((await c.api('/stats')).mentorCount, 6);

  const again = runSeed();
  assert.match(again.stdout, /already there/);
  assert.equal((await c.api('/experts')).experts.length, 6, 'running twice does not duplicate');

  const removed = runSeed(['--remove']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal((await c.api('/experts')).experts.length, 0);
});
