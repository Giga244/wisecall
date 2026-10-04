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

// The public status of the site's parts (the /status page): nothing secret, just whether each part works.
app.get('/api/status', async (req, res) => {
  const out = { checkedAt: new Date().toISOString(), components: {} };
  const t0 = Date.now();
  try { await db.query('SELECT 1'); out.components.database = { status: 'ok', ms: Date.now() - t0 }; } catch (e) { out.components.database = { status: 'down' }; }
  const last = require('./jobs').lastSweep();
  const late = !last || Date.now() - last.getTime() > Math.max(3 * config.SWEEP_INTERVAL_SECONDS * 1000, 5 * 60000);
  out.components.website = { status: 'ok' };
  out.components.jobs = { status: late ? (process.uptime() < 120 ? 'starting' : 'delayed') : 'ok', lastRun: last ? last.toISOString() : null };
  out.components.payments = { status: config.LAUNCH_MODE === 'prelaunch' ? 'not_open' : (config.PAYMENTS_ENABLED ? 'ok' : 'off') };
  out.components.idChecks = { status: config.ID_CHECKS_ENABLED ? 'ok' : 'not_open' };
  out.components.email = { status: config.EMAIL_ENABLED ? 'ok' : 'off' };
  out.status = out.components.database.status !== 'ok' ? 'down' : (out.components.jobs.status === 'delayed' ? 'degraded' : 'ok');
  res.set('Cache-Control', 'no-store');
  res.status(out.status === 'down' ? 503 : 200).json(out);
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
app.use('/api/admin/2fa/verify', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })); // (and five wrong codes in a row lock the account for 5 minutes)
app.use('/api/admin/2fa/enable', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api/admin/2fa/setup', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api/verification/kyc/start', rateLimit({ windowMs: 60 * 60 * 1000, max: 15 }));
app.use('/api/verification/work-email', rateLimit({ windowMs: 15 * 60 * 1000, max: 12 }));
app.use('/api/verification/documents', rateLimit({ windowMs: 60 * 60 * 1000, max: 40 }));
// Each submission starts an analysis (with a paid AI call), so it is limited; so are evidence links (each one is checked on the web).
app.use('/api/verification/submit', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use('/api/verification/evidence', rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.use('/api/verification/experience', rateLimit({ windowMs: 60 * 60 * 1000, max: 120 }));
app.use(/^\/api\/admin\/mentors\/[^/]+\/analysis$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use(/^\/api\/experts\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use('/api/me/photo', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use(/^\/api\/ratings\/[^/]+\/(report|reply)$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use(/^\/api\/bookings\/[^/]+\/ratings$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.post('/api/bookings', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use('/api/username', rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use('/api/me/username', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/me/export', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.put('/api/me/payout', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.post('/api/me/withdrawals', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.post(/^\/api\/answers\/(offer|decline)$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/answers\/[^/]+\/helpful$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.use('/api/me/delete', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
// The Inbox: sending (a follow-up, a support message), starting support conversations, reporting, unsubscribing.
app.use(/^\/api\/inbox\/threads\/[^/]+\/messages$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use('/api/inbox/support', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use(/^\/api\/inbox\/messages\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/inbox/unsubscribe', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/inbox/unread', rateLimit({ windowMs: 60 * 1000, max: 120 })); // (every open tab asks every 30 seconds)
// Uploaded verification documents arrive as raw file bytes (PDF or JPEG, up to 10 MB).
app.use('/api/verification/documents', express.raw({ type: ['application/pdf', 'image/jpeg', 'application/octet-stream'], limit: '10mb' }));
// A profile photo arrives as raw file bytes too (JPEG, PNG or WebP, up to 5 MB; it is re-encoded on the server).
app.use('/api/me/photo', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '5mb' }));
app.use('/api/auth/google', require('./routes/google'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/me/2fa', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
app.use('/api/me/2fa', require('./routes/twoFactorUser'));
app.use('/api/me', require('./routes/me'));
app.use('/api', require('./routes/profiles'));
app.use('/api', require('./routes/ratings'));
app.use('/api/experts', require('./routes/experts'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/answers', require('./routes/answers'));
app.use('/api/verification', require('./routes/verification'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/inbox', require('./routes/inbox').router);
app.use('/api', require('./routes/receipts'));
app.use('/api/admin/2fa', require('./routes/adminTwoFactor')); // two-step verification (how an admin passes the second step)
if (config.DEV_MODE) app.use('/api/admin/dev', require('./routes/adminDev')); // development only: never exists in production
app.use('/api/admin/support', require('./routes/inbox').adminRouter);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/adminVerification'));
app.use('/api/admin', require('./routes/adminNiches').router);
if (useMockBank) app.use('/api/mock-bank', require('./routes/mockBank'));
if (useMockKyc) app.use('/api/mock-kyc', require('./routes/mockKyc'));

app.get('/api/config', async (req, res) => {
  await launch.ensureFresh(5000);
  res.json({
    currency: config.CURRENCY,
    // "prelaunch": buyers cannot pay yet and the pages show the waiting list; "live": normal.
    launchMode: config.LAUNCH_MODE,
    // Whether mentors can do the ID check yet (before launch the site can run without the ID-check provider's keys).
    idChecksOpen: config.ID_CHECKS_ENABLED,
    // Whether the "Continue with Google" button is shown (both Google keys are set).
    googleEnabled: config.GOOGLE_ENABLED,
    priceMin: config.PRICE_MIN,
    priceMax: config.PRICE_MAX,
    payoutHoldDays: require('./ledger').holdDays(),
    payoutMinGel: config.PAYOUT_MIN_GEL,
    disputeDays: config.DISPUTE_DAYS,
    // The seller's legal details for the footer (each only when set), and whether card logos belong there (only once payments are open).
    legal: { name: config.LEGAL_NAME || null, id: config.LEGAL_ID || null, address: config.LEGAL_ADDRESS || null },
    paymentsLive: config.PAYMENTS_ENABLED && config.LAUNCH_MODE !== 'prelaunch',
    founder: config.FOUNDER.name ? config.FOUNDER : null,
    answerDeadlineDays: config.ANSWER_DEADLINE_DAYS,
    unpaidAttemptDays: config.UNPAID_ATTEMPT_DAYS,
    // How long a question and an answer must be (the forms show these; the server decides, see server/content.js).
    ...require('./content').LIMITS,
    // What the platform keeps, and what a mentor keeps of each paid question.
    platformFeePercent: config.PLATFORM_FEE_PERCENT,
    mentorSharePercent: 100 - config.PLATFORM_FEE_PERCENT,
    // Shown in the footer only when set.
    contactEmail: config.SUPPORT_EMAIL || null,
    social: config.SOCIAL_URLS,
    // The niches (fields) the pages offer, with both names and an icon (they live in the database and an admin can add more).
    niches: require('./niches').forClient(),
    // Only present on a developer's computer, where pages may show dev-mode helpers. In production the
    // key does not exist at all.
    ...(config.DEV_MODE ? { devMode: true } : {})
  });
});

// The admin scripts and their dictionaries are for admins only: everybody else gets a plain 403 for them, so no admin text or
// setting is ever sent to a visitor or an ordinary account (the admin page itself is checked in server/pages.js).
app.use(require('./adminAuth').adminOnlyFile);

app.use(pages.languagePrefix); // (/ka/<page> is the Georgian version of <page>)
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
  const errorReport = require('./errorReport');
  errorReport.report(err, { method: req.method, route: errorReport.routeOf(req), status: err.status || 500 }); // (off without SENTRY_DSN; nothing personal)
  if (res.headersSent) return next(err);
  const wantsHtml = !req.path.startsWith('/api/') && req.method === 'GET' && String(req.accepts(['html', 'json'])).startsWith('html');
  if (wantsHtml) return pages.errorPage(req, res);
  res.status(err.status || 500).json({ error: 'server_error' });
});

async function start() {
  await db.migrate();
  await require('./niches').load(); // (the niche list lives in the database)
  const made = await require('./usernames').backfill(); // people who signed up before profiles existed get a username
  if (made) console.log(`[profiles] gave ${made} existing user(s) a username made from their name`);
  await launch.refresh();
  const server = app.listen(config.PORT, () => {
    console.log(`Wisecall running at http://localhost:${config.PORT}`);
    console.log(!config.PAYMENTS_ENABLED
      ? 'Payments: OFF (no bank keys yet): nothing can be booked or paid. Set PAYMENT_PROVIDER=bog or tbc with your bank keys, then LAUNCH_MODE=live.'
      : config.PAYMENT_PROVIDER === 'mock'
        ? 'Payments: MOCK bank (development only). Set PAYMENT_PROVIDER=bog or tbc with your bank keys for real payments.'
        : `Payments: ${config.PAYMENT_PROVIDER.toUpperCase()} (callback URL ${config.PUBLIC_URL}/api/payments/callback)`);
    console.log(!config.ID_CHECKS_ENABLED
      ? 'ID check: OFF (no Didit keys yet): mentors see "ID checks open soon". Set KYC_PROVIDER=didit with your Didit keys.'
      : config.KYC_PROVIDER === 'mock'
        ? 'ID check: MOCK (development only).'
        : `ID check: ${config.KYC_PROVIDER.toUpperCase()} (webhook URL ${config.PUBLIC_URL}/api/kyc/webhook)`);
    const how = config.LAUNCH_MODE_SETTING === 'auto' ? `automatic: ${config.LISTED_MENTORS} listed mentor(s)` : 'set by LAUNCH_MODE';
    console.log(config.LAUNCH_MODE === 'prelaunch'
      ? `Launch mode: PRELAUNCH (${how}). Nobody can pay yet; visitors join the waiting list and mentors can apply and be verified. It opens when the first mentor is listed, or set LAUNCH_MODE=live.`
      : `Launch mode: live (${how}).`);
    console.log(config.GOOGLE_ENABLED
      ? `Google sign-in: on (add ${config.GOOGLE_CALLBACK_URL} as an authorised redirect URI in Google Cloud Console).`
      : 'Google sign-in: off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to show "Continue with Google").');
    console.log(`Mentor review: AI ${config.AI_REVIEW_ENABLED ? `on (${config.ANTHROPIC_MODEL})` : 'off (set ANTHROPIC_API_KEY to add AI summaries for the admin)'}; automatic approval ${config.AUTO_APPROVE ? 'ON' : 'off (a person approves every mentor)'}.`);
    launch.warnings().forEach((w) => console.warn('[WARNING] ' + w));
    require('./startupWarnings').printWarnings();
  });

  const stopJobs = startJobs();
  // Verification rules v2: finish carrying over what mentors did under the first rules (once; safe to repeat).
  setTimeout(() => require('./verification/carryOver').run().catch((e) => console.error('[carry-over] failed:', e.message)), 2000).unref();
  const shutdown = () => { stopJobs(); server.close(() => db.close().then(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err); require('./errorReport').report(err instanceof Error ? err : new Error(String(err))); });

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

module.exports = app;
