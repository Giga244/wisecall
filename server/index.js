const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { startJobs } = require('./jobs');
const pages = require('./pages');

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

// Health check for the hosting platform: also proves the database is reachable.
app.get('/healthz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
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
app.use('/api/contact', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contact', require('./routes/contact'));
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
app.use(pages.seoRoutes());
app.use(pages.pageRoutes());
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
app.use(pages.notFoundHandler);

// Any error thrown in a route ends up here instead of crashing or hanging the request.
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  const wantsHtml = !req.path.startsWith('/api/') && req.method === 'GET' && String(req.accepts(['html', 'json'])).startsWith('html');
  if (wantsHtml) return pages.errorPage(req, res);
  res.status(err.status || 500).json({ error: 'server_error' });
});

async function start() {
  await db.migrate();
  const server = app.listen(config.PORT, () => {
    console.log(`Wisecall running at http://localhost:${config.PORT}`);
    console.log(config.STRIPE_ENABLED
      ? 'Stripe: enabled.'
      : 'Stripe: not configured — bookings are auto-marked "paid" in simulated mode. Add STRIPE_SECRET_KEY to .env to enable real Stripe Checkout.');
  });

  const stopJobs = startJobs();
  const shutdown = () => { stopJobs(); server.close(() => db.close().then(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

module.exports = app;
