// REVIEW-2: what leaves the server. Sentry gets route patterns without usernames (REVIEW-2 #10) and messages without personal data;
// Plausible gets the path without its query, and nothing from a visitor who asked not to be tracked; Daily.co (and through it the other
// people in the call) does not learn the account behind an anonymous "Guest" (REVIEW-2 #7).
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// (set before anything loads server/config.js, which reads the environment once)
const fakeUrl = 'http://127.0.0.1:4856';
process.env.PLAUSIBLE_DOMAIN = 'wisecall.test';
process.env.PLAUSIBLE_API_URL = `${fakeUrl}/api/event`;

// A small fake service that records what it is sent (Plausible's event API and Daily's REST API).
const seen = [];
let fake;
before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch (e) { /* not JSON */ }
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/rooms') return res.end(JSON.stringify({ name: json.name, url: `https://wisecall.daily.co/${json.name}` }));
      if (req.method === 'POST' && req.url === '/v1/meeting-tokens') return res.end(JSON.stringify({ token: `tok-${seen.length}` }));
      if (req.url.startsWith('/v1/')) return res.end(JSON.stringify({ deleted: true, data: [] }));
      res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(4856, '127.0.0.1', r));
});
after(() => fake.close());

describe('Sentry', () => {
  test('the route pattern names no person: ids, /u/<username>, emails and the query are replaced', () => {
    const { routeOf } = require('../../server/errorReport');
    assert.equal(routeOf({ originalUrl: '/api/bookings/4cf35951-731a-4046-9d61-7988fc15ac04/answer?x=1' }), '/api/bookings/:id/answer');
    assert.equal(routeOf({ originalUrl: '/ka/u/maia-p' }), '/u/:username');
    assert.ok(!routeOf({ originalUrl: '/api/x/someone@example.com' }).includes('example'));
  });

  test('…including the profile API, which has the username in its address', () => {
    const { routeOf } = require('../../server/errorReport');
    for (const p of ['/api/users/maia-p', '/api/users/maia-p/report']) assert.ok(!routeOf({ originalUrl: p }).includes('maia-p'), `${p} -> ${routeOf({ originalUrl: p })}`);
  });

  test('the error message loses emails, IBANs, card-like numbers and tokens', () => {
    const { buildEvent } = require('../../server/errorReport');
    const e = buildEvent(new Error('failed for nino@example.com GE29NB0000000101904917 4111 1111 1111 1111 eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz'), { method: 'POST', route: '/api/x', status: 500 });
    const v = e.exception.values[0].value;
    for (const secret of ['nino@', 'GE29', '4111', 'eyJhbGci']) assert.ok(!v.includes(secret), v);
    assert.deepEqual(Object.keys(e).sort(), ['environment', 'event_id', 'exception', 'level', 'platform', 'release', 'tags', 'timestamp']);
  });
});

describe('Plausible', () => {
  const req = (url, headers = {}) => ({ originalUrl: url, path: url.split('?')[0], ip: '203.0.113.7', get: (h) => ({ 'user-agent': 'TestBrowser/1.0', referer: 'https://news.example/item?id=42&email=a@b.c', ...headers })[h.toLowerCase()] });

  test('the path without its query, the referrer without its query, no admin pages, and nothing at all under Do Not Track', async () => {
    const analytics = require('../../server/analytics');
    seen.length = 0;
    assert.equal(await analytics.pageview(req('/reset-password.html?token=secret-reset-token')), true);
    const ev = seen.find((s) => s.url === '/api/event');
    assert.equal(ev.body.url.endsWith('/reset-password.html'), true, ev.body.url);
    assert.ok(!JSON.stringify(ev.body).includes('secret-reset-token'));
    assert.equal(ev.body.referrer, 'https://news.example/item');
    assert.equal(ev.headers['x-forwarded-for'], '203.0.113.7', '(only to count unique visitors; Plausible does not keep it)');
    seen.length = 0;
    assert.equal(await analytics.pageview(req('/admin.html')), false);
    assert.equal(await analytics.pageview(req('/', { dnt: '1' })), false);
    assert.equal(await analytics.pageview(req('/', { 'sec-gpc': '1' })), false);
    assert.equal(seen.length, 0);
  });
});

describe('Daily.co', () => {
  // (a real server with LIVE_PROVIDER=daily, talking to the fake Daily API above)
  const { pool, sql, marketplace, published, buyAndPay, openRoom } = require('./_shared');
  let ctx;
  before(async () => {
    ctx = await marketplace(4855, { LIVE_PROVIDER: 'daily', DAILY_API_KEY: 'test-daily-key-not-real', DAILY_API_URL: `${fakeUrl}/v1` });
  });
  after(async () => { if (ctx) ctx.srv.proc.kill(); await pool.end(); });

  test('a token carries a first name (or "Guest N"), never an email', async () => {
    const s = await published(ctx);
    await buyAndPay(ctx, ctx.seeker, s.id);
    await openRoom(s.id);
    seen.length = 0;
    const j = await ctx.seeker.api(`/live/${s.id}/join`, { method: 'POST', body: { anonymous: true } });
    assert.equal(j.status, 200, j.text);
    const t = seen.filter((x) => x.url === '/v1/meeting-tokens').pop().body.properties;
    assert.match(t.user_name, /^Guest \d+$/);
    assert.ok(!JSON.stringify(t).includes('@'));
    assert.equal(t.is_owner, false);
  });

  test('an anonymous guest is not identified by their account id (to Daily, the other people in the call, or the mentor)', async () => {
    const [s] = await sql(`SELECT id FROM live_sessions WHERE status IN ('published', 'live') ORDER BY created_at DESC LIMIT 1`);
    const seekerId = (await ctx.seeker.api('/me')).user.id;
    seen.length = 0;
    assert.equal((await ctx.seeker.api(`/live/${s.id}/join`, { method: 'POST', body: { anonymous: true } })).status, 200);
    const t = seen.filter((x) => x.url === '/v1/meeting-tokens').pop().body.properties;
    assert.notEqual(t.user_id, seekerId, 'Daily (and everyone in the call) gets the account id of "Guest"');
    const st = await ctx.mentor.api(`/live/${s.id}/state`);
    assert.ok(!JSON.stringify(st.people || []).includes(seekerId), 'the mentor gets the account id of "Guest"');
  });
});
