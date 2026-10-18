// scripts/profile-db.js: a read-only data profile. Run against the TEST database after the app made some real data, with a few rows
// broken on purpose: the problems are listed on top (worst first), and the report has counts only, never a name, an email address, an
// IBAN, a question or an id, and never the database address.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, bookAndPay, longAnswer, SAMPLE, GOOD_IBAN } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const OUT = path.join(os.tmpdir(), `wisecall-profile-${process.pid}.md`);
const QUESTION = 'Should I move from accounting into data analysis this year?';
let srv, report;

const run = (...extra) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'profile-db.js'), ...extra], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }
});

before(async () => {
  await resetDatabase();
  srv = await startServer(4748, { RATE_LIMIT_MULTIPLIER: '20' });
  const admin = await signupVerified(srv.base, 'QA Admin', 'qa-admin@example.com');
  const asker = await signupVerified(srv.base, 'Ana Profile', 'ana.profile@example.com');
  const mentor = await signupVerified(srv.base, 'Mika Profile', 'mika.profile@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Analyst', niche: 'tech', price: 60, sampleAnswer: SAMPLE } });
  const mentorId = await approveMentor(admin, mentor);
  assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: 'Mika Profile', iban: GOOD_IBAN, currentPassword: 'test-pass-12345' } })).status, 200);
  const b = await bookAndPay(srv.base, asker, mentorId, QUESTION);
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with one small analysis at work.') } })).status, 200);
  // Broken on purpose: an address used twice (it differs only by a space), a fee that does not add up, a sign-up dated next week, and a
  // waiting-list address in two fields with different case.
  await pool.query(`INSERT INTO users (name, email, color) VALUES ('Dup Profile', ' ana.profile@example.com', '#3f8fc4')`);
  await pool.query('UPDATE bookings SET platform_fee_amount = platform_fee_amount + 1 WHERE id = $1', [b.id]);
  await pool.query(`UPDATE users SET created_at = now() + interval '7 days' WHERE email = 'mika.profile@example.com'`);
  await pool.query(`INSERT INTO waitlist (email, niche, token) VALUES ('wait@example.com', 'tech', 'tok-1'), ('WAIT@example.com', 'law', 'tok-2')`);
  srv.proc.kill(); // (the script needs no server)
  srv = null;

  const r = run('--out', OUT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /\(read-only\)/);
  report = fs.readFileSync(OUT, 'utf8');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUT, { force: true }); });

test('the problems are listed on top, worst first, each with its count', () => {
  const top = report.slice(report.indexOf('## Problems found'), report.indexOf('## 1. Row counts'));
  assert.match(top, /\| Duplicate user email addresses \(ignoring case and spaces\) \| 1 \| 2 accounts \|/);
  assert.match(top, /\| bookings: platform_fee_amount \+ mentor_net_amount <> amount \(no discount\) \| 1 \|/);
  assert.match(top, /\| timestamps: users\.created_at more than 1 day in the future \| 1 \|/);
  assert.match(top, /\| Duplicate waiting-list email addresses \(ignoring case\) \| 1 \| 2 rows \|/);
  const counts = [...top.matchAll(/^\| [^|]+ \| ([\d,]+) \|/gm)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'worst first');
});

test('every section is there, as short tables, with money in GEL', () => {
  for (const h of ['## 1. Row counts', '## 2. users', '## 3. waitlist', '## 4. bookings', '## 5. payouts and payout_batches', '## 6. disputes',
    '## 7. Timestamps more than 1 day in the future', '## 8. Leftovers']) assert.ok(report.includes(h), h);
  assert.match(report, /\| users \| 4 \|/, 'row counts per table');
  assert.match(report, /\| answered \| 1 \|/);
  assert.match(report, /\| all \| 1 \| 60\.00 GEL \| 60\.00 GEL \| 60\.00 GEL \|/, 'tetri shown in GEL');
  assert.match(report, /\| 1 \| 60 GEL \| 60 GEL \| 60 GEL \| 0 \|/, 'a verified mentor\'s price in whole lari');
  assert.match(report, /\| mentor \| 1 \|/);
  assert.match(report, /\| stripe_events \(from before the Georgian banks\) \| 0 \|/);
});

test('aggregates only: no name, email address, IBAN, question, answer or id, and never the database address', () => {
  assert.doesNotMatch(report, /@/, 'no email address');
  assert.doesNotMatch(report, /Ana|Mika|Dup Profile|QA Admin/, 'no name');
  assert.doesNotMatch(report, /GE\d\d[A-Z]{2}\d/, 'no IBAN');
  assert.doesNotMatch(report, new RegExp(QUESTION.slice(0, 20)), 'no question');
  assert.doesNotMatch(report, /Start with one small analysis/, 'no answer');
  assert.doesNotMatch(report, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no id');
  const url = new URL(process.env.TEST_DATABASE_URL);
  const stdout = run('--stdout');
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.match(stdout.stdout, /^# Data profile: /, '--stdout prints the report');
  for (const text of [report, stdout.stdout, stdout.stderr]) {
    assert.ok(!text.includes(process.env.TEST_DATABASE_URL), 'not the address');
    if (url.password) assert.ok(!text.includes(decodeURIComponent(url.password)), 'not the password');
  }
});

test('read-only: one READ ONLY transaction, rolled back, and not a single write statement; the report is never committed', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'profile-db.js'), 'utf8');
  assert.match(src, /await client\.query\('BEGIN'\);\n\s+await client\.query\('SET TRANSACTION READ ONLY'\);/);
  assert.match(src, /SHOW transaction_read_only/);
  assert.match(src, /await client\.query\('ROLLBACK'\)/);
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+(TABLE|INDEX)|DROP\s+(TABLE|INDEX)|TRUNCATE|GRANT|COMMIT)\b/i);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^docs\/data-profile\/$/m);
});
