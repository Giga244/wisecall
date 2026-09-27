const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

// For hosted Postgres that needs TLS, put ?sslmode=require on DATABASE_URL.
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

const query = (text, params) => pool.query(text, params);

// Runs fn(client) in one transaction. Work that must only happen once the changes are saved (an email about them) is queued with
// afterCommit(client, fn) and runs after COMMIT; it is dropped on ROLLBACK.
async function tx(fn) {
  const client = await pool.connect();
  client.afterCommit = [];
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    const later = client.afterCommit;
    client.afterCommit = null;
    for (const f of later) Promise.resolve().then(f).catch((e) => console.error('[db] after-commit task failed:', e.message));
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* connection already gone */ }
    throw err;
  } finally {
    client.afterCommit = null;
    client.release();
  }
}

// Queues fn to run once the transaction of `client` has committed; without a transaction (no client, or a plain pool query) it runs
// straight away (in the background: its errors are logged, never thrown).
function afterCommit(client, fn) {
  if (client && Array.isArray(client.afterCommit)) { client.afterCommit.push(fn); return; }
  Promise.resolve().then(fn).catch((e) => console.error('[db] background task failed:', e.message));
}

// Applies every migrations/*.sql file once, in filename order. An advisory lock keeps two
// instances starting at the same time (e.g. during a deploy) from racing each other.
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7272001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[db] applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(7272001)'); } catch (e) { /* ignore */ }
    client.release();
  }
}

const close = () => pool.end();

module.exports = { pool, query, tx, afterCommit, migrate, close };
