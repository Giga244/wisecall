// Before the browser tests: wipe the TEST database and start a real server on port 4620 with the FAKE bank, the FAKE
// ID check, and every email written to a log file (e2e/.tmp/mail.jsonl) so the tests can read verification codes.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');
require('dotenv').config();

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const PORT = 4620;
const GOOGLE_PORT = 4630; // the fake Google (tests/fakeGoogle.js): a real OpenID Connect provider with a page where the person picks an account

module.exports = async () => {
  const db = process.env.TEST_DATABASE_URL;
  if (!db) throw new Error('Set TEST_DATABASE_URL in .env (a separate database from the real one; it is wiped).');

  // E2E_KEEP_DATA=1 keeps the database and the mail log from the previous run, to re-run one spec (for example the
  // responsive one) against the data the earlier specs created.
  const keep = process.env.E2E_KEEP_DATA === '1';
  if (!keep) {
    const pool = new Pool({ connectionString: db });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pool.end();
  }

  fs.mkdirSync(TMP, { recursive: true });
  if (!keep || !fs.existsSync(path.join(TMP, 'mail.jsonl'))) fs.writeFileSync(path.join(TMP, 'mail.jsonl'), '');
  const log = fs.openSync(path.join(TMP, 'server.log'), 'w');

  const google = spawn(process.execPath, ['tests/fakeGoogle.js', String(GOOGLE_PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch('http://localhost:' + GOOGLE_PORT + '/.well-known/openid-configuration')).ok) break; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }

  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      NODE_ENV: '', PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, DATABASE_URL: db,
      SESSION_SECRET: 'e2e-secret-that-is-long-enough-1234567890', DATA_ENCRYPTION_KEY: 'e2e-data-key-that-is-long-enough-1234567890',
      PAYMENT_PROVIDER: 'mock', KYC_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: path.join(TMP, 'mail.jsonl'), EMAIL_FROM: 'Wisecall <e2e@wisecall.example>', RESEND_API_KEY: '',
      ADMIN_EMAILS: 'e2e-admin@example.com', ADMIN_EMAIL: '', SUPPORT_EMAIL: 'support@wisecall.example',
      LAUNCH_MODE: 'live', SWEEP_INTERVAL_SECONDS: '1', RATE_LIMIT_MULTIPLIER: '100',
      GOOGLE_CLIENT_ID: 'fake-google-client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fake-google-client-secret', GOOGLE_ISSUER: 'http://localhost:' + GOOGLE_PORT,
      BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: '', TBC_CLIENT_ID: '', TBC_CLIENT_SECRET: '',
      DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: ''
    }
  });

  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) break; } catch (e) { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error('The test server exited early. See e2e/.tmp/server.log');
    await new Promise((r) => setTimeout(r, 250));
  }

  return async () => { proc.kill(); google.kill(); };
};
