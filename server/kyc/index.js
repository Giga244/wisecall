// The one place that knows which ID-verification provider is in use. The rest of the code uses only:
//
//   startVerification({ userId, callbackUrl }) -> { sessionId, url }   send the mentor to url
//   handleWebhook({ rawBody, headers })        -> { eventId, sessionId, vendorData, status, person }
//                                                 proves the webhook is genuine (or throws)
//   getStatus(sessionId)                       -> { sessionId, vendorData, status, person }
//
//   status: approved | declined | in_review | expired | not_finished
//   person: { fullName, dateOfBirth, country, documentType } | null
//
// To use another provider (Sumsub, Veriff, ...), write a module with those three functions plus
// `name` and `isConfigured`, and register it below.
const config = require('../config');

const providers = {
  didit: require('./didit'),
  mock: require('./mock')
};

class KycUnavailable extends Error {
  constructor(name) { super(`ID verification provider "${name}" is not available`); this.code = 'kyc_unavailable'; }
}

function forProvider(name) {
  const p = providers[name];
  if (!p || !p.isConfigured()) throw new KycUnavailable(name);
  return p;
}

const current = () => forProvider(config.KYC_PROVIDER);

module.exports = { forProvider, current, KycUnavailable, providers };
