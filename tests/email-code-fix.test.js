// A slow email must never block anyone (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md): a code works for 24 hours, any of the last 3 codes works (a
// resend does not kill the one before), five wrong codes mean a short wait (not a dead code), a resend waits a minute; a mentor fills in
// and sends the application before the email is confirmed, but no admin can approve it until it is; "Use another email" keeps everything
// filled in; a confirmed account can change its email in Settings (a code to the new address, a notice to the old one).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, SAMPLE, longAnswer } = require('./helpers');
const { createFakeResend } = require('./fakeResend');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4873, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

async function signup(name, email) {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name, email, password: 'test-pass-12345' } });
  assert.equal(su.status, 201, su.text);
  return { c, code: su.devVerifyCode, id: su.user.id };
}
// (the codes of one person, made older: as if the mail had waited that long at a company mail server)
const ageCodes = (id, hours) => pool.query(`UPDATE email_codes SET created_at = created_at - make_interval(hours => $2), expires_at = expires_at - make_interval(hours => $2) WHERE user_id = $1`, [id, hours]);
const verify = (c, code) => c.api('/auth/verify-email', { method: 'POST', body: { code } });
const otherCode = (code) => String((Number(code) + 1) % 900000 + 100000);

describe('a late code still works', () => {
  test('a code works after 23 hours and fails after 25', async () => {
    const a = await signup('Late Mail', 'late-23@corp.example');
    await ageCodes(a.id, 23);
    const ok = await verify(a.c, a.code);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.user.emailVerified, true);

    const b = await signup('Too Late', 'late-25@corp.example');
    await ageCodes(b.id, 25);
    const late = await verify(b.c, b.code);
    assert.equal(late.status, 400);
    assert.equal(late.error, 'expired');
  });

  test('an older code (one of the last 3) still works after a resend; the 4th oldest does not', async () => {
    const a = await signup('Two Codes', 'two-codes@corp.example');
    const second = await a.c.api('/auth/resend-verification', { method: 'POST' });
    assert.equal(second.status, 200, second.text);
    assert.notEqual(second.devVerifyCode, a.code);
    assert.equal((await verify(a.c, a.code)).status, 200, 'the first code works after a resend');

    const b = await signup('Four Codes', 'four-codes@corp.example');
    const codes = [b.code];
    for (let i = 0; i < 3; i++) {
      await pool.query(`UPDATE email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, [b.id]); // (past the one-minute wait)
      codes.push((await b.c.api('/auth/resend-verification', { method: 'POST' })).devVerifyCode);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_codes WHERE user_id = $1', [b.id])).rows[0].n, 3);
    assert.equal((await verify(b.c, codes[0])).error, 'invalid_code', 'only the last 3 codes count');
    assert.equal((await verify(b.c, codes[1])).status, 200, 'the oldest of the last 3 works');
  });
});

describe('the limits still hold', () => {
  test('5 wrong codes: a short wait, even for the right code; after the wait the code still works', async () => {
    const a = await signup('Brute Force', 'brute-wait@corp.example');
    const wrong = otherCode(a.code);
    for (let i = 0; i < 4; i++) assert.equal((await verify(a.c, wrong)).error, 'invalid_code');
    const fifth = await verify(a.c, wrong);
    assert.equal(fifth.error, 'too_many_attempts');
    const right = await verify(a.c, a.code);
    assert.equal(right.status, 400);
    assert.equal(right.error, 'too_many_attempts');
    assert.ok(right.retryAfter > 0 && right.retryAfter <= 15 * 60, `a short wait: ${right.retryAfter}`);
    await pool.query(`UPDATE users SET email_code_locked_until = now() - interval '1 second' WHERE id = $1`, [a.id]); // (the wait is over)
    assert.equal((await verify(a.c, a.code)).status, 200, 'the code was not killed: a late mail is never wasted');
  });

  test('a resend waits a minute; a resend does not end the wait after wrong codes', async () => {
    const a = await signup('Resend Twice', 'resend-twice@corp.example');
    assert.equal((await a.c.api('/auth/resend-verification', { method: 'POST' })).status, 200);
    const again = await a.c.api('/auth/resend-verification', { method: 'POST' });
    assert.equal(again.status, 429);
    assert.equal(again.error, 'resend_wait');
    assert.ok(again.retryAfter > 0 && again.retryAfter <= 60);

    for (let i = 0; i < 5; i++) await verify(a.c, otherCode(a.code));
    await pool.query(`UPDATE email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, [a.id]);
    const fresh = await a.c.api('/auth/resend-verification', { method: 'POST' });
    assert.equal(fresh.status, 200);
    assert.equal((await verify(a.c, fresh.devVerifyCode)).error, 'too_many_attempts', 'a new code does not lift the wait');
  });
});

describe('a mentor never waits for the email', () => {
  const form = {
    roleTitle: 'Business adviser', customNiche: 'Company strategy', niche: 'business', specialtyTags: ['strategy'], yearsExperience: 22,
    story: 'I have advised companies in Tbilisi for twenty-two years, first at a large consultancy and for the last ten years in my own advisory practice.',
    sampleAnswer: longAnswer(SAMPLE)
  };
  let lawyer;

  test('all the steps save before the email is confirmed, and the application can be sent', async () => {
    lawyer = await signup('Senior Lawyer', 'partner@lawfirm.example');
    assert.equal((await lawyer.c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 60, headline: 'Partner at an advisory firm' } })).status, 200);
    const exp = await lawyer.c.api('/verification/experience', { method: 'PUT', body: { ...form, niche: 'business', customNiche: 'Company strategy for founders' } });
    assert.equal(exp.status, 200, exp.text);
    assert.equal((await lawyer.c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'https://lawfirm.invalid/team' } })).status, 200);
    const v = await lawyer.c.api('/verification');
    assert.ok(!v.application.missing.includes('email'), 'the email is not "missing" for sending');
    const sent = await lawyer.c.api('/verification/submit', { method: 'POST' });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.user.emailVerified, false);
    assert.ok(sent.user.applicationSubmittedAt);
  });

  test('admin sees "email not confirmed" and cannot approve until it is', async () => {
    const list = (await admin.api('/admin/mentors?status=email_unconfirmed')).mentors;
    const row = list.find((m) => m.id === lawyer.id);
    assert.ok(row, 'in the "Email not confirmed" filter');
    assert.equal(row.emailVerified, false);
    assert.ok(!list.some((m) => m.emailVerified), 'the filter shows only unconfirmed emails');
    // every other step passed (the ID check and the rest have their own tests): only the email is left
    const rules = require('../server/verification/rules');
    const me = (await lawyer.c.api('/me')).user;
    for (const step of rules.requiredFor(me.niche).filter((s) => s !== 'email' && s !== 'experience')) {
      await pool.query(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'test setup', now())
        ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed'`, [lawyer.id, step]);
    }
    const detail = await admin.api(`/admin/mentors/${lawyer.id}/verification`);
    assert.ok(detail.oneTap.blockedBy.includes('email'), JSON.stringify(detail.oneTap));
    const refused = await admin.api(`/admin/mentors/${lawyer.id}/approve`, { method: 'POST' });
    assert.equal(refused.status, 409, refused.text);

    // the code arrives hours later and is entered from the dashboard: now it can be approved
    await ageCodes(lawyer.id, 6);
    assert.equal((await verify(lawyer.c, lawyer.code)).status, 200);
    assert.ok(!(await admin.api('/admin/mentors?status=email_unconfirmed')).mentors.some((m) => m.id === lawyer.id));
    const after = await admin.api(`/admin/mentors/${lawyer.id}/verification`);
    assert.ok(!after.oneTap.blockedBy.includes('email'), JSON.stringify(after.oneTap));
    const ok = await admin.api(`/admin/mentors/${lawyer.id}/approve`, { method: 'POST' });
    assert.equal(ok.status, 200, ok.text);
  });

  test('"Use another email" keeps the filled-in steps; the old address\'s code stops working, the new one works', async () => {
    const m = await signup('Professor Switch', 'prof@university.example');
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30, headline: 'Professor of economics' } })).status, 200);
    assert.equal((await m.c.api('/verification/experience', { method: 'PUT', body: { ...form, niche: 'teaching', customNiche: 'University teaching' } })).status, 200);
    const before = (await m.c.api('/verification')).application;

    const sw = await m.c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'prof.personal@mail.example' } });
    assert.equal(sw.status, 200, sw.text);
    assert.equal(sw.user.email, 'prof.personal@mail.example');
    const now = (await m.c.api('/verification')).application;
    assert.deepEqual(now.form, before.form, 'every field filled in stays');
    assert.equal((await m.c.api('/me')).user.headline, 'Professor of economics');

    assert.equal((await verify(m.c, m.code)).error, 'invalid_code', 'the old address\'s code does not count');
    assert.equal((await verify(m.c, sw.devVerifyCode)).status, 200);
  });
});

describe('Settings: change a confirmed email', () => {
  const resend = createFakeResend();
  let mailSrv, mbase;
  before(async () => {
    await resend.start();
    mailSrv = await startServer(4874, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecallge.ge>', RATE_LIMIT_MULTIPLIER: '20' });
    mbase = mailSrv.base;
  });
  after(async () => { if (mailSrv) mailSrv.proc.kill(); await resend.stop(); });

  test('the password, a code to the new address, then the change; the old address gets a notice', async () => {
    const c = client(mbase);
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Mover', email: 'old-box@corp.example', password: 'test-pass-12345' } })).status, 201);
    assert.equal((await verify(c, resend.codeIn(await resend.waitFor('old-box@corp.example')))).status, 200);

    assert.equal((await c.api('/me/email', { method: 'POST', body: { email: 'new-box@mail.example', password: 'wrong-password-1' } })).error, 'wrong_password');
    assert.equal((await c.api('/me/email', { method: 'POST', body: { email: 'old-box@corp.example', password: 'test-pass-12345' } })).error, 'same_email');
    const start = await c.api('/me/email', { method: 'POST', body: { email: 'new-box@mail.example', password: 'test-pass-12345' } });
    assert.equal(start.status, 200, start.text);
    assert.equal(start.pendingEmail, 'new-box@mail.example');
    const me = (await c.api('/me')).user;
    assert.equal(me.email, 'old-box@corp.example', 'the old address stays until the code is entered');
    assert.equal(me.pendingEmail, 'new-box@mail.example');

    const code = resend.codeIn(await resend.waitFor('new-box@mail.example'));
    assert.equal((await c.api('/me/email/confirm', { method: 'POST', body: { code: otherCode(code) } })).error, 'invalid_code');
    const done = await c.api('/me/email/confirm', { method: 'POST', body: { code } });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.user.email, 'new-box@mail.example');
    assert.equal(done.user.pendingEmail, null);
    assert.equal(done.user.emailVerified, true);
    const notice = await resend.waitFor('old-box@corp.example', 'changed');
    assert.match(notice.body.text, /new-box@mail\.example/);
    // signing in works with the new address
    assert.equal((await client(mbase).api('/auth/login', { method: 'POST', body: { email: 'new-box@mail.example', password: 'test-pass-12345' } })).status, 200);
  });

  test('an address that belongs to another account is refused; an unconfirmed account uses "Use another email" instead', async () => {
    const c = client(mbase);
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Taker', email: 'taker@corp.example', password: 'test-pass-12345' } })).status, 201);
    assert.equal((await c.api('/me/email', { method: 'POST', body: { email: 'x@mail.example', password: 'test-pass-12345' } })).error, 'email_not_verified');
    assert.equal((await verify(c, resend.codeIn(await resend.waitFor('taker@corp.example')))).status, 200);
    const taken = await c.api('/me/email', { method: 'POST', body: { email: 'new-box@mail.example', password: 'test-pass-12345' } });
    assert.equal(taken.status, 409);
    assert.equal(taken.error, 'email_taken');
  });
});

// docs/CLAUDE-CODE-UNKNOWN-ERROR.md: a mentor started with his work email (A), confirmed his Gmail (B) instead, then tried to go back to A
// and saw only a generic error, every time: the account was confirmed by then, the code page's "change email" was refused with
// already_verified, and no page had words for that answer; nor could a confirmed account change its email at all.
describe('switching email after confirming another one (the "Unknown error" case)', () => {
  test('A (code sent, unconfirmed) -> B confirmed -> back to A: a clear answer on the code page, the move works in Settings with A\'s late code, nothing lost', async () => {
    const a = await signup('Lasha Example', 'work-a@lawfirm.example');
    const lateCodeForA = a.code;
    assert.equal((await a.c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 50, headline: 'Partner, corporate advisory' } })).status, 200);
    const toB = await a.c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'private-b@mail.example' } });
    assert.equal(toB.status, 200, toB.text);
    assert.equal((await verify(a.c, toB.devVerifyCode)).status, 200);

    // what the code page sent when he typed A again: now a clear answer that names the confirmed address, never a server error
    const again = await a.c.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'work-a@lawfirm.example' } });
    assert.equal(again.status, 400);
    assert.equal(again.error, 'already_verified');
    assert.equal(again.email, 'private-b@mail.example');
    assert.doesNotMatch(again.text, /unknown error/i);

    // Settings: the password, then A's code, which arrived 23 hours late and still works for the move
    const start = await a.c.api('/me/email', { method: 'POST', body: { email: 'work-a@lawfirm.example', password: 'test-pass-12345' } });
    assert.equal(start.status, 200, start.text);
    await ageCodes(a.id, 23);
    const done = await a.c.api('/me/email/confirm', { method: 'POST', body: { code: lateCodeForA } });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.user.email, 'work-a@lawfirm.example');
    assert.equal(done.user.emailVerified, true);
    const me = (await a.c.api('/me')).user;
    assert.equal(me.headline, 'Partner, corporate advisory', 'nothing filled in is lost');
    assert.equal(me.price, 50);

    // and back to B again: a new code to B
    await pool.query(`UPDATE email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, [a.id]);
    const back = await a.c.api('/me/email', { method: 'POST', body: { email: 'private-b@mail.example', password: 'test-pass-12345' } });
    assert.equal(back.status, 200, back.text);
    assert.equal((await a.c.api('/me/email/confirm', { method: 'POST', body: { code: back.devVerifyCode } })).user.email, 'private-b@mail.example');
    assert.equal((await a.c.api('/me')).user.headline, 'Partner, corporate advisory');
  });

  test('B confirmed on a second account while A waits unconfirmed on the first: "already in use", clearly', async () => {
    const first = await signup('First Try', 'held-a@lawfirm.example'); // (A: never confirmed, an application maybe started)
    assert.equal((await first.c.api('/me', { method: 'PATCH', body: { becomeMentor: true, headline: 'Started here' } })).status, 200);
    const second = await signupVerified(base, 'Second Try', 'held-b@mail.example');
    const taken = await second.api('/me/email', { method: 'POST', body: { email: 'held-a@lawfirm.example', password: 'test-pass-12345' } });
    assert.equal(taken.status, 409);
    assert.equal(taken.error, 'email_taken');
    assert.equal((await second.api('/auth/change-unconfirmed-email', { method: 'POST', body: { email: 'held-a@lawfirm.example' } })).error, 'already_verified');
    // the first account is untouched and can go on: sign in, a new code (it works 24 hours), confirm
    const back = client(base);
    assert.equal((await back.api('/auth/login', { method: 'POST', body: { email: 'held-a@lawfirm.example', password: 'test-pass-12345' } })).status, 200);
    await pool.query(`UPDATE email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, [first.id]);
    const fresh = await back.api('/auth/resend-verification', { method: 'POST' });
    assert.equal(fresh.status, 200);
    assert.equal((await verify(back, first.code)).status, 200, 'the first code still works too');
    assert.equal((await back.api('/me')).user.headline, 'Started here');
  });

  test('a server error answers with a short reference, and no text on the site says "Unknown error"', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const files = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|json|html)$/.test(f.name)) files.push(p); } };
    walk(path.join(root, 'public')); walk(path.join(root, 'server'));
    const hits = files.filter((f) => /unknown error|უცნობი შეცდომა/i.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(hits, []);
    for (const lang of ['ka', 'en']) {
      const dict = JSON.parse(fs.readFileSync(path.join(root, 'public/i18n', `${lang}.json`), 'utf8'));
      assert.match(dict['toast.error'], /\{support\}/, 'the generic message says where to write');
      assert.match(dict['toast.errorRef'], /\{ref\}/);
    }
  });
});

// The owner's decisions after the first version: the ID check (step 5, a paid partner check) waits for a confirmed email; steps 1-4 do
// not. In the review queue an unconfirmed email comes after the confirmed ones (and the card shows a grey chip).
describe('the ID check waits for the email; the queue puts unconfirmed emails last', () => {
  test('steps 1-4 save, the ID check is refused until the code is entered, then it starts', async () => {
    const m = await signup('Step Five', 'step-five@corp.example');
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30, headline: 'Head of operations' } })).status, 200);
    const refused = await m.c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(refused.status, 400);
    assert.equal(refused.error, 'email_not_verified');
    assert.equal((await verify(m.c, m.code)).status, 200);
    const started = await m.c.api('/verification/kyc/start', { method: 'POST' });
    assert.equal(started.status, 200, started.text);
    assert.ok(started.url);
  });

  test('in the review queue, unconfirmed emails come after the confirmed ones', async () => {
    const form = { roleTitle: 'Operations lead', customNiche: 'Running a small company', niche: 'business', specialtyTags: ['operations'], yearsExperience: 12,
      story: 'For twelve years I have run the day-to-day operations of small companies in Tbilisi, from hiring the first people to setting up suppliers.', sampleAnswer: longAnswer(SAMPLE) };
    const send = async (c) => {
      assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 25, headline: 'Operations lead' } })).status, 200);
      assert.equal((await c.api('/verification/experience', { method: 'PUT', body: form })).status, 200);
      assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://ops-${Date.now()}-${Math.random()}.invalid/` } })).status, 200);
      const r = await c.api('/verification/submit', { method: 'POST' });
      assert.equal(r.status, 200, r.text);
      return r.user.id;
    };
    // (sent first, so by age alone it would be on top: the unconfirmed one, as when ID checks are closed)
    const early = await signup('Early Unconfirmed', 'early-unconfirmed@corp.example');
    const earlyId = await send(early.c);
    const late = await signupVerified(base, 'Late Confirmed', 'late-confirmed@corp.example');
    const lateId = await send(late);
    const queue = (await admin.api('/admin/mentors?queue=needs_human')).mentors.map((m) => m.id);
    assert.ok(queue.includes(earlyId) && queue.includes(lateId));
    assert.ok(queue.indexOf(lateId) < queue.indexOf(earlyId), 'the confirmed one first');
    const list = (await admin.api('/admin/mentors?queue=needs_human')).mentors;
    const firstUnconfirmed = list.findIndex((m) => !m.emailVerified);
    assert.ok(list.slice(firstUnconfirmed).every((m) => !m.emailVerified), 'every unconfirmed one after every confirmed one');
  });
});
