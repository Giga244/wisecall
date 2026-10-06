#!/usr/bin/env node
// Load test 2: N buyers ask a question and pay at the same moment (the fake bank). Each buyer: POST /api/bookings -> the fake bank's
// page -> "pay" (the fake bank then sends its signed callback in the background) -> back on the site, POST /api/bookings/:id/sync until the
// booking says paid (what the page does when the buyer returns). Measures each step and the whole thing, and checks every booking is paid
// exactly once.
//   node tests/load/pay.js --base http://localhost:4300 --buyers 50 [--offset 0]
const fs = require('fs');
const { tokens, sql, close, api, payMock, orderFromUrl, summary } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const N = Number(arg('buyers', 50));
const OFFSET = Number(arg('offset', 0));
const OUT = arg('out', null);
const QUESTION = 'I would like to move from QA to backend development in the next year. Which skills should I learn first and how do I show them?';

async function buyer(u, mentor, steps) {
  const call = api(BASE, u.cookie);
  const t0 = performance.now();
  const ask = await call('/api/bookings', { method: 'POST', body: { mentorId: mentor, question: QUESTION } });
  steps.ask.push(ask);
  if (ask.status !== 201) return { ok: false, step: 'ask', status: ask.status, error: ask.json && ask.json.error };
  const id = ask.json.booking.id;
  const pay = await payMock(BASE, orderFromUrl(ask.json.checkoutUrl));
  steps.pay.push(pay);
  if (pay.status !== 200) return { ok: false, step: 'pay', status: pay.status };
  for (let i = 0; i < 40; i++) {
    const s = await call(`/api/bookings/${id}/sync`, { method: 'POST' });
    steps.sync.push(s);
    if (s.json && s.json.booking && s.json.booking.status === 'paid') return { ok: true, id, ms: performance.now() - t0, polls: i + 1 };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, step: 'never_paid', id };
}

async function main() {
  const users = await tokens(N, { offset: OFFSET });
  const mentors = (await sql(`SELECT id FROM users WHERE email LIKE 'rehearsal.mentor%' ORDER BY email`)).map((r) => r.id);
  const steps = { ask: [], pay: [], sync: [] };
  const t0 = performance.now();
  const results = await Promise.all(users.map((u, i) => buyer(u, mentors[i % mentors.length], steps)));
  const wall = performance.now() - t0;
  const ids = results.filter((r) => r.id).map((r) => r.id);
  const db = ids.length ? (await sql(`SELECT status, count(*)::int AS n, (SELECT count(*) FROM receipts WHERE booking_id = ANY($1::uuid[]) AND kind = 'payment')::int AS receipts
                                        FROM bookings WHERE id = ANY($1::uuid[]) GROUP BY status`, [ids])) : [];
  const ok = results.filter((r) => r.ok);
  const out = { buyers: N, wallSeconds: +(wall / 1000).toFixed(1), paid: ok.length, failed: results.filter((r) => !r.ok),
    endToEnd: summary(ok.map((r) => ({ ms: r.ms, status: 200 }))), ask: summary(steps.ask), bankPage: summary(steps.pay), sync: summary(steps.sync),
    syncPollsAvg: ok.length ? +(ok.reduce((a, r) => a + r.polls, 0) / ok.length).toFixed(1) : null, database: db };
  console.log(JSON.stringify(out, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
