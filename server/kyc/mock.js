// A FAKE ID check for local development. It behaves like a real provider (hosted page, signed
// webhook, status lookup) so the whole verification flow can be tried without an account. It never
// looks at a real document. Refused in production (config.js), and its routes are not mounted there.
const crypto = require('crypto');
const config = require('../config');

const name = 'mock';
const isConfigured = () => !config.IS_PROD;

const sessions = new Map();

const sign = (body) => crypto.createHmac('sha256', config.SESSION_SECRET).update(body).digest('hex');

async function startVerification({ userId, callbackUrl }) {
  const sessionId = `mock-kyc-${crypto.randomUUID()}`;
  sessions.set(sessionId, { sessionId, userId, callbackUrl, status: 'not_finished', person: null });
  return { sessionId, url: `${config.PUBLIC_URL}/mock-kyc.html?session=${sessionId}` };
}

function handleWebhook({ rawBody, headers }) {
  const given = String(headers['x-mock-signature'] || '');
  const expected = sign(rawBody);
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('invalid mock signature');
  const body = JSON.parse(rawBody.toString('utf8'));
  return { eventId: body.eventId, sessionId: body.sessionId, vendorData: body.vendorData, status: body.status, person: body.person };
}

async function getStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { sessionId, vendorData: null, status: 'not_finished', person: null };
  return { sessionId, vendorData: s.userId, status: s.status, person: s.person };
}

const getSession = (id) => sessions.get(id) || null;

// The person pressed a button on the fake page: decide, then tell the server with a signed webhook.
async function complete(sessionId, { outcome, fullName, dateOfBirth, country }) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.status = { approve: 'approved', decline: 'declined', review: 'in_review' }[outcome] || 'declined';
  s.person = outcome === 'decline' ? null : { fullName, dateOfBirth, country: country || 'GEO', documentType: 'Identity Card' };
  const body = JSON.stringify({ eventId: `evt-${crypto.randomUUID()}`, sessionId, vendorData: s.userId, status: s.status, person: s.person });
  fetch(`${config.PUBLIC_URL}/api/kyc/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': sign(body) }, body })
    .catch((e) => console.error('[mock-kyc] webhook failed:', e.message));
  return s.callbackUrl;
}

module.exports = { name, isConfigured, startVerification, handleWebhook, getStatus, getSession, complete };
