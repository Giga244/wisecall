#!/usr/bin/env node
// Reproduces finding R-1 (docs/LAUNCH-REHEARSAL.md): a mentor's answer is accepted AFTER the same question was declined.
// The decline (server/routes/bookings.js:219) only sets declined_at and leaves status = 'paid' until the refund transaction runs; the answer
// (server/models.js:211 claimAnswer) checks status = 'paid' AND answered_at IS NULL but not declined_at. In the gap the answer wins: the
// mentor sees "answered", the buyer is emailed the answer, and then the refund goes through (the payout is voided). The buyer has the
// answer for free and the mentor did the work for nothing.
//   DATABASE_URL=... node scripts/rehearsal/repro-answer-after-decline.js [--base http://localhost:4300] [--tries 40]
// Exit code 1 when reproduced (with the booking), 0 when it never happened in --tries attempts.
const { tokens, sql, close, api, payMock, orderFromUrl } = require('./lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const TRIES = Number(arg('tries', 40));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUESTION = 'Is it worth taking a lower salary to join a startup as the first data analyst, or should I stay at the bank for another year?';
const ANSWER = 'It depends on your runway and what you want to learn. At a startup you will own the whole data stack early, which teaches more in a year than three at a bank, but agree on a clear salary review after six months and make sure the founders actually use data to decide things.';

(async () => {
  const buyers = await tokens(TRIES, { offset: 360 });
  const mentors = await tokens(50, { mentors: true });
  for (let i = 0; i < TRIES; i++) {
    const m = mentors[(i * 7) % mentors.length];
    const call = api(BASE, buyers[i].cookie);
    const a = await call('/api/bookings', { method: 'POST', body: { mentorId: m.id, question: QUESTION } });
    if (a.status !== 201) { console.log('ask failed', a.status, a.json); continue; }
    await payMock(BASE, orderFromUrl(a.json.checkoutUrl));
    for (let k = 0; k < 20; k++) { const s = await call(`/api/bookings/${a.json.booking.id}/sync`, { method: 'POST' }); if (s.json && s.json.booking.status === 'paid') break; await sleep(200); }
    const id = a.json.booking.id;
    const mc = api(BASE, m.cookie);
    // the decline leaves first; the answer follows 0–6 ms later (two tabs, or a double click on two buttons)
    const [dec, ans] = await Promise.all([
      mc(`/api/bookings/${id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } }),
      sleep(Math.random() * 6).then(() => mc(`/api/bookings/${id}/answer`, { method: 'POST', body: { answer: ANSWER } }))
    ]);
    const [b] = await sql(`SELECT status, answered_at IS NOT NULL AS answered, declined_at IS NOT NULL AS declined, answer IS NOT NULL AS has_answer FROM bookings WHERE id = $1`, [id]);
    if (dec.status === 200 && ans.status === 200) {
      console.log(`🔴 reproduced on try ${i + 1}: booking ${id} — decline 200 and answer 200; now ${JSON.stringify(b)}`);
      await close();
      process.exit(1);
    }
  }
  console.log(`not reproduced in ${TRIES} tries`);
  await close();
})().catch((e) => { console.error(e); process.exit(2); });
