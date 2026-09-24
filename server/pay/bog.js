// Bank of Georgia (BOG Payments API), built from the official docs at https://api.bog.ge/docs/en/
//   auth     POST  {BOG_AUTH_URL}                        client_id:client_secret (HTTP Basic) -> Bearer token
//   create   POST  /payments/v1/ecommerce/orders         -> { id, _links.redirect.href }
//   status   GET   /payments/v1/receipt/{order_id}       -> order_status.key, purchase_units.request_amount ...
//   refund   POST  /payments/v1/payment/refund/{order_id}  (asynchronous: "request_received")
//   callback POST  to callback_url, signed: header Callback-Signature = SHA256withRSA(raw body)
const crypto = require('crypto');
const config = require('../config');
const { toDecimal, fromDecimal } = require('./money');
const { requestJson, ProviderError } = require('./http');

// BOG's published public key for callback signatures (from their callback documentation).
const BOG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`;

const name = 'bog';
const isConfigured = () => Boolean(config.BOG_CLIENT_ID && config.BOG_CLIENT_SECRET);

let token = null; // { value, expiresAt }

async function getToken(force = false) {
  if (!force && token && token.expiresAt > Date.now() + 30000) return token.value;
  const basic = Buffer.from(`${config.BOG_CLIENT_ID}:${config.BOG_CLIENT_SECRET}`).toString('base64');
  const res = await requestJson(config.BOG_AUTH_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
    form: { grant_type: 'client_credentials' }
  });
  if (!res || !res.access_token) throw new ProviderError('BOG did not return an access token');
  // The docs' example shows an implausible expires_in, so never trust more than one hour.
  const seconds = Math.min(Number(res.expires_in) || 300, 3600);
  token = { value: res.access_token, expiresAt: Date.now() + seconds * 1000 };
  return token.value;
}

async function call(method, path, { json, headers = {} } = {}) {
  const send = async (force) => requestJson(config.BOG_API_URL + path, {
    method, json, headers: { Authorization: `Bearer ${await getToken(force)}`, 'Accept-Language': 'en', ...headers }
  });
  try {
    return await send(false);
  } catch (e) {
    if (e.status === 401) return send(true); // token expired early: fetch a fresh one once
    throw e;
  }
}

// A deterministic UUID, so retrying the same refund reuses BOG's Idempotency-Key.
function uuidFrom(text) {
  const h = crypto.createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// createPayment({ bookingId, amount (tetri), description, callbackUrl, successUrl, failUrl, ttlMinutes })
async function createPayment({ bookingId, amount, callbackUrl, successUrl, failUrl, ttlMinutes }) {
  const total = toDecimal(amount);
  const res = await call('POST', '/payments/v1/ecommerce/orders', {
    json: {
      callback_url: callbackUrl,
      external_order_id: bookingId,
      capture: 'automatic',
      ttl: ttlMinutes,
      purchase_units: {
        currency: 'GEL',
        total_amount: total,
        basket: [{ product_id: 'wisecall-advice', quantity: 1, unit_price: total }]
      },
      redirect_urls: { success: successUrl, fail: failUrl }
    }
  });
  const redirectUrl = res && res._links && res._links.redirect && res._links.redirect.href;
  if (!res || !res.id || !redirectUrl) throw new ProviderError('BOG order response was missing the order id or redirect link');
  return { orderId: res.id, redirectUrl };
}

const STATUS_MAP = {
  created: 'pending', processing: 'pending', auth_requested: 'pending', blocked: 'pending', partial_completed: 'pending',
  completed: 'paid',
  rejected: 'failed',
  refund_requested: 'refund_pending',
  refunded: 'refunded',
  refunded_partially: 'refunded_partially'
};

// -> { status: pending|paid|failed|expired|refund_pending|refunded|refunded_partially, amount (tetri), currency }
async function getPaymentStatus(orderId) {
  const d = await call('GET', `/payments/v1/receipt/${encodeURIComponent(orderId)}`);
  if (!d) throw new ProviderError('BOG returned an empty payment record');
  const key = String((d.order_status && d.order_status.key) || d.order_status || '').toLowerCase();
  let status = STATUS_MAP[key] || 'pending';
  if (status === 'failed' && d.reject_reason === 'expiration') status = 'expired';
  const units = Array.isArray(d.purchase_units) ? d.purchase_units[0] : d.purchase_units;
  return {
    status,
    // request_amount is what the order asked for; transfer_amount drops to 0 after a refund.
    amount: units ? fromDecimal(units.request_amount) : null,
    currency: units && units.currency_code ? String(units.currency_code).toLowerCase() : null,
    raw: key
  };
}

// Asks BOG to refund the whole order. BOG accepts the request first; the order later becomes
// "refunded", which getPaymentStatus reports.
async function refund({ orderId, idempotencyKey }) {
  const res = await call('POST', `/payments/v1/payment/refund/${encodeURIComponent(orderId)}`, {
    json: {}, headers: { 'Idempotency-Key': uuidFrom(idempotencyKey) }
  });
  return { refundId: (res && res.action_id) || null };
}

// Checks that a callback really came from BOG. It only proves authenticity and names the order;
// the caller must still ask getPaymentStatus before trusting anything about the payment.
function verifyCallback({ rawBody, headers }) {
  const signature = headers['callback-signature'];
  if (!signature || !Buffer.isBuffer(rawBody)) throw new ProviderError('missing callback signature');
  const key = config.BOG_CALLBACK_PUBLIC_KEY || BOG_PUBLIC_KEY;
  let ok = false;
  try {
    ok = crypto.verify('RSA-SHA256', rawBody, key, Buffer.from(String(signature), 'base64'));
  } catch (e) { ok = false; }
  if (!ok) throw new ProviderError('invalid callback signature');

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch (e) { throw new ProviderError('callback body is not JSON'); }
  const orderId = payload && payload.body && payload.body.order_id;
  if (payload.event !== 'order_payment' || typeof orderId !== 'string') throw new ProviderError('unexpected callback payload');
  return { orderId };
}

// For the launch check: proves the credentials work by asking the bank for an access token.
async function ping() {
  await getToken(true);
  return 'the bank issued an access token';
}

module.exports = { name, isConfigured, createPayment, getPaymentStatus, refund, verifyCallback, ping };
