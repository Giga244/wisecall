#!/usr/bin/env node
// The database part of the rehearsal. Needs, on the local Postgres:
//   ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'; ALTER SYSTEM SET log_min_duration_statement = 20;  (then restart)
//   CREATE EXTENSION pg_stat_statements;  (in the rehearsal database)
//
//   DATABASE_URL=... node scripts/rehearsal/db-report.js [--log /var/log/postgresql/postgresql-16-main.log] [--since "2026-10-05 23:00"] [--out f.json]
// Prints:
//   1. the statements that took > 20 ms (from the server log, with their real parameters), grouped, each with EXPLAIN (ANALYZE, BUFFERS)
//      run once more now (writes are explained inside a transaction that is rolled back)
//   2. the top statements by total time and by mean time (pg_stat_statements)
//   3. tables read by sequential scans under load, and foreign keys without an index
//   4. likely N+1 patterns: statements called many times more often than the requests that issue them (calls per request ratio)
const fs = require('fs');
const { sql, close, db } = require('./lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const LOG = arg('log', '/var/log/postgresql/postgresql-16-main.log');
const SINCE = arg('since', null);
const OUT = arg('out', null);
const dbName = (process.env.DATABASE_URL || '').split('/').pop().split('?')[0];

function slowFromLog() {
  if (!fs.existsSync(LOG)) return [];
  const lines = fs.readFileSync(LOG, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+ \S+) [^ ]+ \[\d+\] (\S+)@(\S+) LOG:\s+duration: ([\d.]+) ms\s+(?:execute [^:]*|statement): (.*)$/.exec(lines[i]);
    if (!m || m[3] !== dbName) continue;
    if (SINCE && m[1] < SINCE) continue;
    let text = m[5];
    let j = i + 1;
    while (j < lines.length && /^\t/.test(lines[j])) { text += '\n' + lines[j].slice(1); j++; }
    let params = null;
    if (j < lines.length && /DETAIL:\s+parameters: (.*)$/.test(lines[j])) params = /DETAIL:\s+parameters: (.*)$/.exec(lines[j])[1];
    out.push({ at: m[1], ms: Number(m[4]), text: text.trim(), params });
  }
  return out;
}

// "$1 = 'abc', $2 = NULL" -> ['abc', null]
function parseParams(p) {
  if (!p) return [];
  const vals = [];
  const re = /\$(\d+) = (NULL|'((?:[^']|'')*)')/g;
  let m;
  while ((m = re.exec(p))) vals[Number(m[1]) - 1] = m[2] === 'NULL' ? null : m[3].replace(/''/g, "'");
  return vals;
}

const normalise = (q) => q.replace(/\s+/g, ' ').replace(/'[^']*'/g, "'?'").replace(/\b\d+\b/g, 'N').slice(0, 400);

async function explain(q, params) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q}`, params);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  } catch (e) { return `(could not explain: ${e.message})`; }
  finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
}

async function main() {
  const report = {};
  // 1. slow statements from the log
  const slow = slowFromLog().filter((s) => !/^(EXPLAIN|BEGIN|COMMIT|ROLLBACK|SELECT pg_|CREATE|ALTER|COPY|DROP)/i.test(s.text));
  const groups = {};
  for (const s of slow) {
    const k = normalise(s.text);
    (groups[k] = groups[k] || { count: 0, maxMs: 0, totalMs: 0, example: s }).count += 1;
    groups[k].totalMs += s.ms;
    if (s.ms > groups[k].maxMs) { groups[k].maxMs = s.ms; groups[k].example = s; }
  }
  report.slow = [];
  for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 25)) {
    report.slow.push({ statement: k, count: g.count, maxMs: g.maxMs, avgMs: +(g.totalMs / g.count).toFixed(1), firstAt: g.example.at,
      plan: await explain(g.example.text, parseParams(g.example.params)) });
  }
  // 2. pg_stat_statements
  const pss = `FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query !~* '^(EXPLAIN|BEGIN|COMMIT|ROLLBACK|SET|SELECT pg_)'`;
  report.byTotal = await sql(`SELECT calls::int, round(total_exec_time::numeric)::int AS total_ms, round(mean_exec_time::numeric, 2)::float AS mean_ms,
                                     round(max_exec_time::numeric, 1)::float AS max_ms, rows::int, left(regexp_replace(query, '\\s+', ' ', 'g'), 300) AS query ${pss} ORDER BY total_exec_time DESC LIMIT 20`);
  report.byMean = await sql(`SELECT calls::int, round(mean_exec_time::numeric, 2)::float AS mean_ms, round(max_exec_time::numeric, 1)::float AS max_ms,
                                    left(regexp_replace(query, '\\s+', ' ', 'g'), 300) AS query ${pss} AND calls >= 5 ORDER BY mean_exec_time DESC LIMIT 15`);
  report.byCalls = await sql(`SELECT calls::int, round(mean_exec_time::numeric, 3)::float AS mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) AS query ${pss} ORDER BY calls DESC LIMIT 15`);
  // 3. scans and indexes
  report.seqScans = await sql(`SELECT relname AS table, seq_scan::int, seq_tup_read::bigint AS rows_read_by_seq_scans, idx_scan::bigint, n_live_tup::int AS rows
                                 FROM pg_stat_user_tables WHERE seq_scan > 0 ORDER BY seq_tup_read DESC LIMIT 15`);
  report.fkWithoutIndex = await sql(`
    SELECT c.conrelid::regclass::text AS table, a.attname AS column, c.confrelid::regclass::text AS refers_to
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
     ORDER BY 1, 2`);
  report.unusedIndexes = await sql(`SELECT relname AS table, indexrelname AS index, idx_scan::int, pg_size_pretty(pg_relation_size(indexrelid)) AS size
                                      FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 15`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(`> 20 ms in the log: ${slow.length} statement(s), ${report.slow.length} distinct`);
  for (const s of report.slow) console.log(`\n[${s.count}× max ${s.maxMs} ms avg ${s.avgMs} ms] ${s.statement.slice(0, 220)}\n${s.plan.split('\n').slice(0, 14).map((l) => '    ' + l).join('\n')}`);
  console.log('\nTop by total time:'); report.byTotal.slice(0, 12).forEach((r) => console.log(`  ${String(r.total_ms).padStart(7)} ms  ${String(r.calls).padStart(7)}×  mean ${r.mean_ms} max ${r.max_ms}  ${r.query.slice(0, 150)}`));
  console.log('\nMost called:'); report.byCalls.slice(0, 10).forEach((r) => console.log(`  ${String(r.calls).padStart(7)}×  mean ${r.mean_ms}  ${r.query.slice(0, 150)}`));
  console.log('\nSequential scans:'); report.seqScans.forEach((r) => console.log(`  ${r.table.padEnd(28)} seq ${r.seq_scan} (rows read ${r.rows_read_by_seq_scans}) idx ${r.idx_scan} rows ${r.rows}`));
  console.log('\nForeign keys without an index:'); report.fkWithoutIndex.forEach((r) => console.log(`  ${r.table}.${r.column} -> ${r.refers_to}`));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
