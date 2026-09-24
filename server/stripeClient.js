const config = require('./config');

let stripe = null;
if (config.STRIPE_ENABLED) {
  stripe = require('stripe')(config.STRIPE_SECRET_KEY);
}

module.exports = stripe;
