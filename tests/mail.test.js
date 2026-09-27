const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetDatabase, startServer, client, bookAndPay, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');
const { longAnswer } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-outbox-${process.pid}.jsonl`);
let srv, base;

const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mailTo = (email, subjectPart) => outbox().filter((m) => m.to === email && (!subjectPart || m.subject.includes(subjectPart)));
const codeFrom = (m) => (m.html.match(/letter-spacing:8px[^>]*>(\d{6})</) || [])[1];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); }
}

// With real email on, the code is only in the email, so read it from the outbox.
async function signupViaOutbox(name, email, language = 'en') {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345', language } });
  assert.equal(su.status, 201);
  const mail = await waitFor(() => mailTo(email)[0]);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: codeFrom(mail) } });
  assert.equal(v.status, 200);
  return c;
}

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  srv = await startServer(4571, { EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, SUPPORT_EMAIL: 'help@example.com', EMAIL_FROM: 'Wisecall <hi@example.com>' });
  base = srv.base;
});
after(() => { if (srv) srv.proc.kill(); fs.rmSync(OUTBOX, { force: true }); });

describe('templates', () => {
  const { render, TEMPLATE_NAMES } = require('../server/mail/templates');
  const sample = { last4: '4917', reference: 'TR-1', code: '123456', url: 'https://example.com/reset?token=a.b', amount: '25.00 USD', question: 'Is <b>this</b> escaped?', answer: 'An <script>alert(1)</script> answer', mentor: 'Dr <i>Who</i>', reason: 'no_answer_deadline', date: '1 Oct 2026, 10:00 UTC', note: 'Please add a LinkedIn link', name: 'Ann', email: 'ann@example.com', message: 'Hello', domain: 'clinic.example', minutes: 20, link: 'https://meet.example.com/abc-defg', niche: 'design', mentorField: 'design', unsubscribeUrl: 'https://example.com/waitlist-unsubscribe.html?token=abc', step: 'license', status: 'failed', number: 'R-000001', kind: 'payment', body: 'A follow-up <b>question</b>', threadId: '00000000-0000-0000-0000-000000000000', outcome: 'partial_refund', role: 'asker', missing: [{ steps: ['id_kyc'], state: 'pending' }, { steps: ['work_email', 'portfolio'], state: 'todo' }] };

  test('every template renders in English and Georgian with no unfilled placeholders', () => {
    for (const name of TEMPLATE_NAMES) {
      const en = render(name, 'en', sample);
      const ka = render(name, 'ka', sample);
      for (const m of [en, ka]) {
        assert.ok(m.subject && m.html && m.text, `${name} has subject, html and text`);
        assert.doesNotMatch(m.subject + m.html + m.text, /\{\w+\}/, `${name} left a placeholder`);
      }
      assert.notEqual(en.subject, ka.subject, `${name} is translated`);
      assert.match(ka.html, /[ა-ჿ]/, `${name} contains Georgian text`);
    }
  });

  test('user-supplied text can never inject HTML', () => {
    for (const name of ['newQuestion', 'answered', 'refundMentor', 'deadlineSoon', 'mentorRejected', 'contact']) {
      const { html } = render(name, 'en', sample);
      assert.doesNotMatch(html, /<script>alert/i, name);
      assert.doesNotMatch(html, /<b>this<\/b>/, name);
    }
    assert.match(render('answered', 'en', sample).html, /&lt;script&gt;/);
    assert.doesNotMatch(render('answered', 'en', sample).subject, /</);
  });

  test('branded, readable in dark mode, and with a plain-text version, in both languages', () => {
    for (const name of TEMPLATE_NAMES) {
      for (const lang of ['en', 'ka']) {
        const { html, text } = render(name, lang, { ...sample, question: 'Is this fine?', answer: 'An answer', mentor: 'Dr Who', body: 'A follow-up question' }); // (no HTML in what people wrote)
        assert.match(html, /\/brand\/wisecall-logo-email\.png"/, `${name} ${lang}: the logo`);
        assert.match(html, /background:#eaf6f1/, `${name} ${lang}: the brand colours`);
        assert.match(html, /<meta name="color-scheme" content="light dark">/, `${name} ${lang}: tells mail apps it has a dark version`);
        assert.match(html, /@media \(prefers-color-scheme:dark\)/);
        assert.match(html, /\/brand\/wisecall-logo-email-dark\.png"/, `${name} ${lang}: the logo for dark backgrounds`);
        assert.match(html, new RegExp(`<html lang="${lang}">`));
        assert.doesNotMatch(text, /<\/?(p|div|a|strong|b|br|table|td|img|span)\b/i, `${name} ${lang}: the text version has no HTML`);
        assert.ok(text.length > 40, `${name} ${lang}: the text version says something`);
      }
    }
  });

  test('unknown language falls back to English', () => {
    assert.equal(render('verify', 'fr', { code: '111111' }).subject, render('verify', 'en', { code: '111111' }).subject);
  });
});

describe('delivery through the email provider', () => {
  test('signup sends the verification code by email (in the chosen language) and never returns it', async () => {
    const c = client(base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Nino Beridze', email: 'nino@example.com', password: 'test-pass-12345', language: 'ka' } });
    assert.equal(su.status, 201);
    assert.equal(su.devVerifyCode, undefined, 'code must not be in the response when email was sent');
    assert.equal(su.user.language, 'ka');
    const mail = await waitFor(() => mailTo('nino@example.com')[0]);
    assert.match(mail.subject, /დადასტურების კოდი/);
    assert.equal(mail.replyTo, 'help@example.com');
    const code = codeFrom(mail);
    assert.match(code, /^\d{6}$/);
    assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).user.emailVerified, true);
  });

  test('password reset is emailed, works, and the link is not in the API response', async () => {
    const c = client(base);
    const r = await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'nino@example.com' } });
    assert.deepEqual({ ok: r.ok, resetUrl: r.resetUrl, devMode: r.devMode }, { ok: true, resetUrl: undefined, devMode: undefined });
    const mail = await waitFor(() => mailTo('nino@example.com', 'პაროლის')[0]);
    const link = mail.html.match(/href="([^"]*reset-password\.html\?token=[^"]+)"/)[1].replace(/&amp;/g, '&');
    const token = new URL(link).searchParams.get('token');
    assert.equal((await c.api('/auth/reset-password', { method: 'POST', body: { token, newPassword: 'fresh-password-1' } })).ok, true);
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'fresh-password-1' } })).status, 200);
  });

  test('an unknown email gets no message and no hint', async () => {
    const before = outbox().length;
    const r = await client(base).api('/auth/forgot-password', { method: 'POST', body: { email: 'ghost@example.com' } });
    assert.equal(r.ok, true);
    await wait(400);
    assert.equal(outbox().length, before);
  });

  test('question and answer notifications go out in each person\'s own language', async () => {
    const admin = await signupViaOutbox('QA Admin', 'qa-admin@example.com');
    const mentor = await signupViaOutbox('Dr English', 'mentor-en@example.com');
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Doctor', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/de', sampleAnswer: SAMPLE } });
    const mid = (await mentor.api('/me')).user.id;
    await addPayoutDetails(mentor);
    await approveMentor(admin, mentor);

    const seeker = await signupViaOutbox('Ka Seeker', 'ka-seeker@example.com', 'ka');

    const paid = await bookAndPay(base, seeker, mid, 'Is this <em>question</em> safe?');
    assert.equal(paid.status, 'paid');
    const b = { booking: paid };
    const q = await waitFor(() => mailTo('mentor-en@example.com', 'new paid question')[0]);
    assert.match(q.html, /25\.00 GEL/);
    assert.match(q.html, /&lt;em&gt;question&lt;\/em&gt;/);
    assert.match(q.html, /within 7 days/);

    await mentor.api(`/bookings/${b.booking.id}/answer`, { method: 'POST', body: { answer: longAnswer('Yes, it is safe.') } });
    const a = await waitFor(() => mailTo('ka-seeker@example.com', 'უპასუხა')[0]);
    assert.match(a.subject, /Dr English/);
    assert.match(a.html, /Yes, it is safe\./);
  });

  test('the language toggle on the account changes the language of later emails', async () => {
    const c = client(base);
    await c.api('/auth/login', { method: 'POST', body: { email: 'nino@example.com', password: 'fresh-password-1' } });
    await c.api('/me', { method: 'PATCH', body: { language: 'en' } });
    await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'nino@example.com' } });
    await waitFor(() => mailTo('nino@example.com', 'Reset your Wisecall password')[0]);
  });
});

describe('contact form', () => {
  test('is emailed to the private admin address (never to the public SUPPORT_EMAIL), and replying goes to the visitor', async () => {
    const r = await client(base).api('/contact', { method: 'POST', body: { name: 'Lela <b>Tabidze</b>', email: 'lela@example.com', message: 'I would like a refund for a <script>question</script>.' } });
    assert.equal(r.ok, true);
    assert.equal(r.devMode, undefined);
    const mail = await waitFor(() => mailTo('qa-admin@example.com', 'contact form')[0]);
    assert.equal(mailTo('help@example.com', 'contact form').length, 0, 'the public address does not receive form messages');
    assert.equal(mail.replyTo, 'lela@example.com');
    assert.match(mail.html, /lela@example\.com/);
    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;/);
  });

  test('is rate limited', async () => {
    const c = client(base);
    let last;
    for (let i = 0; i < 6; i++) last = await c.api('/contact', { method: 'POST', body: { name: 'Spam', email: 'spam@example.com', message: 'This is message number ' + i } });
    assert.equal(last.status, 429);
  });
});

describe('providers are swappable', () => {
  const run = (env, message) => {
    const { spawnSync } = require('child_process');
    const script = `
      const calls = [];
      global.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, text: async () => '' }; };
      const { sendEmail } = require('./server/email');
      sendEmail(${JSON.stringify(message)}).then((r) => console.log(JSON.stringify({ r, calls })));`;
    const out = spawnSync('node', ['-e', script], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8',
      env: { PATH: process.env.PATH, RESEND_API_KEY: '', POSTMARK_TOKEN: '', DATABASE_URL: 'postgresql://x:y@localhost/z', EMAIL_FROM: 'Wisecall <hi@example.com>', SUPPORT_EMAIL: 'help@example.com', ...env }
    });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout.trim().split('\n').pop());
  };
  const msg = { to: 'a@example.com', subject: 'Hi\nthere', html: '<p>x</p>', text: 'x' };

  test('resend', () => {
    const { r, calls } = run({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }, msg);
    assert.equal(r.sent, true);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].headers.Authorization, 'Bearer re_test');
    assert.equal(calls[0].body.subject, 'Hi there', 'newlines stripped from subjects');
    assert.equal(calls[0].body.reply_to, 'help@example.com');
  });

  test('postmark', () => {
    const { r, calls } = run({ EMAIL_PROVIDER: 'postmark', POSTMARK_TOKEN: 'pm_test' }, msg);
    assert.equal(r.sent, true);
    assert.equal(calls[0].url, 'https://api.postmarkapp.com/email');
    assert.equal(calls[0].headers['X-Postmark-Server-Token'], 'pm_test');
    assert.equal(calls[0].body.HtmlBody, '<p>x</p>');
  });

  test('nothing configured means nothing is sent (and nothing crashes)', () => {
    const { r, calls } = run({ EMAIL_PROVIDER: 'resend' }, msg);
    assert.equal(r.sent, false);
    assert.equal(calls.length, 0);
  });
});
