#!/usr/bin/env node
// Resilience drills against the rehearsal server (scripts/rehearsal/start-server.sh must be running, with the fake upstreams).
//   node tests/load/resilience.js --base http://localhost:4300 [--only postgres,email,daily,bank,crash]
// Each drill keeps a little traffic running (10 visitors browsing + a health probe every 250 ms), breaks one thing, mends it, and reports:
// errors while broken, how long requests waited, how long until the site was healthy again, whether the server process survived, and what
// the money looks like afterwards (scripts/rehearsal/invariants.js is run by the caller).
//   postgres  the database restarts (pg_ctlcluster restart: ~3 s down)          email  the email API answers 503, then hangs
//   daily     the video API answers 503, then hangs, while people join a room   bank   the bank API times out, then errors
//   crash     the server dies right after the bank took a buyer's money, and starts again: the money must be recorded (callback/sweep)
const { exec, spawnSync } = require('child_process');
const execAsync = (cmd) => new Promise((res, rej) => exec(cmd, (e, out) => (e ? rej(e) : res(out))));
const fs = require('fs');
const { tokens, sql, close, api, payMock, orderFromUrl, summary } = require('../../scripts/rehearsal/lib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:4300');
const UP = arg('upstreams', 'http://localhost:4399');
const ONLY = arg('only', 'postgres,email,daily,bank,crash').split(',');
const PLAN = arg('plan', 'starter');
const OUT = arg('out', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUESTION = 'What should I prepare before my first conversation with a recruiter from a company abroad, and which questions should I ask them?';
const ANSWER = 'Prepare a two-minute story about what you do and why you are looking, know the salary range you want and your notice period, and have two questions ready about the team and how they measure success in the first months. Ask about the hiring steps and the timeline before you hang up.';

const serverPid = () => Number(fs.readFileSync('/tmp/wisecall-rehearsal.pid', 'utf8'));
// (a dead process whose parent is gone can linger as a zombie, which still answers kill(pid, 0): read its state instead)
const alive = (pid) => { try { return !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch (e) { return false; } };
const setUpstream = (service, mode) => fetch(`${UP}/__mode`, { method: 'POST', body: JSON.stringify({ service, mode }) }).then((r) => r.json());
const setBank = (mode) => fs.writeFileSync('/tmp/wisecall-bank-mode', mode);

// background traffic + health probe while a drill runs
function traffic() {
  const results = [];
  let stop = false;
  const probe = (async () => {
    while (!stop) {
      const t0 = performance.now();
      let status = 0;
      try { status = (await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(10000) })).status; } catch (e) { status = 0; }
      results.push({ t: Date.now(), kind: 'health', status, ms: performance.now() - t0 });
      await sleep(250);
    }
  })();
  const visitors = Array.from({ length: 10 }, async (_, i) => {
    const paths = ['/', '/api/experts', '/live', '/answers', '/api/config', `/api/live?limit=3`];
    while (!stop) {
      const p = paths[(i + results.length) % paths.length];
      const t0 = performance.now();
      let status = 0;
      try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); await r.arrayBuffer(); status = r.status; } catch (e) { status = 0; }
      results.push({ t: Date.now(), kind: 'page', status, ms: performance.now() - t0 });
      await sleep(300);
    }
  });
  return { results, stop: async () => { stop = true; await Promise.all([probe, ...visitors]); } };
}
function outage(results, from, to) {
  const during = results.filter((r) => r.t >= from && r.t <= to);
  const after = results.filter((r) => r.t > to);
  const firstHealthy = after.find((r) => r.kind === 'health' && r.status === 200);
  return { during: summary(during), failedDuring: during.filter((r) => r.status === 0 || r.status >= 500).length,
    recoveredMsAfterFix: firstHealthy ? firstHealthy.t - to : null, after: summary(after.slice(0, 200)),
    failedAfter: after.filter((r) => r.status === 0 || r.status >= 500).length };
}

async function askAndPay(u, mentorId) {
  const call = api(BASE, u.cookie);
  const a = await call('/api/bookings', { method: 'POST', body: { mentorId, question: QUESTION } });
  if (a.status !== 201) return { ok: false, ask: a };
  const p = await payMock(BASE, orderFromUrl(a.json.checkoutUrl));
  let s;
  for (let i = 0; i < 20; i++) { s = await call(`/api/bookings/${a.json.booking.id}/sync`, { method: 'POST' }); if (s.json && s.json.booking && s.json.booking.status === 'paid') break; await sleep(300); }
  return { ok: Boolean(s && s.json && s.json.booking && s.json.booking.status === 'paid'), id: a.json.booking.id, ask: a, pay: p, sync: s };
}
const sweep = async (admin) => {
  const [dummy] = await sql(`SELECT id FROM bookings WHERE provider_order_id LIKE 'seed-%' ORDER BY created_at LIMIT 1`);
  return api(BASE, admin.cookie)(`/api/admin/dev/bookings/${dummy.id}/fast-forward`, { method: 'POST', body: { days: 1 }, timeoutMs: 180000 });
};

async function main() {
  const report = {};
  const users = await tokens(60, { offset: 420 });
  const mentors = await tokens(50, { mentors: true });
  const [admin] = await tokens(1, { admin: true });
  let ui = 0;
  const nextUser = () => users[ui++];

  if (ONLY.includes('postgres')) {
    const pid = serverPid();
    const tr = traffic();
    await sleep(3000);
    const from = Date.now();
    // (stop, keep it down for 5 s, start: what a managed database's restart or a short network cut looks like)
    await execAsync('pg_ctlcluster 16 main stop');
    await sleep(5000);
    await execAsync('pg_ctlcluster 16 main start');
    const to = Date.now();
    // a payment right after the database is back: does the pool hand out dead connections?
    await sleep(500);
    const pay = await askAndPay(nextUser(), mentors[1].id);
    await sleep(8000);
    await tr.stop();
    report.postgres = { downMs: to - from, ...outage(tr.results, from, to), serverSurvived: alive(pid), paymentRightAfter: pay.ok ? 'paid' : `failed: ${pay.ask && pay.ask.status}` };
    console.log('postgres', JSON.stringify(report.postgres));
  }

  if (ONLY.includes('email')) {
    await fetch(`${UP}/__reset`);
    const r = {};
    for (const mode of ['down', 'hang']) {
      await setUpstream('email', mode);
      const t0 = performance.now();
      const pays = await Promise.all([0, 1, 2].map(() => askAndPay(nextUser(), mentors[2].id)));
      const payWallMs = Math.round(performance.now() - t0);
      // sign-up sends the verification code by email inside the request
      const signup = await api(BASE)('/api/auth/signup', { method: 'POST', body: { name: 'Rehearsal Signup', email: `rehearsal.signup.${mode}.${Date.now()}@example.test`, password: 'rehearsal-pass-12345', language: 'en', adult: true, birthYm: '1990-01' }, timeoutMs: 60000 });
      const forgot = await api(BASE)('/api/auth/forgot-password', { method: 'POST', body: { email: users[0].email }, timeoutMs: 60000 });
      r[mode] = { paymentsPaid: pays.filter((p) => p.ok).length, payWallMs, signup: { status: signup.status, ms: Math.round(signup.ms), error: signup.json && signup.json.error, emailSent: signup.json && signup.json.emailSent },
        forgotPassword: { status: forgot.status, ms: Math.round(forgot.ms) } };
    }
    await setUpstream('email', 'up');
    r.upstreamStats = (await (await fetch(`${UP}/__stats`)).json()).stats.email;
    report.email = r;
    console.log('email', JSON.stringify(r));
  }

  if (ONLY.includes('daily')) {
    // one session starting in 5 minutes, with a room, and a paid ticket
    const [s] = await sql(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes', room_name = 'wc-rehearsal-room', room_url = 'https://rehearsal.daily.co/wc-rehearsal-room'
                             WHERE slug = 'rehearsal-live-3' RETURNING id, mentor_id`);
    const buyer = nextUser();
    // (a paid ticket written straight into the database, with its receipt, as a real purchase leaves it)
    await sql(`WITH t AS (INSERT INTO live_tickets (session_id, buyer_id, holder_id, status, price, fee, net, provider, provider_order_id, hold_until, paid_at, guest_number)
               VALUES ($1, $2, $2, 'paid', 1000, 200, 800, 'mock', 'rehearsal-daily-' || gen_random_uuid(), now(), now(), 1) RETURNING id)
               INSERT INTO receipts (ticket_id, kind, amount, currency) SELECT id, 'payment', 1000, 'gel' FROM t`, [s.id, buyer.id]);
    const mentor = mentors.find((m) => m.id === s.mentor_id);
    const r = {};
    for (const mode of ['up', 'down', 'hang', 'up']) {
      await setUpstream('daily', mode);
      const [m, b, page] = await Promise.all([
        api(BASE, mentor.cookie)(`/api/live/${s.id}/join`, { method: 'POST', body: {}, timeoutMs: 30000 }),
        api(BASE, buyer.cookie)(`/api/live/${s.id}/join`, { method: 'POST', body: {}, timeoutMs: 30000 }),
        api(BASE)('/live/rehearsal-live-3')]);
      r[mode + (r[mode] ? '-again' : '')] = { mentorJoin: { status: m.status, ms: Math.round(m.ms), error: m.json && m.json.error }, buyerJoin: { status: b.status, ms: Math.round(b.ms), error: b.json && b.json.error }, sessionPage: page.status };
    }
    const [after] = await sql(`SELECT status FROM live_sessions WHERE id = $1`, [s.id]);
    r.sessionStatusAfter = after.status;
    report.daily = r;
    console.log('daily', JSON.stringify(r));
  }

  if (ONLY.includes('bank')) {
    const r = {};
    // a) the bank times out when a buyer asks
    setBank('timeout');
    const u1 = nextUser();
    const askT = await api(BASE, u1.cookie)('/api/bookings', { method: 'POST', body: { mentorId: mentors[4].id, question: QUESTION }, timeoutMs: 60000 });
    const [b1] = await sql(`SELECT status FROM bookings WHERE seeker_id = $1 ORDER BY created_at DESC LIMIT 1`, [u1.id]);
    r.askWhileBankTimesOut = { status: askT.status, ms: Math.round(askT.ms), error: askT.json && askT.json.error, bookingLeftAs: b1 && b1.status };
    // b) a paid question is declined while the bank's refund API times out: refund_pending, then the sweep finishes it once the bank is back
    setBank('up');
    const paid = await askAndPay(nextUser(), mentors[5].id);
    setBank('timeout');
    const dec = await api(BASE, mentors[5].cookie)(`/api/bookings/${paid.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' }, timeoutMs: 90000 });
    const [mid] = await sql(`SELECT status, refund_error FROM bookings WHERE id = $1`, [paid.id]);
    setBank('error');
    const sw1 = await sweep(admin);
    const [mid2] = await sql(`SELECT status, refund_error FROM bookings WHERE id = $1`, [paid.id]);
    setBank('up');
    const sw2 = await sweep(admin);
    const [end] = await sql(`SELECT status, refund_error, (SELECT count(*) FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund')::int AS refund_receipts FROM bookings b WHERE id = $1`, [paid.id]);
    r.refundWhileBankTimesOut = { declineStatus: dec.status, declineMs: Math.round(dec.ms), afterDecline: mid, afterSweepBankError: mid2, sweepWhileErrorMs: Math.round(sw1.ms), afterSweepBankUp: end, sweepMs: Math.round(sw2.ms) };
    // c) the buyer comes back while the bank's status API is slow: does /sync hold a request for long?
    setBank('slow');
    const u3 = nextUser();
    const a3 = await api(BASE, u3.cookie)('/api/bookings', { method: 'POST', body: { mentorId: mentors[6].id, question: QUESTION }, timeoutMs: 60000 });
    const s3 = a3.json ? await api(BASE, u3.cookie)(`/api/bookings/${a3.json.booking.id}/sync`, { method: 'POST', timeoutMs: 60000 }) : null;
    setBank('up');
    r.slowBank = { askMs: Math.round(a3.ms), syncMs: s3 && Math.round(s3.ms) };
    report.bank = r;
    console.log('bank', JSON.stringify(r));
  }

  if (ONLY.includes('crash')) {
    const r = {};
    fs.writeFileSync('/tmp/wisecall-crash-after-payment', '1');
    try { fs.unlinkSync('/tmp/wisecall-bank-orders.jsonl'); } catch (e) { /* none */ }
    const u = nextUser();
    const a = await api(BASE, u.cookie)('/api/bookings', { method: 'POST', body: { mentorId: mentors[7].id, question: QUESTION } });
    const bookingId = a.json.booking.id;
    const pid = serverPid();
    const p = await payMock(BASE, orderFromUrl(a.json.checkoutUrl));
    await sleep(1500);
    r.serverDied = !alive(pid);
    const [before] = await sql(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    r.bookingAfterCrash = before.status;
    fs.unlinkSync('/tmp/wisecall-crash-after-payment');
    fs.copyFileSync('/tmp/wisecall-rehearsal.log', 'tests/load/results/crash-server.log');
    r.crashLogLine = (fs.readFileSync('tests/load/results/crash-server.log', 'utf8').split('\n').find((l) => l.includes('[rehearsal] crashing')) || '').trim();
    const t0 = Date.now();
    const start = spawnSync('scripts/rehearsal/start-server.sh', [PLAN, new URL(BASE).port], { env: process.env, encoding: 'utf8' });
    r.restartMs = Date.now() - t0;
    r.restartOutput = (start.stdout || '').trim().split('\n').pop();
    // the buyer never comes back and the callback was lost with the process: only the sweep can find it (reconcilePending looks at
    // bookings older than 3 minutes; the clock is moved instead of waiting)
    await sql(`UPDATE bookings SET created_at = created_at - interval '4 minutes' WHERE id = $1`, [bookingId]);
    const sw = await sweep(admin);
    const [after] = await sql(`SELECT status, paid_at IS NOT NULL AS paid, (SELECT count(*) FROM receipts WHERE booking_id = $1 AND kind = 'payment')::int AS receipts FROM bookings WHERE id = $1`, [bookingId]);
    r.bookingAfterSweep = after;
    r.sweepMs = Math.round(sw.ms);
    r.payPageStatus = p.status;
    report.crash = r;
    console.log('crash', JSON.stringify(r));
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
