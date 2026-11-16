// The ID check can't be missed (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md): with steps 1-4 done and the ID check not, the server says "one step
// left" (the header's "4/5 · ID left", the cards on /apply.html, the dashboard and Settings); an application sent without it gets
// "Wisecall – one step left" once instead of "We got your application", and the reminders are about the ID check alone; an admin sees
// "Waiting for ID" and can send a reminder at most once in 48 hours; once the ID check passes, a finished application is sent for review
// with nothing more to press. The ID check itself, the 18+ rule and the name match are unchanged.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, wait } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports.';
let srv, base, admin;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4789, { SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.ge>' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com', 'en');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

const idOf = async (email) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const back = (email, column, days) => pool.query(`UPDATE users SET ${column} = now() - make_interval(days => $2) WHERE email = $1`, [email, days]);
async function settle() { await wait(2500); } // (two sweeps)

// A mentor with steps 1-4 done (the ID check not started).
async function fourSteps(name, email, lang = 'en') {
  const c = await signupByEmail(resend, base, name, email, lang);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Professor of economics', price: 30 } });
  await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics', niche: 'business', yearsExperience: 18, story: STORY } });
  const ev = await c.api('/verification/evidence', { method: 'POST', body: { url: `https://tsu.ge/staff/${email.split('@')[0]}` } });
  assert.equal(ev.status, 200, ev.text);
  return c;
}
// The (fake) ID partner decides: outcome 'approve' | 'review' | 'decline'.
async function idCheck(c, name, outcome) {
  const start = await c.api('/verification/kyc/start', { method: 'POST' });
  assert.equal(start.status, 200, start.text);
  const session = new URL(start.url).searchParams.get('session');
  const done = await c.api(`/mock-kyc/sessions/${session}/complete`, { method: 'POST', body: { outcome, fullName: name } });
  assert.equal(done.status, 200, done.text);
}
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(150);
  }
}

describe('steps 1-4 done, the ID check not started', () => {
  let c;
  before(async () => { c = await fourSteps('Lela Almost', 'lela-almost@example.com'); });

  test('the server says the ID check is the one step left: the header, the cards and step 5 follow it', async () => {
    const me = (await c.api('/me')).user;
    assert.deepEqual(me.mentorPath, { state: 'draft', step: 5, done: 4, id: 'todo', idLeft: true });
    const v = await c.api('/verification');
    assert.equal(v.application.id, 'todo');
    assert.equal(v.application.idLeft, true);
    assert.deepEqual(v.application.missing, [], 'nothing else is missing');
  });

  test('a draft whose only gap is the ID check is reminded about the ID check, not about "step 5 of 5"', async () => {
    await back('lela-almost@example.com', 'apply_touched_at', 3);
    const mail = await resend.waitFor('lela-almost@example.com', 'One step left: the ID check');
    assert.match(mail.body.text, /Everything else in your application is done/);
    assert.match(mail.body.text, /review your application once the ID check is done/);
    assert.match(mail.body.html, /\/apply\.html\?step=5&amp;start=id"/);
    await settle();
    assert.equal(resend.to('lela-almost@example.com', 'is waiting').length, 0, 'no "your application is waiting" about step 5');
  });
});

describe('sent without the ID check (like the professor\'s)', () => {
  const email = 'tamar-sent@example.com';
  let c;
  before(async () => {
    c = await fourSteps('Tamar Sent', email, 'ka');
    const sent = await c.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, sent.text);
  });

  test('"Wisecall – დარჩა ერთი ნაბიჯი" by email, with a link that starts the ID check; not "we got your application"', async () => {
    const mail = await resend.waitFor(email, 'Wisecall – დარჩა ერთი ნაბიჯი');
    assert.match(mail.body.html, /\/apply\.html\?step=5&amp;start=id"/);
    assert.match(mail.body.text, /პირადობის დადასტურების შემდეგ განვიხილავთ/);
    await settle();
    assert.equal(resend.to(email, 'მიღებულია').length, 0, 'no "application received" while the ID check is left');
    const me = (await c.api('/me')).user;
    assert.equal(me.mentorPath.state, 'sent');
    assert.equal(me.mentorPath.idLeft, true);
    assert.equal((await c.api('/verification')).application.stage, 'waiting_identity');
  });

  test('the email is sent once: "Edit my application" and sending again brings no second one', async () => {
    assert.equal((await c.api('/verification/edit', { method: 'POST' })).status, 200);
    assert.equal((await c.api('/verification/submit', { method: 'POST' })).status, 200);
    await settle();
    assert.equal(resend.to(email, 'Wisecall – დარჩა ერთი ნაბიჯი').length, 1);
  });

  test('the reminders 2 days after sending are about the ID check only', async () => {
    await back(email, 'application_submitted_at', 3);
    const mail = await resend.waitFor(email, 'დარჩა ერთი ნაბიჯი: პირადობის შემოწმება');
    assert.match(mail.body.text, /ბოლო ნაბიჯი პირადობის შემოწმებაა/);
    assert.doesNotMatch(mail.body.text, /ნაბიჯზე \(სულ 5-ია\)/, 'not "you stopped at step N"');
  });

  test('admin: "Waiting for ID", and a reminder at most once in 48 hours', async () => {
    const list = (await admin.api('/admin/mentors')).mentors;
    const row = list.find((m) => m.email === email);
    assert.equal(row.verification.waitingForId, true);
    assert.equal(list.find((m) => m.email === 'lela-almost@example.com').verification.waitingForId, false, 'a draft is not "an application waiting"');
    const id = await idOf(email);
    const before = resend.to(email, 'დარჩა ერთი ნაბიჯი: პირადობის შემოწმება').length;
    const first = await admin.api(`/admin/mentors/${id}/id-reminder`, { method: 'POST' });
    assert.equal(first.status, 200, first.text);
    await resend.waitForNew(email, 'დარჩა ერთი ნაბიჯი: პირადობის შემოწმება', before);
    const second = await admin.api(`/admin/mentors/${id}/id-reminder`, { method: 'POST' });
    assert.equal(second.status, 429);
    assert.equal(second.error, 'too_soon');
    const hours = (new Date(second.nextAt) - Date.now()) / 3600000;
    assert.ok(hours > 47 && hours <= 48, `the next one in about 48 hours (${hours})`);
    assert.equal(resend.to(email, 'დარჩა ერთი ნაბიჯი: პირადობის შემოწმება').length, before + 1, 'refused: nothing sent');
    // (48 hours later it is allowed again; every one is in the mentor's audit log)
    await pool.query(`UPDATE verification_audit SET created_at = created_at - interval '49 hours' WHERE mentor_id = $1 AND action = 'id_reminder_sent'`, [id]);
    assert.equal((await admin.api(`/admin/mentors/${id}/id-reminder`, { method: 'POST' })).status, 200);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM verification_audit WHERE mentor_id = $1 AND action = 'id_reminder_sent'`, [id])).rows[0].n, 2);
    // (not for someone whose ID check is not what is left)
    const other = await signupByEmail(resend, base, 'Not Applying', 'not-applying@example.com', 'en');
    await other.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    assert.equal((await admin.api(`/admin/mentors/${await idOf('not-applying@example.com')}/id-reminder`, { method: 'POST' })).status, 409);
  });

  test('the ID check passes: the review starts, and nobody is "waiting for ID" any more', async () => {
    await idCheck(c, 'Tamar Sent', 'approve');
    await until(async () => !(await c.api('/me')).user.mentorPath.idLeft);
    const row = (await admin.api('/admin/mentors')).mentors.find((m) => m.email === email);
    assert.equal(row.verification.waitingForId, false);
  });
});

describe('the ID check passes before sending', () => {
  const email = 'giorgi-first@example.com';
  let c;
  before(async () => { c = await fourSteps('Giorgi First', email); });

  test('with the partner ("in review"): not "one step left", but "being checked"', async () => {
    await idCheck(c, 'Giorgi First', 'review');
    const path = await until(async () => { const p = (await c.api('/me')).user.mentorPath; return p.id === 'checking' && p; });
    assert.equal(path.idLeft, false);
    assert.equal(path.state, 'draft');
  });

  test('passed: the application is sent for review by itself, with nothing more to press', async () => {
    await idCheck(c, 'Giorgi First', 'approve');
    const sentAt = await until(async () => (await pool.query('SELECT application_submitted_at FROM users WHERE email = $1', [email])).rows[0].application_submitted_at);
    assert.ok(sentAt);
    const me = (await c.api('/me')).user;
    assert.equal(me.mentorPath.state, 'sent');
    assert.equal(me.mentorPath.idLeft, false);
    assert.equal(me.verificationStatus, 'pending');
    assert.ok(['checking', 'with_team'].includes((await c.api('/verification')).application.stage));
    await resend.waitFor(email, 'We got your Wisecall application');
    assert.equal(resend.to(email, 'one step left').length, 0);
    const { rows } = await pool.query(`SELECT action FROM verification_audit WHERE mentor_id = $1 AND action = 'application_submitted'`, [await idOf(email)]);
    assert.equal(rows.length, 1);
  });

  test('a declined check is "try again", still the one step left', async () => {
    const d = await fourSteps('Eka Declined', 'eka-declined@example.com');
    await idCheck(d, 'Eka Declined', 'decline');
    const path = await until(async () => { const p = (await d.api('/me')).user.mentorPath; return p.id === 'failed' && p; });
    assert.equal(path.idLeft, true);
    assert.equal((await pool.query('SELECT application_submitted_at FROM users WHERE email = $1', ['eka-declined@example.com'])).rows[0].application_submitted_at, null);
  });
});

test('the words: Georgian first, as the brief has them, and the same in the header\'s first-frame table', () => {
  const ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
  assert.equal(ka['idcard.title'], 'დარჩა ერთი ნაბიჯი: პირადობის დადასტურება');
  assert.equal(ka['idcard.line'], 'ID ბარათის ფოტო + სელფი, დაახლოებით 3 წუთი, ტელეფონითაც შეგიძლია.');
  assert.equal(ka['idcard.start'], 'დაწყება');
  assert.equal(ka['idcard.retry'], 'სცადე თავიდან');
  assert.equal(ka['idcard.checking'], 'პირადობა მოწმდება, ჩვეულებრივ რამდენიმე წუთი.');
  assert.equal(ka['nav.idLeft'], 'განაცხადი · 4/5 · დარჩა პირადობა');
  assert.equal(ka['apply.step.submit'], 'პირადობა');
  for (const k of Object.keys(ka).filter((x) => x.startsWith('idcard.'))) assert.ok(en[k], `${k} in English`);
  const adminKa = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/admin-ka.json'), 'utf8'));
  assert.equal(adminKa['admin.mv.waitingForId'], 'ID-ს ელოდება');
  const header = fs.readFileSync(path.join(ROOT, 'public/js/header.js'), 'utf8');
  assert.match(header, /'nav\.idLeft': 'განაცხადი · 4\/5 · დარჩა პირადობა'/);
});
