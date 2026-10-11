#!/usr/bin/env node
// EXPLAIN ANALYZE of the queries every public page runs, on the inflated copy (scripts/rehearsal/inflate.sql): what they cost after a busy
// first year. Each query is the app's own (server/models.js mentorStatsFor, server/live/listing.js, server/routes/bookings.js /mine,
// server/routes/admin.js overview), with real ids.
//   DATABASE_URL=.../wisecall_restore_scale node scripts/rehearsal/scale-explain.js
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const ids = (await c.query(`SELECT id FROM users WHERE email LIKE 'rehearsal.mentor%'`)).rows.map((r) => r.id);
  const listable = require('../../server/models').listableSql;
  const Q = {
    'mentorStatsFor: ratings (every /api/experts and profile view)': [`SELECT r.ratee_id, count(*)::int AS n, round(avg(r.stars)::numeric, 1) AS avg FROM ratings r JOIN bookings b ON b.id = r.booking_id
      WHERE r.direction = 'asker_to_mentor' AND r.ratee_id = ANY($1::uuid[]) AND r.revealed_at IS NOT NULL AND r.hidden_at IS NULL AND b.status = 'answered' GROUP BY r.ratee_id`, [ids]],
    'mentorStatsFor: answered count + average wait (every /api/experts and profile view)': [`SELECT mentor_id, count(*) FILTER (WHERE status = 'answered' AND answer_review <> 'held') AS answered,
      avg(EXTRACT(EPOCH FROM (COALESCE(answer_released_at, answered_at) - paid_at))) FILTER (WHERE status = 'answered' AND answer_review <> 'held' AND paid_at IS NOT NULL AND answered_at IS NOT NULL) AS avg_seconds
      FROM bookings WHERE mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`, [ids]],
    'mentorStatsFor for ONE mentor (a profile page)': [`SELECT mentor_id, count(*) FILTER (WHERE status = 'answered' AND answer_review <> 'held') AS answered,
      avg(EXTRACT(EPOCH FROM (COALESCE(answer_released_at, answered_at) - paid_at))) FILTER (WHERE status = 'answered' AND answer_review <> 'held' AND paid_at IS NOT NULL AND answered_at IS NOT NULL) AS avg_seconds
      FROM bookings WHERE mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`, [[ids[0]]]],
    'a mentor\'s dashboard (/api/bookings/mine, received)': [`SELECT b.*, u.name AS other_name FROM bookings b JOIN users u ON u.id = b.seeker_id
      WHERE b.mentor_id = $1 AND b.status NOT IN ('pending_payment', 'expired') ORDER BY b.created_at DESC LIMIT 200`, [ids[0]]],
    'admin overview money line': [`SELECT COALESCE(sum(amount - COALESCE(refunded_amount, 0)) FILTER (WHERE status IN ('paid', 'answered')), 0)::bigint AS received FROM bookings`, []],
    'mentor balance (ledger.balanceFor)': [`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'pending' AND payable_at <= now() AND batch_id IS NULL), 0)::int AS payable FROM payouts WHERE mentor_id = $1`, [ids[0]]],
    '/api/experts list (listable mentors)': [`SELECT * FROM users WHERE ${listable()} ORDER BY created_at DESC LIMIT 200`, []]
  };
  const out = {};
  for (const [name, [q, p]] of Object.entries(Q)) {
    const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS) ${q}`, p);
    const plan = rows.map((r) => r['QUERY PLAN']);
    const ms = Number((plan.find((l) => /Execution Time/.test(l)) || '').replace(/[^\d.]/g, ''));
    out[name] = ms;
    console.log(`\n${String(ms).padStart(8)} ms  ${name}\n${plan.slice(0, 8).map((l) => '      ' + l).join('\n')}`);
  }
  require('fs').writeFileSync('tests/load/results/scale-explain.json', JSON.stringify(out, null, 1));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
