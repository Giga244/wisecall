// A fake Flitt for tests (https://docs.flitt.com, protocol 1.0.1): checkout, order status, reversals (partial ones, and reverse_id that
// makes a repeated request return the first result) and IBAN payouts (signed with the payout key; the test IBANs ...0001 approved,
// ...0002 declined, ...0003 processing, as on Flitt's Testing page). It checks every signature and records every call.
const http = require('http');
const crypto = require('crypto');

const MERCHANT_ID = 1549901;
const SECRET = 'test';
const PAYOUT_SECRET = 'testcredit';

function signature(params, secret) {
  const values = Object.keys(params).filter((k) => k !== 'signature' && k !== 'response_signature_string').sort()
    .map((k) => params[k]).filter((v) => v !== undefined && v !== null && String(v) !== '').map(String);
  return crypto.createHash('sha1').update([secret, ...values].join('|'), 'utf8').digest('hex');
}

function createFakeFlitt() {
  const state = { orders: new Map(), payouts: new Map(), calls: [], reverses: new Map(), loseNextReverseAnswer: false, payoutDown: false };
  let server = null;
  const signed = (r, secret = SECRET) => ({ ...r, signature: signature(r, secret) });
  const fail = (code, message) => ({ response: { response_status: 'failure', error_code: code, error_message: message } });

  async function handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { body = {}; }
    const r = body.request || {};
    const path = req.url.split('?')[0];
    state.calls.push({ path, request: r });
    const send = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    // (a status request may be about a payment or a payout: signed with the key of either)
    const payout = path === '/api/ibancredit' || (path === '/api/status/order_id' && (state.payouts.has(r.order_id) || r.signature === signature(r, PAYOUT_SECRET)));
    if (Number(r.merchant_id) !== MERCHANT_ID) return send(fail(1006, 'Invalid merchant_id'));
    if (r.signature !== signature(r, payout ? PAYOUT_SECRET : SECRET)) return send(fail(1007, 'Parameter `signature` is incorrect'));

    if (path === '/api/checkout/url') {
      if (state.orders.has(r.order_id)) return send(fail(1013, 'Duplicate order_id'));
      const paymentId = String(800000000 + state.orders.size);
      state.orders.set(r.order_id, { order_id: r.order_id, payment_id: paymentId, amount: Number(r.amount), currency: r.currency, status: 'created', reversed: 0, request: r });
      return send({ response: { response_status: 'success', checkout_url: `https://pay.flitt.example/merchants/checkout?token=${paymentId}`, payment_id: paymentId } });
    }
    if (path === '/api/status/order_id') {
      const p = state.payouts.get(r.order_id);
      if (p) return send({ response: signed({ response_status: 'success', order_id: p.order_id, merchant_id: MERCHANT_ID, order_status: p.status, payment_id: p.payment_id, amount: String(p.amount), currency: 'GEL', tran_type: 'p2p credit' }, PAYOUT_SECRET) });
      const o = state.orders.get(r.order_id);
      if (!o) return send(fail(1018, 'Order not found'));
      return send({ response: signed({ response_status: 'success', order_id: o.order_id, merchant_id: MERCHANT_ID, order_status: o.status, payment_id: o.payment_id,
        amount: String(o.amount), actual_amount: o.status === 'created' ? '' : String(o.amount), currency: 'GEL', reversal_amount: String(o.reversed), tran_type: 'purchase' }) });
    }
    if (path === '/api/reverse/order_id') {
      const o = state.orders.get(r.order_id);
      if (!o) return send(fail(1018, 'Order not found'));
      // (the same reverse_id again: the first result, nothing returned twice)
      if (r.reverse_id && state.reverses.has(r.reverse_id)) return send({ response: state.reverses.get(r.reverse_id) });
      const amount = Number(r.amount);
      if (!['approved', 'reversed'].includes(o.status) || o.reversed + amount > o.amount) {
        return send({ response: { response_status: 'success', reverse_status: 'declined', order_id: o.order_id, response_code: 1036, response_description: 'Reversal amount is greater than allowed' } });
      }
      o.reversed += amount;
      if (o.reversed >= o.amount) o.status = 'reversed';
      const out = signed({ response_status: 'success', reverse_status: 'approved', order_id: o.order_id, merchant_id: MERCHANT_ID, reverse_id: r.reverse_id || '', reversal_amount: String(amount) });
      if (r.reverse_id) state.reverses.set(r.reverse_id, out);
      if (state.loseNextReverseAnswer) { state.loseNextReverseAnswer = false; return send({ message: 'gateway timeout' }, 504); }
      return send({ response: out });
    }
    if (path === '/api/ibancredit') {
      if (state.payoutDown) return send({ message: 'unavailable' }, 503);
      if (r.currency !== 'GEL') return send(fail(1011, 'Only GEL'));
      if (state.payouts.has(r.order_id)) return send(fail(1013, 'Duplicate order_id'));
      const status = /0002$/.test(r.receiver_iban) ? 'declined' : (/0003$/.test(r.receiver_iban) ? 'processing' : 'approved');
      const p = { order_id: r.order_id, payment_id: String(900000000 + state.payouts.size), amount: Number(r.amount), status, iban: r.receiver_iban, name: r.receiver_name, request: r };
      state.payouts.set(r.order_id, p);
      return send({ response: signed({ response_status: 'success', order_id: p.order_id, merchant_id: MERCHANT_ID, order_status: status, payment_id: p.payment_id, amount: String(p.amount), currency: 'GEL', tran_type: 'p2p credit', payment_system: 'iban' }, PAYOUT_SECRET) });
    }
    return send({ message: 'unknown endpoint' }, 404);
  }

  return {
    MERCHANT_ID, SECRET, PAYOUT_SECRET, state, signature,
    get url() { return `http://127.0.0.1:${server.address().port}`; },
    start: () => new Promise((resolve) => { server = http.createServer((req, res) => { handle(req, res).catch(() => { res.writeHead(500); res.end(); }); }); server.listen(0, '127.0.0.1', resolve); }),
    stop: () => new Promise((resolve) => server.close(resolve)),
    // The buyer paid (or not) on Flitt's page.
    pay(orderId, status = 'approved') { const o = state.orders.get(orderId); o.status = status; return o; },
    setPayout(orderId, status) { state.payouts.get(orderId).status = status; },
    // The callback Flitt would send for an order (a purchase, or a payout with the payout key).
    callbackFor(orderId, { payout = false, tamper = false } = {}) {
      const o = payout ? state.payouts.get(orderId) : state.orders.get(orderId);
      const body = { order_id: orderId, merchant_id: MERCHANT_ID, order_status: o.status, amount: String(o.amount), currency: 'GEL', payment_id: o.payment_id, response_status: 'success' };
      body.signature = signature(body, payout ? PAYOUT_SECRET : SECRET);
      if (tamper) body.order_status = body.order_status === 'approved' ? 'declined' : 'approved';
      return body;
    }
  };
}

module.exports = { createFakeFlitt, signature, MERCHANT_ID, SECRET, PAYOUT_SECRET };
