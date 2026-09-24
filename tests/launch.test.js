// Launch safety: warnings for fake providers, the launch mode, and the launch check.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
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
      assert.match(html, /rel="canonical" href="https:\/\/wisecall\.example\//, `${f} canonical`);
      assert.match(html, /og:url" content="https:\/\/wisecall\.example\//, `${f} og:url`);
      assert.match(html, /og:image" content="https:\/\/wisecall\.example\/og-image\.png"/, `${f} og:image`);
      assert.match(html, /twitter:image" content="https:\/\/wisecall\.example\/og-image\.png"/, `${f} twitter:image`);
    }
    const ids = await (await fetch(`${srv.base}/expert.html?id=11111111-1111-1111-1111-111111111111`)).text();
    assert.match(ids, /rel="canonical" href="https:\/\/wisecall\.example\/expert\.html/);
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
    assert.match(src, /config\.PUBLIC_URL\}\/expert\.html\?id=/);
    assert.match(src, /config\.PUBLIC_URL\}\/settings\.html\?tab=verification/);
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
