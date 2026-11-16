// Moving the site to another domain (docs/DOMAIN-MOVE.md; server/domainMove.js). Nothing in the code, the pages or the emails names a
// domain: every address is built from PUBLIC_URL. OLD_DOMAINS (empty by default: nothing changes) sends a request for the site's earlier
// address to the same path and query on PUBLIC_URL with a permanent 301, before anything else runs; so does "www." + the site's host. The
// addresses outside services call (the ID check, the bank, the email provider, Google sign-in, one-click unsubscribe) answer on every host.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, execSync } = require('child_process');
const { ROOT, resetDatabase, startServer, client, signupVerified } = require('./helpers');

// (made-up hosts: the site's earlier one and its new one. Written in pieces where the real earlier name is meant, so this file passes
// its own "the old name is nowhere" check.)
const OLD = 'old-site.test';
const NEW = 'https://new-site.test';
const FORMER = 'wisecall' + 'ge.ge';
const OUTBOX = path.join(os.tmpdir(), `wisecall-domain-move-${process.pid}.jsonl`);
let moved, plain, onNew;

// A request to a test server "as if" it came for another host (fetch does not let a Host header be set).
function ask(srv, urlPath, { host, method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.base);
    const req = http.request({ hostname: u.hostname, port: u.port, path: urlPath, method, headers: { ...(host ? { Host: host } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  await resetDatabase();
  fs.writeFileSync(OUTBOX, '');
  // "moved": the redirect is on (its own address is localhost:<port>, as in every test).
  moved = await startServer(4891, { RATE_LIMIT_MULTIPLIER: '50', OLD_DOMAINS: `${OLD}, www.${OLD}` });
  // "plain": OLD_DOMAINS is not set, as on a site that has not moved.
  plain = await startServer(4892, { RATE_LIMIT_MULTIPLIER: '50', OLD_DOMAINS: '' });
  // "onNew": the site as it is after the move: PUBLIC_URL is the new address (reached here through localhost).
  onNew = await startServer(4893, { RATE_LIMIT_MULTIPLIER: '50', LAUNCH_MODE: 'prelaunch', PUBLIC_URL: NEW, OLD_DOMAINS: OLD, SUPPORT_EMAIL: 'support@new-site.ge',
    EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hello@new-site.ge>' });
});
after(() => { for (const s of [moved, plain, onNew]) if (s) s.proc.kill(); try { fs.unlinkSync(OUTBOX); } catch (e) { /* gone */ } });

describe('the old domain: a permanent redirect to the same page', () => {
  test('every page of the old host goes, with 301, to the same path and query on PUBLIC_URL', async () => {
    for (const p of ['/', '/ka/', '/ka/about.html', '/ka/match?f=beauty', '/u/somebody?chip=art.web&x=1', '/ka/advice-articles/some-article', '/no-such-page', '/sitemap.xml', '/api/config']) {
      const r = await ask(moved, p, { host: OLD });
      assert.equal(r.status, 301, p);
      assert.equal(r.location, moved.base + p, p);
    }
    const www = await ask(moved, '/ka/faq.html?a=1', { host: `www.${OLD}` });
    assert.deepEqual([www.status, www.location], [301, `${moved.base}/ka/faq.html?a=1`]);
    // (with a port, in capitals, with a dot at the end: the same host)
    for (const host of [`${OLD}:443`, OLD.toUpperCase(), `${OLD}.`]) assert.equal((await ask(moved, '/ka/', { host })).status, 301, host);
  });

  test('before anything else runs: a POST to the old host is redirected too, and nothing of it is done', async () => {
    const r = await ask(moved, '/api/auth/signup', { host: OLD, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' },
      body: JSON.stringify({ name: 'Old Host', email: 'old-host@example.com', password: 'test-pass-12345', adult: true, birthYm: '1990-01' }) });
    assert.equal(r.status, 301);
    assert.equal(r.location, `${moved.base}/api/auth/signup`);
    assert.equal((await client(moved.base).api('/auth/login', { method: 'POST', body: { email: 'old-host@example.com', password: 'test-pass-12345' } })).status, 401, 'no account was made');
  });

  test('the redirect can only ever lead to PUBLIC_URL', async () => {
    for (const p of ['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example']) {
      const r = await ask(moved, p, { host: OLD });
      assert.equal(r.status, 301, p);
      assert.ok(r.location.startsWith(moved.base + '/'), `${p} -> ${r.location}`);
      assert.equal(new URL(r.location).host, new URL(moved.base).host, p);
    }
  });

  test('what outside services call answers on the old host: the ID check, the bank, the email provider, Google sign-in, one-click unsubscribe, the health check', async () => {
    const post = (p) => ask(moved, p, { host: OLD, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    for (const p of ['/api/kyc/webhook', '/api/payments/callback', '/api/payments/flitt/payout-callback', '/api/email/webhook']) {
      const r = await post(p);
      assert.ok(r.status !== 301 && r.status !== 308 && !r.location, `${p} is answered here (${r.status}), not redirected`);
      // (and it is the route's own answer: the same as on the site's own host)
      const own = await ask(moved, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(r.status, own.status, p);
    }
    const unsub = await post('/api/waitlist-one-click?token=not-a-token');
    assert.equal(unsub.status, 200);
    const google = await ask(moved, '/api/auth/google/callback?code=x&state=y', { host: OLD });
    assert.notEqual(google.status, 301);
    assert.ok(!google.location || !google.location.startsWith(`${moved.base}/api/auth/google/callback`), 'handled here, not sent on');
    assert.equal((await ask(moved, '/healthz', { host: OLD })).status, 200);
    // (only those: the page next to one of them is redirected like any other)
    for (const p of ['/api/kyc/start', '/api/auth/google/start', '/api/email/other', '/api/waitlist']) assert.equal((await ask(moved, p, { host: OLD })).status, 301, p);
    const { answersEverywhere } = require('../server/domainMove');
    assert.equal(answersEverywhere('/api/kyc/webhook'), true);
    assert.equal(answersEverywhere('/api/kyc/webhooks-list'), false);
  });

  test('the site\'s own host, and any host that is not listed, are served as before', async () => {
    assert.equal((await ask(moved, '/ka/about.html')).status, 200);
    assert.equal((await ask(moved, '/ka/about.html', { host: 'another-site.test' })).status, 200);
    assert.equal((await ask(moved, '/ka/about.html', { host: `not-${OLD}` })).status, 200);
  });

  test('OLD_DOMAINS empty (the default): no redirect at all', async () => {
    for (const host of [OLD, `www.${OLD}`]) {
      const r = await ask(plain, '/ka/about.html', { host });
      assert.equal(r.status, 200, host);
      assert.equal(r.location, null);
    }
    const read = (env) => execFileSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./server/config').OLD_DOMAINS))"],
      { cwd: ROOT, env: { ...process.env, NODE_ENV: '', PUBLIC_URL: 'http://localhost:4242', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(read({ OLD_DOMAINS: '' }), '[]');
    assert.equal(read({ OLD_DOMAINS: ' https://Old-Site.ge/ , www.old-site.ge, not a host, old-site.ge ' }), '["old-site.ge","www.old-site.ge"]', 'host names only, each once');
    assert.equal(read({ OLD_DOMAINS: 'localhost,old-site.ge' }), '["old-site.ge"]', 'the site\'s own host is never one of its old ones');
  });

  test('"www." + the site\'s own host goes to the host without it, always; the outside services\' addresses answer there too', async () => {
    const own = new URL(plain.base).host; // localhost:4892
    const r = await ask(plain, '/ka/match?f=art', { host: `www.${own}` });
    assert.deepEqual([r.status, r.location], [301, `${plain.base}/ka/match?f=art`]);
    const hook = await ask(plain, '/api/kyc/webhook', { host: `www.${own}`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(hook.status !== 301 && !hook.location);
  });
});

describe('after the move: every address is PUBLIC_URL', () => {
  const urls = (text) => [...text.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)].map((m) => m[0]);
  // (addresses that are not the site's own: the social pages, schema.org, the XML namespaces, fonts)
  const outside = /^https?:\/\/(www\.)?(instagram\.com|tiktok\.com|facebook\.com|schema\.org|www\.w3\.org|w3\.org|www\.sitemaps\.org|sitemaps\.org)\b/;

  test('canonical, hreflang, the share tags and the structured data of a page', async () => {
    for (const p of ['/ka/', '/', '/ka/about.html', '/ka/match', '/ka/help/good-mentor-profile']) {
      const h = (await ask(onNew, p)).text;
      const head = h.slice(0, h.indexOf('</head>'));
      assert.match(head, new RegExp(`<link rel="canonical" href="${NEW}/`), p);
      assert.match(head, new RegExp(`hreflang="ka" href="${NEW}/ka/`), p);
      assert.match(head, new RegExp(`<meta property="og:url" content="${NEW}/`), p);
      assert.match(head, new RegExp(`<meta property="og:image" content="${NEW}/`), p);
      for (const u of urls(head).filter((x) => !outside.test(x))) assert.ok(u.startsWith(NEW), `${p}: ${u}`);
      assert.ok(!h.includes(FORMER), `${p}: the earlier domain is not in the page`);
      assert.ok(!h.includes('localhost'), `${p}: nor the address the test reached it by`);
    }
    const ld = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec((await ask(onNew, '/ka/')).text)[1]);
    const org = ld['@graph'].find((x) => x['@type'] === 'Organization');
    assert.equal(org.url, `${NEW}/`);
    assert.equal(org['@id'], `${NEW}/#org`);
    assert.ok(org.logo.startsWith(`${NEW}/`));
    assert.equal(org.email, 'support@new-site.ge');
  });

  test('sitemap.xml, robots.txt and llms.txt', async () => {
    const sitemap = (await ask(onNew, '/sitemap.xml')).text;
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length >= 20);
    for (const u of [...locs, ...[...sitemap.matchAll(/href="([^"]+)"/g)].map((m) => m[1])]) assert.ok(u.startsWith(`${NEW}/`), u);
    assert.match((await ask(onNew, '/robots.txt')).text, new RegExp(`Sitemap: ${NEW}/sitemap\\.xml`));
    const llms = (await ask(onNew, '/llms.txt')).text;
    assert.match(llms, new RegExp(`- Site: ${NEW} \\(Georgian: ${NEW}/ka/\\)`));
    assert.match(llms, /- Contact: support@new-site\.ge/);
    for (const u of urls(llms)) assert.ok(u.startsWith(NEW), u);
    for (const text of [sitemap, llms]) assert.ok(!text.includes(FORMER) && !text.includes('localhost'));
  });

  test('the help centre names the site by its own host (a profile\'s address)', async () => {
    const h = (await ask(onNew, '/help/good-mentor-profile')).text;
    assert.match(h, /<code>new-site\.test\/u\/your-name<\/code>/);
    assert.doesNotMatch(h, /\{site\}/);
    const md = fs.readFileSync(path.join(ROOT, 'docs', 'help', 'ka', '08-good-mentor-profile.md'), 'utf8');
    assert.match(md, /`\{site\}\/u\//);
  });

  test('emails: every link is on PUBLIC_URL, and the sender and the support address come from the settings', async () => {
    const c = client(onNew.base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'New Domain', email: 'new-domain@example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201, su.text);
    const wl = await c.api('/waitlist', { method: 'POST', body: { email: 'waiting@example.com', niche: 'any', language: 'ka', over16: true } });
    assert.ok(wl.status === 200 || wl.status === 201, wl.text);
    await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'new-domain@example.com' } });
    let mails = [];
    for (let i = 0; i < 40 && mails.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 150));
      mails = fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    }
    assert.ok(mails.length >= 2, `${mails.length} emails`);
    // (the sender is EMAIL_FROM and nothing else: the one line of each provider that sets it; tests/email-journey.test.js sees it arrive)
    const mailer = fs.readFileSync(path.join(ROOT, 'server', 'email.js'), 'utf8');
    assert.match(mailer, /from: config\.EMAIL_FROM, to: m\.to/);
    assert.match(mailer, /From: config\.EMAIL_FROM, To: m\.to/);
    assert.doesNotMatch(mailer, /@[a-z0-9-]+\.ge\b/, 'no address is typed into the mailer');
    for (const m of mails) {
      assert.equal(m.replyTo, 'support@new-site.ge', 'replies go to SUPPORT_EMAIL');
      const body = `${m.html || ''}\n${m.text || ''}\n${JSON.stringify(m.headers || {})}`;
      const links = urls(body).filter((u) => !outside.test(u));
      assert.ok(links.length > 0, m.subject);
      for (const u of links) assert.ok(u.startsWith(NEW), `${m.subject}: ${u}`);
      assert.ok(!body.includes(FORMER) && !body.includes('localhost'), m.subject);
    }
  });

  test('the login cookie belongs to the host that set it (no Domain): signing in works on any address the site has', async () => {
    const c = await signupVerified(moved.base, 'Cookie Person', 'cookie-person@example.com');
    const r = await c.api('/auth/login', { method: 'POST', body: { email: 'cookie-person@example.com', password: 'test-pass-12345' } });
    assert.equal(r.status, 200);
    const cookies = r.headers.getSetCookie();
    assert.ok(cookies.some((x) => x.startsWith('wisecall_token=')));
    for (const x of cookies) assert.doesNotMatch(x, /;\s*domain=/i, x);
    const src = execSync('git grep -n -i "domain:" -- server/auth.js server/security.js server/routes/google.js server/attribution.js || true', { cwd: ROOT, encoding: 'utf8' });
    assert.equal(src.trim(), '', 'no cookie is tied to a domain');
  });
});

describe('no domain is typed into the code', () => {
  test('the earlier domain is in no tracked file but the move\'s own guide (the social pages keep their names)', () => {
    const hits = execSync(`git grep -l -i "${FORMER.replace('.', '\\.')}" -- . || true`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(hits, ['docs/DOMAIN-MOVE.md']);
    // (the Instagram, TikTok and Facebook pages are named as they are)
    const config = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    assert.match(config, /instagram: 'https:\/\/www\.instagram\.com\/wisecallge\/'/);
  });

  test('the site\'s code, pages and email templates name no domain of the site at all: the new one neither', () => {
    const hits = execSync('git grep -n -i -E "wisecall\\.ge" -- server public || true', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
      .filter((l) => !/tiktok\.com\/@wisecall\.ge|facebook\.com\/Wisecall\.ge/.test(l));
    assert.deepEqual(hits, []);
  });

  test('the blueprint holds no address: PUBLIC_URL, OLD_DOMAINS, EMAIL_FROM and SUPPORT_EMAIL are set in the dashboard only', () => {
    const render = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8').replace(/\r\n/g, '\n');
    for (const key of ['PUBLIC_URL', 'OLD_DOMAINS', 'EMAIL_FROM', 'SUPPORT_EMAIL']) assert.match(render, new RegExp(`- key: ${key}\\n\\s+sync: false`), key);
    assert.doesNotMatch(render, /value: https?:\/\//);
    assert.doesNotMatch(render, /value: [^\n]*@/);
    for (const f of ['.env.example', 'DEPLOY.md']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /OLD_DOMAINS/, f);
  });
});
