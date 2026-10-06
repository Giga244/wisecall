#!/usr/bin/env node
// Load test 1: visitors browsing. Each virtual visitor loops: open a page (the HTML, then the API calls that page makes, in parallel, like
// the browser does: recorded with Playwright on 2026-10-05), wait a moment (think time), open the next one. A first visit also fetches the
// page's stylesheets and scripts (a returning visitor has them cached for a year).
//
//   node tests/load/browse.js --base http://localhost:4300 --vus 200 --duration 300 [--think 1000-3000] [--ramp 30] [--signed-in 0.2]
//   --think 0 = no pauses (a stress test: requests as fast as the server answers)
// Prints p50/p95/p99 per page and overall, errors and timeouts, requests per second; --out file.json keeps the raw summary.
const fs = require('fs');
const { tokens, sql, close, pct } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const VUS = Number(arg('vus', 200));
const DURATION = Number(arg('duration', 300)) * 1000;
const RAMP = Number(arg('ramp', 30)) * 1000;
const THINK = String(arg('think', '1000-3000')).split('-').map(Number);
const [TMIN, TMAX] = [THINK[0], THINK.length > 1 ? THINK[1] : THINK[0]];
const SIGNED_IN = Number(arg('signed-in', 0.2));
const OUT = arg('out', null);

async function journeys() {
  const mentors = await sql(`SELECT id, username, niche FROM users WHERE email LIKE 'rehearsal.mentor%' ORDER BY email`);
  const live = await sql(`SELECT slug, mentor_id FROM live_sessions WHERE slug LIKE 'rehearsal-live-%' AND slug <> 'rehearsal-live-999'`);
  const answers = await sql(`SELECT slug FROM public_answers WHERE status = 'published' LIMIT 100`);
  const r = (a) => a[Math.floor(Math.random() * a.length)];
  // [weight, name, () => [html path, ...api paths]]
  return [
    [25, 'home', () => ['/', '/api/config', '/api/me', '/api/answers?limit=3', '/api/experts', '/api/live?limit=3']],
    [15, 'home-ka', () => ['/ka/', '/api/config', '/api/me', '/api/answers?limit=3', '/api/experts', '/api/live?limit=3']],
    [15, 'browse', () => { const m = r(mentors); return [`/advice/${m.niche}`, '/api/config', '/api/me', `/api/experts?niche=${m.niche}`]; }],
    [20, 'profile', () => { const m = r(mentors); return [`/u/${m.username}`, '/api/config', `/api/users/${m.username}`, '/api/me', `/api/experts/${m.id}/reviews`,
      `/api/answers?mentor=${m.id}&limit=10`, `/api/live?mentor=${m.id}&limit=6`, `/api/live/ratings/${m.id}`, `/api/live/follows/${m.id}`]; }],
    [8, 'live', () => ['/live', '/api/config', '/api/me']],
    [5, 'live-session', () => { const s = r(live); return [`/live/${s.slug}`, '/api/config', '/api/me', `/api/live/s/${s.slug}`, `/api/live/follows/${s.mentor_id}`]; }],
    [7, 'answers', () => ['/answers', '/api/config', '/api/me']],
    [5, 'answer', () => [`/answers/${r(answers).slug}`, '/api/config', '/api/me']]
  ];
}

async function assets() {
  const html = await (await fetch(BASE + '/')).text();
  return [...html.matchAll(/(?:href|src)="(\/(?:css|js|fonts|brand)\/[^"]+\?v=[0-9a-f]+)"/g)].map((m) => m[1]);
}

const results = [];
const record = (page, kind, status, ms, error) => results.push({ t: Date.now(), page, kind, status, ms, error });
async function get(path, cookie, page, kind) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { headers: { 'accept-encoding': 'gzip', ...(kind === 'html' ? { accept: 'text/html' } : {}), ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(30000) });
    await res.arrayBuffer();
    record(page, kind, res.status, performance.now() - t0);
  } catch (e) { record(page, kind, 0, performance.now() - t0, e.name === 'TimeoutError' ? 'timeout' : e.message); }
}

async function visitor(i, plan, assetList, cookies, stopAt) {
  await new Promise((r) => setTimeout(r, (RAMP * i) / VUS));
  const cookie = Math.random() < SIGNED_IN ? cookies[i % cookies.length].cookie : null;
  const total = plan.reduce((a, j) => a + j[0], 0);
  let first = true;
  while (Date.now() < stopAt) {
    let x = Math.random() * total;
    const j = plan.find((p) => (x -= p[0]) < 0) || plan[0];
    const [html, ...apis] = j[2]();
    await get(html, cookie, j[1], 'html');
    await Promise.all([...apis.map((a) => get(a, cookie, j[1], 'api')), ...(first ? assetList.map((a) => get(a, null, j[1], 'asset')) : [])]);
    first = false;
    if (TMAX > 0) await new Promise((r) => setTimeout(r, TMIN + Math.random() * (TMAX - TMIN)));
  }
}

async function main() {
  const plan = await journeys();
  const assetList = await assets();
  const cookies = await tokens(500);
  const t0 = Date.now();
  const stopAt = t0 + DURATION;
  console.log(`browse: ${VUS} visitors for ${DURATION / 1000}s (ramp ${RAMP / 1000}s, think ${TMIN}-${TMAX} ms, ${Math.round(SIGNED_IN * 100)}% signed in) against ${BASE}`);
  const ticker = setInterval(() => {
    const recent = results.filter((r) => r.t > Date.now() - 10000);
    console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s  ${(recent.length / 10).toFixed(0)} req/s  p95 ${pct(recent.map((r) => r.ms), 95)} ms  errors ${recent.filter((r) => r.status === 0 || r.status >= 500).length}`);
  }, 10000);
  await Promise.all(Array.from({ length: VUS }, (_, i) => visitor(i, plan, assetList, cookies, stopAt)));
  clearInterval(ticker);
  const secs = (Date.now() - t0) / 1000;
  const steady = results.filter((r) => r.t > t0 + RAMP);
  const sum = (rs) => ({ n: rs.length, p50: pct(rs.map((r) => r.ms), 50), p95: pct(rs.map((r) => r.ms), 95), p99: pct(rs.map((r) => r.ms), 99),
    max: Math.round(Math.max(0, ...rs.map((r) => r.ms))), errors5xx: rs.filter((r) => r.status >= 500).length, failed: rs.filter((r) => r.status === 0).length,
    timeouts: rs.filter((r) => r.error === 'timeout').length, other4xx: rs.filter((r) => r.status >= 400 && r.status < 500).length });
  const out = { base: BASE, vus: VUS, seconds: Math.round(secs), think: [TMIN, TMAX], rps: Math.round(results.length / secs), overall: sum(steady),
    html: sum(steady.filter((r) => r.kind === 'html')), api: sum(steady.filter((r) => r.kind === 'api')), pages: {} };
  for (const j of plan) out.pages[j[1]] = sum(steady.filter((r) => r.page === j[1] && r.kind !== 'asset'));
  const errs = {};
  results.filter((r) => r.error).forEach((r) => { errs[r.error] = (errs[r.error] || 0) + 1; });
  out.errorKinds = errs;
  console.log(JSON.stringify(out, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
