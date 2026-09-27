#!/usr/bin/env node
// A backup of the database, and a check that a backup can really be restored.
//   npm run backup                          -> backups/wisecall-<date-time>.dump (pg_dump custom format) of DATABASE_URL
//   npm run backup -- <url>                 -> the same for another database
//   npm run backup:check -- <file.dump>     -> restores the file into a new, empty scratch database and compares the row counts of the
//                                              main tables with the database it came from (DATABASE_URL, or BACKUP_SOURCE_URL); then
//                                              drops the scratch database. Nothing in the source database is changed.
// pg_dump / pg_restore must be installed (PostgreSQL client tools); PG_BIN can name their folder.
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TABLES = ['users', 'bookings', 'payouts', 'payout_batches', 'receipts', 'ratings', 'verification_steps', 'verification_audit', 'threads', 'messages', 'waitlist'];

function tool(name) {
  const candidates = [process.env.PG_BIN, 'C:/Program Files/PostgreSQL/17/bin', 'C:/Program Files/PostgreSQL/16/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean);
  for (const dir of candidates) {
    const file = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (fs.existsSync(file)) return file;
  }
  return name; // (on the PATH)
}
function run(cmd, args) {
  const r = spawnSync(tool(cmd), args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new Error(`${cmd} could not start (${r.error.message}). Install the PostgreSQL client tools or set PG_BIN.`);
  if (r.status !== 0) throw new Error(`${cmd} failed with exit code ${r.status}`);
}
const redact = (url) => String(url).replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');

async function counts(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const out = {};
    for (const t of TABLES) {
      try { out[t] = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n; } catch (e) { out[t] = null; }
    }
    return out;
  } finally { await c.end(); }
}

async function backup(url) {
  if (!url) throw new Error('No database: set DATABASE_URL or pass one.');
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `wisecall-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.dump`);
  console.log(`Backing up ${redact(url)} ...`);
  run('pg_dump', ['--format=custom', '--no-owner', '--file', file, '--dbname', url]);
  console.log(`Saved ${file} (${Math.round(fs.statSync(file).size / 1024)} KB). Keep it somewhere safe, with the DATA_ENCRYPTION_KEY in use when it was made.`);
  return file;
}

async function check(file, sourceUrl) {
  if (!file || !fs.existsSync(file)) throw new Error('Name the .dump file to check.');
  if (!sourceUrl) throw new Error('No source database to compare with: set DATABASE_URL or BACKUP_SOURCE_URL.');
  const scratch = `wisecall_restore_check_${Date.now()}`;
  const admin = new URL(sourceUrl);
  admin.pathname = '/postgres';
  const target = new URL(sourceUrl);
  target.pathname = '/' + scratch;
  const a = new Client({ connectionString: admin.toString() });
  await a.connect();
  try {
    await a.query(`CREATE DATABASE ${scratch}`);
    console.log(`Restoring ${path.basename(file)} into the scratch database ${scratch} ...`);
    run('pg_restore', ['--no-owner', '--exit-on-error', '--dbname', target.toString(), file]);
    const [src, dst] = await Promise.all([counts(sourceUrl), counts(target.toString())]);
    let same = true;
    for (const t of TABLES) {
      const ok = src[t] === dst[t];
      if (!ok) same = false;
      console.log(`${ok ? 'ok  ' : 'DIFF'} ${t.padEnd(20)} source ${String(src[t]).padStart(6)}  restored ${String(dst[t]).padStart(6)}`);
    }
    console.log(same ? 'The backup restores completely.' : 'The counts differ: rows were added or removed after the backup was made, or the restore is incomplete.');
    return same;
  } finally {
    await a.query(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => {});
    await a.end();
  }
}

(async () => {
  const [mode, arg] = process.argv.slice(2);
  try {
    if (mode === 'check') process.exitCode = (await check(arg, process.env.BACKUP_SOURCE_URL || process.env.DATABASE_URL)) ? 0 : 2;
    else await backup(mode || process.env.DATABASE_URL);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
})();
