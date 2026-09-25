// Nothing of the admin panel reaches anybody but an admin: the page, its scripts, its texts and every /api/admin route are checked on the
// server before anything is sent, and the public files never mention the panel's settings.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, client, signupVerified } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ADMIN = 'qa-admin@example.com';
const UUID = '00000000-0000-4000-8000-000000000000';
let srv, base, admin, plain;
const extra = [];
const ADMIN_SCRIPTS = fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => /^admin[\w-]*\.js$/.test(f)).map((f) => `/js/${f}`);

before(async () => {
  await resetDatabase();
  srv = await startServer(4606); base = srv.base;
  admin = await signupVerified(base, 'Qa Admin', ADMIN);
  plain = await signupVerified(base, 'Plain Person', 'plain@example.com');
});
after(() => { [srv, ...extra].forEach((s) => s && s.proc.kill()); });

// Every route the admin panel has: read from the route files, so a new one cannot be forgotten by this test.
function adminRoutes() {
  const found = [];
  const scan = (file, prefix, only) => {
    for (const m of read(file).matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'([^\n]*)/g)) {
      if (only && !m[2].startsWith(only)) continue;
      found.push({ file, method: m[1].toUpperCase(), path: prefix + m[2], line: m[0] });
    }
  };
  scan('server/routes/admin.js', '/api/admin');
  scan('server/routes/adminVerification.js', '/api/admin');
  scan('server/routes/ratings.js', '/api', '/admin/');
  scan('server/routes/adminDev.js', '/api/admin/dev'); // (development only, but this test server is a development one)
  scan('server/routes/adminTwoFactor.js', '/api/admin/2fa'); // (how an admin passes the second step: for admins only, see tests/two-factor.test.js)
  return found;
}

describe('the admin page', () => {
  test('nobody signed in is sent to the login page, and receives nothing of the panel', async () => {
    const r = await client(base)('/admin.html');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login.html?redirect=/admin.html');
    assert.equal(r.text, 'Found. Redirecting to /login.html?redirect=/admin.html', 'only the redirect, none of the page');
  });

  test('a signed-in person who is not an admin gets a plain 403 page in the site design, with no admin text, setting or script', async () => {
    const r = await plain('/admin.html');
    assert.equal(r.status, 403);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.text, /data-i18n="error\.403\.title"/);
    assert.match(r.text, /You don't have access to this page/);
    assert.match(r.text, /href="\/index\.html"[^>]*data-i18n="error\.home"/, 'a button back home');
    assert.match(r.text, /js\/header\.js/, 'in the site design');
    for (const leak of [/adminLaunchNote/, /Prelaunch/i, /LAUNCH_MODE/, /ADMIN_EMAILS/, /admin-mentors\.js/, /js\/admin\.js/, /wisecall-i18n-extra/, /admin\.launch/, /Mentor applications/, /Payouts/]) {
      assert.doesNotMatch(r.text, leak, String(leak));
    }
  });

  test('an admin gets the panel', async () => {
    const r = await admin('/admin.html');
    assert.equal(r.status, 200);
    assert.match(r.text, /id="adminLaunchNote"/);
    assert.match(r.text, /js\/admin\.js/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('an address on the admin list that was never verified is not an admin', async () => {
    const s = await startServer(4607, { ADMIN_EMAILS: 'unverified-admin@example.com' }); extra.push(s);
    const c = client(s.base);
    const su = await c.api('/auth/signup', { method: 'POST', body: { name: 'Not Verified', email: 'unverified-admin@example.com', password: 'test-pass-12345' } });
    assert.equal(su.status, 201);
    assert.equal((await c('/admin.html')).status, 403);
    assert.equal((await c.api('/admin/mentors')).status, 403);
    assert.equal((await c('/js/admin.js')).status, 403);
  });

  test('the 403 page is not served under its own address', async () => {
    assert.equal((await client(base)('/403.html', { headers: { Accept: 'text/html' } })).status, 404);
  });
});

describe('the admin scripts and texts are for admins only', () => {
  test('there are admin scripts to protect, and a dictionary in each language', () => {
    assert.ok(ADMIN_SCRIPTS.length >= 6, ADMIN_SCRIPTS.join());
    assert.ok(fs.existsSync(path.join(ROOT, 'public/i18n/admin-en.json')) && fs.existsSync(path.join(ROOT, 'public/i18n/admin-ka.json')));
  });

  test('visitors and ordinary accounts get a plain 403 for every admin script and dictionary', async () => {
    for (const who of [client(base), plain]) {
      for (const p of [...ADMIN_SCRIPTS, '/i18n/admin-en.json', '/i18n/admin-ka.json', '/i18n/admin2fa-en.json', '/i18n/admin2fa-ka.json']) {
        const r = await who(p);
        assert.equal(r.status, 403, p);
        assert.equal(r.text, 'Forbidden', p);
        assert.equal(r.headers.get('cache-control'), 'no-store', p);
      }
    }
  });

  test('other spellings of the same files (encoded letters, dot segments, capitals, backslashes, the page as a raw file) get nothing either', async () => {
    const http = require('http');
    const raw = (p, cookie) => new Promise((resolve, reject) => {
      const port = new URL(base).port;
      const req = http.request({ host: 'localhost', port, path: p, method: 'GET', headers: cookie ? { cookie } : {} }, (res) => {
        let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.end();
    });
    const paths = ['/js/./admin.js', '/js/x/../admin.js', '/js/%61dmin.js', '/js/%61dmin-mentors.js', '/JS/ADMIN.JS', '/js/Admin-Queue.js', '/js\\admin.js', '/i18n/%61dmin-en.json', '/i18n/./admin-ka.json', '/I18N/ADMIN-EN.JSON',
      '/%61dmin.html', '/./admin.html', '/x/../admin.html', '/js/../admin.html', '/admin.htm', '/%2e%2e/admin.html', '/js/admin.js%00', '/js/admin.js%2f'];
    for (const [who, cookie] of [['visitor', ''], ['plain account', plain.cookie()]]) {
      for (const p of paths) {
        const r = await raw(p, cookie);
        assert.ok([400, 403, 404].includes(r.status), `${who} ${p} -> ${r.status}`);
        assert.doesNotMatch(r.body, /adminLaunchNote|admin\.launch|Prelaunch mode|Mentor applications|LAUNCH_MODE|adminTabs/, `${who} ${p} sent admin content`);
      }
    }
  });

  test('an admin gets them', async () => {
    for (const p of ADMIN_SCRIPTS) assert.equal((await admin(p)).status, 200, p);
    const en = JSON.parse((await admin('/i18n/admin-en.json')).text);
    assert.match(en['admin.launch.banner'], /LAUNCH_MODE/, 'the panel says how to open the site: only admins can read that');
    assert.equal((await admin('/i18n/admin-ka.json')).status, 200);
  });

  test('the public dictionaries and files carry no admin text and no setting names', async () => {
    const en = JSON.parse(read('public/i18n/en.json')), ka = JSON.parse(read('public/i18n/ka.json'));
    for (const d of [en, ka]) assert.deepEqual(Object.keys(d).filter((k) => /^admin\./.test(k) && k !== 'admin.loading'), []);
    // what a visitor is really sent: every script, stylesheet, dictionary and page
    const files = [];
    const walk = (dir, url) => fs.readdirSync(path.join(ROOT, 'public', dir), { withFileTypes: true }).forEach((e) => {
      if (e.isDirectory()) return walk(`${dir}/${e.name}`, `${url}/${e.name}`);
      if (/\.(js|css|json|html)$/.test(e.name) && !/^admin[\w-]*\.(js|json)$/.test(e.name) && !/^(admin)-/.test(e.name)) files.push(`${url}/${e.name}`);
    });
    ['js', 'css', 'i18n'].forEach((d) => walk(d, `/${d}`));
    const visitor = client(base);
    for (const f of files) {
      const r = await visitor(f);
      assert.equal(r.status, 200, f);
      assert.doesNotMatch(r.text, /LAUNCH_MODE|ADMIN_EMAILS|ADMIN_EMAIL\b|SUPPORT_EMAIL|Prelaunch mode: nobody can pay yet/, `${f} names a setting or an admin text`);
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => /\.html$/.test(n) && !/^(admin|403)\.html$/.test(n))) {
      assert.doesNotMatch(read(`public/${f}`), /adminLaunchNote|LAUNCH_MODE|ADMIN_EMAILS/, f);
    }
    // and the settings the panel talks about are not in the public config either
    const cfg = await client(base).api('/config');
    assert.ok(!('adminEmails' in cfg) && !JSON.stringify(cfg).includes(ADMIN));
  });

  test('English and Georgian admin dictionaries have the same keys, and the 403 page is in both languages', () => {
    const [aen, aka] = ['en', 'ka'].map((l) => JSON.parse(read(`public/i18n/admin-${l}.json`)));
    assert.deepEqual(Object.keys(aen).filter((k) => !(k in aka)), []);
    assert.deepEqual(Object.keys(aka).filter((k) => !(k in aen)), []);
    const [en, ka] = ['en', 'ka'].map((l) => JSON.parse(read(`public/i18n/${l}.json`)));
    for (const k of ['error.403.title', 'error.403.body']) { assert.ok(en[k], k); assert.match(ka[k], /[ა-ჿ]/, k); }
  });

  test('the admin page asks for its own dictionary (the loader merges it)', () => {
    assert.match(read('public/admin.html'), /<meta name="wisecall-i18n-extra" content="admin">/);
    assert.match(read('public/js/i18n.js'), /wisecall-i18n-extra/);
  });
});

describe('every /api/admin route', () => {
  test('the routes are found (so the checks below cover them all)', () => {
    const routes = adminRoutes();
    assert.ok(routes.length >= 30, `only ${routes.length} admin routes found`);
  });

  test('each one is declared behind requireAuth and requireAdmin', () => {
    for (const r of adminRoutes()) assert.match(r.line, /requireAuth,\s*requireAdmin/, `${r.method} ${r.path}`);
  });

  test('anybody who is not an admin gets a 403 (a visitor a 401) and nothing else in the answer', async () => {
    const withParams = (p) => p.replace(/:(?:mentorId|id)\b/g, UUID).replace(/:step\b/, 'id_kyc');
    for (const r of adminRoutes()) {
      const url = withParams(r.path);
      const opts = r.method === 'GET' ? {} : { method: r.method, body: {} };
      const visitor = await client(base)(url, opts);
      assert.equal(visitor.status, 401, `visitor ${r.method} ${url}`);
      const other = await plain(url, opts);
      assert.equal(other.status, 403, `plain account ${r.method} ${url}`);
      assert.deepEqual(JSON.parse(other.text), { error: 'not_admin' }, `${r.method} ${url} says nothing more`);
    }
  });

  test('with no admin configured at all the answer is the same plain 403 (it never explains the server settings)', async () => {
    const s = await startServer(4608, { ADMIN_EMAILS: '', ADMIN_EMAIL: '' }); extra.push(s);
    const c = await signupVerified(s.base, 'Nobody Special', 'nobody@example.com');
    for (const p of ['/api/admin/mentors', '/api/admin/bookings', '/api/admin/payouts', '/api/admin/waitlist']) {
      const r = await c(p);
      assert.equal(r.status, 403, p);
      assert.deepEqual(JSON.parse(r.text), { error: 'not_admin' }, p);
    }
    assert.equal((await c('/admin.html')).status, 403);
  });

  test('an admin still gets through', async () => {
    for (const p of ['/api/admin/mentors', '/api/admin/bookings', '/api/admin/payouts', '/api/admin/waitlist', '/api/admin/answers', '/api/admin/interviews', '/api/admin/reviews']) {
      assert.equal((await admin(p)).status, 200, p);
    }
  });
});
