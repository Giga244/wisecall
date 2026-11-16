// Launch safety: warnings for fake providers, the launch mode, and the launch check.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { longQuestion } = require('./helpers');
const { resetDatabase } = require('./helpers');

describe('PUBLIC_URL is the only address the site ever gives out', () => {
  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  let srv;
  before(async () => {
    await resetDatabase();
    srv = await startServer(4588, { PUBLIC_URL: 'https://wisecall.example', SUPPORT_EMAIL: 'help@wisecall.example' });
  });
  after(() => { if (srv) srv.proc.kill(); });

  test('every page (except the fake-provider pages) fills in canonical, og:url, og:image and twitter:image from it', async () => {
    const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && !f.startsWith('mock-'));
    assert.ok(pages.length >= 15);
    for (const f of pages) {
      const url = f === 'index.html' ? '/' : `/${f}`;
      const html = await (await fetch(srv.base + url)).text();
      assert.doesNotMatch(html, /localhost|127\.0\.0\.1/, `${f} mentions localhost`);
      assert.doesNotMatch(html, /\{\{\w+\}\}/, `${f} has an unfilled placeholder`);
      // Error pages are never indexed, so they name no canonical address (the rest of the head still uses PUBLIC_URL).
      if (/<meta name="robots" content="noindex">/.test(html) && /class="error-code"/.test(html)) assert.doesNotMatch(html, /rel="canonical"/, `${f} is an error page`);
      else assert.match(html, /rel="canonical" href="https:\/\/wisecall\.example\//, `${f} canonical`);
      assert.match(html, /og:url" content="https:\/\/wisecall\.example\//, `${f} og:url`);
      assert.match(html, /og:image" content="https:\/\/wisecall\.example\/og\/og-ka\.png(\?v=[0-9a-f]{10})?"/, `${f} og:image`);
      assert.match(html, /twitter:image" content="https:\/\/wisecall\.example\/og\/og-ka\.png(\?v=[0-9a-f]{10})?"/, `${f} twitter:image`);
    }
    const profile = await (await fetch(`${srv.base}/u/nobody-by-this-name`)).text();
    assert.match(profile, /rel="canonical" href="https:\/\/wisecall\.example\/profile\.html/);
  });

  test('robots.txt, sitemap.xml and the error pages use it too', async () => {
    assert.match(await (await fetch(`${srv.base}/robots.txt`)).text(), /Sitemap: https:\/\/wisecall\.example\/sitemap\.xml/);
    const sitemap = await (await fetch(`${srv.base}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>https:\/\/wisecall\.example\/<\/loc>/);
    assert.doesNotMatch(sitemap, /localhost/);
    assert.doesNotMatch(await (await fetch(`${srv.base}/no-such-page`, { headers: { Accept: 'text/html' } })).text(), /localhost/);
  });

  test('every email template links to it, and the bank and ID-check return and callback addresses are built from it', () => {
    const env = { ...process.env, PUBLIC_URL: 'https://wisecall.example', APP_URL: '', NODE_ENV: '' };
    const out = spawnSync('node', ['-e', `
      const { render, TEMPLATE_NAMES } = require('./server/mail/templates');
      const d = { code: '123456', url: 'https://wisecall.example/x', question: 'q', answer: 'a', mentor: 'm', reason: 'other', date: 'd', note: 'n', name: 'n', email: 'e@e.co', message: 'm', amount: '1', last4: '1', reference: 'r', link: 'https://meet.example/x', minutes: 20, domain: 'd.co', niche: 'design', mentorField: 'design', unsubscribeUrl: 'https://wisecall.example/u', step: 'license', status: 'failed', missing: [] };
      let all = '';
      for (const n of TEMPLATE_NAMES) for (const l of ['en', 'ka']) { const r = render(n, l, d); all += r.html + r.text; }
      console.log(JSON.stringify({ localhost: /localhost|127\\.0\\.0\\.1/.test(all), links: (all.match(/https:\\/\\/wisecall\\.example/g) || []).length }));
    `], { cwd: ROOT, env, encoding: 'utf8' });
    const r = JSON.parse(out.stdout.trim().split('\n').pop());
    assert.equal(r.localhost, false);
    assert.ok(r.links > 20, 'the buttons carry the public address');
    const src = ['server/payments.js', 'server/verification/kyc.js', 'server/routes/auth.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert.match(src, /config\.PUBLIC_URL\}\/api\/payments\/callback/);
    assert.match(src, /config\.PUBLIC_URL\}\/u\/\$\{mentor\.username\}\?booking=/);
    assert.match(src, /config\.PUBLIC_URL\}\/apply\.html\?step=5&kyc=returned/);
    assert.match(src, /config\.PUBLIC_URL\}\/reset-password\.html/);
  });

  test('production refuses to start when PUBLIC_URL is missing, not https, or points at this computer', () => {
    const base = {
      ...process.env, NODE_ENV: 'production', PORT: '4599', DATABASE_URL: process.env.TEST_DATABASE_URL, SESSION_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40),
      RESEND_API_KEY: 're_x', EMAIL_FROM: 'Wisecall <a@wisecall.example>', ADMIN_EMAILS: 'a@wisecall.example', PAYMENT_PROVIDER: 'bog', BOG_CLIENT_ID: 'i', BOG_CLIENT_SECRET: 's',
      KYC_PROVIDER: 'didit', DIDIT_API_KEY: 'k', DIDIT_WORKFLOW_ID: 'w', DIDIT_WEBHOOK_SECRET: 's'
    };
    const run = (extra) => spawnSync('node', ['server/index.js'], { cwd: ROOT, env: { ...base, PUBLIC_URL: '', APP_URL: '', ...extra }, encoding: 'utf8', timeout: 15000 });
    assert.match(run({}).stderr, /PUBLIC_URL is required/);
    assert.match(run({ PUBLIC_URL: 'http://wisecall.example' }).stderr, /PUBLIC_URL must be your public https/);
    assert.match(run({ PUBLIC_URL: 'https://localhost:4242' }).stderr, /not localhost/);
    assert.match(run({ PUBLIC_URL: 'https://127.0.0.1' }).stderr, /not localhost/);
  });
});

describe('the public contact address', () => {
  const fs = require('fs');
  const path = require('path');
  let withEmail, without;
  before(async () => {
    await resetDatabase();
    withEmail = await startServer(4589, { SUPPORT_EMAIL: 'support@wisecall.example', ADMIN_EMAILS: 'private-owner@example.com' });
    without = await startServer(4590, { SUPPORT_EMAIL: '' });
  });
  after(() => { if (withEmail) withEmail.proc.kill(); if (without) without.proc.kill(); });

  test('SUPPORT_EMAIL is what the pages get; the admin address is never sent to the browser', async () => {
    const cfg = await (await fetch(`${withEmail.base}/api/config`)).json();
    assert.equal(cfg.contactEmail, 'support@wisecall.example');
    const everything = [cfg, ...await Promise.all(['/api/stats', '/api/experts'].map(async (p) => (await fetch(withEmail.base + p)).json()))];
    assert.doesNotMatch(JSON.stringify(everything), /private-owner@example\.com/);
    for (const p of ['/', '/contact.html', '/terms.html', '/privacy.html', '/about.html']) {
      assert.doesNotMatch(await (await fetch(withEmail.base + p)).text(), /private-owner@example\.com/, `${p} leaks the admin address`);
    }
  });

  test('with no SUPPORT_EMAIL nothing is shown and no address is invented', async () => {
    const cfg = await (await fetch(`${without.base}/api/config`)).json();
    assert.equal(cfg.contactEmail, null);
  });

  test('the footer, contact page, Terms and Privacy pages read it from the configuration (and never hard-code an address)', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.match(read('js/footer.js'), /cfg\.contactEmail/);
    assert.match(read('js/contact.js'), /cfg\.contactEmail/);
    assert.match(read('js/legal.js'), /cfg\.contactEmail/);
    for (const f of ['index.html', 'contact.html', 'terms.html', 'privacy.html', 'about.html', 'js/footer.js', 'js/legal.js', 'js/contact.js', 'i18n/en.json', 'i18n/ka.json']) {
      assert.doesNotMatch(read(f), /[\w.+-]+@(gmail|yahoo|outlook|hotmail)\.com/i, `${f} hard-codes a personal address`);
    }
  });
});

describe('social links', () => {
  const fs = require('fs');
  const path = require('path');
  let all, none, mixed;
  before(async () => {
    await resetDatabase();
    all = await startServer(4591, {
      SOCIAL_INSTAGRAM: 'https://instagram.com/wisecall', SOCIAL_FACEBOOK: 'https://facebook.com/wisecall', SOCIAL_LINKEDIN: 'https://linkedin.com/company/wisecall', SOCIAL_TIKTOK: 'https://tiktok.com/@wisecall'
    });
    none = await startServer(4592, {});
    mixed = await startServer(4593, { SOCIAL_INSTAGRAM: 'https://instagram.com/wisecall', SOCIAL_TIKTOK: 'not a url', SOCIAL_FACEBOOK: 'http://insecure.example', SOCIAL_LINKEDIN: '   ' });
  });
  after(() => { [all, none, mixed].forEach((s) => s && s.proc.kill()); });
  const social = async (s) => (await (await fetch(`${s.base}/api/config`)).json()).social;

  test('each network appears only when its address is set in the environment', async () => {
    assert.deepEqual(Object.keys(await social(all)).sort(), ['facebook', 'instagram', 'linkedin', 'tiktok']);
    assert.deepEqual(await social(none), {});
    assert.deepEqual(await social(mixed), { instagram: 'https://instagram.com/wisecall' }, 'blank, malformed and non-https values are ignored');
  });

  test('the footer draws an icon for what the configuration returns and nothing else', () => {
    const footer = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'footer.js'), 'utf8');
    assert.match(footer, /cfg\.social/);
    for (const name of ['facebook', 'instagram', 'linkedin', 'tiktok']) assert.match(footer, new RegExp(`${name}:`), `${name} has an icon`);
    assert.doesNotMatch(footer, /instagram\.com|facebook\.com|linkedin\.com|tiktok\.com/, 'no address is hard-coded');
  });
});

describe('launch mode: prelaunch, then live', () => {
  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const { Pool } = require('pg');
  const { client, addPayoutDetails, approveMentor, bookAndPay, SAMPLE, ROOT, wait } = require('./helpers');
  const { createFakeResend, signupByEmail } = require('./fakeResend');
  const fake = createFakeResend();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const emailEnv = () => ({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: fake.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>' });
  const row = async (email) => (await pool.query('SELECT niche, prelaunch, notified_at FROM waitlist WHERE lower(email) = $1', [email])).rows[0];
  let pre, live, seeker, mentorId;

  before(async () => {
    await resetDatabase();
    await fake.start();
    pre = await startServer(4594, { LAUNCH_MODE: 'prelaunch', ...emailEnv() });
  });
  after(async () => {
    [pre, live].forEach((s) => s && s.proc.kill());
    await pool.end();
    await fake.stop();
  });

  test('the server says which mode it is in, and logs it', async () => {
    assert.equal((await (await fetch(`${pre.base}/api/config`)).json()).launchMode, 'prelaunch');
    assert.match(pre.logs(), /Launch mode: PRELAUNCH/);
  });

  test('a mistyped LAUNCH_MODE stops the server with a clear message', () => {
    const out = spawnSync('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, NODE_ENV: '', PORT: '4599', DATABASE_URL: process.env.TEST_DATABASE_URL, LAUNCH_MODE: 'soon' }, encoding: 'utf8', timeout: 15000 });
    assert.match(out.stderr, /LAUNCH_MODE must be prelaunch or live/);
  });

  test('visitors can join the waiting list, and are marked as having joined before launch', async () => {
    for (const [email, niche] of [['wait-any@example.com', 'any'], ['wait-med@example.com', 'medicine']]) {
      assert.equal((await client(pre.base).api('/waitlist', { method: 'POST', body: { over16: true, email, niche, language: 'ka' } })).status, 201);
    }
    const r = await row('wait-any@example.com');
    assert.equal(r.prelaunch, true);
    assert.equal(r.notified_at, null);
  });

  test('mentors can still sign up, apply, be verified and add payout details', async () => {
    const admin = await signupByEmail(fake, pre.base, 'QA Admin', 'qa-admin@example.com');
    const m = await signupByEmail(fake, pre.base, 'Dr Prelaunch', 'mentor@example.com');
    assert.equal((await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Doctor', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/dr-prelaunch', sampleAnswer: SAMPLE } })).status, 200);
    await approveMentor(admin, m);
    await addPayoutDetails(m);
    const me = (await m.api('/me')).user;
    assert.equal(me.verificationStatus, 'verified');
    assert.equal(me.hasPayoutDetails, true);
    mentorId = me.id;
  });

  test('the approval email tells the mentor the site is not open yet (English and Georgian)', async () => {
    const mail = await fake.waitFor('mentor@example.com', 'approved');
    assert.match(mail.body.html, /has not opened to buyers yet/);
    const render = (lang, mode) => JSON.parse(spawnSync('node', ['-e', `const { render } = require('./server/mail/templates'); const r = render('mentorApproved', '${lang}', {}); console.log(JSON.stringify(r.html));`],
      { cwd: ROOT, env: { ...process.env, LAUNCH_MODE: mode, NODE_ENV: '', DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8' }).stdout.trim().split('\n').pop());
    assert.match(render('ka', 'prelaunch'), /ჯერ მყიდველებისთვის არ გახსნილა/);
    assert.doesNotMatch(render('en', 'live'), /not opened to buyers yet/);
    assert.doesNotMatch(render('ka', 'live'), /ჯერ მყიდველებისთვის არ გახსნილა/);
  });

  test('nobody can pay: no booking is created and the bank is never contacted', async () => {
    seeker = await signupByEmail(fake, pre.base, 'Sam Seeker', 'seeker@example.com');
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Can you help me with my sleep?') } });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'prelaunch');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n, 0);
    assert.equal((await client(pre.base).api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Anonymous try') } })).status, 401);
  });

  test('listing a mentor does not send the waiting list a "mentors have joined" email yet', async () => {
    await wait(1500);
    assert.equal(fake.to('wait-any@example.com').length, 0);
    assert.equal(fake.to('wait-med@example.com').length, 0);
    assert.equal((await row('wait-med@example.com')).notified_at, null, 'they are still waiting');
  });

  test('profiles are left out of the sitemap before launch', async () => {
    const sitemap = await (await fetch(`${pre.base}/sitemap.xml`)).text();
    assert.doesNotMatch(sitemap, /\/u\//);
    assert.match(sitemap, /<loc>http:\/\/localhost:4594\/<\/loc>/);
  });

  test('when the site goes live, buyers can pay and the waiting list is told once', async () => {
    pre.proc.kill();
    live = await startServer(4595, { LAUNCH_MODE: 'live', SWEEP_INTERVAL_SECONDS: '1', ...emailEnv() });
    assert.equal((await (await fetch(`${live.base}/api/config`)).json()).launchMode, 'live');
    assert.match(live.logs(), /Launch mode: live/);

    // Someone who joins after launch is not in the launch-day batch.
    assert.equal((await client(live.base).api('/waitlist', { method: 'POST', body: { over16: true, email: 'later@example.com', niche: 'any' } })).status, 201);
    assert.equal((await row('later@example.com')).prelaunch, false);

    const any = await fake.waitFor('wait-any@example.com', undefined, 12000);
    const med = await fake.waitFor('wait-med@example.com', undefined, 12000);
    assert.match(any.body.html, /[ა-ჿ]/, 'in the language they joined with');
    assert.match(med.body.html, /waitlist-unsubscribe\.html\?token=/);
    await wait(2500); // two more sweeps: nobody is emailed twice
    assert.equal(fake.to('wait-any@example.com').length, 1);
    assert.equal(fake.to('wait-med@example.com').length, 1);
    assert.equal(fake.to('later@example.com').length, 0);
    assert.ok((await row('wait-any@example.com')).notified_at);

    assert.match(await (await fetch(`${live.base}/sitemap.xml`)).text(), /\/u\/dr-prelaunch</);
    const s = client(live.base);
    assert.equal((await s.api('/auth/login', { method: 'POST', body: { email: 'seeker@example.com', password: 'test-pass-12345' } })).status, 200);
    assert.equal((await bookAndPay(live.base, s, mentorId, 'Can you help me with my sleep?')).status, 'paid');
  });

  test('the pages and the dictionary know about prelaunch (English and Georgian)', () => {
    const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    // (the admin panel's texts live in their own dictionaries, which the server only sends to admins)
    const en = { ...JSON.parse(pub('i18n/en.json')), ...JSON.parse(pub('i18n/admin-en.json')) }, ka = { ...JSON.parse(pub('i18n/ka.json')), ...JSON.parse(pub('i18n/admin-ka.json')) };
    const wanted = new Set(['home2.pill.prelaunch', 'home2.wait.count', 'wait.thanks', 'wait.follow', 'expert.prelaunch.wait', 'wait.hero', 'wait.prelaunch.title', 'wait.join',
      'launch.banner', 'launch.banner.mentor', 'expert.prelaunch.title', 'expert.prelaunch.body', 'vt.status.verifiedPrelaunch',
      'dash.received.prelaunch.title', 'dash.received.prelaunch.body', 'admin.launch.banner']);
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => n.endsWith('.html'))) {
      for (const m of pub(f).matchAll(/data-i18n-prelaunch="([^"]+)"/g)) wanted.add(m[1]);
    }
    for (const key of wanted) {
      assert.ok(en[key], `${key} in English`);
      assert.match(ka[key] || '', /[ა-ჿ]/, `${key} in Georgian`);
    }
    const home = pub('index.html');
    assert.match(home, /data-i18n-prelaunch="home2\.pill\.prelaunchShort"/);
    assert.match(home, /class="[^"]*lmentor-btn" data-mentor-cta="hero" data-i18n="nav\.becomeMentor"/); // (the experts' way in, before and after launch)
    // (Browse, public/js/main.js, is open before launch too: docs/CLAUDE-CODE-NEW-HOME.md 4)
    for (const f of ['js/landing.js', 'js/waitlist.js', 'js/profile.js','js/nav.js', 'js/dashboard.js', 'js/settings-verification.js']) assert.match(pub(f), /launchMode\(\)/, `${f} checks the mode`);
  });
});

describe('LAUNCH_MODE left empty: prelaunch until the first mentor is listed', () => {
  const { client, signupVerified, addPayoutDetails, approveMentor, bookAndPay, SAMPLE } = require('./helpers');
  let auto, forced;
  before(async () => {
    await resetDatabase();
    auto = await startServer(4596, { LAUNCH_MODE: '' });
    forced = await startServer(4597, { LAUNCH_MODE: 'live' });
  });
  after(() => { [auto, forced].forEach((s) => s && s.proc.kill()); });
  const mode = async (s) => (await (await fetch(`${s.base}/api/config`)).json()).launchMode;

  test('with nobody listed the site starts in prelaunch and says why; nobody can pay', async () => {
    assert.equal(await mode(auto), 'prelaunch');
    assert.match(auto.logs(), /Launch mode: PRELAUNCH \(automatic: 0 listed mentor/);
    const seeker = await signupVerified(auto.base, 'Sam Seeker', 'sam@example.com');
    const r = await seeker.api('/bookings', { method: 'POST', body: { mentorId: '11111111-1111-1111-1111-111111111111', question: longQuestion('Is anyone there?') } });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'prelaunch');
  });

  test('forcing live with nobody listed logs a warning', () => {
    assert.match(forced.logs(), /\[WARNING\] LAUNCH_MODE=live, but no mentor is listed yet/);
    assert.doesNotMatch(auto.logs(), /LAUNCH_MODE=live, but no mentor/);
  });

  test('the first listed mentor opens the site by itself, and buyers can then pay', async () => {
    const admin = await signupVerified(auto.base, 'QA Admin', 'qa-admin@example.com');
    const m = await signupVerified(auto.base, 'First Mentor', 'first@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Founder', niche: 'business', price: 15, proofUrl: 'https://linkedin.com/in/first', sampleAnswer: SAMPLE } });
    await approveMentor(admin, m);
    assert.equal(await mode(auto), 'prelaunch', 'approved but without payout details nobody can be paid yet');
    await addPayoutDetails(m);
    assert.equal(await mode(auto), 'live');
    assert.match(auto.logs(), /the site is now in LIVE mode \(1 listed mentor/);
    const mentorId = (await m.api('/me')).user.id;
    const seeker = client(auto.base);
    assert.equal((await seeker.api('/auth/login', { method: 'POST', body: { email: 'sam@example.com', password: 'test-pass-12345' } })).status, 200);
    assert.equal((await bookAndPay(auto.base, seeker, mentorId, 'How do I find my first customer?')).status, 'paid');
  });
});

describe('development warnings', () => {
  let srv;
  before(async () => { await resetDatabase(); srv = await startServer(4587); });
  after(() => { if (srv) srv.proc.kill(); });

  test('a server with fake providers says so clearly at startup', async () => {
    const out = srv.logs();
    assert.match(out, /\[WARNING\] Development mode/);
    assert.match(out, /MOCK BANK is active/);
    assert.match(out, /MOCK ID CHECK is active/);
    assert.match(out, /EMAIL IS OFF/);
    assert.match(out, /PUBLIC_URL is http:\/\/localhost:4587/);
    assert.match(out, /ID check: MOCK/);
  });

  test('development pages and helpers are available here, and /api/config says devMode', async () => {
    const cfg = await (await fetch(`${srv.base}/api/config`)).json();
    assert.equal(cfg.devMode, true);
    assert.equal((await fetch(`${srv.base}/mock-bank.html`)).status, 200);
  });
});
