// Migration 018 (verification rules v2) on a database that already has mentors from the first rules: nothing is lost, approved mentors
// stay approved, what they did is carried over, waiting applications are analysed and told once, and running it again changes nothing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv;
const ids = {};

before(async () => {
  await resetDatabase();
  // The database as it was before rules v2: migrations 001 to 017 only.
  await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && f < '018').sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }
  process.env.WISECALL_NO_EXIT = '1';
  const { encrypt } = require('../server/cryptoBox');
  const mk = async (key, name, status, extra = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, niche, role_title, price, verification_status, proof_url, bio, sample_answer, verification_decided_at, email_verified)
       VALUES ($1, $2, 'x', 'mentor', 'design', 'Designer', 25, $3, $4, $5, $6, now() - interval '30 days', true) RETURNING id`,
      [name, `${key}@example.com`, status, extra.proof || null, extra.bio || null, 'A sample answer from the first rules that is long enough to have been accepted then.']);
    ids[key] = rows[0].id;
  };
  await mk('approved', 'Ana Approved', 'verified', { proof: 'https://www.linkedin.com/in/ana-approved', bio: 'I have designed packaging and brand identities for twelve years, for bakeries, wineries and small shops across Georgia and abroad.' });
  await mk('pending', 'Pat Pending', 'pending', { proof: 'https://pat.invalid/work', bio: 'short bio' });
  await mk('rejected', 'Rex Rejected', 'rejected');
  await mk('suspended', 'Sue Suspended', 'suspended', { proof: 'https://sue.invalid' });
  // What they had done under the first rules.
  await pool.query(
    `INSERT INTO verification_steps (user_id, step, status, evidence) VALUES
       ($1, 'id_kyc', 'passed', '{}'), ($1, 'work_email', 'passed', '{"domain": "studio.ge"}'), ($1, 'proof_link', 'passed', '{}'),
       ($2, 'portfolio', 'pending', '{"url": "https://dribbble.invalid/pat"}'), ($2, 'company_id', 'pending', '{"companyId": "404123456"}'),
       ($3, 'proof_link', 'failed', '{}')`,
    [ids.approved, ids.pending, ids.rejected]);
  await pool.query(
    `INSERT INTO kyc_sessions (user_id, provider, provider_session_id, status, verified_name_enc, birth_date_enc, country, decided_at)
     VALUES ($1, 'mock', 'old-session-1', 'approved', $2, $3, 'GEO', now() - interval '31 days')`,
    [ids.approved, encrypt('Ana Approved'), encrypt('1988-02-03')]);
  await pool.query(`INSERT INTO verification_documents (user_id, step, filename, mime, size, data_enc) VALUES ($1, 'role_proof', 'contract.pdf', 'application/pdf', 10, '\\x00')`, [ids.pending]);

  srv = await startServer(4703); // applies 018, then the carry-over runs a moment after start
  await new Promise((r) => setTimeout(r, 4000));
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const q = async (sql, params) => (await pool.query(sql, params)).rows;

test('018 was applied, and nobody lost their status', async () => {
  assert.ok((await q(`SELECT 1 FROM schema_migrations WHERE name = '018_verification_v2.sql'`)).length);
  const statuses = Object.fromEntries((await q('SELECT id, verification_status, verification_rules FROM users')).map((r) => [r.id, r]));
  assert.equal(statuses[ids.approved].verification_status, 'verified');
  assert.equal(statuses[ids.pending].verification_status, 'pending');
  assert.equal(statuses[ids.rejected].verification_status, 'rejected');
  assert.equal(statuses[ids.suspended].verification_status, 'suspended');
  assert.equal(statuses[ids.approved].verification_rules, 1, 'decided under the first rules');
  assert.equal(statuses[ids.pending].verification_rules, 2);
  // The old steps are all still there, for the record.
  assert.equal((await q('SELECT count(*)::int AS n FROM verification_steps WHERE step IN (\'proof_link\', \'portfolio\', \'company_id\')'))[0].n, 4);
});

test('an approved mentor keeps the approval, gets the Experience step and the age step from the ID check', async () => {
  const steps = Object.fromEntries((await q('SELECT step, status, reason, evidence FROM verification_steps WHERE user_id = $1', [ids.approved])).map((r) => [r.step, r]));
  assert.equal(steps.experience.status, 'passed');
  assert.equal(steps.experience.reason, 'carried over from verification rules v1');
  assert.equal(steps.age.status, 'passed');
  assert.deepEqual(steps.age.evidence, { adult: true });
  const u = (await q('SELECT story, application_submitted_at FROM users WHERE id = $1', [ids.approved]))[0];
  assert.ok(u.application_submitted_at, 'counts as submitted');
  assert.match(u.story, /packaging and brand identities/, 'a long bio became the starting story');
  const ev = await q('SELECT kind, url, check_status FROM mentor_evidence WHERE user_id = $1 ORDER BY kind', [ids.approved]);
  assert.deepEqual(ev.map((e) => e.kind), ['linkedin', 'work_email']);
  // The public badges: ID verified and Experience reviewed (and the work email).
  const badges = await client(srv.base).api(`/experts/${ids.approved}`);
  if (badges.status === 200 && badges.badges) assert.ok(badges.badges.some((b) => b.key === 'experience'));
  assert.equal((await q(`SELECT count(*)::int AS n FROM verification_steps WHERE user_id = $1 AND step = 'experience'`, [ids.suspended]))[0].n, 1, 'a suspended mentor keeps it too');
});

test('a waiting application: evidence carried over, analysed for the admin, the mentor told once', async () => {
  const ev = await q('SELECT kind, url, registry_id, check_status, document_id FROM mentor_evidence WHERE user_id = $1 ORDER BY kind', [ids.pending]);
  assert.deepEqual(ev.map((e) => e.kind), ['company', 'diploma', 'other', 'portfolio']);
  assert.equal(ev.find((e) => e.kind === 'company').registry_id, '404123456');
  assert.equal(ev.find((e) => e.kind === 'company').check_status, 'admin_check');
  assert.ok(ev.find((e) => e.kind === 'diploma').document_id);
  const reviews = await q('SELECT trigger, outcome, ai_error FROM verification_reviews WHERE user_id = $1', [ids.pending]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].trigger, 'migrated');
  assert.equal(reviews[0].outcome, 'needs_human', 'never approved automatically');
  const notices = await q(`SELECT count(*)::int AS n FROM verification_audit WHERE mentor_id = $1 AND action = 'migration_notice_sent'`, [ids.pending]);
  assert.equal(notices[0].n, 1);
  const u = (await q('SELECT application_submitted_at, story FROM users WHERE id = $1', [ids.pending]))[0];
  assert.equal(u.application_submitted_at, null, 'they finish the new form and submit it themselves');
  assert.equal(u.story, null, 'a short bio does not become the story');
});

test('starting again changes nothing (no second email, no second analysis)', async () => {
  srv.proc.kill();
  srv = await startServer(4703);
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal((await q(`SELECT count(*)::int AS n FROM verification_audit WHERE action = 'migration_notice_sent'`))[0].n, 1);
  assert.equal((await q(`SELECT count(*)::int AS n FROM verification_reviews`))[0].n, 1);
  assert.equal((await q(`SELECT count(*)::int AS n FROM verification_audit WHERE action = 'migrated_to_rules_v2'`))[0].n, 4);
});

test('the undo script reverses 018 cleanly (inside a transaction that is rolled back)', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '018_verification_v2.down.sql'), 'utf8'));
    assert.equal((await c.query(`SELECT to_regclass('mentor_evidence') AS t`)).rows[0].t, null);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'story'`)).rows[0].n, 0);
    assert.equal((await c.query(`SELECT verification_status FROM users WHERE id = $1`, [ids.approved])).rows[0].verification_status, 'verified');
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM verification_steps WHERE step = 'proof_link'`)).rows[0].n, 2);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
