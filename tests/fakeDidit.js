// A fake Didit for tests: speaks the documented API (create session, fetch decision) and can send
// webhooks signed exactly the way Didit signs them (X-Signature-V2 over the canonical JSON, X-Signature
// over the raw bytes, X-Timestamp), so the real server/kyc/didit.js is what gets exercised.
const http = require('http');
const crypto = require('crypto');

const API_KEY = 'didit_api_key_test';
const WORKFLOW = 'workflow-test-1';
const SECRET = 'didit_webhook_secret_test';

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const hmac = (data, secret = SECRET) => crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');

function createFakeDidit() {
  const sessions = new Map(); // id -> { id, vendorData, callback, status, decision }
  const calls = [];
  const options = { hugeLinks: false, alwaysNew: false, forceSessionId: null, refuse: null }; // (a link too long for a QR code; no reuse of unfinished sessions; a chosen id;
  // refuse: { status, body } answers every new session with that error, as Didit does when the balance is empty)
  let server, port, counter = 0;

  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  async function handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (e) { /* ignore */ }
    calls.push({ method: req.method, path: req.url, headers: req.headers, body });
    if (req.headers['x-api-key'] !== API_KEY) return send(res, 401, { detail: 'invalid api key' });

    if (req.method === 'POST' && req.url === '/v3/session/') {
      if (!body || body.workflow_id !== WORKFLOW || !body.vendor_data) return send(res, 400, { detail: 'bad request' });
      if (options.refuse) return send(res, options.refuse.status, options.refuse.body);
      // (as Didit documents: an unfinished session for the same person comes back, with a 201, instead of a new one)
      const unfinished = [...sessions.values()].find((s) => s.vendorData === body.vendor_data && ['Not Started', 'In Progress', 'Resubmitted', 'Awaiting User'].includes(s.status));
      if (unfinished && !options.alwaysNew) {
        unfinished.callback = body.callback;
        return send(res, 201, { session_id: unfinished.id, session_token: 'tok', url: `http://localhost:${port}/verify/${unfinished.id}${options.hugeLinks ? `?x=${'a'.repeat(5000)}` : ''}` });
      }
      const id = options.forceSessionId || `didit-session-${++counter}`;
      sessions.set(id, { id, vendorData: body.vendor_data, callback: body.callback, status: 'Not Started', decision: {} });
      return send(res, 201, { session_id: id, session_token: 'tok', url: `http://localhost:${port}/verify/${id}${options.hugeLinks ? `?x=${'a'.repeat(5000)}` : ''}` });
    }
    const m = req.url.match(/^\/v3\/session\/([^/]+)\/decision\/$/);
    if (req.method === 'GET' && m) {
      const s = sessions.get(m[1]);
      if (!s) return send(res, 404, { detail: 'not found' });
      // On this endpoint the arrays are at the root.
      return send(res, 200, { session_id: s.id, vendor_data: s.vendorData, status: s.status, ...s.decision });
    }
    send(res, 404, { detail: 'unknown' });
  }

  // A complete, approved decision for a person (ID + liveness + face match, all approved).
  const approvedDecision = ({ fullName = 'Nino Beridze', dateOfBirth = '1990-05-12', country = 'GEO' } = {}) => ({
    id_verifications: [{ status: 'Approved', document_type: 'Identity Card', document_number: 'SECRET-DOC-NUMBER', full_name: fullName, first_name: fullName.split(' ')[0], last_name: fullName.split(' ').slice(1).join(' '), date_of_birth: dateOfBirth, issuing_state: country, front_image: 'https://img.example/secret-front.jpg' }],
    liveness_checks: [{ status: 'Approved' }],
    face_matches: [{ status: 'Approved' }]
  });

  return {
    options,
    API_KEY, WORKFLOW, SECRET, calls, sessions,
    start: () => new Promise((resolve) => { server = http.createServer((q, r) => handle(q, r).catch((e) => send(r, 500, { detail: e.message }))); server.listen(0, () => { port = server.address().port; resolve(port); }); }),
    stop: () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())),
    get url() { return `http://localhost:${port}`; },
    approvedDecision,

    // Sets the result the fake holds for a session (what a later status lookup returns).
    setResult(id, status, decision = {}) { Object.assign(sessions.get(id), { status, decision }); },

    // The webhook exactly as Didit sends it. Returns { body (string), headers }.
    webhook(id, status, decision, { eventId = `evt-${++counter}`, timestamp = Math.floor(Date.now() / 1000), secret = SECRET, tamper = false, dropV2 = false, rawOnly = false, vendorData } = {}) {
      const s = sessions.get(id);
      if (s) s.status = status; // (a finished session is not given out again)
      const payload = { event_id: eventId, webhook_type: 'status.updated', timestamp, application_id: 'app', environment: 'sandbox', status, session_id: id, workflow_id: WORKFLOW, vendor_data: vendorData || (s && s.vendorData), decision };
      const raw = JSON.stringify(payload);
      const headers = { 'content-type': 'application/json', 'x-timestamp': String(timestamp) };
      if (!dropV2 && !rawOnly) headers['x-signature-v2'] = hmac(JSON.stringify(sortKeys(payload)), secret);
      if (!dropV2 || rawOnly) headers['x-signature'] = hmac(raw, secret);
      return { body: tamper ? raw.replace(status, status + ' ') : raw, headers };
    }
  };
}

module.exports = { createFakeDidit };
