const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const { rateLimit } = require('./rateLimit');

const app = express();
if (config.IS_PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
});

// Webhook route needs the raw body for Stripe signature verification,
// so it's mounted before the global json() body parser.
app.use('/api/webhook', express.raw({ type: 'application/json' }), require('./routes/webhook'));

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

const authLimit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max });
app.use('/api/auth/login', authLimit(15));
app.use('/api/auth/signup', authLimit(15));
app.use('/api/auth/verify-email', authLimit(10));
app.use('/api/auth/resend-verification', authLimit(6));
app.use('/api/auth/forgot-password', authLimit(6));
app.use('/api/auth/reset-password', authLimit(10));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', require('./routes/me'));
app.use('/api/experts', require('./routes/experts'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/connect', require('./routes/connect'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/config', (req, res) => {
  res.json({
    currency: config.CURRENCY,
    platformFeePercent: config.PLATFORM_FEE_PERCENT,
    stripeEnabled: config.STRIPE_ENABLED,
    stripePublishableKey: config.STRIPE_PUBLISHABLE_KEY
  });
});

app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.PORT, () => {
  console.log(`Wisecall running at http://localhost:${config.PORT}`);
  console.log(config.STRIPE_ENABLED
    ? 'Stripe: LIVE test-mode integration active.'
    : 'Stripe: not configured — bookings are auto-marked "paid" in simulated dev mode. Add STRIPE_SECRET_KEY to .env to enable real Stripe Checkout.');
});
