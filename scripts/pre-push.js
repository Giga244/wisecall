// The pre-push check (.githooks/pre-push): the user-flow tests (every test whose title has @flow, e2e/user-flows.spec.js) must pass
// before anything is pushed. Exit code 1 blocks the push. Nothing to push from a build server (CI): it does nothing there.
const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.CI) process.exit(0);
const root = path.join(__dirname, '..');
console.log('Running the user-flow tests before the push (about a minute)...');
const run = spawnSync('npx', ['playwright', 'test', '--grep', '@flow', '--reporter=line', '--retries=1'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(run.status === 0 ? 0 : 1);
