// Proves that every kind of email really goes out through the Resend HTTP API, in the recipient's
// language, and that production never shows codes or links on screen. Resend is replaced by a
// small fake server (RESEND_API_URL), so nothing is sent for real.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, startServer, client, bookAndPay, addPayoutDetails, SAMPLE, wait } = require('./helpers');

const sent = []; // every request Resend received
const behavior = { failures: [] }; // statuses to answer with before succeeding, e.g. [500]
let fakeResend, resendUrl;

function startFakeResend() {
  return new Promise((resolve) => {
    fakeResend = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      sent.push({ headers: req.headers, body, at: Date.now() });
      const fail = behavior.failures.shift();
      res.writeHead(fail || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fail ? { message: 'simulated failure' } : { id: 'email_' + sent.length }));
    });
    fakeResend.listen(0, () => { resendUrl = `http://localhost:${fakeResend.address().port}/emails`; resolve(); });
  });
}
const mailTo = (to, subjectPart) => sent.filter((m) => m.body.to === to && (!subjectPart || m.body.subject.includes(subjectPart)));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); }
}
const codeFrom = (m) => (m.body.html.match(/letter-spacing:8px[^>]*>(\d{6})</) || [])[1];

let srv, base, admin, seeker, mentor, mentorId;

before(async () => {
  await startFakeResend();
  await resetDatabase();
  srv = await startServer(4574, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resendUrl, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', SUPPORT_EMAIL: '' });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); await new Promise((r) => fakeResend.close(r)); });

async function signup(name, email, language) {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { name, email, password: 'test-pass-12345', language } });
  assert.equal(su.status, 201);
  assert.equal(su.emailSent, true);
  assert.equal(su.devVerifyCode, undefined, 'the code is only in the email');
  const mail = await waitFor(() => mailTo(email)[0]);
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: codeFrom(mail) } })).status, 200);
  return { c, mail };
}

describe('every email goes out through the Resend API', () => {
  test('signup verification: correct request, Georgian for a Georgian user, code in the email only', async () => {
    const { mail } = await signup('Nino Beridze', 'nino@example.com', 'ka');
    assert.equal(mail.headers.authorization, 'Bearer re_test_key');
    assert.equal(mail.body.from, 'Wisecall <hello@wisecall.example>');
    assert.match(mail.body.subject, /დადასტურების კოდი/);
    assert.ok(mail.body.html && mail.body.text, 'HTML and plain-text versions');
    assert.match(mail.body.text, /\d{6}/);
  });

  test('password reset: emailed, and never returned by the API', async () => {
    const r = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'nino@example.com' } });
    assert.deepEqual({ ok: r.ok, resetUrl: r.resetUrl, devMode: r.devMode }, { ok: true, resetUrl: undefined, devMode: undefined });
    const mail = await waitFor(() => mailTo('nino@example.com', 'პაროლის')[0]);
    assert.match(mail.body.html, /reset-password\.html\?token=/);
    assert.match(mail.body.html, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'links use the configured public address');
  });

  test('mentor approved and rejected: each mentor is told, in their own language, with the reason', async () => {
    admin = (await signup('QA Admin', 'qa-admin@example.com', 'en')).c;
    const m1 = await signup('Dr English', 'approved@example.com', 'en');
    const m2 = await signup('Georgian Applicant', 'rejected@example.com', 'ka');
    for (const [who, url] of [[m1.c, 'a'], [m2.c, 'b']]) {
      await who.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Doctor', niche: 'medicine', price: 25, proofUrl: `https://linkedin.com/in/${url}`, sampleAnswer: SAMPLE } });
    }
    const id1 = (await m1.c.api('/me')).user.id;
    const id2 = (await m2.c.api('/me')).user.id;
    await admin.api(`/admin/mentors/${id1}/review`, { method: 'POST', body: { approve: true, checks: { identity: true, credential: true, sample: true } } });
    await admin.api(`/admin/mentors/${id2}/review`, { method: 'POST', body: { approve: false, note: 'Profile link is private' } });

    const ok = await waitFor(() => mailTo('approved@example.com', 'approved')[0]);
    assert.match(ok.body.html, /IBAN/, 'tells the mentor to add payout details');
    const no = await waitFor(() => mailTo('rejected@example.com', 'განაცხადის')[0]);
    assert.match(no.body.html, /Profile link is private/, 'the reason is included');
    assert.match(no.body.html, /[ა-ჿ]/);

    mentor = m1.c; mentorId = id1;
    await addPayoutDetails(mentor);
  });

  test('new question, answer ready and refund: mentor and buyer are each emailed in their language', async () => {
    seeker = (await signup('Ka Seeker', 'seeker@example.com', 'ka')).c;
    const paid = await bookAndPay(base, seeker, mentorId, 'Is my question <b>safe</b>?');
    assert.equal(paid.status, 'paid');

    const q = await waitFor(() => mailTo('approved@example.com', 'new paid question')[0]);
    assert.match(q.body.html, /25\.00 GEL/, 'amounts are in lari');
    assert.match(q.body.html, /&lt;b&gt;safe&lt;\/b&gt;/, 'user text is escaped');

    await mentor.api(`/bookings/${paid.id}/answer`, { method: 'POST', body: { answer: 'It is safe.' } });
    const a = await waitFor(() => mailTo('seeker@example.com', 'უპასუხა')[0]);
    assert.match(a.body.subject, /Dr English/);

    const refund = await admin.api(`/admin/bookings/${paid.id}/refund`, { method: 'POST' });
    assert.equal(refund.status, 200);
    const toBuyer = await waitFor(() => mailTo('seeker@example.com', 'დაგიბრუნდა')[0]);
    assert.match(toBuyer.body.html, /25\.00 GEL/);
    const toMentor = await waitFor(() => mailTo('approved@example.com', 'refunded')[0]);
    assert.match(toMentor.body.html, /will not receive a payout|not receive a payout/i);
  });

  test('contact form goes to the admin (ADMIN_EMAIL) with Reply-To set to the visitor', async () => {
    const r = await client(base).api('/contact', { method: 'POST', body: { name: 'Lela', email: 'lela@example.com', message: 'I have a question about refunds.' } });
    assert.equal(r.ok, true);
    const mail = await waitFor(() => mailTo('qa-admin@example.com', 'contact form')[0]);
    assert.equal(mail.body.reply_to, 'lela@example.com');
    assert.match(mail.body.html, /I have a question about refunds/);
  });
});

describe('reliability', () => {
  test('a temporary Resend failure is retried once and the email still arrives (once)', async () => {
    const before = sent.length;
    behavior.failures = [503];
    const c = client(base);
    await c.api('/auth/signup', { method: 'POST', body: { name: 'Retry Person', email: 'retry@example.com', password: 'test-pass-12345' } });
    await waitFor(() => sent.filter((m) => m.body.to === 'retry@example.com').length >= 2);
    assert.equal(sent.filter((m) => m.body.to === 'retry@example.com').length, 2, 'one failure, one retry');
    assert.ok(sent.length - before >= 2);
  });

  test('a permanent failure (bad key / unverified domain) is not retried, and the user is told', async () => {
    behavior.failures = [403];
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'No Mail', email: 'nomail@example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201, 'the account is still created');
    assert.equal(su.emailSent, false);
    await wait(1200);
    assert.equal(sent.filter((m) => m.body.to === 'nomail@example.com').length, 1, 'a 403 is not retried');
  });
});

describe('production never shows codes or links on screen', () => {
  test('even when email fails, the response has no code and no dev mode; the config says so', async () => {
    const prod = await startServer(4575, {
      NODE_ENV: 'production', APP_URL: 'https://example.com', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resendUrl,
      EMAIL_FROM: 'Wisecall <hello@wisecall.example>', PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'id_for_test', BOG_CLIENT_SECRET: 'secret_for_test',
      DATA_ENCRYPTION_KEY: 'test-data-key-that-is-long-enough-12345'
    });
    try {
      behavior.failures = [403, 403, 403];
      const c = client(prod.base);
      const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'Prod User', email: 'prod@example.com', password: 'test-pass-12345' } });
      assert.equal(su.status, 201);
      assert.equal(su.emailSent, false);
      assert.equal(su.devMode, false);
      assert.equal(su.devVerifyCode, undefined);
      const again = await c.api('/auth/resend-verification', { method: 'POST' });
      assert.equal(again.devMode, false);
      assert.equal(again.devVerifyCode, undefined);
      const f = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'prod@example.com' } });
      assert.equal(f.devMode, undefined);
      assert.equal(f.resetUrl, undefined);
      assert.equal((await client(prod.base).api('/config')).devMode, false);
      assert.equal((await fetch(`${prod.base}/mock-bank.html`)).status, 404, 'the fake bank page does not exist in production');
      assert.equal((await client(prod.base).api('/mock-bank/orders/x')).status, 404);
    } finally { prod.proc.kill(); behavior.failures = []; }
  });
});
