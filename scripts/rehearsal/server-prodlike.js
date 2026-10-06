#!/usr/bin/env node
// The rehearsal's server entry point. It is server/index.js with two changes, made from the outside (no app file is edited):
//   1. Production caching: once the routes are mounted, config.IS_PROD is set to true, so pages and asset versions are cached in memory as
//      they are in production (in development every request re-reads and re-hashes the files, which would make the CPU numbers wrong).
//      The fake bank, fake ID check and fake video rooms stay switched on (their isConfigured() is pinned to true), and the email "log"
//      provider is replaced by the fake email API (scripts/rehearsal/fake-upstreams.js, EMAIL_PROVIDER=resend with RESEND_API_URL).
//   2. Fault injection for the fake bank: the file /tmp/wisecall-bank-mode (if present) says how the bank behaves right now:
//        up (default) | timeout (every call hangs 20 s, then fails) | error (every call fails at once) | slow (every call takes 3 s)
//      and /tmp/wisecall-crash-after-payment makes the process exit right after the fake bank confirms a payment and before the server
//      records it (the "server restarts mid-payment" drill; the sweep must recover it on the next start).
// Never used outside a rehearsal: it refuses NODE_ENV=production and any non-rehearsal database.
const fs = require('fs');
if (process.env.NODE_ENV === 'production') { console.error('server-prodlike.js is for rehearsals only'); process.exit(1); }
if (!/rehearsal|test|restore/.test(process.env.DATABASE_URL || '')) { console.error('server-prodlike.js needs a rehearsal, test or restore DATABASE_URL'); process.exit(1); }

const config = require('../../server/config');
const mock = require('../../server/pay/mock');
for (const f of ['../../server/kyc/mock', '../../server/live/fake', '../../server/pay/mock']) require(f).isConfigured = () => true;

const MODE_FILE = '/tmp/wisecall-bank-mode';
const bankMode = () => { try { return fs.readFileSync(MODE_FILE, 'utf8').trim() || 'up'; } catch (e) { return 'up'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const name of ['createPayment', 'getPaymentStatus', 'refund']) {
  const real = mock[name];
  mock[name] = async (...args) => {
    const m = bankMode();
    if (m === 'timeout') { await sleep(20000); throw new Error(`fake bank: ${name} timed out (rehearsal)`); }
    if (m === 'error') throw new Error(`fake bank: ${name} failed (rehearsal)`);
    if (m === 'slow') await sleep(3000);
    return real(...args);
  };
}
// "crash after the bank took the money": the fake bank's page marks the order paid, then the process dies before its callback is handled.
const realComplete = mock.complete;
mock.complete = async (orderId, outcome) => {
  if (outcome === 'success' && fs.existsSync('/tmp/wisecall-crash-after-payment')) {
    const o = mock.getOrder(orderId);
    if (o && o.status === 'pending') o.status = 'paid';
    console.error(`[rehearsal] crashing right after the fake bank confirmed ${orderId}`);
    // the fake bank forgets its orders on a restart; keep this one so the next process can confirm it (as the real bank would)
    fs.appendFileSync('/tmp/wisecall-bank-orders.jsonl', JSON.stringify(o) + '\n');
    setImmediate(() => process.exit(137));
    return o ? o.successUrl : null;
  }
  return realComplete(orderId, outcome);
};
// orders the fake bank confirmed before a crash (see above): it "remembers" them, as a real bank does
try {
  for (const line of fs.readFileSync('/tmp/wisecall-bank-orders.jsonl', 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    mock.__restore = mock.__restore || [];
    mock.__restore.push(o);
  }
} catch (e) { /* none */ }
if (mock.__restore) {
  const realGet = mock.getPaymentStatus;
  mock.getPaymentStatus = async (orderId) => {
    const o = mock.__restore.find((x) => x.orderId === orderId);
    if (o) return { status: 'paid', amount: o.amount, currency: 'gel', raw: 'restored' };
    return realGet(orderId);
  };
}

require('../../server/index');
config.IS_PROD = true;
console.log('[rehearsal] production caching on; fake bank, ID check and video on; bank mode file:', MODE_FILE);
