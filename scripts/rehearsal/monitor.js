#!/usr/bin/env node
// Samples the server process every second while a load test runs: CPU (% of ONE core, so 50 = all of a Starter plan's 0.5 CPU),
// resident memory, and the app's database connections (active / idle / waiting on a lock).
//   node scripts/rehearsal/monitor.js <pid> <out.json>      (stop it with SIGINT/SIGTERM: it writes the summary and exits)
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pid = Number(process.argv[2]);
const out = process.argv[3] || '/tmp/monitor.json';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
pool.on('error', () => {});
const dbName = (process.env.DATABASE_URL || '').split('/').pop().split('?')[0];
const TICK = 100; // USER_HZ on Linux

const cpuTicks = () => { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); };
const rssMb = () => { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Number(m[1]) / 1024 : 0; };
const throttled = () => { try { return Number(/nr_throttled (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu/wc_rehearsal/cpu.stat', 'utf8'))[1]); } catch (e) { return null; } };

const samples = [];
let last = { t: Date.now(), c: cpuTicks() };
const timer = setInterval(async () => {
  try {
    const now = { t: Date.now(), c: cpuTicks() };
    const cpu = ((now.c - last.c) / TICK) / ((now.t - last.t) / 1000) * 100;
    last = now;
    const { rows: [c] } = await pool.query(
      `SELECT count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state LIKE 'idle%')::int AS idle,
              count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_wait, count(*)::int AS total
         FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid() AND application_name <> 'psql'`, [dbName]);
    samples.push({ t: now.t, cpu: Math.round(cpu), rss: Math.round(rssMb()), db: c, throttled: throttled() });
  } catch (e) { samples.push({ t: Date.now(), error: e.message }); }
}, 1000);

function finish() {
  clearInterval(timer);
  const ok = samples.filter((s) => !s.error);
  const max = (k) => Math.max(...ok.map(k));
  const avg = (k) => Math.round(ok.reduce((a, s) => a + k(s), 0) / Math.max(1, ok.length));
  const s = { seconds: ok.length, cpuAvg: avg((x) => x.cpu), cpuMax: max((x) => x.cpu), rssStart: ok[0] && ok[0].rss, rssMax: max((x) => x.rss), rssEnd: ok.length ? ok[ok.length - 1].rss : null,
    dbTotalMax: max((x) => x.db.total), dbActiveMax: max((x) => x.db.active), dbLockWaitMax: max((x) => x.db.lock_wait),
    throttledPeriods: ok.length && ok[ok.length - 1].throttled !== null ? ok[ok.length - 1].throttled - ok[0].throttled : null, errors: samples.length - ok.length };
  fs.writeFileSync(out, JSON.stringify({ summary: s, samples }, null, 1));
  console.log(JSON.stringify(s));
  pool.end().finally(() => process.exit(0));
}
process.on('SIGINT', finish);
process.on('SIGTERM', finish);
