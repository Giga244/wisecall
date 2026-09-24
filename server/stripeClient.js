const config = require('./config');

let stripe = null;
if (config.STRIPE_ENABLED) {
  const options = { maxNetworkRetries: 2, timeout: 20000 };
  // Test-only: point the SDK at a local fake Stripe server. Ignored in production.
  if (!config.IS_PROD && process.env.STRIPE_API_HOST) {
    options.host = process.env.STRIPE_API_HOST;
    options.port = process.env.STRIPE_API_PORT;
    options.protocol = 'http';
  }
  stripe = require('stripe')(config.STRIPE_SECRET_KEY, options);
}

module.exports = stripe;
