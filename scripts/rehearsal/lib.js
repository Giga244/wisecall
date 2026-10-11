// Shared helpers for the launch rehearsal (scripts/rehearsal, tests/load). Local, seeded databases only; the fake bank only.
//
//   tokens(n, {offset})   login cookies for the seeded buyers (signed with this machine's SESSION_SECRET for their seeded session row,
//                         so 500 users do not have to log in through the rate-limited login form from one address)
//   api(base, cookie)     fetch wrapper with the CSRF header the API expects
//   payMock(base, order)  presses "pay" on the fake bank's page for an order (the server then gets the fake bank's signed callback)
//   mockCallback(base, orderId)  sends the fake bank's signed callback directly (duplicates, storms)
//   pct(list, p)          percentile
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DB = process.env.DATABASE_URL;
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error('SESSION_SECRET is not set (use the local .env)');
if (/onrender\.com|amazonaws|render\.com/.test(DB || '')) throw new Error('The rehearsal never runs against a hosted database.');

let pool;
const db = () => {
  if (!pool) { pool = new Pool({ connectionString: DB, max: 5 }); pool.on('error', () => { /* a restarted database: the next query reconnects */ }); }
  return pool;
};
const sql = async (t, p) => (await db().query(t, p)).rows;
const close = () => (pool ? pool.end() : null);

async function tokens(n, { offset = 0, mentors = false, admin = false } = {}) {
  const like = admin ? 'rehearsal.admin@example.test' : mentors ? 'rehearsal.mentor%@example.test' : 'rehearsal.user%@example.test';
  const rows = await sql(
    `SELECT u.id, u.email, u.session_version, s.id AS sid FROM users u JOIN sessions s ON s.user_id = u.id AND s.revoked_at IS NULL
      WHERE u.email LIKE $1 ORDER BY u.email OFFSET $2 LIMIT $3`, [like, offset, n]);
  return rows.map((r) => ({ id: r.id, email: r.email, cookie: `wisecall_token=${jwt.sign({ id: r.id, email: r.email, sid: r.sid, sv: r.session_version }, SECRET, { expiresIn: '2d' })}` }));
}

function api(base, cookie) {
  return async (path, { method = 'GET', body, timeoutMs = 30000 } = {}) => {
    const t0 = performance.now();
    try {
      const res = await fetch(base + path, {
        method, signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'wisecall', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
      return { status: res.status, json, ms: performance.now() - t0 };
    } catch (e) {
      return { status: 0, json: null, error: e.name === 'TimeoutError' ? 'timeout' : e.message, ms: performance.now() - t0 };
    }
  };
}

const orderFromUrl = (u) => new URL(u).searchParams.get('order');
async function payMock(base, orderId, outcome = 'success') {
  return api(base)(`/api/mock-bank/orders/${encodeURIComponent(orderId)}/complete`, { method: 'POST', body: { outcome } });
}
// The fake bank's callback, signed like server/pay/mock.js signs it.
async function mockCallback(base, orderId) {
  const body = JSON.stringify({ orderId });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/api/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': sig }, body, signal: AbortSignal.timeout(30000) });
    return { status: res.status, ms: performance.now() - t0 };
  } catch (e) { return { status: 0, error: e.message, ms: performance.now() - t0 }; }
}

const pct = (list, p) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const summary = (results) => {
  const ms = results.map((r) => r.ms);
  const by = {};
  results.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
  return { n: results.length, p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: Math.round(Math.max(...ms)), statuses: by };
};

module.exports = { db, sql, close, tokens, api, payMock, mockCallback, orderFromUrl, pct, summary };
