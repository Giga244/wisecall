// A FAKE BANK for local development. It behaves like the real bank integrations (redirect to a
// payment page, signed callback, status lookup, asynchronous-looking refund) so the whole flow can
// be tried without a merchant account. Orders live in memory only. It is refused in production
// (config.js) and its routes are not mounted there.
const crypto = require('crypto');
const config = require('../config');

const name = 'mock';
const isConfigured = () => !config.IS_PROD;

const orders = new Map();

const sign = (body) => crypto.createHmac('sha256', config.JWT_SECRET).update(body).digest('hex');

async function createPayment({ bookingId, amount, callbackUrl, successUrl, failUrl }) {
  const orderId = `mock-${crypto.randomUUID()}`;
  orders.set(orderId, { orderId, bookingId, amount, status: 'pending', callbackUrl, successUrl, failUrl });
  return { orderId, redirectUrl: `${config.APP_URL}/mock-bank.html?order=${orderId}` };
}

async function getPaymentStatus(orderId) {
  const o = orders.get(orderId);
  if (!o) return { status: 'failed', amount: null, currency: 'gel', raw: 'unknown_order' };
  return { status: o.status, amount: o.amount, currency: 'gel', raw: o.status };
}

async function refund({ orderId }) {
  const o = orders.get(orderId);
  if (!o || o.status !== 'paid') throw new Error('mock bank: order is not refundable');
  o.status = 'refunded';
  return { refundId: `mock-refund-${orderId}` };
}

function verifyCallback({ rawBody, headers }) {
  const given = String(headers['x-mock-signature'] || '');
  const expected = sign(rawBody);
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('invalid mock callback signature');
  return { orderId: JSON.parse(rawBody.toString('utf8')).orderId };
}

// Used by the fake payment page.
const getOrder = (orderId) => orders.get(orderId) || null;

// The buyer pressed a button on the fake payment page.
async function complete(orderId, outcome) {
  const o = orders.get(orderId);
  if (!o) return null;
  if (o.status === 'pending') o.status = outcome === 'success' ? 'paid' : 'failed';
  const body = JSON.stringify({ orderId });
  // Like a real bank, tell the server in the background (fire and forget).
  fetch(o.callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': sign(body) }, body })
    .catch((e) => console.error('[mock-bank] callback failed:', e.message));
  return outcome === 'success' ? o.successUrl : o.failUrl;
}

module.exports = { name, isConfigured, createPayment, getPaymentStatus, refund, verifyCallback, getOrder, complete };
