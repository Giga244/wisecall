#!/usr/bin/env node
// Load test 4: a storm of bank callbacks. M buyers ask a question (bookings waiting for payment), the fake bank marks every order paid
// WITHOUT telling the server, then 100+ signed callbacks arrive at once: each order 2-3 times (duplicates), plus forged signatures and
// unknown orders. Expected: every booking paid exactly once (one receipt, one paid_at), forged ones refused with 400, unknown ones 200.
//   node tests/load/callbacks.js --base http://localhost:4300 [--orders 40] [--offset 200]
const fs = require('fs');
const crypto = require('crypto');
const { tokens, sql, close, api, mockCallback, orderFromUrl, summary } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const M = Number(arg('orders', 40));
const OFFSET = Number(arg('offset', 200));
const OUT = arg('out', null);
const QUESTION = 'How did you prepare your documents for a German university, and what would you do differently if you applied again this year?';

async function main() {
  const users = await tokens(M, { offset: OFFSET });
  const mentors = (await sql(`SELECT id FROM users WHERE email LIKE 'rehearsal.mentor%' ORDER BY email`)).map((r) => r.id);
  const asked = await Promise.all(users.map((u, i) => api(BASE, u.cookie)('/api/bookings', { method: 'POST', body: { mentorId: mentors[(i * 3) % mentors.length], question: QUESTION } })));
  const bookings = asked.filter((a) => a.status === 201).map((a) => ({ id: a.json.booking.id, order: orderFromUrl(a.json.checkoutUrl) }));
  // Every order is paid on the fake bank's page (which sends its own callback) at the same instant as the storm of duplicates below.
  const storm = [];
  bookings.forEach((b, i) => { for (let k = 0; k < 2 + (i % 2); k++) storm.push(() => mockCallback(BASE, b.order).then((r) => ({ ...r, kind: 'genuine' }))); });
  for (let i = 0; i < 10; i++) storm.push(() => mockCallback(BASE, `mock-${crypto.randomUUID()}`).then((r) => ({ ...r, kind: 'unknown_order' })));
  for (let i = 0; i < 10; i++) storm.push(() => fetch(`${BASE}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': 'f'.repeat(64) }, body: JSON.stringify({ orderId: bookings[i % bookings.length].order }) })
    .then((r) => ({ status: r.status, ms: 0, kind: 'forged' })));
  // the bank page "pay" for every order at the same instant as the storm (its own callback joins the duplicates)
  const pays = bookings.map((b) => () => api(BASE)(`/api/mock-bank/orders/${b.order}/complete`, { method: 'POST', body: { outcome: 'success' } }).then((r) => ({ ...r, kind: 'bank_page' })));
  const t0 = performance.now();
  const results = await Promise.all([...pays, ...storm].sort(() => Math.random() - 0.5).map((f) => f()));
  const wall = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 3000)); // the fake bank's own callbacks are fire-and-forget
  const ids = bookings.map((b) => b.id);
  const [db] = await sql(`SELECT count(*) FILTER (WHERE status = 'paid')::int AS paid, count(*) FILTER (WHERE status = 'pending_payment')::int AS pending,
                                 (SELECT count(*) FROM receipts WHERE booking_id = ANY($1::uuid[]) AND kind = 'payment')::int AS payment_receipts
                            FROM bookings WHERE id = ANY($1::uuid[])`, [ids]);
  const byKind = {};
  for (const k of ['genuine', 'unknown_order', 'forged', 'bank_page']) byKind[k] = summary(results.filter((r) => r.kind === k));
  const out = { bookings: bookings.length, callbacks: storm.length, wallMs: Math.round(wall), byKind, database: db,
    ok: db.paid === bookings.length && db.payment_receipts === bookings.length };
  console.log(JSON.stringify(out, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
