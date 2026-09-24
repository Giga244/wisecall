// Shared helpers for the end-to-end tests: start the real server against the TEST database
// and talk to it over HTTP with a tiny cookie-keeping client.
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const TEST_DB = process.env.TEST_DATABASE_URL;

async function resetDatabase() {
  const pool = new Pool({ connectionString: TEST_DB });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
}

async function startServer(port, extraEnv = {}) {
  if (!TEST_DB) throw new Error('Set TEST_DATABASE_URL in .env (a separate database from the real one).');
  const env = {
    ...process.env,
    NODE_ENV: '',
    PORT: String(port),
    APP_URL: `http://localhost:${port}`,
    DATABASE_URL: TEST_DB,
    JWT_SECRET: 'test-secret-that-is-long-enough-1234567890',
    RESEND_API_KEY: '',
    PAYMENT_PROVIDER: 'mock',
    BOG_CLIENT_ID: '', BOG_CLIENT_SECRET: '', TBC_API_KEY: '', TBC_CLIENT_ID: '', TBC_CLIENT_SECRET: '',
    ADMIN_EMAILS: 'qa-admin@example.com',
    ADMIN_EMAIL: '',
    PLATFORM_FEE_PERCENT: '20',
    ...extraEnv
  };
  const proc = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d; });
  proc.stderr.on('data', (d) => { logs += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { proc, base, logs: () => logs }; } catch (e) { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error('Server exited early:\n' + logs);
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('Server did not start:\n' + logs);
}

function client(base) {
  let cookie = '';
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
      redirect: 'manual'
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, ...json };
  };
  call.api = (p, o) => call('/api' + p, o);
  return call;
}

async function signupVerified(base, name, email, password = 'test-pass-12345') {
  const c = client(base);
  const su = await c.api('/auth/signup', { method: 'POST', body: { name, email, password } });
  if (su.status !== 201) throw new Error('signup failed: ' + su.text);
  const v = await c.api('/auth/verify-email', { method: 'POST', body: { code: su.devVerifyCode } });
  if (v.status !== 200) throw new Error('verify failed: ' + v.text);
  return c;
}


const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Creates a booking and pays it at the FAKE bank (PAYMENT_PROVIDER=mock), then waits until the
// server has confirmed the payment with the bank. Returns the booking as the seeker sees it.
async function bookAndPay(base, seekerClient, mentorId, question, outcome = 'success') {
  const r = await seekerClient.api('/bookings', { method: 'POST', body: { mentorId, question } });
  if (r.status !== 201) throw new Error('booking failed: ' + r.text);
  await client(base).api(`/mock-bank/orders/${r.booking.providerOrderId}/complete`, { method: 'POST', body: { outcome } });
  await seekerClient.api(`/bookings/${r.booking.id}/sync`, { method: 'POST' });
  let booking = r.booking;
  for (let i = 0; i < 40 && booking.status === 'pending_payment'; i++) {
    await wait(100);
    booking = (await seekerClient.api(`/bookings/${r.booking.id}`)).booking;
  }
  return booking;
}

const SAMPLE = 'This is a detailed sample answer that is comfortably longer than eighty characters to pass validation.';

module.exports = { ROOT, resetDatabase, startServer, client, signupVerified, bookAndPay, wait, SAMPLE };
