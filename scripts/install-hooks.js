// npm install runs this ("prepare"): git then uses the project's hooks in .githooks (the pre-commit secret check, docs/SECRETS.md). Where there is
// no git checkout (a build server) it does nothing, and it never fails an install.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.git')) && !process.env.CI) {
  try {
    execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  } catch (e) { /* (no git: nothing to install) */ }
}
