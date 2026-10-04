// "Find me a mentor" (PART 7B): a signed-in visitor's request is active at once, anybody else confirms by email; one active request per
// email and field; checks like the contact form (a hidden field for bots, rude words, contact details); a matching mentor's listing sends
// ONE email; the email's link removes the request; the public board exists only from 5 requests and shows anonymous counts (text only
// when allowed); admins see everything, can merge two spellings and export a CSV.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, SAMPLE, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-requests-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, visitor;

async function signup(name, email) {
  const c = client(base);
  await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345' } });
  let mail;
  for (let i = 0; i < 60 && !mail; i++) { mail = outbox().find((m) => m.to === email); if (!mail) await wait(100); }
  const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
const ask = (c, body) => c.api('/requests', { method: 'POST', body: { field: 'Study in Germany', niche: 'study_abroad', need: 'I want to study engineering in Munich and need help with the application.', ...body } });
const mailsTo = (to, part) => outbox().filter((m) => m.to === to && (!part || m.subject.includes(part)));
async function waitMail(to, part) { for (let i = 0; i < 60; i++) { const m = mailsTo(to, part); if (m.length) return m; await wait(100); } return []; }

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4727, { RATE_LIMIT_MULTIPLIER: '20', SWEEP_INTERVAL_SECONDS: '1', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>' });
  base = srv.base;
  admin = await signup('QA Admin', 'qa-admin@example.com');
  visitor = client(base);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('asking', () => {
  test('a visitor confirms by email first; checks like the contact form', async () => {
    assert.equal((await ask(visitor, { email: 'not-an-email' })).error, 'invalid_email');
    assert.equal((await ask(visitor, { email: 'a@example.com', need: 'too short' })).error, 'invalid_need');
    assert.equal((await ask(visitor, { email: 'a@example.com', need: 'Call me on +995 599 123 456 about studying in Munich please' })).error, 'contact_details');
    assert.equal((await ask(visitor, { email: 'a@example.com', field: 'fucking bees' })).error, 'invalid_field');
    assert.equal((await ask(visitor, { email: 'a@example.com', niche: 'astrology' })).error, 'invalid_niche');
    assert.equal((await ask(visitor, { email: 'a@example.com', budgetMin: 50, budgetMax: 10 })).error, 'invalid_budget');
    const bot = await ask(visitor, { email: 'bot@example.com', website: 'http://spam.example' });
    assert.equal(bot.status, 201, 'a bot is told it worked');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM mentor_requests WHERE email = 'bot@example.com'`)).rows[0].n, 0, '…and nothing is kept');

    const r = await ask(visitor, { email: 'ana@example.com', showPublic: true });
    assert.equal(r.status, 201);
    assert.equal(r.needsConfirmation, true);
    const [mail] = await waitMail('ana@example.com', 'Confirm');
    assert.ok(mail, 'a confirmation email');
    const url = mail.text.match(/https?:\/\/\S+\/api\/requests\/confirm\?token=[0-9a-f]{48}/)[0];
    assert.equal((await pool.query(`SELECT status FROM mentor_requests WHERE email = 'ana@example.com'`)).rows[0].status, 'unconfirmed');
    const res = await fetch(url.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });
    assert.equal(res.headers.get('location'), '/find-a-mentor.html?confirmed=1');
    assert.equal((await pool.query(`SELECT status FROM mentor_requests WHERE email = 'ana@example.com'`)).rows[0].status, 'active');
    assert.equal((await ask(visitor, { email: 'ANA@example.com', field: 'study in germany' })).error, 'already_requested', 'one active request per email and field');
  });

  test('a signed-in person with a confirmed email is active at once, with their account email', async () => {
    const giorgi = await signup('Giorgi Asker', 'giorgi@example.com');
    const r = await ask(giorgi, { field: 'Opening a cafe', niche: 'business', need: 'I want to open a small cafe in Batumi and need help with the numbers.' });
    assert.equal(r.status, 201);
    assert.equal(r.needsConfirmation, false);
    assert.equal(r.request.status, 'active');
  });
});

describe('matching', () => {
  test('when a matching mentor is listed the person gets ONE email with the profile and a link that removes the request', async () => {
    const mentor = await signup('Mariam Munich', 'mariam@example.com');
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer who studied in Munich', niche: 'tech', price: 20, sampleAnswer: SAMPLE } });
    await mentor.api('/verification/experience', { method: 'PUT', body: { customNiche: 'Studying in Germany' } });
    await approveMentor(admin, mentor);
    await addPayoutDetails(mentor, undefined, 'Mariam Munich');
    const mails = await waitMail('ana@example.com', 'mentor for');
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /\/u\/mariam-munich/);
    // A second matching mentor: no second email.
    const second = await signup('Dato Dresden', 'dato@example.com');
    await second.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Studied in Dresden', niche: 'study_abroad', price: 20, sampleAnswer: SAMPLE } });
    await approveMentor(admin, second);
    await addPayoutDetails(second, undefined, 'Dato Dresden');
    await wait(500);
    assert.equal(mailsTo('ana@example.com', 'mentor for').length, 1, 'only one email ever');
    assert.equal(mailsTo('giorgi@example.com', 'mentor for').length, 0, 'a cafe is not Germany');
    const remove = mails[0].text.match(/https?:\/\/\S+\/api\/requests\/remove\?token=[0-9a-f]{48}/)[0];
    const res = await fetch(remove.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });
    assert.equal(res.headers.get('location'), '/find-a-mentor.html?removed=1');
    assert.equal((await pool.query(`SELECT status FROM mentor_requests WHERE email = 'ana@example.com'`)).rows[0].status, 'removed');
  });
});

describe('the board and the admin', () => {
  test('the board appears from 5 active requests, anonymous, with a request\'s text only when its author allowed it', async () => {
    assert.equal((await fetch(`${base}/requests`)).status, 404, 'under 5: no board');
    assert.equal((await client(base).api('/requests/board')).open, false);
    for (const [i, show] of [[1, true], [2, false], [3, false], [4, true]]) {
      const c = await signup(`Asker ${i}`, `asker${i}@example.com`);
      await ask(c, { field: 'Nail artist', niche: 'other', need: `Request number ${i}: how do I start working as a nail artist from home?`, showPublic: show });
    }
    const board = await client(base).api('/requests/board');
    assert.equal(board.open, true);
    const nails = board.fields.find((f) => f.label === 'Nail artist');
    assert.equal(nails.count, 4);
    assert.equal(nails.texts.length, 2, 'only the two that allowed it');
    const html = await (await fetch(`${base}/requests`)).text();
    assert.match(html, /4 people are looking for: Nail artist/);
    assert.doesNotMatch(html, /asker\d@example\.com|Asker \d/, 'nobody is named');
  });

  test('admins see the requests, the fields with no mentor, a CSV, and can merge two spellings', async () => {
    const c = await signup('Asker Five', 'asker5@example.com');
    await ask(c, { field: 'Nail artists', niche: 'other', need: 'How much should a beginner nail artist charge for a first set?' });
    assert.equal((await c.api('/admin/requests')).status, 403);
    const d = await admin.api('/admin/requests');
    assert.ok(d.topUnserved.some((f) => f.label === 'Nail artist'));
    const nails = d.byField.filter((f) => /nail artist/i.test(f.label));
    assert.equal(nails.length, 2, 'two spellings before merging');
    const from = nails.find((f) => f.label === 'Nail artists').key;
    const into = nails.find((f) => f.label === 'Nail artist').key;
    assert.equal((await admin.api('/admin/requests/merge', { method: 'POST', body: { from, into } })).merged, 1);
    assert.equal((await admin.api('/admin/requests')).byField.filter((f) => /nail artist/i.test(f.label)).length, 1);
    const csv = await (await admin.raw('/api/admin/requests.csv')).text();
    assert.match(csv, /asker5@example\.com/);
  });

  test('requests end after 60 days', async () => {
    await pool.query(`UPDATE mentor_requests SET expires_at = now() - interval '1 minute' WHERE email = 'giorgi@example.com'`);
    for (let i = 0; i < 60; i++) { // (the sweep runs every second here)
      const s = (await pool.query(`SELECT status FROM mentor_requests WHERE email = 'giorgi@example.com'`)).rows[0].status;
      if (s === 'expired') break;
      await wait(100);
    }
    assert.equal((await pool.query(`SELECT status FROM mentor_requests WHERE email = 'giorgi@example.com'`)).rows[0].status, 'expired');
  });
});
