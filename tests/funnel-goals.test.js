// The funnel (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 6, docs/ANALYTICS.md): the Plausible events a mentor's journey sends,
// each once and with no personal data, and the same funnel from the database in the admin overview. Plausible is faked here.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, startServer, signupVerified, client, approveMentor, wait } = require('./helpers');

const seen = [];
let fake, srv, base;
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports.';

before(async () => {
  fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url === '/api/event') seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(202); res.end('ok');
  });
  await new Promise((r) => fake.listen(0, r));
  await resetDatabase();
  srv = await startServer(4785, { RATE_LIMIT_MULTIPLIER: '20', PLAUSIBLE_DOMAIN: 'wisecall.test', PLAUSIBLE_API_URL: `http://localhost:${fake.address().port}/api/event` });
  base = srv.base;
});
after(() => { if (srv) srv.proc.kill(); fake.close(); });

const names = () => seen.filter((e) => e.name !== 'pageview').map((e) => e.name);
const count = (n) => names().filter((x) => x === n).length;
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(50); } return false; };

test('a mentor\'s journey sends each goal once, in order, with no personal data; the admin overview counts the same steps', async () => {
  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const c = client(base);
  assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Funnel Mentor', email: 'funnel-mentor@example.com', password: 'test-pass-12345', as: 'mentor' } })).status, 201);
  assert.ok(await until(() => count('signup') === 2)); // (the admin's, then the mentor's)
  assert.equal(seen.filter((e) => e.name === 'signup').pop().props.role, 'mentor');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    // (the code is only kept hashed: a fresh one is set for the test)
    const bcrypt = require('bcryptjs');
    await pool.query(`UPDATE users SET email_code_hash = $2, email_code_expires_at = now() + interval '10 minutes' WHERE email = $1`, ['funnel-mentor@example.com', await bcrypt.hash('123456', 4)]);
  } finally { await pool.end(); }
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: '123456' } })).status, 200);
  // (the admin's, then the mentor's: waiting for exactly one passed only when the mentor's event happened to arrive after the check)
  assert.ok(await until(() => count('email_verified') === 2), names().join());

  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Professor of economics' } });
  await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics', niche: 'business', yearsExperience: 18 } });
  assert.ok(await until(() => count('apply_step_1_done') === 1), names().join());
  await c.api('/verification/experience', { method: 'PUT', body: { story: STORY } });
  assert.ok(await until(() => count('apply_step_2_done') === 1), names().join());
  await c.api('/verification/experience', { method: 'PUT', body: { story: STORY + ' Again.' } });
  await c.api('/me', { method: 'PATCH', body: { price: 30 } });
  assert.ok(await until(() => count('apply_step_3_done') === 1), names().join());
  await c.api('/verification/evidence', { method: 'POST', body: { url: 'https://www.tsu.ge/en/staff/funnel-mentor' } });
  assert.ok(await until(() => count('apply_step_4_done') === 1), names().join());
  await c.api('/verification/kyc/start', { method: 'POST' });
  assert.ok(await until(() => count('id_check_started') === 1), names().join());
  assert.equal((await c.api('/verification/submit', { method: 'POST' })).status, 200);
  assert.ok(await until(() => count('apply_sent') === 1), names().join());
  await approveMentor(admin, c);
  assert.ok(await until(() => count('mentor_approved') === 1), names().join());
  for (const n of ['apply_step_1_done', 'apply_step_2_done', 'apply_step_3_done']) assert.equal(count(n), 1, `${n} once, however many saves`);
  assert.doesNotMatch(JSON.stringify(seen), /funnel-mentor|Funnel Mentor|Macroeconomics|tsu\.ge/, 'nothing personal');

  const f = (await admin.api('/admin/overview')).mentorFunnel;
  assert.equal(f.days, 30);
  assert.ok(f.signup >= 1);
  for (const k of ['emailVerified', 'step1', 'step2', 'step3', 'step4', 'sent', 'approved']) assert.ok(f[k] >= 1, k);
  assert.ok(f.signup >= f.emailVerified && f.emailVerified >= f.sent && f.sent >= f.approved);
});
