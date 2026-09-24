const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { ROOT, resetDatabase, startServer, client, signupVerified, bookAndPay, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

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

  test('only admins can review; final approval needs every step the niche requires', async () => {
    assert.equal((await ids.seekerClient.api('/admin/mentors')).error, 'not_admin');
    assert.equal((await ids.seekerClient.api(`/admin/mentors/${ids.mentor}/verification`)).error, 'not_admin');
    ids.admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');

    // The list shows how far along each application is. Medicine is a regulated niche.
    const list = await ids.admin.api('/admin/mentors?status=pending');
    const row = list.mentors.find((x) => x.id === ids.mentor);
    assert.ok(row, 'the application is in the pending list');
    assert.equal(row.verification.level, 'regulated');
    assert.equal(row.verification.ready, false);

    // The detail view has the evidence, the registries to check by hand, and the audit log.
    const d = await ids.admin.api(`/admin/mentors/${ids.mentor}/verification`);
    assert.equal(d.status, 200);
    assert.equal(d.mentor.sampleAnswer, SAMPLE);
    assert.equal(d.mentor.proofUrl, 'https://linkedin.com/in/dr');
    const byStep = Object.fromEntries(d.requirements.filter((r) => r.type === 'step').map((r) => [r.step, r]));
    assert.deepEqual(Object.keys(byStep), ['email', 'id_kyc', 'name_match', 'sample_answer', 'proof_link', 'license', 'license_document', 'video_interview']);
    assert.equal(byStep.email.status, 'passed', 'the verified email passed by itself');
    assert.equal(byStep.proof_link.status, 'pending');
    assert.equal(byStep.sample_answer.status, 'pending');
    assert.equal(byStep.id_kyc.status, 'todo');
    assert.ok(d.registries.length > 0);
    assert.ok(d.audit.some((a) => a.action === 'step_submitted' && a.step === 'proof_link'));

    // Step decisions need a reason, and only cover what a person is allowed to decide.
    const decide = (step, body) => ids.admin.api(`/admin/mentors/${ids.mentor}/steps/${step}`, { method: 'POST', body });
    assert.equal((await decide('proof_link', { decision: 'passed' })).error, 'reason_required');
    assert.equal((await decide('proof_link', { decision: 'passed', reason: 'ok' })).error, 'reason_required', 'a reason of a few characters is not enough');
    assert.equal((await decide('id_kyc', { decision: 'passed', reason: 'I looked at the ID myself' })).error, 'not_manual', 'the ID check is decided only by the provider');
    assert.equal((await decide('email', { decision: 'failed', reason: 'because I want to' })).error, 'not_manual');
    assert.equal((await decide('license', { decision: 'passed', reason: 'Looks fine to me' })).error, 'not_submitted', 'nothing was submitted for the licence yet');
    assert.equal((await decide('nonsense', { decision: 'passed', reason: 'Looks fine to me' })).status, 404);
    assert.equal((await decide('proof_link', { decision: 'maybe', reason: 'Looks fine to me' })).error, 'invalid_decision');
    assert.equal((await ids.seekerClient.api(`/admin/mentors/${ids.mentor}/steps/proof_link`, { method: 'POST', body: { decision: 'passed', reason: 'Looks fine to me' } })).error, 'not_admin');

    assert.equal((await decide('proof_link', { decision: 'passed', reason: 'LinkedIn profile matches the name and role' })).status, 200);
    assert.equal((await decide('sample_answer', { decision: 'passed', reason: 'Shows real expertise' })).status, 200);

    // Final approval is refused while required steps are missing, and says which.
    const tooEarly = await ids.admin.api(`/admin/mentors/${ids.mentor}/approve`, { method: 'POST' });
    assert.equal(tooEarly.error, 'steps_incomplete');
    assert.ok(tooEarly.missing.includes('id_kyc') && tooEarly.missing.includes('license') && tooEarly.missing.includes('video_interview'));
    assert.equal((await client(base).api('/experts')).experts.length, 0);

    // Every decision is in the audit log with who made it.
    const audit = (await ids.admin.api(`/admin/mentors/${ids.mentor}/verification`)).audit;
    assert.ok(audit.some((a) => a.action === 'step_passed' && a.step === 'proof_link' && a.by === 'qa-admin@example.com' && /LinkedIn/.test(a.reason)));

    // With every required step passed, the real final approval works.
    await approveMentor(ids.admin, ids.mentorClient);
    const me = (await ids.mentorClient.api('/me')).user;
    assert.equal(me.verificationStatus, 'verified');
    const ok = { mentor: me };
    assert.equal(ok.mentor.verificationStatus, 'verified');

    // Approved is not enough: without payout details the mentor stays hidden and cannot be booked.
    assert.equal((await client(base).api('/experts')).experts.length, 0);
    const early = await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'Is a mentor without payout details bookable?' } });
    assert.equal(early.status, 404);
    await addPayoutDetails(ids.mentorClient);
  });

  test('approved mentor is public, and public data never leaks private fields', async () => {
    const pub = await client(base).api('/experts');
    assert.equal(pub.experts.length, 1);
    const e = pub.experts[0];
    for (const k of ['email', 'payoutIban', 'payoutName', 'proofUrl', 'sampleAnswer', 'passwordHash']) assert.equal(e[k], undefined, k + ' must not be public');
    assert.equal(e.roleTitle, 'Cardiologist');
  });

  test('a required step that later fails takes a live mentor off the site until it passes again', async () => {
    const decide = (step, body) => ids.admin.api(`/admin/mentors/${ids.mentor}/steps/${step}`, { method: 'POST', body });
    assert.equal((await decide('proof_link', { decision: 'failed', reason: 'The LinkedIn profile turned out to belong to someone else' })).status, 200);
    assert.equal((await client(base).api('/experts')).experts.length, 0, 'delisted at once');
    assert.equal((await ids.mentorClient.api('/me')).user.verificationStatus, 'pending');
    const v = await ids.mentorClient.api('/verification');
    assert.equal(v.requirements.find((r) => r.step === 'proof_link').status, 'failed');
    assert.match(v.requirements.find((r) => r.step === 'proof_link').reason, /belong to someone else/, 'the mentor is told why');

    assert.equal((await decide('proof_link', { decision: 'passed', reason: 'New link checked and matches' })).status, 200);
    assert.equal((await ids.admin.api(`/admin/mentors/${ids.mentor}/approve`, { method: 'POST' })).status, 200);
    assert.equal((await client(base).api('/experts')).experts.length, 1, 'listed again after re-approval');
  });

  test('editing the proof link or sample answer sends the mentor back to review; editing the price does not', async () => {
    const before = await ids.mentorClient.api('/verification');
    assert.equal(before.status, 'verified');
    assert.equal((await ids.mentorClient.api('/me', { method: 'PATCH', body: { price: 30 } })).user.verificationStatus, 'verified');
    const edited = await ids.mentorClient.api('/me', { method: 'PATCH', body: { proofUrl: 'https://linkedin.com/in/dr-new' } });
    assert.equal(edited.user.verificationStatus, 'pending');
    assert.equal((await ids.mentorClient.api('/verification')).requirements.find((r) => r.step === 'proof_link').status, 'pending');
    assert.equal((await client(base).api('/experts')).experts.length, 0);
    // Put things back for the tests that follow.
    await ids.admin.api(`/admin/mentors/${ids.mentor}/steps/proof_link`, { method: 'POST', body: { decision: 'passed', reason: 'Checked the new link' } });
    await ids.mentorClient.api('/me', { method: 'PATCH', body: { price: 25 } });
    assert.equal((await ids.admin.api(`/admin/mentors/${ids.mentor}/approve`, { method: 'POST' })).status, 200);
  });
});

describe('questions, answers and reviews (paid at the test bank)', () => {
  test('cannot book yourself; short questions rejected', async () => {
    assert.equal((await ids.mentorClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'Booking myself here' } })).error, 'cannot_book_self');
    assert.equal((await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: 'hi' } })).error, 'missing_fields');
  });

  test('book -> only the mentor can answer -> seeker reviews once', async () => {
    const b = await bookAndPay(base, ids.seekerClient, ids.mentor, 'How do I get into a good residency?');
    assert.equal(b.status, 'paid');
    assert.equal(b.currency, 'gel');
    assert.equal(b.amount, 2500, '25 GEL is 2500 tetri');
    assert.equal(b.platformFeeAmount, 500, '20% fee');
    assert.equal(b.mentorNetAmount, 2000);
    ids.booking = b.id;

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
    assert.equal((await ids.admin.api(`/admin/mentors/${id}/reject`, { method: 'POST', body: {} })).error, 'reason_required');
    assert.equal((await ids.admin.api(`/admin/mentors/${id}/reject`, { method: 'POST', body: { reason: 'no' } })).error, 'reason_required');
    const rej = await ids.admin.api(`/admin/mentors/${id}/reject`, { method: 'POST', body: { reason: 'Profile link is private' } });
    assert.equal(rej.mentor.verificationStatus, 'rejected');
    assert.equal((await m.api('/me')).user.verificationNote, 'Profile link is private');
  });

  test('admins see all bookings; nobody else can; only admins can refund', async () => {
    const paid = await bookAndPay(base, ids.seekerClient, ids.mentor, 'A question that will be refunded by an admin');
    assert.equal(paid.status, 'paid');
    const b = { booking: paid };
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

describe('SEO, error pages and the contact form', () => {
  const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });

  test('pages carry a canonical link, share image and the right domain', async () => {
    const html = await (await get('/')).text();
    assert.match(html, /<link rel="canonical" href="http:\/\/localhost:4551\/">/);
    assert.match(html, /og:image" content="http:\/\/localhost:4551\/og-image\.png"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html, /\{\{/, 'no unfilled placeholders');
    const dash = await (await get('/dashboard.html')).text();
    assert.match(dash, /name="robots" content="noindex"/);
    const png = Buffer.from(await (await get('/og-image.png')).arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  });

  test('every page has its own title and description', () => {
    const fs = require('fs');
    const seen = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => n.endsWith('.html') && n !== 'expert.html')) {
      const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
      const title = html.match(/<title>(.*?)<\/title>/)[1];
      const desc = html.match(/name="description" content="([^"]*)"/)[1];
      assert.ok(title && desc, f);
      assert.ok(!seen.has(title) && !seen.has(desc), `${f} repeats a title or description`);
      seen.add(title); seen.add(desc);
    }
  });

  test('an expert page gets that expert\'s name in its title and canonical link', async () => {
    const html = await (await get(`/expert.html?id=${ids.mentor}`)).text();
    assert.match(html, /<title>Dr Mentor, Cardiologist — Wisecall<\/title>/);
    assert.match(html, new RegExp(`rel="canonical" href="http://localhost:4551/expert.html\\?id=${ids.mentor}"`));
    const unknown = await (await get('/expert.html?id=nope')).text();
    assert.match(unknown, /<title>Expert — Wisecall<\/title>/);
    assert.doesNotMatch(unknown, /\{\{/);
  });

  test('robots.txt and sitemap.xml list the site and its approved experts only', async () => {
    const robots = await (await get('/robots.txt')).text();
    assert.match(robots, /Disallow: \/api\//);
    assert.match(robots, /Sitemap: http:\/\/localhost:4551\/sitemap\.xml/);
    const res = await get('/sitemap.xml');
    assert.match(res.headers.get('content-type'), /xml/);
    const xml = await res.text();
    assert.match(xml, /<loc>http:\/\/localhost:4551\/<\/loc>/);
    assert.match(xml, /<loc>http:\/\/localhost:4551\/about\.html<\/loc>/);
    assert.match(xml, new RegExp(`expert\\.html\\?id=${ids.mentor}`));
    const pending = (await ids.admin.api('/admin/mentors?status=rejected')).mentors[0];
    assert.ok(pending);
    assert.doesNotMatch(xml, new RegExp(pending.id), 'rejected mentors are not in the sitemap');
  });

  test('unknown pages get the branded 404 for browsers and JSON for the API', async () => {
    const page = await get('/no-such-page.html', { Accept: 'text/html' });
    assert.equal(page.status, 404);
    assert.match(await page.text(), /error\.404\.title/);
    const noExt = await get('/whatever', { Accept: 'text/html' });
    assert.equal(noExt.status, 404);
    const api = await get('/api/nothing', { Accept: 'application/json' });
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: 'not_found' });
  });

  test('the contact form validates input and ignores bots', async () => {
    const c = client(base);
    const post = (body) => c.api('/contact', { method: 'POST', body });
    assert.equal((await post({ name: 'A', email: 'a@example.com', message: 'short' })).error, 'missing_fields');
    assert.equal((await post({ name: 'A', email: 'not-an-email', message: 'A long enough message' })).error, 'invalid_email');
    assert.equal((await post({ name: 'A', email: 'a@example.com', message: 'A long enough message' })).ok, true);
    assert.equal((await post({ name: 'Bot', email: 'b@example.com', message: 'Buy cheap pills now please', website: 'http://spam' })).ok, true);
  });
});

describe('security hardening', () => {
  const post = (p, headers, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  test('every response carries a strict Content-Security-Policy and the other security headers', async () => {
    const res = await fetch(base + '/');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/, 'scripts only from our own files');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('permissions-policy'));
    assert.equal(res.headers.get('strict-transport-security'), null, 'HSTS only in production');
  });

  test('no page uses inline scripts or inline event handlers (which the policy would block)', () => {
    const fs = require('fs');
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => n.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
      assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${f} has an inline script`);
      assert.doesNotMatch(html, /\son(click|change|submit|load|error)=/i, `${f} has an inline event handler`);
    }
  });

  test('CSRF: state-changing API calls need our header and a same-site origin', async () => {
    const login = { email: 'seeker@example.com', password: 'test-pass-12345' };
    assert.equal((await post('/api/auth/login', {}, login)).status, 403, 'no custom header');
    assert.equal((await post('/api/auth/login', { 'X-Requested-With': 'wisecall', Origin: 'https://evil.example' }, login)).status, 403, 'foreign origin');
    assert.equal((await post('/api/auth/login', { 'X-Requested-With': 'wisecall', 'Sec-Fetch-Site': 'cross-site' }, login)).status, 403, 'cross-site request');
    const ok = await post('/api/auth/login', { 'X-Requested-With': 'wisecall', Origin: base }, login);
    assert.equal(ok.status, 200);
    assert.equal((await fetch(base + '/api/experts')).status, 200, 'reads need no header');
  });

  test('values of the wrong type are rejected with 400, never a server error', async () => {
    const c = client(base);
    for (const body of [
      { name: ['x'], email: 'a@example.com', password: 'long-enough-1' },
      { name: 'x', email: { a: 1 }, password: 'long-enough-1' },
      { name: 'x', email: 'a@example.com', password: ['long-enough-1'] }
    ]) assert.equal((await c.api('/auth/signup', { method: 'POST', body })).status, 400);
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'a@example.com', password: { $ne: 1 } } })).status, 400);
    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token: ['a.b'], newPassword: 'long-enough-1' } })).status, 400);

    assert.equal((await ids.seekerClient.api('/me', { method: 'PATCH', body: { bio: { evil: true } } })).status, 400);
    assert.equal((await ids.seekerClient.api('/me/password', { method: 'POST', body: { currentPassword: 'x', newPassword: ['12345678'] } })).status, 400);
    assert.equal((await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: ids.mentor, question: { a: 'long enough text' } } })).status, 400);
    assert.equal((await ids.seekerClient.api('/bookings', { method: 'POST', body: { mentorId: [ids.mentor], question: 'A perfectly fine question' } })).status, 400);
  });

  test('a broken JSON body is a 400, and an oversized one is refused', async () => {
    const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: '{oops' });
    assert.equal(bad.status, 400);
    const big = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ email: 'a'.repeat(80000) }) });
    assert.equal(big.status, 413);
  });
});

describe('production safety', () => {
  const blank = { JWT_SECRET: '', SESSION_SECRET: '', APP_URL: '', PUBLIC_URL: '', RESEND_API_KEY: '', EMAIL_FROM: '', ADMIN_EMAILS: '', ADMIN_EMAIL: '', PAYMENT_PROVIDER: '', BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: '', DATA_ENCRYPTION_KEY: '', KYC_PROVIDER: '', DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: '' };
  // The smallest complete production configuration; tests remove or change one thing at a time.
  const goodProd = {
    PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4552', DATABASE_URL: process.env.TEST_DATABASE_URL,
    SESSION_SECRET: 'test-secret-that-is-long-enough-1234567890', PUBLIC_URL: 'https://wisecall.example', RESEND_API_KEY: 're_fake',
    EMAIL_FROM: 'Wisecall <hi@wisecall.example>', ADMIN_EMAILS: 'boss@wisecall.example', PAYMENT_PROVIDER: 'bog',
    BOG_CLIENT_ID: 'id', BOG_CLIENT_SECRET: 'secret', DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345',
    JWT_SECRET: '', APP_URL: '',
    KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'key_for_test', DIDIT_WORKFLOW_ID: 'workflow_for_test', DIDIT_WEBHOOK_SECRET: 'whsec_for_test'
  };
  const start = (env) => spawnSync('node', ['server/index.js'], { cwd: ROOT, encoding: 'utf8', timeout: 8000, env });

  test('refuses to start without required settings and says which', () => {
    // Values are blanked (not omitted) so dotenv cannot fill them in from the real .env file.
    const r = start({ PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4552', DATABASE_URL: process.env.TEST_DATABASE_URL, ...blank });
    assert.equal(r.status, 1);
    for (const name of ['SESSION_SECRET', 'PUBLIC_URL', 'RESEND_API_KEY', 'ADMIN_EMAILS', 'PAYMENT_PROVIDER', 'DATA_ENCRYPTION_KEY', 'KYC_PROVIDER']) assert.match(r.stderr, new RegExp(name));
  });

  test('each required production variable is enforced on its own', () => {
    const cases = [
      [{ SESSION_SECRET: 'short' }, /SESSION_SECRET/],
      [{ PUBLIC_URL: 'http://wisecall.example' }, /PUBLIC_URL must be your public https/],
      [{ PUBLIC_URL: 'https://localhost:4242' }, /not localhost/],
      [{ RESEND_API_KEY: '' }, /RESEND_API_KEY/],
      [{ EMAIL_FROM: '' }, /EMAIL_FROM/],
      [{ ADMIN_EMAILS: '' }, /ADMIN_EMAILS/],
      [{ PAYMENT_PROVIDER: 'mock' }, /mock is a fake bank/],
      [{ PAYMENT_PROVIDER: '' }, /PAYMENT_PROVIDER is required/],
      [{ BOG_CLIENT_SECRET: '' }, /BOG_CLIENT_SECRET/],
      [{ PAYMENT_PROVIDER: 'tbc' }, /TBC_API_KEY/],
      [{ DATA_ENCRYPTION_KEY: 'short' }, /DATA_ENCRYPTION_KEY/],
      [{ KYC_PROVIDER: 'mock' }, /KYC_PROVIDER=mock is a fake/],
      [{ KYC_PROVIDER: '' }, /KYC_PROVIDER is required/],
      [{ DIDIT_API_KEY: '' }, /DIDIT_API_KEY/],
      [{ DIDIT_WORKFLOW_ID: '' }, /DIDIT_WORKFLOW_ID/],
      [{ DIDIT_WEBHOOK_SECRET: '' }, /DIDIT_WEBHOOK_SECRET/]
    ];
    for (const [change, expected] of cases) {
      const r = start({ ...goodProd, ...change });
      assert.equal(r.status, 1, JSON.stringify(change));
      assert.match(r.stderr, expected, JSON.stringify(change));
    }
  });

  test('the old names APP_URL and JWT_SECRET still work as aliases', async () => {
    const legacy = await startServer(4554, { PUBLIC_URL: '', SESSION_SECRET: '', APP_URL: 'http://localhost:4554', JWT_SECRET: 'an-old-style-secret-that-is-long-enough-1' });
    try {
      const html = await (await fetch(`${legacy.base}/`)).text();
      assert.match(html, /rel="canonical" href="http:\/\/localhost:4554\/"/);
      assert.equal((await client(legacy.base).api('/experts')).status, 200);
    } finally { legacy.proc.kill(); }
  });

  test('in production, codes and reset links are never returned by the API, and nothing says localhost', async () => {
    const prod = await startServer(4553, {
      NODE_ENV: 'production', PUBLIC_URL: 'https://wisecall.example', RESEND_API_KEY: 're_fake_key_for_test', RESEND_API_URL: 'http://127.0.0.1:9/emails',
      EMAIL_FROM: 'Wisecall <hi@wisecall.example>', PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'id_for_test', BOG_CLIENT_SECRET: 'secret_for_test',
      DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345',
      KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'key_for_test', DIDIT_WORKFLOW_ID: 'workflow_for_test', DIDIT_WEBHOOK_SECRET: 'whsec_for_test'
    });
    try {
      const c = client(prod.base);
      const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'Prod User', email: 'prod-user@example.com', password: 'test-pass-12345' } });
      assert.equal(su.status, 201);
      assert.equal(su.devVerifyCode, undefined);
      assert.equal(su.devMode, false);
      const f = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'prod-user@example.com' } });
      assert.deepEqual({ ok: f.ok, resetUrl: f.resetUrl, devMode: f.devMode }, { ok: true, resetUrl: undefined, devMode: undefined });

      // Every public address in the output comes from PUBLIC_URL, never from localhost.
      for (const p of ['/', '/about.html', '/terms.html', '/robots.txt', '/sitemap.xml', '/no-such-page']) {
        const text = await (await fetch(prod.base + p, { headers: { Accept: 'text/html' } })).text();
        assert.doesNotMatch(text, /localhost|127\.0\.0\.1/, `${p} mentions localhost`);
      }
      assert.match(await (await fetch(`${prod.base}/`)).text(), /rel="canonical" href="https:\/\/wisecall\.example\/"/);
      assert.match(await (await fetch(`${prod.base}/`)).text(), /og:image" content="https:\/\/wisecall\.example\/og-image\.png"/);
      assert.match(await (await fetch(`${prod.base}/robots.txt`)).text(), /Sitemap: https:\/\/wisecall\.example\/sitemap\.xml/);
      assert.match(await (await fetch(`${prod.base}/sitemap.xml`)).text(), /<loc>https:\/\/wisecall\.example\/<\/loc>/);
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
