// The one place that knows which bank is in use. Booking code talks to this interface only:
//
//   createPayment({ bookingId, amount, description, callbackUrl, successUrl, failUrl, returnUrl, ttlMinutes, language })
//       -> { orderId, redirectUrl }         start a payment; the buyer is sent to redirectUrl
//   verifyCallback({ rawBody, headers })
//       -> { orderId }                      proves a callback is genuine (or throws); never trust its content
//   getPaymentStatus(orderId)
//       -> { status, amount, currency, returned }
//                                           status: pending | paid | failed | expired | refund_pending | refunded | refunded_partially
//                                           returned: tetri the bank has returned on this order so far (null when it does not say)
//   refund({ orderId, amount, partial, idempotencyKey })
//       -> { refundId }                     asks the bank to return the money (confirmed later via getPaymentStatus)
//   idempotentRefunds                       true when the bank answers a repeated idempotencyKey with the first result (asking
//                                           again can never return the money twice); false: never ask again without a status check
//
// To add another bank, write a module with those four functions plus `name` and `isConfigured`,
// and register it below.
const config = require('../config');

const providers = {
  bog: require('./bog'),
  tbc: require('./tbc'),
  mock: require('./mock')
};

class PaymentProviderUnavailable extends Error {
  constructor(name) { super(`payment provider "${name}" is not available`); this.code = 'provider_unavailable'; }
}

// The implementation for a stored booking (each booking remembers which bank it used, so
// switching PAYMENT_PROVIDER later never strands old payments).
function forProvider(name) {
  const p = providers[name];
  if (!p || !p.isConfigured()) throw new PaymentProviderUnavailable(name);
  return p;
}

const current = () => forProvider(config.PAYMENT_PROVIDER);

module.exports = { forProvider, current, PaymentProviderUnavailable, providers };
