#!/usr/bin/env node
// Load test 5: refunds racing answers. First 3×K questions are asked and paid (the fake bank). Then, all at the same moment:
//   A. answer vs decline   — the mentor sends an answer and a decline (full refund) for the same question at once
//   B. answer vs deadline  — the answer deadline is moved to ~1 s from now; the mentor answers right at the deadline while the background
//                            sweep (which refunds unanswered questions after the deadline) is triggered at the same instant
//   C. refund vs the bank  — the mentor declines while duplicate bank callbacks and the buyer's own status checks hit the same booking
// Expected for every booking: EITHER answered with exactly one payout, OR refunded with one refund receipt and no live payout — never both,
// never neither (scripts/rehearsal/invariants.js checks the whole database afterwards).
//   node tests/load/refund-race.js --base http://localhost:4300 [--k 10] [--offset 300]
const fs = require('fs');
const { tokens, sql, close, api, payMock, mockCallback, orderFromUrl, summary } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const K = Number(arg('k', 10));
const OFFSET = Number(arg('offset', 300));
const OUT = arg('out', null);
const QUESTION = 'Which certifications actually matter for a data analyst job in Tbilisi, and which ones can I safely skip as a beginner?';
const ANSWER = 'Most employers here look at what you can do rather than certificates. Learn SQL well, build two dashboards on public Georgian data (Geostat has plenty), and write a short note on each about the question you answered. One cloud fundamentals course is enough if a job ad asks for it.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askAndPay(u, mentorId) {
  const call = api(BASE, u.cookie);
  const a = await call('/api/bookings', { method: 'POST', body: { mentorId, question: QUESTION } });
  if (a.status !== 201) throw new Error(`ask failed ${a.status} ${JSON.stringify(a.json)}`);
  const order = orderFromUrl(a.json.checkoutUrl);
  await payMock(BASE, order);
  for (let i = 0; i < 40; i++) {
    const s = await call(`/api/bookings/${a.json.booking.id}/sync`, { method: 'POST' });
    if (s.json && s.json.booking.status === 'paid') return { id: a.json.booking.id, order, buyer: u, mentorId };
    await sleep(300);
  }
  throw new Error('never paid');
}

async function main() {
  const buyers = await tokens(3 * K, { offset: OFFSET });
  const mentors = await tokens(50, { mentors: true });
  const [admin] = await tokens(1, { admin: true });
  const [dummy] = await sql(`SELECT id FROM bookings WHERE provider_order_id LIKE 'seed-%' ORDER BY created_at LIMIT 1`);
  const paid = await Promise.all(buyers.map((u, i) => askAndPay(u, mentors[i % mentors.length].id)));
  const mentorCall = (b) => api(BASE, mentors.find((m) => m.id === b.mentorId).cookie);
  const A = paid.slice(0, K), B = paid.slice(K, 2 * K), C = paid.slice(2 * K);
  const responses = { A: [], B: [], C: [] };

  // B: deadlines ~1 s from now
  await sql(`UPDATE bookings SET answer_deadline = now() + interval '1200 milliseconds' WHERE id = ANY($1::uuid[])`, [B.map((b) => b.id)]);
  const t0 = performance.now();
  await Promise.all([
    ...A.flatMap((b) => [
      mentorCall(b)(`/api/bookings/${b.id}/answer`, { method: 'POST', body: { answer: ANSWER } }).then((r) => responses.A.push({ ...r, kind: 'answer', id: b.id })),
      // (the decline leaves 0–80 ms after the answer, so both orders of arrival happen)
      sleep(Math.random() * 80).then(() => mentorCall(b)(`/api/bookings/${b.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } })).then((r) => responses.A.push({ ...r, kind: 'decline', id: b.id }))
    ]),
    (async () => {
      await sleep(1150); // right at the deadline: some answers land before it, some after
      await Promise.all([
        ...B.map((b, i) => sleep(i * 10).then(() => mentorCall(b)(`/api/bookings/${b.id}/answer`, { method: 'POST', body: { answer: ANSWER } })).then((r) => responses.B.push({ ...r, kind: 'answer', id: b.id }))),
        sleep(60).then(() => api(BASE, admin.cookie)(`/api/admin/dev/bookings/${dummy.id}/fast-forward`, { method: 'POST', body: { days: 1 }, timeoutMs: 120000 })).then((r) => responses.B.push({ ...r, kind: 'sweep' }))
      ]);
    })(),
    ...C.flatMap((b) => [
      mentorCall(b)(`/api/bookings/${b.id}/decline`, { method: 'POST', body: { reason: 'against_rules' } }).then((r) => responses.C.push({ ...r, kind: 'decline', id: b.id })),
      ...[0, 1, 2].map(() => mockCallback(BASE, b.order).then((r) => responses.C.push({ ...r, kind: 'callback', id: b.id }))),
      ...[0, 1, 2].map(() => api(BASE, b.buyer.cookie)(`/api/bookings/${b.id}/sync`, { method: 'POST' }).then((r) => responses.C.push({ ...r, kind: 'sync', id: b.id })))
    ])
  ]);
  const wall = performance.now() - t0;
  await sleep(2000);
  // a sweep after the races: anything left over (a refund to confirm) settles the way it would in production
  await api(BASE, admin.cookie)(`/api/admin/dev/bookings/${dummy.id}/fast-forward`, { method: 'POST', body: { days: 1 }, timeoutMs: 120000 });

  const verdict = async (group) => {
    const rows = await sql(`SELECT b.id, b.status, b.answered_at IS NOT NULL AS answered, p.status AS payout,
                                   (SELECT count(*) FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund')::int AS refund_receipts
                              FROM bookings b LEFT JOIN payouts p ON p.booking_id = b.id WHERE b.id = ANY($1::uuid[])`, [group.map((b) => b.id)]);
    const tally = {};
    const bad = [];
    for (const r of rows) {
      const k = `${r.status}${r.payout ? '+payout:' + r.payout : ''}${r.refund_receipts ? '+refund_receipt' : ''}`;
      tally[k] = (tally[k] || 0) + 1;
      const okAnswered = r.status === 'answered' && r.payout === 'pending' && r.refund_receipts === 0;
      const okRefunded = r.status === 'refunded' && (!r.payout || r.payout === 'void') && r.refund_receipts === 1;
      if (!okAnswered && !okRefunded) bad.push(r);
    }
    return { outcomes: tally, inconsistent: bad };
  };
  const byKind = (list) => { const o = {}; list.forEach((r) => { const k = `${r.kind} ${r.status}${r.json && r.json.error ? ' ' + r.json.error : ''}`; o[k] = (o[k] || 0) + 1; }); return o; };
  const out = { k: K, wallMs: Math.round(wall),
    A_answer_vs_decline: { responses: byKind(responses.A), ...(await verdict(A)) },
    B_answer_vs_deadline_sweep: { responses: byKind(responses.B), ...(await verdict(B)) },
    C_decline_vs_callbacks_and_syncs: { responses: byKind(responses.C), latency: summary(responses.C), ...(await verdict(C)) } };
  out.ok = [out.A_answer_vs_decline, out.B_answer_vs_deadline_sweep, out.C_decline_vs_callbacks_and_syncs].every((g) => g.inconsistent.length === 0);
  console.log(JSON.stringify(out, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
