// A fake bank for tests. One HTTP server that speaks the BOG Payments API and the TBC tpay API the
// way their official docs describe, so the real provider code (server/pay/bog.js and tbc.js) is what
// gets exercised. Callbacks are signed with a throwaway RSA key, which the server under test is
// told to trust through BOG_CALLBACK_PUBLIC_KEY.
const http = require('http');
const crypto = require('crypto');

const BOG_ID = 'bog_client_id_test';
const BOG_SECRET = 'bog_client_secret_test';
const TBC_KEY = 'tbc_api_key_test';
const TBC_ID = 'tbc_client_id_test';
const TBC_SECRET = 'tbc_client_secret_test';

function createFakeBank() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const state = {
    bog: new Map(),      // order id -> { id, status, amount, currency, refundAmount, request }
    tbc: new Map(),      // pay id -> { payId, status, amount, request }
    calls: [],           // every request received: { method, path, headers, body }
    tokens: new Set(),
    tokenRequests: 0,
    failOrders: false,   // make order creation fail (bank outage)
    rejectRefunds: false // make refund requests fail
  };
  let counter = 0;
  let server;
  let port;

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const bearerOk = (req) => state.tokens.has(String(req.headers.authorization || '').replace(/^Bearer /, ''));

  async function handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    let body = null;
    const type = String(req.headers['content-type'] || '');
    if (raw && type.includes('json')) { try { body = JSON.parse(raw); } catch (e) { /* ignore */ } }
    if (raw && type.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
    state.calls.push({ method: req.method, path, headers: req.headers, body });

    // ---- BOG ----
    if (req.method === 'POST' && path === '/bog-oauth/token') {
      const expected = 'Basic ' + Buffer.from(`${BOG_ID}:${BOG_SECRET}`).toString('base64');
      if (req.headers.authorization !== expected || !body || body.grant_type !== 'client_credentials') return send(res, 401, { error: 'invalid_client' });
      state.tokenRequests += 1;
      const token = `bog-token-${++counter}`;
      state.tokens.add(token);
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }
    if (path.startsWith('/payments/v1/')) {
      if (!bearerOk(req)) return send(res, 401, { message: 'invalid token' });
      if (req.method === 'POST' && path === '/payments/v1/ecommerce/orders') {
        if (state.failOrders) return send(res, 503, { message: 'bank is down' });
        const pu = body && body.purchase_units;
        if (!body || !body.callback_url || !pu || typeof pu.total_amount !== 'number' || !Array.isArray(pu.basket) || !body.redirect_urls) {
          return send(res, 400, { message: 'invalid order request' });
        }
        const id = `bog-order-${++counter}`;
        state.bog.set(id, { id, status: 'created', amount: pu.total_amount, currency: pu.currency || 'GEL', refundAmount: 0, request: body });
        return send(res, 200, { id, _links: { details: { href: `http://localhost:${port}/payments/v1/receipt/${id}` }, redirect: { href: `http://localhost:${port}/pay/${id}` } } });
      }
      const receipt = path.match(/^\/payments\/v1\/receipt\/([^/]+)$/);
      if (req.method === 'GET' && receipt) {
        const o = state.bog.get(receipt[1]);
        if (!o) return send(res, 404, { message: 'not found' });
        return send(res, 200, {
          order_id: o.id, industry: 'ecommerce', capture: 'automatic', external_order_id: o.request.external_order_id,
          order_status: { key: o.status, value: o.status },
          purchase_units: {
            request_amount: String(o.amount), transfer_amount: o.status === 'refunded' ? '0.0' : String(o.amount),
            refund_amount: String(o.refundAmount), currency_code: o.currency, items: []
          },
          reject_reason: o.status === 'rejected' ? (o.rejectReason || 'insufficient funds') : null
        });
      }
      const refund = path.match(/^\/payments\/v1\/payment\/refund\/([^/]+)$/);
      if (req.method === 'POST' && refund) {
        const o = state.bog.get(refund[1]);
        if (!o) return send(res, 404, { message: 'not found' });
        if (state.rejectRefunds || o.status !== 'completed') return send(res, 400, { key: 'refund_rejected', message: 'cannot refund' });
        o.status = 'refund_requested';
        o.refundAmount = o.amount;
        o.refundIdempotencyKey = req.headers['idempotency-key'];
        return send(res, 200, { key: 'request_received', message: 'Refund request received', action_id: `bog-action-${++counter}` });
      }
      return send(res, 404, { message: 'unknown endpoint' });
    }

    // ---- TBC ----
    if (path.startsWith('/v1/tpay/')) {
      if (req.headers.apikey !== TBC_KEY) return send(res, 401, { message: 'invalid api key' });
      if (req.method === 'POST' && path === '/v1/tpay/access-token') {
        if (!body || body.client_id !== TBC_ID || body.client_secret !== TBC_SECRET) return send(res, 401, { message: 'invalid client' });
        state.tokenRequests += 1;
        const token = `tbc-token-${++counter}`;
        state.tokens.add(token);
        return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 86400 });
      }
      if (!bearerOk(req)) return send(res, 401, { message: 'invalid token' });
      if (req.method === 'POST' && path === '/v1/tpay/payments') {
        if (state.failOrders) return send(res, 503, { message: 'bank is down' });
        if (!body || !body.amount || body.amount.currency !== 'GEL' || typeof body.amount.total !== 'number' || !body.returnurl) return send(res, 400, { message: 'invalid payment request' });
        const payId = `tpay-${++counter}`;
        state.tbc.set(payId, { payId, status: 'Created', amount: body.amount.total, request: body });
        return send(res, 200, { payId, status: 'Created', links: [{ uri: `http://localhost:${port}/checkout/${payId}`, rel: 'approval_url', method: 'REDIRECT' }] });
      }
      const details = path.match(/^\/v1\/tpay\/payments\/([^/]+)$/);
      if (req.method === 'GET' && details) {
        const p = state.tbc.get(details[1]);
        if (!p) return send(res, 404, { message: 'not found' });
        return send(res, 200, { payId: p.payId, status: p.status, currency: 'GEL', amount: p.amount, returnedAmount: p.returned || 0 });
      }
      const cancel = path.match(/^\/v1\/tpay\/payments\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancel) {
        const p = state.tbc.get(cancel[1]);
        if (!p) return send(res, 404, { message: 'not found' });
        if (state.rejectRefunds || p.status !== 'Succeeded') return send(res, 400, { resultCode: 'cannot_cancel' });
        p.status = 'CancelPaymentProcessing';
        p.returned = body && body.amount;
        return send(res, 200, {});
      }
      return send(res, 404, { message: 'unknown endpoint' });
    }
    return send(res, 404, { message: 'unknown endpoint' });
  }

  return {
    state,
    BOG_ID, BOG_SECRET, TBC_KEY, TBC_ID, TBC_SECRET,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    start() {
      return new Promise((resolve) => {
        server = http.createServer((req, res) => handle(req, res).catch((e) => { send(res, 500, { message: e.message }); }));
        server.listen(0, () => { port = server.address().port; resolve(port); });
      });
    },
    stop: () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())),
    get url() { return `http://localhost:${port}`; },

    // --- what the buyer/bank does ---
    bogSet(id, status, extra = {}) { Object.assign(state.bog.get(id), { status }, extra); },
    bogFinishRefund(id) { state.bog.get(id).status = 'refunded'; },
    tbcSet(payId, status, extra = {}) { Object.assign(state.tbc.get(payId), { status }, extra); },
    // Invalidates every issued token, as if they had all expired early.
    expireTokens() { state.tokens.clear(); },

    // A BOG callback exactly as BOG sends it: raw JSON body plus a SHA256withRSA signature header.
    bogCallback(orderId, { tamper = false, signWith = privateKey } = {}) {
      const body = JSON.stringify({ event: 'order_payment', zoned_request_time: new Date().toISOString(), body: { order_id: orderId, industry: 'ecommerce' } });
      const signature = crypto.sign('RSA-SHA256', Buffer.from(body), signWith).toString('base64');
      return { body: tamper ? body.replace(orderId, orderId + 'x') : body, headers: { 'content-type': 'application/json', 'callback-signature': signature } };
    },
    // A signature made with some other key (a forger who does not have BOG's private key).
    forgedKey: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  };
}

module.exports = { createFakeBank };
