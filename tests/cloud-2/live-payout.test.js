// REVIEW-2: a live session's payout depends on "the mentor was there for at least half the planned time" (server/live/settle.js). That
// time comes only from heartbeats the mentor's own browser sends: a script that never opens the call earns it just the same, even while
// the video service sees nobody in the room (REVIEW-2 #4). A real server with LIVE_PROVIDER=daily, talking to a fake Daily API whose
// presence list is empty.
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { pool, sql, marketplace, published, buyAndPay, wait } = require('./_shared');

const seen = [];
let fake, ctx;
before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, url: req.url });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/rooms') return res.end(JSON.stringify({ name: json.name, url: `https://wisecall.daily.co/${json.name}` }));
      if (req.method === 'POST' && req.url === '/v1/meeting-tokens') return res.end(JSON.stringify({ token: `tok-${seen.length}` }));
      // (nobody is in the call)
      if (req.method === 'GET' && /\/presence$/.test(req.url)) return res.end(JSON.stringify({ total_count: 0, data: [] }));
      res.end(JSON.stringify({ deleted: true, data: [] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  ctx = await marketplace(4857, { LIVE_PROVIDER: 'daily', DAILY_API_KEY: 'test-daily-key-not-real', DAILY_API_URL: `http://127.0.0.1:${fake.address().port}/v1` });
});
after(async () => { if (ctx) ctx.srv.proc.kill(); fake.close(); await pool.end(); });

test('heartbeats count as presence only when the video service sees the mentor in the call', async () => {
  const s = await published(ctx);
  await buyAndPay(ctx, ctx.seeker, s.id);
  await pool.query(`UPDATE live_sessions SET starts_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
  // The mentor asks for a token (the session goes live) but never opens the call; a script sends the heartbeats.
  assert.equal((await ctx.mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).role, 'mentor');
  assert.equal((await ctx.mentor.api(`/live/${s.id}/heartbeat`, { method: 'POST' })).status, 200);
  await wait(2500);
  assert.equal((await ctx.mentor.api(`/live/${s.id}/heartbeat`, { method: 'POST' })).status, 200);
  const [row] = await sql('SELECT mentor_seconds, status FROM live_sessions WHERE id = $1', [s.id]);
  assert.equal(row.status, 'live');
  assert.equal(row.mentor_seconds, 0, `${row.mentor_seconds} s of presence counted towards the payout while the call was empty`);
});
