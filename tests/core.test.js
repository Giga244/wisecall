const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { ROOT, resetDatabase, startServer, client, signupVerified, SAMPLE } = require('./helpers');

let srv, base;
const ids = {};

before(async () => {
  await resetDatabase();
  srv = await startServer(4551);
  base = srv.base;
});
after(() => { if (srv) srv.proc.kill(); });

describe('platform basics', () => {
  test('health check, security headers, no framework banner', async () => {
    const r = await fetch(base + '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('/api/me answers 200 with no user when logged out', async () => {
    const r = await client(base).api('/me');
    assert.equal(r.status, 200);
    assert.equal(r.user, null);
  });
});

describe('accounts', () => {
  test('signup -> wrong code rejected -> right code verifies', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'Ann Seeker', email: 'Ann@Example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201);
    assert.match(su.devVerifyCode, /^\d{6}$/);
    assert.equal(su.user.email, 'ann@example.com');
    assert.equal(su.user.passwordHash, undefined);

    const bad = await c.api('/auth/verify-email', { method: 'POST', body: { code: '000000' } });
    assert.equal(bad.error, 'invalid_code');
    const ok = await c.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } });
    assert.equal(ok.user.emailVerified, true);
    assert.equal((await c.api('/me')).user.email, 'ann@example.com');
  });

  test('duplicate email is rejected case-insensitively', async () => {
    const r = await client(base).api('/auth/signup', { method: 'POST', body: { name: 'Dup', email: 'ANN@example.com', password: 'test-pass-12345' } });
    assert.equal(r.status, 409);
    assert.equal(r.error, 'email_taken');
  });

  test('login: wrong password fails, right password (any email case) works', async () => {
    const c = client(base);
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'ann@example.com', password: 'nope-nope-nope' } })).status, 401);
    const ok = await c.api('/auth/login', { method: 'POST', body: { email: 'ANN@example.com', password: 'test-pass-12345' } });
    assert.equal(ok.status, 200);
  });

  test('password reset: single-use token, old password stops working, unknown email leaks nothing', async () => {
    const c = client(base);
    const f = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'ann@example.com' } });
    assert.equal(f.devMode, true);
    const token = new URL(f.resetUrl).searchParams.get('token');

    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token: token + 'x', newPassword: 'brand-new-pass-1' } })).error, 'invalid_or_expired');
    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'brand-new-pass-1' } })).ok, true);
    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'another-pass-123' } })).error, 'invalid_or_expired');
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'ann@example.com', password: 'test-pass-12345' } })).status, 401);
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'ann@example.com', password: 'brand-new-pass-1' } })).status, 200);

    const unknown = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'nobody@example.com' } });
    assert.equal(unknown.resetUrl, null);
  });
});

describe('mentor application and approval', () => {
  test('an unverified email cannot apply, and nothing is saved', async () => {
    const c = client(base);
    await c.api('/auth/signup', { method: 'POST', body: { name: 'Unverified', email: 'unverified@example.com', password: 'test-pass-12345' } });
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    const r = await c.api('/me', { method: 'PATCH', body: { roleTitle: 'Doctor', niche: 'medicine', price: 20, proofUrl: 'https://linkedin.com/in/x', sampleAnswer: SAMPLE } });
    assert.equal(r.error, 'email_not_verified');
    assert.equal((await c.api('/me')).user.roleTitle, null);
  });

  test('missing proof / short sample are rejected; a full application goes to pending', async () => {
    const m = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    const base_ = { roleTitle: 'Cardiologist', niche: 'medicine', price: 25 };
    assert.equal((await m.api('/me', { method: 'PATCH', body: { ...base_, sampleAnswer: SAMPLE } })).error, 'proof_required');
    assert.equal((await m.api('/me', { method: 'PATCH', body: { ...base_, proofUrl: 'https://linkedin.com/in/dr', sampleAnswer: 'too short' } })).error, 'sample_required');
    assert.equal((await m.api('/me')).user.roleTitle, null, 'rejected saves must not write anything');
    const ok = await m.api('/me', { method: 'PATCH', body: { ...base_, proofUrl: 'https://linkedin.com/in/dr', sampleAnswer: SAMPLE } });
    assert.equal(ok.user.verificationStatus, 'pending');
    ids.mentor = ok.user.id;
    ids.mentorClient = m;
  });

  test('pending mentors are invisible and cannot be booked', async () => {
    const pub = await client(base).api('/experts');
    assert.equal(pub.experts.length, 0);
    assert.equal((await client(base).api(`/experts/${ids.mentor}`)).status, 404);
    const s = await signupVerified(base, 'Sam Seeker', 'seeker@example.com');
    ids.seekerClient = s;
    const b = await s.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'Can I book a pending mentor?' } });
    assert.equal(b.status, 404);
  });

  test('only admins can review; approval needs the full checklist', async () => {
    assert.equal((await ids.seekerClient.api('/admin/mentors')).error, 'not_admin');
    ids.admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    const list = await ids.admin.api('/admin/mentors?status=pending');
    const row = list.mentors.find((x) => x.id === ids.mentor);
    assert.ok(row && row.sampleAnswer && row.proofUrl, 'admin sees proof + sample');
    const noChecks = await ids.admin.api(`/admin/mentors/${ids.mentor}/review`, { method: 'POST', body: { approve: true } });
    assert.equal(noChecks.error, 'checklist_incomplete');
    const ok = await ids.admin.api(`/admin/mentors/${ids.mentor}/review`, { method: 'POST', body: { approve: true, checks: { identity: true, credential: true, sample: true } } });
    assert.equal(ok.mentor.verificationStatus, 'verified');
  });

  test('approved mentor is public, and public data never leaks private fields', async () => {
    const pub = await client(base).api('/experts');
    assert.equal(pub.experts.length, 1);
    const e = pub.experts[0];
    for (const k of ['email', 'stripeAccountId', 'proofUrl', 'sampleAnswer', 'passwordHash']) assert.equal(e[k], undefined, k + ' must not be public');
    assert.equal(e.roleTitle, 'Cardiologist');
  });
});

describe('questions, answers and reviews (simulated payments)', () => {
  test('cannot book yourself; short questions rejected', async () => {
    assert.equal((await ids.mentorClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'Booking myself here' } })).error, 'cannot_book_self');
    assert.equal((await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'hi' } })).error, 'missing_fields');
  });

  test('book -> only the mentor can answer -> seeker reviews once', async () => {
    const b = await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'How do I get into a good residency?' } });
    assert.equal(b.status, 201);
    assert.equal(b.booking.status, 'paid');
    assert.equal(b.booking.amount, 2500);
    assert.equal(b.booking.platformFeeAmount, 500, '20% fee');
    assert.equal(b.booking.mentorNetAmount, 2000);
    ids.booking = b.booking.id;

    assert.notEqual((await ids.seekerClient.api(`/bookings/${ids.booking}/answer`, { method: 'POST', body: { answer: 'I am not the mentor' } })).status, 200);
    const ans = await ids.mentorClient.api(`/bookings/${ids.booking}/answer`, { method: 'POST', body: { answer: 'Focus on research and strong letters.' } });
    assert.equal(ans.booking.status, 'answered');

    assert.equal((await ids.seekerClient.api(`/bookings/${ids.booking}/review`, { method: 'POST', body: { rating: 9 } })).error, 'invalid_rating');
    const rv = await ids.seekerClient.api(`/bookings/${ids.booking}/review`, { method: 'POST', body: { rating: 5, review: 'Very helpful' } });
    assert.equal(rv.booking.rating, 5);
    assert.equal((await ids.seekerClient.api(`/bookings/${ids.booking}/review`, { method: 'POST', body: { rating: 1 } })).error, 'already_reviewed');
  });

  test('stats, anonymised reviews and search reflect the real data', async () => {
    const e = (await client(base).api(`/experts/${ids.mentor}`)).expert;
    assert.equal(e.ratingAvg, 5);
    assert.equal(e.reviewCount, 1);
    assert.equal(e.answeredCount, 1);
    const rev = (await client(base).api(`/experts/${ids.mentor}/reviews`)).reviews;
    assert.equal(rev[0].reviewerName, 'Sam S.');
    assert.equal((await client(base).api('/experts?q=cardio')).experts.length, 1);
    assert.equal((await client(base).api('/experts?q=zzz')).experts.length, 0);
    assert.equal((await client(base).api('/experts?q=%25')).experts.length, 0, 'wildcards are escaped');
    const stats = await client(base).api('/stats');
    assert.equal(stats.answeredCount, 1);
    assert.equal(stats.mentorCount, 1);
  });

  test('users only see their own bookings', async () => {
    const mine = await ids.seekerClient.api('/bookings/mine');
    assert.equal(mine.asked.length, 1);
    assert.equal(mine.asked[0].otherPartyName, 'Dr Mentor');
    const stranger = await signupVerified(base, 'Stranger', 'stranger@example.com');
    assert.equal((await stranger.api(`/bookings/${ids.booking}`)).status, 403);
  });
});

describe('legal pages', () => {
  const fs = require('fs');
  const dict = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', `${l}.json`), 'utf8'));

  test('terms and privacy are served, and every page links to them in the footer', async () => {
    for (const p of ['terms.html', 'privacy.html']) {
      const res = await fetch(`${base}/${p}`);
      assert.equal(res.status, 200, p);
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => n.endsWith('.html'))) {
      assert.match(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), /js\/footer\.js/, `${f} has the shared footer`);
    }
  });

  test('English and Georgian have exactly the same keys and legal sections', () => {
    const en = dict('en'), ka = dict('ka');
    assert.deepEqual(Object.keys(en).filter((k) => !(k in ka)), [], 'keys missing in ka');
    assert.deepEqual(Object.keys(ka).filter((k) => !(k in en)), [], 'keys missing in en');
    for (const k of ['legal.terms.sections', 'legal.privacy.sections']) {
      assert.equal(en[k].length, ka[k].length, `${k} section count`);
      en[k].forEach((s, i) => assert.equal(s.p.length, ka[k][i].p.length, `${k} section ${i + 1} paragraphs`));
    }
  });

  test('the terms state the refund rule, mentor duties and the not-professional-advice disclaimer', () => {
    const t = JSON.stringify(dict('en')['legal.terms.sections']);
    assert.match(t, /refund you in full automatically/);
    assert.match(t, /Mentor responsibilities/);
    assert.match(t, /Not professional advice/);
  });
});

describe('admin: mentor decisions and refunds', () => {
  test('rejecting needs a reason, and the mentor is told what it was', async () => {
    const m = await signupVerified(base, 'Reject Me', 'reject-me@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    const app = await m.api('/me', { method: 'PATCH', body: { roleTitle: 'Coach', niche: 'business', price: 10, proofUrl: 'https://linkedin.com/in/rm', sampleAnswer: SAMPLE } });
    const id = app.user.id;
    assert.equal((await ids.admin.api(`/admin/mentors/${id}/review`, { method: 'POST', body: { approve: false } })).error, 'reason_required');
    const rej = await ids.admin.api(`/admin/mentors/${id}/review`, { method: 'POST', body: { approve: false, note: 'Profile link is private' } });
    assert.equal(rej.mentor.verificationStatus, 'rejected');
    assert.equal((await m.api('/me')).user.verificationNote, 'Profile link is private');
  });

  test('admins see all bookings; nobody else can; only admins can refund', async () => {
    const b = await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'A question that will be refunded by an admin' } });
    assert.equal(b.status, 201);
    assert.equal((await ids.seekerClient.api('/admin/bookings')).error, 'not_admin');
    assert.equal((await ids.seekerClient.api(`/admin/bookings/${b.booking.id}/refund`, { method: 'POST' })).error, 'not_admin');

    const all = await ids.admin.api('/admin/bookings?status=paid');
    const row = all.bookings.find((x) => x.id === b.booking.id);
    assert.ok(row);
    assert.equal(row.seekerEmail, 'seeker@example.com');
    assert.equal(row.mentorName, 'Dr Mentor');
    assert.equal((await ids.admin.api('/admin/bookings?status=bogus')).error, 'invalid_status');

    const r = await ids.admin.api(`/admin/bookings/${b.booking.id}/refund`, { method: 'POST' });
    assert.equal(r.booking.status, 'refunded');
    assert.equal(r.booking.refundReason, 'admin');
    assert.equal((await ids.admin.api(`/admin/bookings/${b.booking.id}/refund`, { method: 'POST' })).booking.status, 'refunded', 'second refund is a no-op');
    assert.equal((await ids.admin.api('/admin/bookings/not-an-id/refund', { method: 'POST' })).status, 404);
  });

  test('the account reports whether it is an admin', async () => {
    assert.equal((await ids.admin.api('/me')).user.isAdmin, true);
    assert.equal((await ids.seekerClient.api('/me')).user.isAdmin, false);
  });
});

describe('production safety', () => {
  test('refuses to start without required settings and says which', () => {
    const r = spawnSync('node', ['server/index.js'], {
      cwd: ROOT, encoding: 'utf8', timeout: 10000,
      // Values are blanked (not omitted) so dotenv cannot fill them in from the real .env file.
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4552', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: '', APP_URL: '', RESEND_API_KEY: '', EMAIL_FROM: '', ADMIN_EMAILS: '', ADMIN_EMAIL: ''
      }
    });
    assert.equal(r.status, 1);
    for (const name of ['JWT_SECRET', 'APP_URL', 'RESEND_API_KEY', 'ADMIN_EMAILS']) assert.match(r.stderr, new RegExp(name));
  });

  test('in production, codes and reset links are never returned by the API', async () => {
    const prod = await startServer(4553, {
      NODE_ENV: 'production', APP_URL: 'https://example.com', RESEND_API_KEY: 're_fake_key_for_test', EMAIL_FROM: 'Wisecall <hi@example.com>'
    });
    try {
      const c = client(prod.base);
      const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'Prod User', email: 'prod-user@example.com', password: 'test-pass-12345' } });
      assert.equal(su.status, 201);
      assert.equal(su.devVerifyCode, undefined);
      assert.equal(su.devMode, false);
      const f = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'prod-user@example.com' } });
      assert.deepEqual({ ok: f.ok, resetUrl: f.resetUrl, devMode: f.devMode }, { ok: true, resetUrl: undefined, devMode: undefined });
    } finally { prod.proc.kill(); }
  });
});

describe('abuse protection', () => {
  test('login is rate limited', async () => {
    const c = client(base);
    let last;
    for (let i = 0; i < 17; i++) last = await c.api('/auth/login', { method: 'POST', body: { email: 'x@example.com', password: 'wrong-password' } });
    assert.equal(last.status, 429);
  });
});
