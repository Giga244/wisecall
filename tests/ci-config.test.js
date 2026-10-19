// CI finishes in time and checks everything (docs/CLAUDE-CODE-CI-FIX.md): the browser tests run in three parallel shares that together hold
// every spec file once (each share starts with the full flow, which the others build on), every job has its own time limit, the runner
// image is pinned, older runs of the same branch are cancelled, and Dependabot groups minor and patch updates and leaves Express 5 for later.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');
const { shares, FIRST, SECONDS } = require('../scripts/e2e-shard');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const specs = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.js')).map((f) => `e2e/${f}`);

test('the three shares hold every browser spec exactly once, each starting with the full flow', () => {
  const s = shares(3);
  assert.equal(s.length, 3);
  for (const share of s) assert.equal(share.files[0], FIRST);
  const dealt = s.flatMap((share) => share.files.slice(1));
  assert.deepEqual([...dealt].sort(), specs.filter((f) => f !== FIRST).sort(), 'every spec once, none twice, none left out');
  // roughly even: no share has more than twice the tests of another
  const secs = s.map((share) => share.seconds);
  assert.ok(Math.max(...secs) <= 2 * Math.min(...secs), JSON.stringify(secs));
  // the timings name only files that exist (a renamed spec is noticed)
  for (const f of Object.keys(SECONDS)) assert.ok(specs.includes(f), `${f} in scripts/e2e-shard.js does not exist`);
});

test('CI: pull requests and pushes to main, older runs cancelled, every job pinned and limited in time, the browser cached', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /on:\n  push:\n    branches: \[main\]\n  pull_request:\n/);
  assert.match(ci, /concurrency:\n  group: ci-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/);
  const jobs = ci.slice(ci.indexOf('\njobs:\n')).split(/\n  (?=[\w-]+:\n)/).slice(1);
  assert.deepEqual(jobs.map((j) => j.split(':')[0]), ['audit', 'unit', 'e2e', 'e2e-cloud', 'secrets']);
  for (const j of jobs) {
    assert.match(j, /\n    runs-on: ubuntu-24\.04\n/, `${j.split(':')[0]}: a pinned runner image`);
    const minutes = Number((j.match(/\n    timeout-minutes: (\d+)\n/) || [])[1]);
    assert.ok(minutes >= 10 && minutes <= 30, `${j.split(':')[0]}: its own time limit (${minutes})`);
  }
  assert.doesNotMatch(ci, /runs-on: ubuntu-latest/);
  assert.match(ci, /share: \[1, 2, 3\]/);
  assert.match(ci, /run: node scripts\/e2e-shard\.js \$\{\{ matrix\.share \}\} 3/);
  assert.match(ci, /uses: actions\/cache@v6\n        with:\n          path: ~\/\.cache\/ms-playwright/);
  assert.match(ci, /cache: npm/);
});

test('Dependabot: minor and patch updates grouped, Express majors ignored for now', () => {
  const d = read('.github/dependabot.yml');
  assert.match(d, /groups:\n      minor-and-patch:\n        update-types: \[minor, patch\]/);
  assert.match(d, /ignore:\n      - dependency-name: express\n        update-types: \[version-update:semver-major\]/);
});
