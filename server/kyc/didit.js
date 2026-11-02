// Didit (https://didit.me): hosted ID + selfie verification with Georgian ID card and passport support.
// Built from Didit's public documentation:
//   create   POST {DIDIT_API_URL}/v3/session/                 header x-api-key, body { workflow_id, vendor_data, callback }
//                                                            -> { session_id, url }
//   result   GET  {DIDIT_API_URL}/v3/session/{id}/decision/   -> id_verifications[], liveness_checks[], face_matches[] at the root
//   webhook  POST to our URL with X-Signature-V2 (HMAC-SHA256 of the canonical, key-sorted JSON), X-Signature
//            (HMAC-SHA256 of the raw bytes) and X-Timestamp (Unix seconds, must be within 5 minutes).
// The workflow behind DIDIT_WORKFLOW_ID (created in Didit's console) must contain ID verification,
// liveness and face match. We refuse to treat a session as approved unless all of them are approved.
const crypto = require('crypto');
const config = require('../config');
const { requestJson, ProviderError } = require('../pay/http');

const name = 'didit';
const isConfigured = () => Boolean(config.DIDIT_API_KEY && config.DIDIT_WORKFLOW_ID && config.DIDIT_WEBHOOK_SECRET);

const STATUS = {
  approved: 'approved', declined: 'declined', 'in review': 'in_review', expired: 'expired', abandoned: 'expired',
  'not finished': 'not_finished', 'in progress': 'not_finished', 'not started': 'not_finished'
};

// Didit refuses to open a session when our balance is empty or its billing failed: a 402, or another refusal that names credit, balance or
// payment. Such an error gets code 'kyc_no_credit' (the mentor is told the check is off for now, the admin is emailed: verification/kyc.js).
const NO_CREDIT = /credit|balance|insufficient|payment|billing|top.?up|quota/i;
const isNoCredit = (e) => e.status === 402 || (e.status >= 400 && e.status < 500 && ![401, 404].includes(e.status) && NO_CREDIT.test(`${JSON.stringify(e.body || '')} ${e.message}`));

async function startVerification({ userId, callbackUrl }) {
  let res;
  try {
    res = await requestJson(`${config.DIDIT_API_URL}/v3/session/`, {
      method: 'POST',
      headers: { 'x-api-key': config.DIDIT_API_KEY },
      json: { workflow_id: config.DIDIT_WORKFLOW_ID, vendor_data: userId, callback: callbackUrl }
    });
  } catch (e) {
    if (e instanceof ProviderError && isNoCredit(e)) e.code = 'kyc_no_credit';
    throw e;
  }
  if (!res || !res.session_id || !res.url) throw new ProviderError('Didit did not return a session id and link');
  return { sessionId: res.session_id, url: res.url };
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

const hmac = (data) => crypto.createHmac('sha256', config.DIDIT_WEBHOOK_SECRET).update(data, 'utf8').digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Throws unless the request really came from Didit and is fresh.
function verifySignature({ rawBody, headers }) {
  const ts = Number(headers['x-timestamp']);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) throw new ProviderError('stale or missing webhook timestamp');
  const text = rawBody.toString('utf8');
  let ok = false;
  const v2 = headers['x-signature-v2'];
  if (v2) {
    try { ok = same(hmac(JSON.stringify(sortKeys(JSON.parse(text)))), v2); } catch (e) { ok = false; }
  }
  const raw = headers['x-signature'];
  if (!ok && raw) ok = same(hmac(text), raw);
  if (!ok) throw new ProviderError('invalid webhook signature');
}

const allApproved = (list) => list.length > 0 && list.every((x) => String(x.status).toLowerCase() === 'approved');

// Turns Didit's decision into { status, person }. "approved" needs the ID, the liveness check and
// (when present) the face match to all be approved; anything less stays "in_review".
function readDecision(decision, topStatus) {
  const d = decision || {};
  let status = STATUS[String(topStatus || '').toLowerCase()] || 'not_finished';
  const ids = d.id_verifications || [];
  if (status === 'approved' && !(allApproved(ids) && allApproved(d.liveness_checks || []) && (!(d.face_matches || []).length || allApproved(d.face_matches)))) {
    status = 'in_review';
  }
  const id = ids[0];
  const person = id ? {
    fullName: id.full_name || [id.first_name, id.last_name].filter(Boolean).join(' ') || null,
    dateOfBirth: id.date_of_birth || null,
    country: id.issuing_state || null,
    documentType: id.document_type || null
  } : null;
  return { status, person };
}

function handleWebhook({ rawBody, headers }) {
  verifySignature({ rawBody, headers }); // throws if not genuine
  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch (e) { throw new ProviderError('webhook body is not JSON'); }
  if (!body || typeof body.session_id !== 'string') throw new ProviderError('webhook has no session id');
  return { eventId: body.event_id || null, sessionId: body.session_id, vendorData: body.vendor_data || null, ...readDecision(body.decision, body.status) };
}

async function getStatus(sessionId) {
  const res = await requestJson(`${config.DIDIT_API_URL}/v3/session/${encodeURIComponent(sessionId)}/decision/`, { headers: { 'x-api-key': config.DIDIT_API_KEY } });
  if (!res) throw new ProviderError('Didit returned an empty decision');
  // On this endpoint the result arrays are at the root, not under "decision".
  return { sessionId, vendorData: res.vendor_data || null, ...readDecision(res, res.status) };
}

// For the launch check. Looks up a session that does not exist: Didit checks the API key before it looks
// anything up, so "not found" proves the key is accepted and 401/403 proves it is not. With { deep: true } it
// also opens (and never uses) one session, which proves the workflow id is right.
async function ping({ deep = false } = {}) {
  try {
    await requestJson(`${config.DIDIT_API_URL}/v3/session/00000000-0000-4000-8000-000000000000/decision/`, { headers: { 'x-api-key': config.DIDIT_API_KEY } });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('Didit rejected the API key (DIDIT_API_KEY)', { status: e.status });
    if (e.status !== 404 && e.status !== 400) throw e;
  }
  if (!deep) return 'API key accepted (the workflow id is only proven by a real verification; run with --deep to test it now)';
  const s = await startVerification({ userId: 'launch-check', callbackUrl: `${config.PUBLIC_URL}/apply.html?step=5` });
  return `API key and workflow id accepted (test session ${s.sessionId} opened and left unused)`;
}

module.exports = { name, isConfigured, startVerification, handleWebhook, getStatus, ping };
