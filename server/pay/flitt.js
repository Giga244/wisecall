// Flitt (flitt.com, TBC's payment company), built from https://docs.flitt.com (protocol 1.0.1, JSON, every request wrapped in
// { request: {...} } and every answer in { response: {...} }; amounts in tetri):
//   create   POST /api/checkout/url        -> { checkout_url, payment_id }        the buyer pays on Flitt's page
//   status   POST /api/status/order_id     -> { order_status, amount, actual_amount, reversal_amount, ... }
//   refund   POST /api/reverse/order_id    { amount, currency, reverse_id }  -> { reverse_status }   (partial ones allowed, up to the
//            amount paid; reverse_id makes a retry safe: the same id is never returned twice)
//   payout   POST /api/ibancredit          { amount, currency: GEL, receiver_iban, receiver_name } (signed with the payout key)
//   callback POST (JSON) to server_callback_url, from 54.154.216.60 or 3.75.125.89, signed like every answer. Even a genuine callback only
//            names the order: the status request is the only thing we believe.
// Signature: SHA-1 (lowercase hex) of the secret key and every non-empty parameter except `signature` (and
// `response_signature_string`), in the alphabetical order of their names, joined with "|".
const crypto = require('crypto');
const config = require('../config');
const { requestJson, ProviderError } = require('./http');

const name = 'flitt';
const isConfigured = () => Boolean(config.FLITT_MERCHANT_ID && config.FLITT_SECRET_KEY);
const VERSION = '1.0.1';

function signature(params, secret) {
  const values = Object.keys(params).filter((k) => k !== 'signature' && k !== 'response_signature_string').sort()
    .map((k) => params[k]).filter((v) => v !== undefined && v !== null && String(v) !== '')
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  return crypto.createHash('sha1').update([secret, ...values].join('|'), 'utf8').digest('hex');
}
// Constant time, and only for a well-formed signature.
function signatureOk(params, secret) {
  const given = String((params && params.signature) || '');
  if (!/^[0-9a-f]{40}$/i.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given.toLowerCase()), Buffer.from(signature(params, secret)));
}

// One signed request; Flitt answers 200 with response_status "failure" for a refusal, which is thrown with a 4xx-like status (422), so a
// refusal is told apart from an answer that was lost (server/payments.js never sends a lost one again without a status check).
async function call(path, params, secret = config.FLITT_SECRET_KEY) {
  const request = { version: VERSION, merchant_id: Number(config.FLITT_MERCHANT_ID), ...params };
  request.signature = signature(request, secret);
  const data = await requestJson(config.FLITT_API_URL + path, { method: 'POST', json: { request } });
  const r = data && data.response;
  if (!r) throw new ProviderError(`Flitt ${path}: an empty answer`);
  if (r.response_status !== 'success') {
    throw new ProviderError(`Flitt ${path} refused: ${r.error_code || ''} ${String(r.error_message || '').slice(0, 200)}`.trim(), { status: 422, body: r });
  }
  // (an answer to our own HTTPS request comes from Flitt itself; callbacks, which anyone can send, are the ones checked: verifyCallback)
  return r;
}

// A new order id for every payment attempt (Flitt refuses an order id it has seen): what it is for, then a random part.
const orderIdFor = (id) => `wc-${String(id).replace(/[^0-9a-z-]/gi, '').slice(0, 36)}-${crypto.randomBytes(5).toString('hex')}`;

// createPayment({ bookingId, amount (tetri), description, callbackUrl, returnUrl, ttlMinutes, language }) -> { orderId, redirectUrl }
// Flitt sends the buyer back with a POST to response_url: it goes to /api/payments/flitt/return, which sends the browser on to returnUrl.
async function createPayment({ bookingId, amount, description, callbackUrl, returnUrl, successUrl, ttlMinutes, language }) {
  const orderId = orderIdFor(bookingId);
  const back = returnUrl || successUrl;
  const r = await call('/api/checkout/url', {
    order_id: orderId,
    order_desc: String(description || 'Wisecall').slice(0, 200),
    amount: Number(amount),
    currency: 'GEL',
    server_callback_url: callbackUrl,
    response_url: `${config.PUBLIC_URL}/api/payments/flitt/return?next=${encodeURIComponent(back)}`,
    lifetime: Math.max(300, Math.round(Number(ttlMinutes || 30) * 60)),
    lang: language === 'ka' ? 'ka' : 'en'
  });
  if (!r.checkout_url) throw new ProviderError('Flitt did not return a checkout address');
  return { orderId, redirectUrl: r.checkout_url };
}

const STATUS_MAP = { created: 'pending', processing: 'pending', approved: 'paid', declined: 'failed', expired: 'expired', reversed: 'refunded' };
const int = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(v)));

// -> { status, amount (tetri), currency, returned (tetri returned so far) }
async function getPaymentStatus(orderId) {
  const r = await call('/api/status/order_id', { order_id: orderId });
  const key = String(r.order_status || '').toLowerCase();
  const paid = int(r.actual_amount) || int(r.amount);
  const returned = int(r.reversal_amount) || 0;
  let status = STATUS_MAP[key] || 'pending';
  if (status === 'paid' && returned > 0) status = paid && returned >= paid ? 'refunded' : 'refunded_partially';
  return { status, amount: int(r.amount), currency: r.currency ? String(r.currency).toLowerCase() : null, returned, raw: key };
}

// A reversal of `amount` tetri (the whole order or part of it). The reverse id comes from the caller's idempotency key (one per booking
// and kind of refund), so asking again after a lost answer can never return the money twice.
const reverseIdFor = (key) => crypto.createHash('sha1').update(String(key)).digest('hex');
async function refund({ orderId, amount, idempotencyKey }) {
  const reverseId = reverseIdFor(idempotencyKey || `${orderId}-${amount}`);
  const r = await call('/api/reverse/order_id', { order_id: orderId, amount: Number(amount), currency: 'GEL', reverse_id: reverseId, comment: 'Wisecall refund' });
  if (String(r.reverse_status).toLowerCase() === 'declined') {
    throw new ProviderError(`Flitt declined the refund: ${r.response_code || ''} ${String(r.response_description || '').slice(0, 200)}`.trim(), { status: 422, body: r });
  }
  return { refundId: reverseId };
}
const idempotentRefunds = true;

// A callback is believed only from Flitt's servers (FLITT_CALLBACK_IPS) and only with a correct signature; then it just names the order.
function fromFlitt(ip) {
  const allowed = config.FLITT_CALLBACK_IPS;
  if (!allowed.length) return true;
  const plain = String(ip || '').replace(/^::ffff:/, '');
  return allowed.includes(plain);
}
function parseBody(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  try { const j = JSON.parse(text); return j && j.response ? j.response : j; } catch (e) { /* a form */ }
  return Object.fromEntries(new URLSearchParams(text));
}
function verifyCallback({ rawBody, ip }, secret = config.FLITT_SECRET_KEY) {
  if (!fromFlitt(ip)) throw new ProviderError(`callback from an address that is not Flitt's (${ip})`);
  const payload = parseBody(rawBody);
  if (!payload || typeof payload.order_id !== 'string' || !payload.order_id) throw new ProviderError('callback has no order_id');
  if (String(payload.merchant_id) !== String(config.FLITT_MERCHANT_ID)) throw new ProviderError('callback for another merchant');
  if (!signatureOk(payload, secret)) throw new ProviderError('invalid callback signature');
  return { orderId: payload.order_id };
}

// ---- Payouts to a mentor's IBAN (server/payoutMethods: flitt_iban) ---------------------------------------------------------------------
// Signed with the payout key. The order id is the payout's own (one per withdrawal request), so sending it again can never pay twice:
// Flitt refuses an order id it has already seen.
async function ibanCredit({ orderId, amount, iban, receiverName, description, callbackUrl }) {
  const r = await call('/api/ibancredit', {
    order_id: orderId, order_desc: String(description || 'Wisecall payout').slice(0, 200), amount: Number(amount), currency: 'GEL',
    receiver_iban: iban, receiver_name: String(receiverName || '').slice(0, 200), server_callback_url: callbackUrl
  }, config.FLITT_PAYOUT_SECRET_KEY);
  return payoutView(r);
}
// [VERIFY with Flitt: the docs name no separate status request for payouts; the order status request, signed with the payout key, is used.]
async function payoutStatus(orderId) {
  return payoutView(await call('/api/status/order_id', { order_id: orderId }, config.FLITT_PAYOUT_SECRET_KEY));
}
const PAYOUT_STATUS = { approved: 'paid', declined: 'failed', expired: 'failed', reversed: 'failed', created: 'sending', processing: 'sending' };
const payoutView = (r) => ({ status: PAYOUT_STATUS[String(r.order_status || '').toLowerCase()] || 'sending', reference: r.payment_id ? String(r.payment_id) : null,
  reason: [r.response_code, r.response_description].filter(Boolean).join(' ') || null, raw: String(r.order_status || '') });
const verifyPayoutCallback = (args) => verifyCallback(args, config.FLITT_PAYOUT_SECRET_KEY);

// For the launch check: a status request for an order that does not exist must be refused for that reason, not for the key.
async function ping() {
  try {
    await call('/api/status/order_id', { order_id: 'wisecall-launch-check' });
    return 'the merchant answered';
  } catch (e) {
    const b = e.body || {};
    if (/signature/i.test(String(b.error_message)) || String(b.error_code) === '1007') throw new Error('Flitt rejected the signature: check FLITT_SECRET_KEY');
    if (/merchant/i.test(String(b.error_message))) throw new Error('Flitt does not know this merchant: check FLITT_MERCHANT_ID');
    if (e.status === 422) return 'the merchant id and the key are accepted';
    throw e;
  }
}

module.exports = { name, isConfigured, createPayment, getPaymentStatus, refund, verifyCallback, ping, idempotentRefunds,
  ibanCredit, payoutStatus, verifyPayoutCallback, signature, signatureOk, reverseIdFor };
