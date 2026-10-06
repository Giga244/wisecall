#!/usr/bin/env node
// Load test 3: N+1 buyers press "Buy" for the last N seats of one live session at the same moment, then everyone who got a seat pays at
// once (the fake bank; the server gets the signed callbacks in the background and each buyer also asks /sync, as the page does).
// Expected: exactly N tickets paid, everybody else told "sold_out", no oversold session (scripts/rehearsal/invariants.js).
//   node tests/load/seats.js --base http://localhost:4300 [--session rehearsal-live-999] [--buyers 31] [--offset 100]
const fs = require('fs');
const { tokens, sql, close, api, payMock, orderFromUrl, summary } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const SLUG = arg('session', 'rehearsal-live-999');
const N = Number(arg('buyers', 31));
const OFFSET = Number(arg('offset', 100));
const OUT = arg('out', null);

async function main() {
  const [s] = await sql(`SELECT id, max_seats, (SELECT count(*) FROM live_tickets t WHERE t.session_id = s.id AND (t.status IN ('paid', 'refund_pending') OR (t.status = 'held' AND t.hold_until > now())))::int AS taken
                           FROM live_sessions s WHERE slug = $1`, [SLUG]);
  if (!s) throw new Error(`no session ${SLUG} (run scripts/rehearsal/seed.js)`);
  const left = s.max_seats - s.taken;
  const users = await tokens(N, { offset: OFFSET });
  console.log(`seats: ${N} buyers for the last ${left} of ${s.max_seats} seats of ${SLUG}`);

  // 1. everybody presses "Buy" at once
  const t0 = performance.now();
  const buys = await Promise.all(users.map((u) => api(BASE, u.cookie)(`/api/live/${s.id}/tickets`, { method: 'POST', body: {} }).then((r) => ({ u, r }))));
  const buyMs = performance.now() - t0;
  const holds = buys.filter((b) => b.r.status === 201);
  const refusals = {};
  buys.filter((b) => b.r.status !== 201).forEach((b) => { const k = `${b.r.status} ${b.r.json ? b.r.json.error : b.r.error}`; refusals[k] = (refusals[k] || 0) + 1; });

  // 2. everybody who got a seat pays at once
  const pays = await Promise.all(holds.map((h) => payMock(BASE, orderFromUrl(h.r.json.checkoutUrl))));
  const syncs = await Promise.all(holds.map(async (h) => {
    for (let i = 0; i < 40; i++) {
      const r = await api(BASE, h.u.cookie)(`/api/live/tickets/${h.r.json.ticket.id}/sync`, { method: 'POST' });
      if (r.json && r.json.ticket && r.json.ticket.status === 'paid') return r;
      await new Promise((res) => setTimeout(res, 500));
    }
    return { status: 'never_paid' };
  }));
  const [after] = await sql(`SELECT count(*) FILTER (WHERE status = 'paid')::int AS paid, count(*) FILTER (WHERE status = 'held')::int AS held,
                                    count(*) FILTER (WHERE status = 'expired')::int AS expired, count(*)::int AS total FROM live_tickets WHERE session_id = $1`, [s.id]);
  const out = { session: SLUG, seatsLeft: left, buyers: N, holdsGranted: holds.length, refusals, buyStep: { wallMs: Math.round(buyMs), ...summary(buys.map((b) => b.r)) },
    payStep: summary(pays), paidAfterSync: syncs.filter((x) => x.status === 200).length, tickets: after, oversold: after.paid > s.max_seats };
  console.log(JSON.stringify(out, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
