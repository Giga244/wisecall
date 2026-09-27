// Sessions, codes, admin two-step verification and who may see whose booking (docs/AUDIT.md). Mock bank, no real email.
// Tests marked { todo: 'AUDIT #n' } show a problem that exists today: they are expected to fail until the finding is fixed.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startServer, resetDatabase, client, signupVerified, bookAndPay, longAnswer } = require('../helpers');
const { BASE_ENV, pool, marketplace } = require('./_shared');

after(async () => { await pool.end(); });

describe('sessions after a password change', () => {
  let srv, base;
  before(async () => { await resetDatabase(); srv = await startServer(4811, BASE_ENV); base = srv.base; });
  after(() => srv && srv.proc.kill());

  test('a new password works and the old one does not', async () => {
    await signupVerified(base, 'Nino Test', 'nino@example.com', 'old-password-123');
    const other = client(base);
    const f = await other.api('/auth/forgot-password', { method: 'POST', body: { email: 'nino@example.com' } });
    const token = new URL(f.resetUrl).searchParams.get('token');
    assert.equal((await other.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'new-password-456' } })).status, 200);
    assert.equal((await client(base).api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'old-password-123' } })).status, 401);
    assert.equal((await client(base).api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'new-password-456' } })).status, 200);
    // The reset link works once.
    assert.equal((await other.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'third-password-789' } })).status, 400);
  });

  test('a session opened before a password RESET is signed out', async () => {
    const victim = await signupVerified(base, 'Giorgi Test', 'giorgi@example.com', 'old-password-123'); // e.g. a stolen or forgotten session
    assert.ok((await victim.api('/me')).user);
    const owner = client(base);
    const f = await owner.api('/auth/forgot-password', { method: 'POST', body: { email: 'giorgi@example.com' } });
    const token = new URL(f.resetUrl).searchParams.get('token');
    assert.equal((await owner.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'new-password-456' } })).status, 200);
    assert.equal((await victim.api('/me')).user, null, 'the old session must no longer be signed in');
  });

  test('other sessions are signed out after a password CHANGE in Settings', async () => {
    const laptop = await signupVerified(base, 'Ana Test', 'ana@example.com', 'old-password-123');
    const phone = client(base);
    assert.equal((await phone.api('/auth/login', { method: 'POST', body: { email: 'ana@example.com', password: 'old-password-123' } })).status, 200);
    assert.equal((await laptop.api('/me/password', { method: 'POST', body: { currentPassword: 'old-password-123', newPassword: 'new-password-456' } })).status, 200);
    assert.equal((await phone.api('/me')).user, null);
  });

  test('a session cookie signed with another secret is refused', async () => {
    const me = (await (await signupVerified(base, 'Luka Test', 'luka@example.com')).api('/me')).user;
    const forged = client(base);
    forged.setCookie('wisecall_token', jwt.sign({ id: me.id, email: me.email }, 'not-the-server-secret'));
    assert.equal((await forged.api('/me')).user, null);
    assert.equal((await forged.api('/bookings/mine')).status, 401);
  });
});

describe('email codes and rate limits', () => {
  let srv, base;
  // Real limits here (RATE_LIMIT_MULTIPLIER=1), as in production.
  before(async () => { await resetDatabase(); srv = await startServer(4812, { ...BASE_ENV, RATE_LIMIT_MULTIPLIER: '1' }); base = srv.base; });
  after(() => srv && srv.proc.kill());

  test('the right code verifies the email', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Code Ok', email: 'code-ok@example.com', password: 'test-pass-12345' } });
    assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } })).user.emailVerified, true);
  });

  test('after 5 wrong codes the code stops working (a new one must be requested)', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Brute Force', email: 'brute@example.com', password: 'test-pass-12345' } });
    const wrong = String((Number(su.devVerifyCode) + 1) % 900000 + 100000);
    for (let i = 0; i < 5; i++) assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: wrong } })).status, 400);
    const right = await c.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } });
    assert.notEqual(right.status, 200, 'the code must be dead after 5 wrong tries');
  });

  test('a rate limit cannot be dodged by changing the letter case of the address', async () => {
    const c = client(base);
    let last;
    for (let i = 0; i < 7; i++) last = (await c.api('/auth/resend-verification', { method: 'POST' })).status; // limit: 6 per 15 minutes
    assert.equal(last, 429);
    for (const p of ['/auth/RESEND-VERIFICATION', '/Auth/Resend-Verification', '/auth/resend-verification/']) {
      assert.equal((await c.api(p, { method: 'POST' })).status, 429, `${p} should share the same limit`);
    }
  });

  test('forgot-password answers the same for known and unknown addresses (no account discovery)', async () => {
    await signupVerified(base, 'Known Person', 'known@example.com');
    const a = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'known@example.com' } });
    const b = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'nobody-here@example.com' } });
    assert.equal(a.status, b.status);
    assert.equal(a.ok, b.ok);
  });
});

describe('admin routes need two-step verification', () => {
  let srv, base;
  before(async () => { await resetDatabase(); srv = await startServer(4813, { ...BASE_ENV, ADMIN_2FA: 'required' }); base = srv.base; });
  after(() => srv && srv.proc.kill());

  const ADMIN_GETS = ['/admin/bookings', '/admin/mentors', '/admin/payouts', '/admin/payouts.csv', '/admin/waitlist', '/admin/answers', '/admin/reports', '/admin/reviews', '/admin/verification/costs'];

  test('a non-admin gets not_admin everywhere', async () => {
    const u = await signupVerified(base, 'Plain User', 'plain@example.com');
    for (const p of ADMIN_GETS) assert.equal((await u.api(p)).status, 403, p);
    assert.equal((await u.raw('/js/admin.js')).status, 403);
    assert.equal((await u.api('/admin/2fa/setup', { method: 'POST' })).error, 'not_admin');
  });

  test('an admin who has not passed the second step can do nothing admin, and gets the 2FA page instead of the panel', async () => {
    const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    for (const p of ADMIN_GETS) {
      const r = await admin.api(p);
      assert.equal(r.status, 403, p);
      assert.equal(r.error, 'two_factor_setup_required', p);
    }
    const refund = await admin.api('/admin/bookings/00000000-0000-4000-8000-000000000000/refund', { method: 'POST' });
    assert.equal(refund.status, 403);
    assert.equal((await admin.raw('/js/admin.js')).status, 403);
    const page = await admin.raw('/admin.html');
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /\/js\/admin\.js/, 'the panel itself must not be sent');
  });

  test('once the second step is passed the admin routes open; a forged "mfaAt" claim does not open them', async () => {
    const admin = client(base);
    assert.equal((await admin.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: 'test-pass-12345' } })).status, 200);
    const setup = await admin.api('/admin/2fa/setup', { method: 'POST' });
    assert.equal(setup.status, 201);
    const on = await admin.api('/admin/2fa/enable', { method: 'POST', body: { code: setup.devCode } });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.recoveryCodes.length, 8);
    for (const p of ADMIN_GETS) assert.equal((await admin.api(p)).status, 200, p);

    const me = (await admin.api('/me')).user;
    const forged = client(base);
    forged.setCookie('wisecall_token', jwt.sign({ id: me.id, email: me.email, mfaAt: Math.floor(Date.now() / 1000) }, 'guessed-secret'));
    assert.equal((await forged.api('/admin/bookings')).status, 401);
  });
});

describe('nobody can read or change someone else\'s booking (IDOR)', () => {
  let ctx, booking, stranger;
  before(async () => {
    ctx = await marketplace(4814);
    booking = await bookAndPay(ctx.base, ctx.seeker, ctx.mentorId, 'How do I negotiate my first salary as an engineer?');
    assert.equal(booking.status, 'paid');
    stranger = await signupVerified(ctx.base, 'Curious Stranger', 'stranger@example.com');
  });
  after(() => ctx && ctx.srv.proc.kill());

  test('a stranger cannot read, sync, answer, rate or report through it', async () => {
    const id = booking.id;
    assert.equal((await stranger.api(`/bookings/${id}`)).status, 403);
    assert.equal((await stranger.api(`/bookings/${id}/sync`, { method: 'POST' })).status, 403);
    const ans = await stranger.api(`/bookings/${id}/answer`, { method: 'POST', body: { answer: longAnswer('Not mine to answer.') } });
    assert.ok(ans.status >= 400 && ans.status < 500);
    assert.equal(ans.error, 'forbidden');
    assert.equal((await stranger.api(`/bookings/${id}/ratings`)).status, 404);
    assert.equal((await stranger.api(`/bookings/${id}/ratings`, { method: 'POST', body: { stars: 1 } })).status, 404);
    const rep = await stranger.api(`/experts/${ctx.mentorId}/report`, { method: 'POST', body: { reason: 'spam', bookingId: id } });
    assert.equal(rep.error, 'invalid_booking');
    const mine = await stranger.api('/bookings/mine');
    assert.equal([...mine.asked, ...mine.received].some((b) => b.id === id), false);
    assert.equal((await pool.query('SELECT answer FROM bookings WHERE id = $1', [id])).rows[0].answer, null);
  });

  test('a visitor who is not signed in gets 401', async () => {
    const anon = client(ctx.base);
    assert.equal((await anon.api(`/bookings/${booking.id}`)).status, 401);
    assert.equal((await anon.api('/bookings/mine')).status, 401);
  });

  test('the buyer cannot answer their own question, and the mentor cannot trigger the buyer\'s payment check', async () => {
    const own = await ctx.seeker.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Answering myself.') } });
    assert.equal(own.error, 'forbidden');
    assert.equal((await ctx.mentor.api(`/bookings/${booking.id}/sync`, { method: 'POST' })).status, 403);
  });

  test('someone else\'s answer is refused with 403 (not 400)', { todo: 'AUDIT #14' }, async () => {
    const r = await stranger.api(`/bookings/${booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Not mine to answer.') } });
    assert.equal(r.status, 403);
  });

  test('a user cannot read another user\'s payout details or documents', async () => {
    const p = await stranger.api('/me/payout');
    assert.equal(p.iban, '');
    assert.equal((await stranger.api('/admin/documents/00000000-0000-4000-8000-000000000000')).status, 403);
    const pub = await client(ctx.base).api(`/experts/${ctx.mentorId}`);
    assert.equal(pub.status, 200);
    for (const secret of ['email', 'payoutIbanEnc', 'payoutName', 'passwordHash', 'proofUrl']) assert.equal(pub.expert[secret], undefined, secret);
  });
});
