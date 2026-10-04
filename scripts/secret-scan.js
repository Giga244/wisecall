// npm run check:secrets: a scan of the WHOLE git history (every branch, every commit, every added line) for keys and passwords, with the
// main gitleaks rules. For a computer without Docker; CI also runs gitleaks itself (.github/workflows/ci.yml). Findings are printed
// redacted (the first characters only) and the exit code is 1 when there is any. It never changes history: if a real key is found,
// rotate it at its provider (a key in git history stays readable even after it is deleted from the files).
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const RULES = [
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ['resend-key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['google-oauth-secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['stripe-live', /\b[rs]k_live_[A-Za-z0-9]{16,}/],
  ['cloudflare-turnstile-secret', /\b0x4AAAAAA[A-Za-z0-9_-]{20,}/],
  ['sentry-dsn', /https:\/\/[0-9a-f]{32}@[a-z0-9.-]*sentry\.io\/\d+/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['db-url-with-password', /\bpostgres(ql)?:\/\/[^:\s/'"]+:[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b|host\b)[^\s'"]+/],
  ['generic-secret-assignment', /\b(secret|token|password|passwd|api[_-]?key|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([A-Za-z0-9+/_\-.]{24,})["']/i]
];
// Obvious examples and test values, and translation keys ("settings.data.password").
const ALLOW = [/example|placeholder|change-me|dev-secret|dev-only|test[-_]|[-_]test\b|fake|dummy|xxxx|your[-_]/i];
const isTranslationKey = (v) => /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,}$/.test(v);

const log = execFileSync('git', ['-C', REPO, 'log', '--all', '-p', '--no-color', '--unified=0', '--format=@@COMMIT %H'], { maxBuffer: 1 << 30, encoding: 'utf8' });
let commit = '', file = '', lines = 0;
const findings = [];
for (const line of log.split('\n')) {
  if (line.startsWith('@@COMMIT ')) { commit = line.slice(9, 21); continue; }
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  lines += 1;
  const text = line.slice(1);
  for (const [rule, re] of RULES) {
    const m = re.exec(text);
    if (!m || ALLOW.some((a) => a.test(m[0]))) continue;
    if (rule === 'generic-secret-assignment' && isTranslationKey(m[2])) continue;
    findings.push(`${rule}  ${commit}  ${file}  ${m[0].slice(0, 6)}…(redacted)`);
  }
}
const commits = execFileSync('git', ['-C', REPO, 'rev-list', '--all', '--count'], { encoding: 'utf8' }).trim();
console.log(`Scanned ${commits} commits (${lines} added lines).`);
if (!findings.length) { console.log('No keys or passwords found.'); process.exit(0); }
console.log(`${findings.length} possible secret(s):`);
findings.forEach((f) => console.log('  ' + f));
process.exit(1);
