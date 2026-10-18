// Visitor statistics (Plausible, from the server: no cookies, no personal data), error monitoring (Sentry: nothing personal, off without
// a DSN) and the public /status page. Plausible and Sentry are faked here.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, startServer, signupVerified, client, wait } = require('./helpers');
const { scrub, buildEvent, parseDsn } = require('../server/errorReport');

const seen = { plausible: [], sentry: [] };
let fake, srv, base, off;

before(async () => {
  fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/api/event') seen.plausible.push({ headers: req.headers, body: JSON.parse(body) });
    else if (req.url.includes('/envelope/')) seen.sentry.push({ headers: req.headers, body });
    res.writeHead(202); res.end('ok');
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  await resetDatabase();
  srv = await startServer(4717, { RATE_LIMIT_MULTIPLIER: '20', PLAUSIBLE_DOMAIN: 'wisecall.test', PLAUSIBLE_API_URL: `http://localhost:${port}/api/event`, SENTRY_DSN: `http://testkey@localhost:${port}/42` });
  base = srv.base;
});
after(() => { if (srv) srv.proc.kill(); if (off) off.proc.kill(); fake.close(); });

const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(50); } return null; };

describe('visitor statistics', () => {
  test('a page view is counted with its path only (never the query), the visitor address passed on, no cookies', async () => {
    await fetch(`${base}/about.html?token=secret-reset-token`, { headers: { 'User-Agent': 'Test browser' } });
    const pv = await until(() => seen.plausible.find((e) => e.body.name === 'pageview' && e.body.url.endsWith('/about.html')));
    assert.ok(pv);
    assert.equal(pv.body.domain, 'wisecall.test');
    assert.doesNotMatch(JSON.stringify(pv.body), /secret-reset-token/);
    assert.equal(pv.headers['user-agent'], 'Test browser');
    assert.ok(pv.headers['x-forwarded-for']);
    const res = await fetch(`${base}/about.html`);
    // (the page view sets no cookie; wc_src, where the visitor came from, is server/attribution.js and has its own tests)
    assert.deepEqual(res.headers.getSetCookie().filter((c) => !c.startsWith('wc_src=')), [], 'no cookie is set for statistics');
  });

  test('Do Not Track and Global Privacy Control are respected; admin pages are never counted', async () => {
    await wait(400); // (the page views of the test before have arrived)
    const before = seen.plausible.length;
    await fetch(`${base}/contact.html`, { headers: { DNT: '1' } });
    await fetch(`${base}/terms.html`, { headers: { 'Sec-GPC': '1' } });
    await wait(400);
    assert.equal(seen.plausible.length, before);
  });

  test('events: a sign-up and a waiting-list join, with no personal data', async () => {
    await signupVerified(base, 'Stat Person', 'stat.person@example.com');
    await client(base).api('/waitlist', { method: 'POST', body: { email: 'wait.person@example.com', niche: 'tech', language: 'en' } });
    const s = await until(() => seen.plausible.find((e) => e.body.name === 'signup'));
    const w = await until(() => seen.plausible.find((e) => e.body.name === 'waitlist_join'));
    assert.deepEqual(s.body.props, { method: 'email' });
    assert.deepEqual(w.body.props, { field: 'tech' });
    assert.doesNotMatch(JSON.stringify(seen.plausible), /stat\.person|wait\.person|@example\.com/);
  });
});

describe('error monitoring', () => {
  test('a server error is reported with the route pattern, and without the email in its message', async () => {
    const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    const r = await admin.api('/admin/dev/crash', { method: 'POST' });
    assert.equal(r.status, 500);
    assert.equal(r.error, 'server_error', 'the visitor gets no details');
    const env = await until(() => seen.sentry[0]);
    assert.ok(env);
    assert.match(env.headers['x-sentry-auth'], /sentry_key=testkey/);
    assert.doesNotMatch(env.body, /someone@example\.com|qa-admin/);
    assert.match(env.body, /A test error for \[email\]/);
    assert.match(env.body, /"route":"\/api\/admin\/dev\/crash"/);
    assert.doesNotMatch(env.body, /cookie|wisecall_token/i);
  });

  test('scrubbing and the DSN, on their own', () => {
    assert.equal(scrub('IBAN GE29NB0000000101904917 card 4111 1111 1111 1111'), 'IBAN [iban] card [number]');
    assert.equal(parseDsn(''), null);
    assert.equal(buildEvent(new Error('x')).exception.values[0].type, 'Error');
  });

  test('without SENTRY_DSN nothing is sent', async () => {
    const before = seen.sentry.length;
    off = await startServer(4718, { SENTRY_DSN: '', PLAUSIBLE_DOMAIN: '' });
    const admin = client(off.base);
    await admin.api('/auth/login', { method: 'POST', body: { email: 'qa-admin@example.com', password: 'test-pass-12345' } });
    assert.equal((await admin.api('/admin/dev/crash', { method: 'POST' })).status, 500);
    await wait(400);
    assert.equal(seen.sentry.length, before);
  });
});

describe('the status page', () => {
  test('/api/status names every part in plain states, and /status.html shows it', async () => {
    const s = await client(base).api('/status');
    assert.ok(['ok', 'degraded'].includes(s.status));
    for (const k of ['website', 'database', 'jobs', 'payments', 'idChecks', 'email']) assert.ok(s.components[k], k);
    assert.equal(s.components.database.status, 'ok');
    assert.doesNotMatch(JSON.stringify(s), /apikey|api_key|secret|password|postgres/i);
    const page = await (await fetch(`${base}/status.html`)).text();
    assert.match(page, /<title>Status — Wisecall<\/title>/);
  });
});
