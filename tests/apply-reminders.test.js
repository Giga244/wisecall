// Reminders for an unfinished application (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2): one email 2 days and one 7 days after
// the application last changed, linking to the step it stopped at, then never a third; a separate one when everything but the ID check
// was sent; the email footer switches them off.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, wait, ABOUT } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const STORY = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports.';
let srv, base;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4781, { SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.ge>' });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

const idOf = async (email) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const back = (email, column, days) => pool.query(`UPDATE users SET ${column} = now() - make_interval(days => $2) WHERE email = $1`, [email, days]);
const reminders = (email, part) => resend.to(email, part);
async function settle() { await wait(2500); } // (two sweeps)

describe('an application left unfinished', () => {
  const email = 'dato-halfway@example.com';
  let c;
  before(async () => {
    c = await signupByEmail(resend, base, 'Dato Halfway', email, 'ka');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'ეკონომიკის პროფესორი' } });
    await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'მაკროეკონომიკა', yearsExperience: 18 } }); // (step 1 done, step 2 next)
  });

  test('nothing within 2 days', async () => {
    assert.ok((await pool.query('SELECT apply_touched_at FROM users WHERE email = $1', [email])).rows[0].apply_touched_at, 'the change was noted');
    await settle();
    assert.equal(reminders(email, 'გელოდება').length, 0);
  });

  test('after 2 days: one friendly email with a link to step 2, and a way to switch them off', async () => {
    await back(email, 'apply_touched_at', 3);
    const mail = await resend.waitFor(email, 'გელოდება');
    assert.match(mail.body.html, /\/apply\.html\?step=2"/);
    assert.match(mail.body.text, /მე-2 ნაბიჯზე/);
    assert.match(mail.body.text, /\/api\/inbox\/unsubscribe|unsubscribe/i);
    await settle();
    assert.equal(reminders(email, 'გელოდება').length, 1, 'once');
  });

  test('after 7 days: the second and last; then never a third', async () => {
    await back(email, 'apply_touched_at', 8);
    await resend.waitForNew(email, 'გელოდება', 1);
    assert.match(reminders(email, 'გელოდება')[1].body.text, /ბოლო შეხსენება/);
    await back(email, 'apply_touched_at', 40);
    await settle();
    assert.equal(reminders(email, 'გელოდება').length, 2, 'no third email');
    assert.equal((await pool.query('SELECT apply_reminders_sent FROM users WHERE email = $1', [email])).rows[0].apply_reminders_sent, 2);
  });
});

describe('everything sent but the ID check', () => {
  const email = 'nino-noid@example.com';
  before(async () => {
    const c = await signupByEmail(resend, base, 'Nino NoId', email, 'en');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Professor of economics', price: 30 } });
    await c.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Macroeconomics', niche: 'business', yearsExperience: 18, story: STORY, about: ABOUT } });
    await c.api('/verification/evidence', { method: 'POST', body: { url: 'https://tsu.ge/staff/nino-noid' } });
    const sent = await c.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, sent.text);
  });

  test('sending it brings "one step left" by email (not "what happens next": the ID check comes first), and no "unfinished" reminder', async () => {
    const mail = await resend.waitFor(email, 'Wisecall – one step left');
    assert.match(mail.body.text, /review your application once the ID check is done/);
    assert.equal(reminders(email, 'We got your Wisecall application').length, 0);
    await back(email, 'apply_touched_at', 3);
    await settle();
    assert.equal(reminders(email, 'is waiting').length, 0);
  });

  test('2 days after sending: a reminder about the ID check; switched off from its footer, no second one', async () => {
    await back(email, 'application_submitted_at', 3);
    const mail = await resend.waitFor(email, 'One step left: the ID check');
    assert.match(mail.body.html, /\/apply\.html\?step=5&amp;start=id"/);
    const unsubscribe = (mail.body.text.match(/https?:\/\/\S+unsubscribe\S*/) || [])[0];
    assert.ok(unsubscribe, 'an unsubscribe link');
    const token = new URL(unsubscribe).searchParams.get('t');
    const off = await fetch(`${base}/api/inbox/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ token }) });
    assert.equal(off.status, 200, await off.text());
    await back(email, 'application_submitted_at', 9);
    await settle();
    assert.equal(reminders(email, 'One step left').length, 1, 'switched off: no second one');
    assert.equal((await pool.query(`SELECT 1 FROM notification_settings WHERE user_id = $1 AND 'apply_reminders' = ANY(email_off)`, [await idOf(email)])).rows.length, 1);
  });
});
