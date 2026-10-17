// Security audit, run 1 (docs/security-audit/REPORT.md): one regression test per finding. M1's IBAN sending and M3 are in
// tests/flitt.test.js (they need the fake Flitt), M2 in tests/payments.test.js (the fake TBC).
//   C1  a first password on an account without one needs a real, recent sign-in (and the code with two-step verification on)
//   C2  an admin's powers to read what others may not need the second step of this session
//   C3  the admin scripts are refused under /ka too
//   C4  two-step verification needs a confirmed email; a reset of an unconfirmed account turns it off
//   C5  the experts API shows the About text only to whoever may see it
//   C6  names a mentor typed are escaped in the admins' emails
//   C7  a redirect after signing in stays on this site
//   M1  a withdrawal is paid only to the details saved with it; changing them closes it; nothing during a payout-details hold
//   M4  a full refund after a settled partial refund still owes the rest of the mentor's share
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, bookAndPay, longAnswer, SAMPLE, GOOD_IBAN, wait } = require('./helpers');
const totp = require('../server/totp');

process.env.WISECALL_NO_EXIT = '1';
const { encrypt, decrypt } = require('../server/cryptoBox');

const OUTBOX = path.join(os.tmpdir(), `wisecall-security-audit-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// The first email to `to` whose subject matches, sent after `from` emails were already in the outbox.
async function mailTo(to, subject, from = 0) {
  for (let i = 0; i < 60; i++) {
    const m = outbox().slice(from).find((x) => x.to === to && subject.test(x.subject));
    if (m) return m;
    await wait(100);
  }
  return null;
}
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
const PASSWORD = 'test-pass-12345';
const OTHER_IBAN = 'GE60NB0000000123456789';
let srv, base, srv2, admin, asker, mentor, mentorId, n = 0;

async function signup(name, email, { confirm = true } = {}) {
  const c = client(base);
  const from = outbox().length;
  assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: PASSWORD } })).status, 201);
  if (!confirm) return c;
  const mail = await mailTo(email, /./, from);
  const code = mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
  return c;
}
const idOf = async (email) => (await sql('SELECT id FROM users WHERE email = $1', [email]))[0].id;
// A paid, answered question whose earnings (48 GEL of a 60 GEL price) are available now. Returns the booking id.
async function earned() {
  n += 1;
  const b = await bookAndPay(base, asker, mentorId, `Question ${n}: how should I plan my first months in a new job?`);
  assert.equal((await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer(`Answer ${n}.`) } })).status, 200);
  await pool.query(`UPDATE payouts SET payable_at = now() - interval '1 minute' WHERE booking_id = $1`, [b.id]);
  return b.id;
}
const withdraw = () => mentor.api('/me/withdrawals', { method: 'POST', body: { currentPassword: PASSWORD } });
const openRequest = async () => (await sql(`SELECT * FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentorId]))[0];
const payRequest = async (req) => assert.equal((await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: `TR-${req.id.slice(0, 6)}`, amount: req.amount } })).status, 200);
const owedBack = async () => (await mentor.api('/me/balance')).balance.owedBack;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  const env = { RATE_LIMIT_MULTIPLIER: '20', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', PAYOUT_MIN_GEL: '1' };
  srv = await startServer(4741, env);
  base = srv.base;
  // (the same database, with the admin's second step required: C2)
  srv2 = await startServer(4742, { ...env, ADMIN_2FA: 'required' });
  admin = await signup('QA Admin', 'qa-admin@example.com');
  asker = await signup('Ana Asker', 'ana@example.com');
  mentor = await signup('Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 60, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: 'Mika Mentor', iban: GOOD_IBAN, currentPassword: PASSWORD } })).status, 200);
});
after(async () => { if (srv) srv.proc.kill(); if (srv2) srv2.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('C1: a recent sign-in is a real one', () => {
  test('a sign-in sets its time; the new session of a new password, "sign out other devices" or two-step verification keeps it', async () => {
    const c = await signup('Sami Session', 'sami@example.com');
    const id = await idOf('sami@example.com');
    const current = async () => (await sql('SELECT auth_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [id]))[0].auth_at;
    const minutesAgo = async () => (Date.now() - new Date(await current()).getTime()) / 60000;
    assert.ok((await minutesAgo()) < 1, 'signing up is a sign-in');
    await pool.query(`UPDATE sessions SET auth_at = now() - interval '5 minutes' WHERE user_id = $1`, [id]);
    assert.equal((await c.api('/me/sessions/logout-others', { method: 'POST' })).status, 200);
    assert.ok((await minutesAgo()) > 4.9, 'sign out other devices: the same time');
    const s = await c.api('/me/2fa/setup', { method: 'POST' });
    assert.equal(s.status, 201);
    assert.equal((await c.api('/me/2fa/enable', { method: 'POST', body: { code: totp.code(s.key.replace(/ /g, '')) } })).status, 200);
    assert.ok((await minutesAgo()) > 4.9, 'two-step verification turned on: the same time');
    assert.equal((await c.api('/me/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'sami-new-password-1' } })).status, 200);
    assert.ok((await minutesAgo()) > 4.9, 'a new password: the same time');
    // (a sign-in with the second step: now)
    const other = client(base);
    assert.equal((await other.api('/auth/login', { method: 'POST', body: { email: 'sami@example.com', password: 'sami-new-password-1' } })).twoFactorRequired, true);
    await pool.query('UPDATE admin_two_factor SET last_step = 0 WHERE user_id = $1', [id]);
    assert.equal((await other.api('/auth/login/second-step', { method: 'POST', body: { code: totp.code(s.key.replace(/ /g, '')) } })).status, 200);
    assert.ok((await minutesAgo()) < 1);
  });

  test('without a password: no new password, withdrawal or account deletion without a real sign-in in the last minutes; then the code too; the owner is emailed', async () => {
    const g = await signup('Gia Google', 'gia@example.com');
    const id = await idOf('gia@example.com');
    await pool.query('UPDATE users SET password_hash = NULL WHERE id = $1', [id]); // (an account made with Google)
    const s = await g.api('/me/2fa/setup', { method: 'POST' });
    const secret = s.key.replace(/ /g, '');
    assert.equal((await g.api('/me/2fa/enable', { method: 'POST', body: { code: totp.code(secret) } })).status, 200);
    await pool.query(`UPDATE sessions SET auth_at = now() - interval '11 minutes' WHERE user_id = $1`, [id]);
    const setPassword = (body = {}) => g.api('/me/password', { method: 'POST', body: { newPassword: 'gia-first-password-1', ...body } });
    let r = await setPassword();
    assert.equal(r.status, 403);
    assert.equal(r.error, 'reauth_required');
    assert.equal((await g.api('/me', { method: 'DELETE', body: {} })).error, 'reauth_required');
    assert.equal((await g.api('/me/withdrawals', { method: 'POST', body: {} })).error, 'reauth_required');
    // "sign out other devices" is not a new sign-in (before the fix it counted as one)
    assert.equal((await g.api('/me/sessions/logout-others', { method: 'POST' })).status, 200);
    assert.equal((await setPassword()).error, 'reauth_required');
    // A real sign-in a moment ago (as server/routes/google.js records one): then the code from the app is needed too.
    await pool.query('UPDATE sessions SET auth_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    assert.equal((await setPassword()).error, 'code_required');
    assert.equal((await setPassword({ code: '000000' })).error, 'invalid_code');
    assert.equal((await sql('SELECT password_hash FROM users WHERE id = $1', [id]))[0].password_hash, null, 'nothing set yet');
    await pool.query('UPDATE admin_two_factor SET last_step = 0, failed_count = 0 WHERE user_id = $1', [id]);
    const from = outbox().length;
    r = await setPassword({ code: totp.code(secret) });
    assert.equal(r.status, 200, r.text);
    const mail = await mailTo('gia@example.com', /password was added/i, from);
    assert.ok(mail, 'the owner is told');
    assert.match(mail.text, /every other device was signed out/);
  });
});

describe('C2: an admin\'s powers need the second step of this session', () => {
  test('without it an admin sees what everyone sees: no private profile, hidden About text or picture, nor somebody else\'s receipt', async () => {
    await pool.query(`UPDATE users SET bio = 'Only I may read this about text.' WHERE id = $1`, [mentorId]);
    await pool.query(`INSERT INTO profile_settings (user_id, visibility) VALUES ($1, '{"about": "only_me"}') ON CONFLICT (user_id) DO UPDATE SET visibility = EXCLUDED.visibility`, [mentorId]);
    const [item] = await sql(`INSERT INTO profile_items (user_id, section, data) VALUES ($1, 'project', '{"title": "A project"}') RETURNING id`, [mentorId]); // (projects: only me)
    await pool.query(`INSERT INTO profile_item_images (item_id, mime, data) VALUES ($1, 'image/webp', $2)`, [item.id, Buffer.from('RIFF....WEBPVP8 ')]);
    const mentorName = (await mentor.api('/me')).user.username;
    const askerName = (await asker.api('/me')).user.username; // (an asker's profile is private)
    const b = await bookAndPay(base, asker, mentorId, 'How should I plan my first week in a new team?');
    const [receipt] = await sql(`SELECT id FROM receipts WHERE booking_id = $1 AND kind = 'payment'`, [b.id]);

    const plain = client(srv2.base);
    assert.equal((await plain.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: PASSWORD } })).status, 200);
    const verified = client(srv2.base);
    assert.equal((await verified.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: PASSWORD } })).status, 200);
    const s = await verified.api('/admin/2fa/setup', { method: 'POST', body: {} });
    assert.equal((await verified.api('/admin/2fa/enable', { method: 'POST', body: { code: totp.code(s.secret) } })).status, 200);

    const see = async (c) => ({
      about: (await c.api(`/users/${mentorName}`)).profile.bio,
      privateProfile: Boolean((await c.api(`/users/${askerName}`)).private),
      picture: (await c.raw(`/api/profile-images/${item.id}.webp`)).status,
      receipt: (await c.raw(`/api/receipts/${receipt.id}.pdf`)).status
    });
    assert.deepEqual(await see(plain), { about: null, privateProfile: true, picture: 404, receipt: 404 });
    assert.deepEqual(await see(verified), { about: 'Only I may read this about text.', privateProfile: false, picture: 200, receipt: 200 });
    assert.equal((await asker.raw(`/api/receipts/${receipt.id}.pdf`)).status, 200, 'the asker always gets their own');
    await pool.query(`UPDATE profile_settings SET visibility = '{}' WHERE user_id = $1`, [mentorId]);
  });
});

describe('C3: the admin scripts under /ka', () => {
  test('are refused to everyone else, at any address, and still sent to an admin', async () => {
    for (const p of ['/js/admin.js', '/ka/js/admin.js', '/ka/js/admin-mentors.js', '/KA/js/admin.js', '/ka/i18n/admin-en.json']) {
      assert.equal((await fetch(base + p)).status, 403, p);
      assert.equal((await asker.raw(p)).status, 403, `${p} (signed in)`);
    }
    assert.equal((await fetch(base + '/ka/js/api.js')).status, 200, 'other scripts as before');
    assert.equal((await admin.raw('/ka/js/admin.js')).status, 200, 'an admin gets it');
  });
});

describe('C4: two-step verification and an unconfirmed email', () => {
  const resetToken = async (email) => {
    const from = outbox().length;
    await client(base).api('/auth/forgot-password', { method: 'POST', body: { email } });
    return (await mailTo(email, /reset/i, from)).text.match(/token=([0-9a-f-]+\.[0-9a-f]+)/)[1];
  };
  const twoFactorOn = async (id) => pool.query(`INSERT INTO admin_two_factor (user_id, secret_enc, enabled_at) VALUES ($1, $2, now())`, [id, encrypt('JBSWY3DPEHPK3PXP')]);
  const hasTwoFactor = async (id) => (await sql('SELECT 1 FROM admin_two_factor WHERE user_id = $1', [id])).length > 0;

  test('cannot be turned on before the email is confirmed', async () => {
    const u = await signup('Una Unconfirmed', 'una@example.com', { confirm: false });
    assert.equal((await u.api('/me/2fa/setup', { method: 'POST' })).error, 'email_not_verified');
    assert.equal((await u.api('/me/2fa/enable', { method: 'POST', body: { code: '123456' } })).error, 'email_not_verified');
  });

  test('a password reset of an account whose email was never confirmed turns it off (the real owner gets in); a confirmed one keeps it', async () => {
    const una = await idOf('una@example.com');
    await twoFactorOn(una); // (as somebody who signed up with Una's address could have done before this rule)
    assert.equal((await client(base).api('/auth/reset-password', { method: 'POST', body: { token: await resetToken('una@example.com'), newPassword: 'una-own-password-1' } })).status, 200);
    assert.equal(await hasTwoFactor(una), false);
    const login = await client(base).api('/auth/login', { method: 'POST', body: { email: 'una@example.com', password: 'una-own-password-1' } });
    assert.equal(login.status, 200);
    assert.notEqual(login.twoFactorRequired, true);

    await signup('Vera Verified', 'vera@example.com');
    const vera = await idOf('vera@example.com');
    await twoFactorOn(vera);
    assert.equal((await client(base).api('/auth/reset-password', { method: 'POST', body: { token: await resetToken('vera@example.com'), newPassword: 'vera-own-password-1' } })).status, 200);
    assert.equal(await hasTwoFactor(vera), true);
  });
});

describe('C5: the About text in the experts API', () => {
  test('follows the About section\'s visibility in one expert, the list and the search', async () => {
    const BIO = 'I help people build zebracorn pipelines.';
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [mentorId, BIO]);
    const settings = (visibility, adminHidden = {}, hiddenAt = null) => pool.query(
      `INSERT INTO profile_settings (user_id, visibility, admin_hidden, hidden_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET visibility = EXCLUDED.visibility, admin_hidden = EXCLUDED.admin_hidden, hidden_at = EXCLUDED.hidden_at`,
      [mentorId, visibility, adminHidden, hiddenAt]);
    const anyone = client(base);
    const look = async (c) => ({
      one: (await c.api(`/experts/${mentorId}`)).expert.bio,
      list: ((await c.api('/experts')).experts.find((e) => e.id === mentorId) || {}).bio,
      found: (await c.api('/experts?q=zebracorn')).experts.some((e) => e.id === mentorId)
    });
    const NOTHING = { one: null, list: null, found: false };

    await settings({ about: 'everyone' });
    assert.deepEqual(await look(anyone), { one: BIO, list: BIO, found: true });
    await settings({ about: 'signed_in' });
    assert.deepEqual(await look(anyone), NOTHING);
    assert.equal((await asker.api(`/experts/${mentorId}`)).expert.bio, BIO, 'signed in: shown');
    await settings({ about: 'only_me' });
    assert.deepEqual(await look(anyone), NOTHING);
    assert.equal((await asker.api(`/experts/${mentorId}`)).expert.bio, null);
    assert.equal((await mentor.api(`/experts/${mentorId}`)).expert.bio, BIO, 'the mentor sees their own');
    await settings({}, { about: 'Links to a shop.' }); // (hidden by an admin)
    assert.deepEqual(await look(anyone), NOTHING);
    assert.equal((await asker.api(`/experts/${mentorId}`)).expert.bio, null);
    await settings({}, {}, new Date()); // (the whole profile hidden by an admin)
    assert.deepEqual(await look(anyone), NOTHING);
    await settings({});
    assert.deepEqual(await look(anyone), { one: BIO, list: BIO, found: true });
  });
});

describe('C7: the redirect after signing in', () => {
  test('stays on this site: no control characters or blanks, no other host, in the browser and on the server', () => {
    // (the page's script, with just enough of a browser around it to load)
    const ctx = { window: { location: { origin: 'https://wisecall.test' } }, URL, document: { documentElement: {} }, requestAnimationFrame: () => 0, MutationObserver: class { observe() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/api.js'), 'utf8'), ctx);
    const browser = (v) => ctx.window.WisecallAPI.safeRedirect(v, '/dashboard.html');
    const server = require('../server/routes/google').safeRedirect;
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '//evil.com', '/\\evil.com', '/ /evil.com', '/\u0000/evil.com', 'https://evil.com/', 'evil.com', '', null]) {
      assert.equal(browser(bad), '/dashboard.html', JSON.stringify(bad));
      assert.equal(server(bad), null, JSON.stringify(bad));
    }
    for (const good of ['/dashboard.html', '/u/nino?tab=answers#top', '/ka/settings.html?tab=account']) {
      assert.equal(browser(good), good);
      assert.equal(server(good), good);
    }
  });
});

describe('M1: where a withdrawal is paid', () => {
  test('to the details saved with it; never during a payout-details hold; changing the details closes it and the mentor is told', async () => {
    await earned();
    assert.equal((await withdraw()).status, 201);
    const req = await openRequest();
    assert.equal(decrypt(req.payout_iban_enc), GOOD_IBAN);
    assert.equal(req.payout_name, 'Mika Mentor');
    // (the details change behind the request, as a taken-over account could before: the queue and the CSV keep the request's own)
    await pool.query('UPDATE users SET payout_iban_enc = $2 WHERE id = $1', [mentorId, encrypt(OTHER_IBAN)]);
    const queued = (await admin.api('/admin/withdrawals')).queue.find((q) => q.id === req.id);
    assert.equal(queued.iban.replace(/\s/g, ''), GOOD_IBAN);
    const csv = await (await admin.raw('/api/admin/withdrawals.csv')).text();
    assert.match(csv, new RegExp(GOOD_IBAN));
    assert.doesNotMatch(csv, new RegExp(OTHER_IBAN));
    await pool.query('UPDATE users SET payout_iban_enc = $2 WHERE id = $1', [mentorId, encrypt(GOOD_IBAN)]);
    await pool.query(`UPDATE payout_batches SET exported_at = NULL, exported_amount = NULL WHERE id = $1`, [req.id]);
    // The admin cannot mark it paid while a payout-details hold runs.
    await pool.query(`UPDATE users SET payout_hold_until = now() + interval '1 hour' WHERE id = $1`, [mentorId]);
    const held = await admin.api(`/admin/withdrawals/${req.id}/pay`, { method: 'POST', body: { reference: 'TR-1', amount: req.amount } });
    assert.equal(held.status, 409);
    assert.equal(held.error, 'payout_hold');
    await pool.query('UPDATE users SET payout_hold_until = NULL WHERE id = $1', [mentorId]);
    // The details change through Settings: the request is closed, its money waits for the hold, and the mentor is told why.
    const from = outbox().length;
    assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: 'Mika Mentor', iban: OTHER_IBAN, currentPassword: PASSWORD } })).status, 200);
    const [closed] = await sql('SELECT status, reject_reason FROM payout_batches WHERE id = $1', [req.id]);
    assert.equal(closed.status, 'rejected');
    assert.match(closed.reject_reason, /payout details changed/);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM payouts WHERE batch_id = $1 AND status = 'pending'`, [req.id]))[0].n, 0, 'released');
    const b = (await mentor.api('/me/balance')).balance;
    assert.equal(b.available, 0);
    assert.ok(b.onHold >= req.amount, 'on hold until the hold ends');
    assert.ok(await mailTo('mika@example.com', /withdrawal was not sent/i, from), 'the mentor is told');
    // (back to the first details, nothing held)
    assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: 'Mika Mentor', iban: GOOD_IBAN, currentPassword: PASSWORD } })).status, 200);
    await pool.query('UPDATE users SET payout_hold_until = NULL WHERE id = $1', [mentorId]);
  });
});

describe('M4: a debt settled in part', () => {
  test('a full refund after a partial refund\'s debt was taken off a withdrawal still owes the rest of the mentor\'s share', async () => {
    const id = await earned();
    assert.equal((await withdraw()).status, 201);
    await payRequest(await openRequest());
    const [p] = await sql('SELECT amount, status FROM payouts WHERE booking_id = $1', [id]);
    assert.deepEqual([p.status, p.amount], ['paid', 4800]);
    // A partial refund (15 of 60 GEL): the mentor owes their part, 12 GEL.
    assert.equal((await asker.api(`/bookings/${id}/dispute`, { method: 'POST', body: { reason: 'off_topic', details: 'Half of it was about something else.' } })).status, 201);
    const [d] = await sql('SELECT id FROM disputes WHERE booking_id = $1', [id]);
    assert.equal((await admin.api(`/admin/disputes/${d.id}/resolve`, { method: 'POST', body: { outcome: 'partial_refund', amount: 1500, note: 'Half of it was off topic.' } })).status, 200);
    assert.equal(await owedBack(), 1200);
    // The next withdrawal takes it off.
    await earned();
    assert.equal((await withdraw()).status, 201);
    const req = await openRequest();
    assert.equal(req.debt_deducted, 1200);
    await payRequest(req);
    assert.equal(await owedBack(), 0);
    // The whole question is refunded later: the rest of the mentor's share is owed (48 - 12 = 36 GEL), not nothing.
    assert.equal((await admin.api(`/admin/bookings/${id}/refund`, { method: 'POST' })).status, 200);
    for (let i = 0; i < 20 && (await owedBack()) === 0; i++) await wait(100);
    assert.equal(await owedBack(), 3600);
    // ...and that is taken off the next withdrawal.
    await earned();
    assert.equal((await withdraw()).status, 201);
    assert.equal((await openRequest()).debt_deducted, 3600);
  });
});

describe('C6: what a mentor typed, in the admins\' emails', () => {
  // (last: a name that does not match the ID takes the mentor back to review)
  test('names are escaped: no link or picture of theirs ever appears in a real Wisecall email', async () => {
    await pool.query(`INSERT INTO kyc_sessions (user_id, provider, provider_session_id, status, verified_name_enc, country, decided_at)
                      VALUES ($1, 'mock', 'audit-test', 'approved', $2, 'GEO', now())`, [mentorId, encrypt('Mika Mentor')]);
    const from = outbox().length;
    const payoutName = '<a href="https://evil.example/">Click here</a> Name';
    assert.equal((await mentor.api('/me/payout', { method: 'PUT', body: { name: payoutName, iban: GOOD_IBAN, currentPassword: PASSWORD } })).status, 200);
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { name: '<img src=x onerror=alert(1)> Mentor' } })).status, 200);
    const payoutMail = await mailTo('qa-admin@example.com', /payout account name does not match/i, from);
    const nameMail = await mailTo('qa-admin@example.com', /mentor name does not match/i, from);
    assert.ok(payoutMail && nameMail);
    for (const m of [payoutMail, nameMail]) {
      assert.doesNotMatch(m.html, /<a href="https:\/\/evil|<img src=x/);
    }
    assert.match(payoutMail.html, /&lt;a href=&quot;https:\/\/evil\.example\/&quot;&gt;Click here&lt;\/a&gt; Name/);
    assert.match(nameMail.html, /&lt;img src=x onerror=alert\(1\)&gt; Mentor/);
  });
});
