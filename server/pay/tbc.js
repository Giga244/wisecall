// TBC Bank (tpay / E-Commerce API), built from https://developers.tbcbank.ge/docs/checkout-api-overview
//   auth     POST  /v1/tpay/access-token        header apikey + form client_id/client_secret -> access_token (1 day)
//   create   POST  /v1/tpay/payments            -> { payId, links: [{ rel: "approval_url", uri }] }
//   status   GET   /v1/tpay/payments/{payId}    -> status: Created|Processing|Succeeded|Failed|Expired|Returned...
//   refund   POST  /v1/tpay/payments/{payId}/cancel   body { amount }
//   callback POST  to callbackUrl with { PaymentId }. TBC does NOT sign it, so it only tells us which
//            payment to look up; the status GET is the only thing we believe.
const config = require('../config');
const { toDecimal, fromDecimal } = require('./money');
const { requestJson, ProviderError } = require('./http');

const name = 'tbc';
const isConfigured = () => Boolean(config.TBC_API_KEY && config.TBC_CLIENT_ID && config.TBC_CLIENT_SECRET);

let token = null;

async function getToken(force = false) {
  if (!force && token && token.expiresAt > Date.now() + 30000) return token.value;
  const res = await requestJson(`${config.TBC_API_URL}/v1/tpay/access-token`, {
    method: 'POST',
    headers: { apikey: config.TBC_API_KEY },
    form: { client_id: config.TBC_CLIENT_ID, client_secret: config.TBC_CLIENT_SECRET }
  });
  if (!res || !res.access_token) throw new ProviderError('TBC did not return an access token');
  const seconds = Math.min(Number(res.expires_in) || 3600, 86400);
  token = { value: res.access_token, expiresAt: Date.now() + seconds * 1000 };
  return token.value;
}

async function call(method, path, json) {
  const send = async (force) => requestJson(config.TBC_API_URL + path, {
    method, json, headers: { apikey: config.TBC_API_KEY, Authorization: `Bearer ${await getToken(force)}` }
  });
  try {
    return await send(false);
  } catch (e) {
    if (e.status === 401) return send(true);
    throw e;
  }
}

// createPayment({ bookingId, amount (tetri), description, callbackUrl, returnUrl, ttlMinutes, language })
async function createPayment({ bookingId, amount, description, callbackUrl, returnUrl, ttlMinutes, language }) {
  const total = toDecimal(amount);
  const res = await call('POST', '/v1/tpay/payments', {
    amount: { currency: 'GEL', total, [config.TBC_SUBTOTAL_FIELD]: total, tax: 0, shipping: 0 },
    returnurl: returnUrl,
    callbackUrl,
    merchantPaymentId: bookingId,
    description: String(description || 'Wisecall').slice(0, 30),
    expirationMinutes: Math.min(ttlMinutes, config.TBC_MAX_EXPIRATION_MINUTES), // (B1: never more than TBC accepts)
    language: language === 'ka' ? 'KA' : 'EN'
  });
  const link = res && Array.isArray(res.links) ? res.links.find((l) => l.rel === 'approval_url') : null;
  if (!res || !res.payId || !link) throw new ProviderError('TBC payment response was missing the payment id or approval link');
  return { orderId: res.payId, redirectUrl: link.uri };
}

const STATUS_MAP = {
  created: 'pending', processing: 'pending', waitingconfirm: 'pending', paymentcompletionprocessing: 'pending',
  succeeded: 'paid',
  failed: 'failed',
  expired: 'expired',
  cancelpaymentprocessing: 'refund_pending',
  returned: 'refunded',
  partialreturned: 'refunded_partially'
};

async function getPaymentStatus(orderId) {
  const d = await call('GET', `/v1/tpay/payments/${encodeURIComponent(orderId)}`);
  if (!d) throw new ProviderError('TBC returned an empty payment record');
  const key = String(d.status || '').toLowerCase();
  return {
    status: STATUS_MAP[key] || 'pending',
    amount: d.amount === undefined || d.amount === null ? null : fromDecimal(d.amount),
    currency: d.currency ? String(d.currency).toLowerCase() : null,
    returned: d.returnedAmount === undefined || d.returnedAmount === null ? null : fromDecimal(d.returnedAmount),
    raw: key
  };
}

// TBC returns the money with a "cancel" request for an amount. Later status lookups show "Returned" (and returnedAmount). TBC has no
// idempotency key: a cancel that is sent twice returns the money twice, so a lost answer is settled by a status check, never by asking again.
const idempotentRefunds = false;
async function refund({ orderId, amount }) {
  await call('POST', `/v1/tpay/payments/${encodeURIComponent(orderId)}/cancel`, { amount: toDecimal(amount) });
  return { refundId: orderId };
}

function verifyCallback({ rawBody }) {
  let payload;
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)); } catch (e) { throw new ProviderError('callback body is not JSON'); }
  const orderId = payload && (payload.PaymentId || payload.paymentId || payload.payId);
  if (typeof orderId !== 'string' || !orderId) throw new ProviderError('callback has no PaymentId');
  return { orderId, unsigned: true };
}

// For the launch check: proves the credentials work by asking the bank for an access token.
async function ping() {
  await getToken(true);
  return 'the bank issued an access token';
}

module.exports = { name, isConfigured, createPayment, getPaymentStatus, refund, verifyCallback, ping, idempotentRefunds };
