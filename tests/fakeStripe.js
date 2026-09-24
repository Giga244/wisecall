// A tiny local stand-in for Stripe's API, so the payment flow can be tested without an account.
// The real `stripe` SDK is pointed at it (STRIPE_API_HOST/PORT), so request shapes are real.
const http = require('http');

// "a[b][c]=1" style form keys -> nested object
function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const path = k.replace(/\]/g, '').split('[');
    let cur = out;
    path.forEach((part, i) => {
      if (i === path.length - 1) cur[part] = v;
      else cur = cur[part] = cur[part] || {};
    });
  }
  return out;
}

function createFakeStripe() {
  let n = 0;
  const state = {
    sessions: {}, requests: [], idem: {},
    failTransfers: false,
    accountReady: false
  };
  const next = (p) => `${p}_${++n}`;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = parseForm(raw);
      const key = req.headers['idempotency-key'];
      state.requests.push({ method: req.method, path: url.pathname, body, key });

      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Request-Id': 'req_fake' }); res.end(JSON.stringify(obj)); };
      const idem = (make) => {
        if (key && state.idem[key]) return send(200, state.idem[key]);
        const obj = make();
        if (key) state.idem[key] = obj;
        send(200, obj);
      };
      const route = `${req.method} ${url.pathname}`;
      let m;

      if (route === 'POST /v1/checkout/sessions') {
        return idem(() => {
          const id = next('cs_test');
          const s = {
            id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}`, payment_status: 'unpaid', status: 'open',
            metadata: body.metadata || {}, client_reference_id: body.client_reference_id,
            amount_total: Number(body.line_items[0].price_data.unit_amount), currency: body.line_items[0].price_data.currency,
            payment_intent: null
          };
          state.sessions[id] = s;
          return s;
        });
      }
      if ((m = route.match(/^GET \/v1\/checkout\/sessions\/(.+)$/))) return send(200, state.sessions[m[1]] || { error: { message: 'no such session' } });
      if (route === 'POST /v1/refunds') return idem(() => ({ id: next('re'), object: 'refund', status: 'succeeded', payment_intent: body.payment_intent }));
      if (route === 'POST /v1/transfers') {
        if (state.failTransfers) return send(400, { error: { type: 'invalid_request_error', message: 'Simulated transfer failure' } });
        return idem(() => ({ id: next('tr'), object: 'transfer', amount: Number(body.amount), destination: body.destination }));
      }
      if ((m = route.match(/^POST \/v1\/transfers\/(.+)\/reversals$/))) return idem(() => ({ id: next('trr'), object: 'transfer_reversal', transfer: m[1] }));
      if ((m = route.match(/^GET \/v1\/payment_intents\/(.+)$/))) return send(200, { id: m[1], object: 'payment_intent', latest_charge: 'ch_for_' + m[1] });
      if (route === 'POST /v1/accounts') return idem(() => ({ id: next('acct_test'), object: 'account' }));
      if ((m = route.match(/^GET \/v1\/accounts\/(.+)$/))) {
        return send(200, {
          id: m[1], object: 'account', details_submitted: true, payouts_enabled: state.accountReady,
          capabilities: { transfers: state.accountReady ? 'active' : 'inactive' }
        });
      }
      if (route === 'POST /v1/account_links') return send(200, { object: 'account_link', url: 'https://connect.stripe.test/onboarding' });

      send(404, { error: { message: `Fake Stripe has no route for ${route}` } });
    });
  });

  return {
    state,
    start: () => new Promise((r) => server.listen(0, () => r(server.address().port))),
    stop: () => new Promise((r) => server.close(r)),
    // Simulates the buyer finishing Checkout; returns the values a real event would carry.
    completeSession(id) {
      const s = state.sessions[id];
      s.payment_status = 'paid';
      s.status = 'complete';
      s.payment_intent = s.payment_intent || next('pi');
      return s;
    },
    expireSession(id) { state.sessions[id].status = 'expired'; return state.sessions[id]; },
    calls: (method, pathPrefix) => state.requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix))
  };
}

module.exports = { createFakeStripe };
