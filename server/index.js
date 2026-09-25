const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { startJobs } = require('./jobs');
const pages = require('./pages');
const assets = require('./assets');
const launch = require('./launch');
const { securityHeaders, csrfGuard, requestLogger } = require('./security');

const app = express();
if (config.IS_PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(require('compression')()); // the pages, scripts, styles and JSON are text: about a quarter of the size on the wire
app.use(requestLogger);

// Health check for the hosting platform: also proves the database is reachable.
app.get('/healthz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

// The bank's callback needs the raw body (BOG signs the exact bytes), so it is mounted before the
// global json() body parser. It also comes from the bank's servers, so it is exempt from the CSRF
// header rule; its authenticity is checked in server/pay/ instead.
app.use('/api/payments', express.raw({ type: '*/*', limit: '100kb' }), require('./routes/paymentCallback'));

// ID-verification webhook: raw body (the signature covers the exact bytes), exempt from the CSRF header.
app.use('/api/kyc', express.raw({ type: '*/*', limit: '200kb' }), require('./routes/kycWebhook'));

// Development only: the fake ID-check page. Never exists in production.
const useMockKyc = config.KYC_PROVIDER === 'mock' && !config.IS_PROD;
if (!useMockKyc) {
  app.use(['/mock-kyc.html', '/js/mock-kyc.js', '/api/mock-kyc'], pages.notFoundHandler);
}

// Development only: the fake bank's payment page. Never exists in production.
const useMockBank = config.PAYMENT_PROVIDER === 'mock' && !config.IS_PROD;
if (!useMockBank) {
  app.use(['/mock-bank.html', '/js/mock-bank.js', '/api/mock-bank'], pages.notFoundHandler);
}

// State-changing API calls must come from our own pages (see security.js).
app.use('/api', csrfGuard);
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

const authLimit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max });
app.use('/api/auth/google', authLimit(40));
app.use('/api/auth/login', authLimit(15));
app.use('/api/auth/signup', authLimit(15));
app.use('/api/auth/verify-email', authLimit(10));
app.use('/api/auth/resend-verification', authLimit(6));
app.use('/api/auth/forgot-password', authLimit(6));
app.use('/api/auth/reset-password', authLimit(10));
app.use('/api/contact', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/api/waitlist', rateLimit({ windowMs: 60 * 60 * 1000, max: 12 }));
app.use('/api/verification/kyc/start', rateLimit({ windowMs: 60 * 60 * 1000, max: 15 }));
app.use('/api/verification/work-email', rateLimit({ windowMs: 15 * 60 * 1000, max: 12 }));
app.use('/api/verification/documents', rateLimit({ windowMs: 60 * 60 * 1000, max: 40 }));
app.use(/^\/api\/experts\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use('/api/me/photo', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use(/^\/api\/ratings\/[^/]+\/(report|reply)$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use(/^\/api\/bookings\/[^/]+\/ratings$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.use('/api/username', rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use('/api/me/username', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
// Uploaded verification documents arrive as raw file bytes (PDF or JPEG, up to 10 MB).
app.use('/api/verification/documents', express.raw({ type: ['application/pdf', 'image/jpeg', 'application/octet-stream'], limit: '10mb' }));
// A profile photo arrives as raw file bytes too (JPEG, PNG or WebP, up to 5 MB; it is re-encoded on the server).
app.use('/api/me/photo', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '5mb' }));
app.use('/api/auth/google', require('./routes/google'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/me', require('./routes/me'));
app.use('/api', require('./routes/profiles'));
app.use('/api', require('./routes/ratings'));
app.use('/api/experts', require('./routes/experts'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/verification', require('./routes/verification'));
app.use('/api/stats', require('./routes/stats'));
if (config.DEV_MODE) app.use('/api/admin/dev', require('./routes/adminDev')); // development only: never exists in production
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/adminVerification'));
if (useMockBank) app.use('/api/mock-bank', require('./routes/mockBank'));
if (useMockKyc) app.use('/api/mock-kyc', require('./routes/mockKyc'));

app.get('/api/config', async (req, res) => {
  await launch.ensureFresh(5000);
  res.json({
    currency: config.CURRENCY,
    // "prelaunch": buyers cannot pay yet and the pages show the waiting list; "live": normal.
    launchMode: config.LAUNCH_MODE,
    // Whether the "Continue with Google" button is shown (both Google keys are set).
    googleEnabled: config.GOOGLE_ENABLED,
    priceMin: config.PRICE_MIN,
    priceMax: config.PRICE_MAX,
    payoutHoldDays: config.PAYOUT_HOLD_DAYS,
    answerDeadlineDays: config.ANSWER_DEADLINE_DAYS,
    // What the platform keeps, and what a mentor keeps of each paid question.
    platformFeePercent: config.PLATFORM_FEE_PERCENT,
    mentorSharePercent: 100 - config.PLATFORM_FEE_PERCENT,
    // Shown in the footer only when set.
    contactEmail: config.SUPPORT_EMAIL || null,
    social: config.SOCIAL_URLS,
    // Only present on a developer's computer, where pages may show dev-mode helpers. In production the
    // key does not exist at all.
    ...(config.DEV_MODE ? { devMode: true } : {})
  });
});

// The admin scripts and their dictionaries are for admins only: everybody else gets a plain 403 for them, so no admin text or
// setting is ever sent to a visitor or an ordinary account (the admin page itself is checked in server/pages.js).
app.use(require('./adminAuth').adminOnlyFile);

app.use(pages.seoRoutes());
app.use(pages.pageRoutes());
app.use(pages.blockRawHtml);
// Stylesheets, scripts, pictures, icons and fonts are asked for with ?v=<hash of the file>, which the pages, styles and scripts get as
// they are sent (server/assets.js): a changed file has a new address and shows at once, an unchanged one is kept for a year.
app.use(assets.serveText);
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, setHeaders: assets.staticHeaders }));
app.use(pages.notFoundHandler);

// Any error thrown in a route ends up here instead of crashing or hanging the request.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' && !res.headersSent) return res.status(413).json({ error: 'file_too_large' });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  const wantsHtml = !req.path.startsWith('/api/') && req.method === 'GET' && String(req.accepts(['html', 'json'])).startsWith('html');
  if (wantsHtml) return pages.errorPage(req, res);
  res.status(err.status || 500).json({ error: 'server_error' });
});

async function start() {
  await db.migrate();
  const made = await require('./usernames').backfill(); // people who signed up before profiles existed get a username
  if (made) console.log(`[profiles] gave ${made} existing user(s) a username made from their name`);
  await launch.refresh();
  const server = app.listen(config.PORT, () => {
    console.log(`Wisecall running at http://localhost:${config.PORT}`);
    console.log(config.PAYMENT_PROVIDER === 'mock'
      ? 'Payments: MOCK bank (development only). Set PAYMENT_PROVIDER=bog or tbc with your bank keys for real payments.'
      : `Payments: ${config.PAYMENT_PROVIDER.toUpperCase()} (callback URL ${config.PUBLIC_URL}/api/payments/callback)`);
    console.log(config.KYC_PROVIDER === 'mock'
      ? 'ID check: MOCK (development only).'
      : `ID check: ${config.KYC_PROVIDER.toUpperCase()} (webhook URL ${config.PUBLIC_URL}/api/kyc/webhook)`);
    const how = config.LAUNCH_MODE_SETTING === 'auto' ? `automatic: ${config.LISTED_MENTORS} listed mentor(s)` : 'set by LAUNCH_MODE';
    console.log(config.LAUNCH_MODE === 'prelaunch'
      ? `Launch mode: PRELAUNCH (${how}). Nobody can pay yet; visitors join the waiting list and mentors can apply and be verified. It opens when the first mentor is listed, or set LAUNCH_MODE=live.`
      : `Launch mode: live (${how}).`);
    console.log(config.GOOGLE_ENABLED
      ? `Google sign-in: on (add ${config.GOOGLE_CALLBACK_URL} as an authorised redirect URI in Google Cloud Console).`
      : 'Google sign-in: off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to show "Continue with Google").');
    launch.warnings().forEach((w) => console.warn('[WARNING] ' + w));
    require('./startupWarnings').printWarnings();
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
