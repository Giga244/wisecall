// The "are you a person?" check (Cloudflare Turnstile, PART 8): with both keys set, sign-up, login, forgot password, contact, the waiting
// list and "find me a mentor" need a token that Cloudflare accepts (a fake Cloudflare here); a refused token is 400, Cloudflare being
// unreachable is 503 (never let through); the page gets the site key and the Content-Security-Policy allows Cloudflare. Without the keys
// (every other test) nothing changes.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, startServer, client } = require('./helpers');

let fake, fakeUrl, srv, base, calls = [];
let cloudflareDown = false;

before(async () => {
  await resetDatabase();
  // A fake siteverify: "good-<n>" tokens pass, anything else fails; the secret must be ours.
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      calls.push({ secret: p.get('secret'), response: p.get('response'), remoteip: p.get('remoteip') });
      if (cloudflareDown) { res.writeHead(502); return res.end('bad gateway'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (p.get('secret') !== 'test-secret-key') return res.end(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }));
      res.end(JSON.stringify(/^good-/.test(p.get('response') || '') ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}/siteverify`;
  srv = await startServer(4731, { RATE_LIMIT_MULTIPLIER: '50', TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET_KEY: 'test-secret-key', TURNSTILE_VERIFY_URL: fakeUrl });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); if (fake) fake.close(); });

let n = 0;
const token = () => `good-${++n}`;

describe('the forms need a token Cloudflare accepts', () => {
  test('the page gets the site key, and the Content-Security-Policy allows Cloudflare\'s script and frame', async () => {
    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.turnstileSiteKey, 'test-site-key');
    const csp = (await fetch(`${base}/login.html`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.match(await (await fetch(`${base}/login.html`)).text(), /\/js\/turnstile\.js/);
  });

  test('sign-up: no token or a refused one is turned away before anything happens; a good one works', async () => {
    const c = client(base);
    const body = { adult: true, name: 'Tamar Turnstile', email: 'tamar@example.com', password: 'test-pass-12345' };
    let r = await c.api('/auth/signup', { method: 'POST', body });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'human_check_failed');
    r = await c.api('/auth/signup', { method: 'POST', body: { ...body, turnstileToken: 'bad-token' } });
    assert.equal(r.error, 'human_check_failed');
    r = await c.api('/auth/signup', { method: 'POST', body: { ...body, turnstileToken: 'x'.repeat(5000) } });
    assert.equal(r.error, 'human_check_failed', 'an absurd token is not even sent to Cloudflare');
    const before = calls.length;
    r = await c.api('/auth/signup', { method: 'POST', body: { ...body, turnstileToken: token() } });
    assert.equal(r.status, 201);
    assert.equal(calls.length, before + 1, 'Cloudflare is asked once');
    const last = calls[calls.length - 1];
    assert.equal(last.secret, 'test-secret-key');
    assert.ok(last.remoteip, 'with the visitor\'s address');
  });

  test('login and forgot password too', async () => {
    const c = client(base);
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'tamar@example.com', password: 'test-pass-12345' } })).error, 'human_check_failed');
    assert.equal((await c.api('/auth/login', { method: 'POST', body: { email: 'tamar@example.com', password: 'test-pass-12345', turnstileToken: token() } })).status, 200);
    assert.equal((await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'tamar@example.com' } })).error, 'human_check_failed');
    assert.equal((await c.api('/auth/forgot-password', { method: 'POST', body: { email: 'tamar@example.com', turnstileToken: token() } })).status, 200);
  });

  test('contact, the waiting list and "find me a mentor"', async () => {
    const c = client(base);
    const contact = { name: 'Nino', email: 'nino@example.com', message: 'Hello, I have a question about how refunds work for a question.' };
    assert.equal((await c.api('/contact', { method: 'POST', body: contact })).error, 'human_check_failed');
    assert.equal((await c.api('/contact', { method: 'POST', body: { ...contact, turnstileToken: token() } })).status, 200);
    assert.equal((await c.api('/waitlist', { method: 'POST', body: { email: 'wait@example.com', niche: 'any' } })).error, 'human_check_failed');
    assert.ok([200, 201].includes((await c.api('/waitlist', { method: 'POST', body: { email: 'wait@example.com', niche: 'any', turnstileToken: token() } })).status));
    const request = { email: 'bees@example.com', field: 'Keeping bees', niche: 'other', need: 'I want to start keeping bees next spring and need to know the costs.' };
    assert.equal((await c.api('/requests', { method: 'POST', body: request })).error, 'human_check_failed');
    assert.equal((await c.api('/requests', { method: 'POST', body: { ...request, turnstileToken: token() } })).status, 201);
    // (the unsubscribe link of the waiting list is not a form bots fill in: no check there)
    assert.notEqual((await c.api('/waitlist/unsubscribe', { method: 'POST', body: { token: 'nope' } })).error, 'human_check_failed');
  });

  test('if Cloudflare cannot be reached the form is refused with "try again", never let through', async () => {
    cloudflareDown = true;
    try {
      const r = await client(base).api('/auth/login', { method: 'POST', body: { email: 'tamar@example.com', password: 'test-pass-12345', turnstileToken: token() } });
      assert.equal(r.status, 503);
      assert.equal(r.error, 'human_check_unavailable');
    } finally { cloudflareDown = false; }
  });
});
