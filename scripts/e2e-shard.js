// Runs one share of the browser tests, so CI can run them in parallel jobs: node scripts/e2e-shard.js <index> <count> [--list]
//   index: 1..count. --list prints the files of that share instead of running them.
//
// Every share starts with e2e/full-flow.spec.js: the specs after it use what it creates (the seeker, the Law mentor, the admin), exactly as
// in one long run. The other spec files are dealt out to the shares by how long they took on CI (the slowest first, each to the share that is
// shortest so far), and run in the usual alphabetical order inside a share. A new spec file is included automatically (counted as 15
// seconds until it is added below).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIRST = 'e2e/full-flow.spec.js';
// Seconds each file took on GitHub Actions (run of 2026-10-19, Playwright list reporter).
const SECONDS = {
  'e2e/responsive.spec.js': 274, 'e2e/smoke.a11y.spec.js': 183, 'e2e/theme.spec.js': 124, 'e2e/redesign.spec.js': 83, 'e2e/home-layout.spec.js': 48,
  'e2e/smoke.spec.js': 32, 'e2e/xss.spec.js': 30, 'e2e/mentor-button.spec.js': 29, 'e2e/profiles.spec.js': 28,
  'e2e/google.spec.js': 23, 'e2e/header-auth.spec.js': 17, 'e2e/ratings.spec.js': 16, 'e2e/mentor-signup.spec.js': 14, 'e2e/dev-setup.spec.js': 13,
  'e2e/live-sessions.spec.js': 10, 'e2e/skeletons.spec.js': 9, 'e2e/live-switch.spec.js': 9, 'e2e/local-flow.spec.js': 9, 'e2e/refunds.spec.js': 9,
  'e2e/niches.spec.js': 9, 'e2e/admin-prelaunch.spec.js': 9, 'e2e/motion.spec.js': 8, 'e2e/pay-and-answer.spec.js': 7, 'e2e/security.spec.js': 6,
  'e2e/ux-extras.spec.js': 6, 'e2e/inbox.spec.js': 5, 'e2e/mentor-requests.spec.js': 5, 'e2e/safety.spec.js': 4, 'e2e/prelaunch-keys.spec.js': 3,
  'e2e/assets.spec.js': 3, 'e2e/withdrawals.spec.js': 3, 'e2e/public-answers.spec.js': 2
};
const NEW_FILE_SECONDS = 15;

function shares(count) {
  const files = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.js')).map((f) => `e2e/${f}`).filter((f) => f !== FIRST);
  const weight = (f) => (SECONDS[f] === undefined ? NEW_FILE_SECONDS : SECONDS[f]);
  const out = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const share = out.reduce((min, s) => (s.seconds < min.seconds ? s : min), out[0]);
    share.files.push(f);
    share.seconds += weight(f);
  }
  return out.map((s) => ({ seconds: s.seconds, files: [FIRST, ...s.files.sort()] }));
}

if (require.main === module) {
  const [index, count] = process.argv.slice(2, 4).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error('usage: node scripts/e2e-shard.js <index> <count> [--list]');
    process.exit(2);
  }
  const mine = shares(count)[index - 1];
  if (process.argv.includes('--list')) {
    console.log(`share ${index}/${count}: about ${Math.round(mine.seconds / 60)} min of tests\n${mine.files.join('\n')}`);
    process.exit(0);
  }
  // (each file is named exactly: Playwright reads the names as patterns, and "e2e/smoke.spec.js" must not also pick smoke.a11y.spec.js)
  const patterns = mine.files.map((f) => `${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const r = spawnSync('npx', ['playwright', 'test', ...patterns], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { shares, FIRST, SECONDS };
