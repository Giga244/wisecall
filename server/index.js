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

// Shutting down (a deploy, docs/TODO-REHEARSAL.md R-2): every answer asks the browser to close its connection, so open keep-alive
// connections end after their current request, and the health check says "not ready" so no new traffic is sent here.
let draining = false;
app.use((req, res, next) => { if (draining) res.set('Connection', 'close'); next(); });

app.use(securityHeaders);
app.use(require('compression')()); // the pages, scripts, styles and JSON are text: about a quarter of the size on the wire
app.use(requestLogger);
app.use(require('./live/switch').gate); // (live sessions switched off: their pages and API do not exist, see server/live/switch.js)

// Health check for the hosting platform: also proves the database is reachable.
app.get('/healthz', async (req, res) => {
  if (draining) return res.status(503).json({ ok: false, draining: true });
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
// The email provider's delivery results (Resend, signed with Svix): raw body, exempt from the CSRF header, rate limited.
app.use('/api/email/webhook', rateLimit({ windowMs: 60 * 1000, max: 300 }), express.raw({ type: '*/*', limit: '64kb' }), require('./routes/emailWebhook'));

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

// Development only: the fake video room for live sessions (server/live/fake.js). Never exists in production.
const useFakeVideo = config.LIVE_PROVIDER === 'fake' && !config.IS_PROD;
if (!useFakeVideo) {
  app.use(['/mock-live-room.html', '/js/mock-live-room.js', '/mock-live-replay.html', '/api/live-fake'], pages.notFoundHandler);
} else {
  // (the fake room is shown inside the room page of this same site: only it may be framed, and only by this site)
  app.get(['/mock-live-room.html', '/mock-live-replay.html'], (req, res, next) => {
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', require('./security').cspWith({ frameAncestors: "'self'" }));
    next();
  });
  app.get('/api/live-fake/check', (req, res) => {
    const fake = require('./live/fake');
    const t = fake.verify(req.query.t);
    if (!t) return res.status(403).json({ ok: false, error: 'bad_token' });
    if (t.room !== req.query.room) return res.status(403).json({ ok: false, error: 'wrong_room' });
    if (Date.now() < t.nbf) return res.status(403).json({ ok: false, error: 'too_early' });
    if (Date.now() > t.exp) return res.status(403).json({ ok: false, error: 'expired' });
    const room = fake.roomState(t.room);
    if (room && room.ended) return res.status(410).json({ ok: false, error: 'room_ended' });
    res.json({ ok: true, room: t.room, userName: t.userName, owner: t.owner, canSend: t.canSend });
  });
}

// State-changing API calls must come from our own pages (see security.js).
app.use('/api', csrfGuard);
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(require('./attribution').capture); // (where visitors come from: a first-party cookie, see server/attribution.js)

const authLimit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max });
app.use('/api/auth/google', authLimit(40));
app.use('/api/auth/login', authLimit(15));
app.use('/api/auth/signup', authLimit(15));
app.use('/api/auth/verify-email', authLimit(10));
app.use('/api/auth/resend-verification', authLimit(6));
app.use('/api/auth/change-unconfirmed-email', authLimit(6));
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
app.use('/api/niches/suggest', rateLimit({ windowMs: 60 * 1000, max: 60 })); // (asked while a mentor types their field)
app.use('/api/me/username', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/me/export', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.put('/api/me/payout', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.post('/api/me/withdrawals', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.post(/^\/api\/answers\/(offer|decline)$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post('/api/requests', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
// Live sessions: buying, writing, the room's questions and heartbeats.
app.post('/api/live', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/[^/]+\/tickets$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/[^/]+\/questions$/, rateLimit({ windowMs: 10 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/questions\/[^/]+\/vote$/, rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }));
app.post(/^\/api\/live\/[^/]+\/(heartbeat|hand|join)$/, rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }));
app.use(/^\/api\/live\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use(/^\/api\/live\/[^/]+\/cover$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '5mb' }));
// (Milestone 2: following, the waiting list, gifts, ratings, summaries, discount codes, the share image)
app.use(/^\/api\/live\/follows\//, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.use(/^\/api\/live\/[^/]+\/waitlist$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.post('/api/live/gifts/claim', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/tickets\/[^/]+\/gift\/resend$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.post(/^\/api\/live\/tickets\/[^/]+\/rating$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/[^/]+\/summary$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.get('/api/live/discounts/check', rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }));
// (Milestone 3: series payments, replay passes, recording)
app.post(/^\/api\/live\/series\/[^/]+\/orders$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/[^/]+\/replay\/purchases$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.post(/^\/api\/live\/[^/]+\/recording$/, rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }));
app.post('/api/live/series', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.get(/^\/api\/live-share\//, rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }));
// The "are you a person?" check (Cloudflare Turnstile; off without its keys), after the rate limits.
app.post(['/api/auth/signup', '/api/auth/login', '/api/auth/forgot-password', '/api/contact', '/api/waitlist', '/api/requests'], require('./turnstile').requireHuman);
app.post(/^\/api\/answers\/[^/]+\/helpful$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }));
app.use('/api/me/delete', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
// The password asked before deleting the account or changing the password: per address here, per account in server/reauthGuard.js
// (docs/REVIEW-2.md #5). Opening a dispute has a limit of its own too (#13).
app.delete('/api/me', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.post('/api/me/password', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use(/^\/api\/bookings\/[^/]+\/dispute$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 })); // (every booking counted together)
app.use(/^\/api\/live\/tickets\/[^/]+\/dispute$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
// The Inbox: sending (a follow-up, a support message), starting support conversations, reporting, unsubscribing.
app.use(/^\/api\/inbox\/threads\/[^/]+\/messages$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }));
app.use('/api/inbox/support', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use(/^\/api\/inbox\/messages\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/inbox/unsubscribe', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/inbox/unread', rateLimit({ windowMs: 60 * 1000, max: 120 })); // (every open tab asks every 30 seconds)
app.post('/api/stats/pageview', rateLimit({ windowMs: 60 * 1000, max: 60 })); // (a page fetched ahead, then opened)
// Uploaded verification documents arrive as raw file bytes (PDF or JPEG, up to 10 MB).
app.use('/api/verification/documents', express.raw({ type: ['application/pdf', 'image/jpeg', 'application/octet-stream'], limit: '10mb' }));
// A profile photo arrives as raw file bytes too (JPEG, PNG or WebP, up to 5 MB; it is re-encoded on the server).
app.use('/api/me/photo', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '5mb' }));
// Rich profile sections: saves are limited; a project's picture arrives as raw bytes like the profile photo.
app.use(/^\/api\/me\/profile\/items\/[^/]+\/image$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '5mb' }));
app.use(/^\/api\/me\/profile\//, rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }));
app.use(/^\/api\/users\/[^/]+\/report$/, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));
app.use('/api/auth/google', require('./routes/google'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/me/2fa', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
app.use('/api/me/2fa', require('./routes/twoFactorUser'));
app.use('/api/me', require('./routes/me'));
app.use('/api', require('./routes/profileSections'));
app.use('/api', require('./routes/profiles'));
// A project's picture (who may see the owner's projects).
app.get(/^\/api\/profile-images\/([0-9a-f-]{36})\.webp$/, require('./auth').optionalAuth, async (req, res, next) => {
  try {
    const viewer = await require('./adminAuth').viewerFrom(req); // (an admin sees hidden pictures only after the second step)
    const img = await require('./profileSections').imageFor(req.params[0], viewer);
    if (!img) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300');
    res.type(img.mime).send(img.data);
  } catch (e) { next(e); }
});
app.use('/api', require('./routes/ratings'));
const { publicCache } = require('./publicCache'); // (the public lists, for visitors who are not signed in: R-5)
app.use('/api/experts', publicCache(), require('./routes/experts'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/answers', publicCache(), require('./routes/answers'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/live', publicCache(), require('./routes/live'));
// A live session's cover picture (public once the session is).
app.get(/^\/api\/live-covers\/([0-9a-f-]{36})\.webp$/, require('./auth').optionalAuth, async (req, res, next) => {
  try {
    const c = await require('./live/covers').get(req.params[0], req.userToken ? req.userToken.id : null);
    if (!c) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=300');
    res.type(c.mime).send(c.data);
  } catch (e) { next(e); }
});
// A square picture to share a session on Instagram and Facebook (drawn on the server; public sessions only).
app.get(/^\/api\/live-share\/([0-9a-f-]{36})\.png$/, async (req, res, next) => {
  try {
    const png = await require('./live/share').render(req.params[0]);
    if (!png) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=300');
    res.type('image/png').send(png);
  } catch (e) { next(e); }
});
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

// The closest category for a field in someone's own words (the mentor application, and the home page's waiting list). Nothing is kept.
app.get('/api/niches/suggest', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 300) : '';
  const niche = require('./fieldSuggest').suggestField(q);
  // (up to 3 choices for the chips under the field, the suggestion first; the page adds "Other" last)
  const choices = require('./fieldSuggest').suggestFields(3, q).map((key) => ({ key, regulated: require('./niches').isRegulated(key) }));
  res.set('Cache-Control', 'no-store');
  res.json({ niche, regulated: Boolean(niche) && require('./niches').isRegulated(niche), choices });
});

// The home page's "our mentors" (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4): approved mentors who chose "show my profile on
// the home page" (off by default): photo, name, field, university or company, "Founding mentor". The count of verified mentors only from 5.
app.get('/api/home-mentors', publicCache(), require('./util').asyncHandler(async (req, res) => {
  const { query } = require('./db');
  const { userFromRow } = require('./models');
  const { publicProfile } = require('./util');
  const [picked, count] = await Promise.all([
    query(`SELECT u.* FROM users u WHERE u.role IN ('mentor', 'both') AND u.verification_status = 'verified' AND u.show_on_home AND u.username IS NOT NULL
             AND u.deleted_at IS NULL AND u.deletion_requested_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM profile_settings ps WHERE ps.user_id = u.id AND ps.hidden_at IS NOT NULL)
           ORDER BY u.founding_mentor_at NULLS LAST, u.verification_decided_at LIMIT 12`),
    query(`SELECT count(*)::int AS n FROM users WHERE role IN ('mentor', 'both') AND verification_status = 'verified' AND deleted_at IS NULL AND deletion_requested_at IS NULL`)
  ]);
  const users = picked.rows.map(userFromRow);
  const [badges, summaries] = await Promise.all([require('./verification/badges').badgesFor(users.map((u) => u.id)), require('./profileSections').publicSummaries(users)]);
  const mentors = users.map((u) => {
    const p = publicProfile(u);
    const uni = (badges[u.id] || []).find((b) => b.key === 'university');
    const work = summaries[u.id] && summaries[u.id].currentPosition;
    return { id: p.id, name: p.name, username: p.username, photoUrl: p.photoUrl, color: p.color, niche: p.niche, customNiche: p.customNiche,
      founding: Boolean(u.foundingMentorAt), university: uni ? uni.university : null, organisation: work ? work.organisation : null };
  });
  const n = count.rows[0].n;
  res.json({ mentors, verifiedCount: n >= 5 ? n : null });
}));

app.get('/api/config', publicCache(), async (req, res) => {
  await launch.ensureFresh(5000);
  res.json({
    currency: config.CURRENCY,
    // "prelaunch": buyers cannot pay yet and the pages show the waiting list; "live": normal.
    launchMode: config.LAUNCH_MODE,
    // Whether mentors can do the ID check yet (before launch the site can run without the ID-check provider's keys).
    idChecksOpen: config.ID_CHECKS_ENABLED,
    // Whether the "Continue with Google" button is shown (both Google keys are set).
    googleEnabled: config.GOOGLE_ENABLED,
    // The public key of the "are you a person?" check, when it is on.
    turnstileSiteKey: config.TURNSTILE_ENABLED ? config.TURNSTILE_SITE_KEY : null,
    priceMin: config.PRICE_MIN,
    priceMax: config.PRICE_MAX,
    payoutHoldDays: require('./ledger').holdDays(),
    payoutMinGel: config.PAYOUT_MIN_GEL,
    disputeDays: config.DISPUTE_DAYS,
    mentorReviewDays: config.MENTOR_REVIEW_DAYS,
    priceSuggestMin: config.PRICE_SUGGEST_MIN,
    priceSuggestMax: config.PRICE_SUGGEST_MAX,
    // The seller's legal details for the footer (each only when set), and whether card logos belong there (only once payments are open).
    legal: { name: config.LEGAL_NAME || null, id: config.LEGAL_ID || null, address: config.LEGAL_ADDRESS || null },
    paymentsLive: config.PAYMENTS_ENABLED && config.LAUNCH_MODE !== 'prelaunch',
    // Live sessions on or off (LIVE_SESSIONS): off hides every link, section and text about them.
    liveSessions: config.LIVE_ENABLED,
    // (outside production, a marked placeholder shows where the founder's photo and words will go: docs/TODO-OWNER.md; production shows
    // nothing until FOUNDER_NAME is set)
    founder: config.FOUNDER.name ? config.FOUNDER : (config.IS_PROD ? null : { placeholder: true, name: '', role: '', photo: '/brand/founder-placeholder.svg', story: { en: '', ka: '' } }),
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
    // The 6 fields people wait for most: first in the waiting list's field menu.
    popularFields: await require('./waitlist').popularFields(),
    // Only present on a developer's computer, where pages may show dev-mode helpers. In production the
    // key does not exist at all.
    ...(config.DEV_MODE ? { devMode: true } : {})
  });
});

app.use(pages.languagePrefix); // (/ka/<page> is the Georgian version of <page>)
// The admin scripts and their dictionaries are for admins only: everybody else gets a plain 403 for them, so no admin text or
// setting is ever sent to a visitor or an ordinary account (the admin page itself is checked in server/pages.js). Checked after the /ka
// prefix is taken off, so /ka/js/admin.js is the same file and gets the same answer (docs/security-audit C3).
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
  // The database was too busy (no free connection within 5 s, a lock or a statement over its limit, server/db.js): "try again", not a crash.
  const busy = ['55P03', '57014'].includes(err.code) || /timeout exceeded when trying to connect/i.test(String(err.message));
  if (busy && !res.headersSent) {
    console.warn(`[busy] ${req.method} ${req.path}: ${err.message}`);
    return res.status(503).set('Retry-After', '5').json({ error: 'busy_try_again' });
  }
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
    console.log(config.LIVE_ENABLED ? 'Live sessions: on (LIVE_SESSIONS=on).' : 'Live sessions: OFF (LIVE_SESSIONS): users see no page, link or email about them; admins see a read-only Live tab. LIVE_SESSIONS=on turns them on.');
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
  // A graceful stop: no new connections, idle ones closed now, busy ones after their request ("Connection: close"); whatever is still open
  // after 20 seconds is closed, so the process always exits inside the host's shutdown window (Render waits 30 s by default).
  const shutdown = () => {
    if (draining) return;
    draining = true;
    stopJobs();
    server.close(() => db.close().then(() => process.exit(0), () => process.exit(0)));
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, Number(process.env.SHUTDOWN_GRACE_MS) || 20000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err); require('./errorReport').report(err instanceof Error ? err : new Error(String(err))); });

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

module.exports = app;
