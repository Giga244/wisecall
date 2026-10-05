require('dotenv').config();

const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const JWT_DEFAULT = 'dev-secret-change-me-before-production';

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : fallback);

const config = {
  IS_PROD,
  // Development helpers (codes shown on screen, fake bank, fake ID check) exist only outside production.
  // There is no setting that turns them on in production: this is derived from NODE_ENV alone.
  DEV_MODE: !IS_PROD,
  PORT: int(env.PORT, 4242),
  // The public address of the site. Used for canonical links, share tags, sitemap.xml, robots.txt,
  // emailed links and the bank's return and callback URLs. (APP_URL still works as an old name.)
  PUBLIC_URL: (env.PUBLIC_URL || env.APP_URL || `http://localhost:${int(env.PORT, 4242)}`).replace(/\/+$/, ''),
  DATABASE_URL: env.DATABASE_URL || '',
  // Signs login sessions. (JWT_SECRET still works as an old name.)
  SESSION_SECRET: env.SESSION_SECRET || env.JWT_SECRET || JWT_DEFAULT,
  // Encrypts mentors' IBANs in the database. Losing or changing it makes stored IBANs unreadable,
  // so keep a copy somewhere safe.
  DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY || 'dev-only-data-key-never-use-in-production',

  // All money is Georgian lari. Amounts are stored as whole tetri (1/100 lari).
  CURRENCY: 'gel',
  PLATFORM_FEE_PERCENT: int(env.PLATFORM_FEE_PERCENT, 20),
  ANSWER_DEADLINE_DAYS: int(env.ANSWER_DEADLINE_DAYS, 7),
  // A mentor's earnings become payable this many days after the answer (the buyer's refund window).
  PAYOUT_HOLD_DAYS: int(env.PAYOUT_HOLD_DAYS, 7),
  // The asker can report a problem with an answer ("dispute") this many days after they can read it. Earnings are never payable
  // before this window has passed, whatever PAYOUT_HOLD_DAYS says.
  DISPUTE_DAYS: int(env.DISPUTE_DAYS, 7),
  SWEEP_INTERVAL_SECONDS: int(env.SWEEP_INTERVAL_SECONDS, 600),
  // Attempts to ask a question that were never paid (cancelled, failed, timed out) are deleted after this many days.
  UNPAID_ATTEMPT_DAYS: int(env.UNPAID_ATTEMPT_DAYS, 7),
  PRICE_MIN: 5,
  PRICE_MAX: 2000,

  // Which bank takes the money: bog | tbc | mock. "mock" is a fake bank for local development
  // only and is refused in production.
  PAYMENT_PROVIDER: (env.PAYMENT_PROVIDER || (IS_PROD ? '' : 'mock')).toLowerCase(),
  PAYMENT_TTL_MINUTES: int(env.PAYMENT_TTL_MINUTES, 30),

  // Bank of Georgia (BOG Payments API)
  BOG_CLIENT_ID: env.BOG_CLIENT_ID || '',
  BOG_CLIENT_SECRET: env.BOG_CLIENT_SECRET || '',
  BOG_API_URL: (env.BOG_API_URL || 'https://api.bog.ge').replace(/\/+$/, ''),
  BOG_AUTH_URL: env.BOG_AUTH_URL || 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token',
  // Leave empty to use the public key BOG publishes for callback signatures.
  BOG_CALLBACK_PUBLIC_KEY: (env.BOG_CALLBACK_PUBLIC_KEY || '').replace(/\\n/g, '\n'),

  // TBC Bank (tpay / E-Commerce API)
  TBC_API_KEY: env.TBC_API_KEY || '',
  TBC_CLIENT_ID: env.TBC_CLIENT_ID || '',
  TBC_CLIENT_SECRET: env.TBC_CLIENT_SECRET || '',
  TBC_API_URL: (env.TBC_API_URL || 'https://api.tbcbank.ge').replace(/\/+$/, ''),
  // [CONFIRM WITH BANK] (docs/BANK-GOLIVE.md B1, B2). The longest payment window TBC accepts: their example uses 12 minutes and the maximum
  // is not published, so 12 is what we send unless TBC confirms more (PAYMENT_TTL_MINUTES is still our own give-up time). The spelling of
  // the sub-total field: the published examples use "subTotal".
  // Asking: at most this many questions started per account per hour, and this many unpaid attempts open at once (0 = no limit; the
  // tests switch them off except where they test them).
  // Payout details: a change holds the mentor's payouts this long; an account without a password must have signed in this recently.
  PAYOUT_CHANGE_HOLD_HOURS: Math.max(0, int(env.PAYOUT_CHANGE_HOLD_HOURS, 72)),
  REAUTH_MINUTES: Math.max(1, int(env.REAUTH_MINUTES, 10)),
  // Withdrawals: the smallest amount a mentor can take out (lari; any amount when the account is closing), the estimated bank fee for
  // the admin's money overview (percent of what was received), and how payouts reach the bank ('manual' for now: server/payoutMethods).
  PAYOUT_MIN_GEL: Math.max(0, int(env.PAYOUT_MIN_GEL, 100)),
  BANK_FEE_PERCENT: Math.max(0, int(env.BANK_FEE_PERCENT, 2)),
  PAYOUT_METHOD: env.PAYOUT_METHOD || 'manual',
  BOOKINGS_PER_HOUR: Math.max(0, int(env.BOOKINGS_PER_HOUR, 10)),
  MAX_OPEN_UNPAID_BOOKINGS: Math.max(0, int(env.MAX_OPEN_UNPAID_BOOKINGS, 3)),
  TBC_MAX_EXPIRATION_MINUTES: Math.max(1, int(env.TBC_MAX_EXPIRATION_MINUTES, 12)),
  TBC_SUBTOTAL_FIELD: ['subTotal', 'subtotal'].includes(env.TBC_SUBTOTAL_FIELD) ? env.TBC_SUBTOTAL_FIELD : 'subTotal',

  // ID verification (KYC) for mentors: didit | mock. "mock" is a fake for local development only and is
  // refused in production.
  KYC_PROVIDER: (env.KYC_PROVIDER || (IS_PROD ? '' : 'mock')).toLowerCase(),
  DIDIT_API_KEY: env.DIDIT_API_KEY || '',
  DIDIT_WORKFLOW_ID: env.DIDIT_WORKFLOW_ID || '',
  DIDIT_WEBHOOK_SECRET: env.DIDIT_WEBHOOK_SECRET || '',
  DIDIT_API_URL: (env.DIDIT_API_URL || 'https://verification.didit.me').replace(/\/+$/, ''),

  EMAIL_PROVIDER: (env.EMAIL_PROVIDER || 'resend').toLowerCase(),
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  RESEND_API_URL: env.RESEND_API_URL || 'https://api.resend.com/emails',
  POSTMARK_TOKEN: env.POSTMARK_TOKEN || '',
  EMAIL_LOG_FILE: env.EMAIL_LOG_FILE || '',
  EMAIL_FROM: env.EMAIL_FROM || 'Wisecall <onboarding@resend.dev>',
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || '',
  // Error monitoring (server/errorReport.js): a Sentry project's DSN. Empty = off. No personal data is ever sent.
  SENTRY_DSN: (env.SENTRY_DSN || '').trim(),
  // Visitor statistics with Plausible (server/analytics.js): the site's domain as registered there. Empty = off.
  PLAUSIBLE_DOMAIN: (env.PLAUSIBLE_DOMAIN || '').trim(),
  PLAUSIBLE_API_URL: (env.PLAUSIBLE_API_URL || 'https://plausible.io/api/event').trim(),
  // The seller's legal details (a company or individual entrepreneur), required on receipts and in the footer for Georgian
  // e-commerce. Each is shown only when set.
  LEGAL_NAME: (env.LEGAL_NAME || '').trim(),
  LEGAL_ID: (env.LEGAL_ID || '').trim(),
  LEGAL_ADDRESS: (env.LEGAL_ADDRESS || '').trim(),
  // The founder section on the About page (hidden while FOUNDER_NAME is empty). FOUNDER_PHOTO is a path on this site (for example
  // /brand/founder.jpg; the Content-Security-Policy allows no pictures from elsewhere); the stories are plain text, one per language.
  FOUNDER: {
    name: (env.FOUNDER_NAME || '').trim(), role: (env.FOUNDER_ROLE || '').trim(),
    photo: /^\/(?!\/)[\w./-]+\.(?:jpe?g|png|webp)$/i.test((env.FOUNDER_PHOTO || '').trim()) ? env.FOUNDER_PHOTO.trim() : '',
    story: { en: (env.FOUNDER_STORY_EN || '').trim(), ka: (env.FOUNDER_STORY_KA || '').trim() }
  },
  POSTMARK_API_URL: (env.POSTMARK_API_URL || 'https://api.postmarkapp.com').replace(/\/+$/, ''),

  // Sign in with Google (OAuth 2 / OpenID Connect, done on the server). Both empty = the button is not shown.
  // Create them in Google Cloud Console (see DEPLOY.md). GOOGLE_ISSUER can only be changed outside production (tests
  // point it at a fake Google); in production it is always Google's own address.
  GOOGLE_CLIENT_ID: (env.GOOGLE_CLIENT_ID || '').trim(),
  GOOGLE_CLIENT_SECRET: (env.GOOGLE_CLIENT_SECRET || '').trim(),
  GOOGLE_ISSUER: (IS_PROD ? '' : (env.GOOGLE_ISSUER || '')).trim().replace(/\/+$/, '') || 'https://accounts.google.com',

  // prelaunch: mentors can sign up, apply and be verified, visitors can join the waiting list, and nobody can
  // pay yet. live: normal behaviour. Left empty (or "auto"), the site is in prelaunch until at least one mentor is
  // listed and live from then on; config.LAUNCH_MODE below is the mode in force right now.
  LAUNCH_MODE_SETTING: (env.LAUNCH_MODE || 'auto').trim().toLowerCase(),
  LISTED_MENTORS: null, // how many mentors can be booked; filled in by server/launch.js

  // ADMIN_EMAILS is a comma-separated list; the old single ADMIN_EMAIL still works.
  ADMIN_EMAILS: list(env.ADMIN_EMAILS || env.ADMIN_EMAIL),
  // Admin accounts must pass a second step (an authenticator app) before any admin action. "required" is the default; "off" exists only for
  // automated tests and is refused in production. A verified session lasts ADMIN_2FA_SESSION_HOURS, then the code is asked for again.
  ADMIN_2FA: (env.ADMIN_2FA || 'required').trim().toLowerCase(),
  ADMIN_2FA_SESSION_HOURS: int(env.ADMIN_2FA_SESSION_HOURS, 12),
  // New passwords are checked against known data breaches (Have I Been Pwned, k-anonymity: only the first 5 characters of the
  // password's SHA-1 leave the server). On in production unless HIBP_CHECK=off; off elsewhere unless HIBP_CHECK=on. If the service
  // cannot be reached the password is accepted.
  HIBP_CHECK: (env.HIBP_CHECK || (IS_PROD ? 'on' : 'off')).toLowerCase() === 'on',
  HIBP_API_URL: (env.HIBP_API_URL || 'https://api.pwnedpasswords.com/range/').replace(/\/?$/, '/'),

  // Mentor verification (rules v2, server/verification/rules.js).
  // AUTO_APPROVE=on lets the analysis approve a mentor by itself when EVERY condition in rules.js holds (never in a regulated niche).
  // Off (the default): every application is approved or rejected by a person, with the analysis to help.
  AUTO_APPROVE_SETTING: (env.AUTO_APPROVE || 'off').trim().toLowerCase(),
  // The AI part of the analysis (Claude, by Anthropic). No key: that part is skipped and the application goes to a person.
  ANTHROPIC_API_KEY: (env.ANTHROPIC_API_KEY || '').trim(),
  ANTHROPIC_MODEL: (env.ANTHROPIC_MODEL || 'claude-sonnet-5').trim(),
  // Asked once more when the first model declines to answer for safety reasons. Empty = no second try.
  ANTHROPIC_FALLBACK_MODEL: (env.ANTHROPIC_FALLBACK_MODEL === undefined ? 'claude-opus-5' : env.ANTHROPIC_FALLBACK_MODEL).trim(),
  // low | medium | high: how much the model thinks (lower is cheaper and faster). medium is enough for reading an application.
  ANTHROPIC_EFFORT: (env.ANTHROPIC_EFFORT || 'medium').trim().toLowerCase(),
  // Spending limits for the AI review. Past the monthly budget (US dollars, counted from what the reviews cost this calendar month) the AI
  // part is skipped and applications go to a person with the link checks only; the admins are emailed once. Each mentor gets at most this
  // many AI reviews a day (submissions and admin re-runs together).
  AI_MONTHLY_BUDGET_USD: Number.isFinite(Number(env.AI_MONTHLY_BUDGET_USD)) && env.AI_MONTHLY_BUDGET_USD !== undefined && env.AI_MONTHLY_BUDGET_USD !== '' ? Number(env.AI_MONTHLY_BUDGET_USD) : 20,
  AI_REVIEWS_PER_MENTOR_PER_DAY: int(env.AI_REVIEWS_PER_MENTOR_PER_DAY, 4),
  // Only outside production: tests point the AI at a fake server. Production always talks to Anthropic itself.
  ANTHROPIC_BASE_URL: IS_PROD ? 'https://api.anthropic.com' : ((env.ANTHROPIC_BASE_URL || '').trim() || 'https://api.anthropic.com'),
  // Domain ages for the link checks come from RDAP (public registration data). Tests point it at a fake server.
  RDAP_BASE_URL: (IS_PROD ? '' : (env.RDAP_BASE_URL || '').trim()) || 'https://rdap.org/domain/',
  // Development only: let the link checker reach addresses on this computer (the tests' fake web pages). Refused in production.
  LINK_CHECK_ALLOW_PRIVATE: env.LINK_CHECK_ALLOW_PRIVATE === '1',

  // Where visitors come from (server/attribution.js): the wc_src cookie with the campaign of the first visit. "off" stops setting it.
  ATTRIBUTION_COOKIE: String(env.ATTRIBUTION_COOKIE || 'on').trim().toLowerCase() !== 'off',

  // Live sessions (server/live/, docs/LIVE-SESSIONS-PLAN.md): the video service (daily, or fake outside production), its key, the most
  // people in one session, how long a seat is held while the buyer pays, and how far ahead a session must be published.
  LIVE_PROVIDER: (env.LIVE_PROVIDER || (IS_PROD ? '' : 'fake')).trim().toLowerCase(),
  DAILY_API_KEY: env.DAILY_API_KEY || '',
  // Only outside production: tests point Daily at a fake server.
  DAILY_API_URL: ((IS_PROD ? '' : (env.DAILY_API_URL || '').trim()) || 'https://api.daily.co/v1').replace(/\/+$/, ''),
  LIVE_MAX_PARTICIPANTS: int(env.LIVE_MAX_PARTICIPANTS, 30),
  LIVE_HOLD_MINUTES: int(env.LIVE_HOLD_MINUTES, 15),
  LIVE_MIN_LEAD_HOURS: int(env.LIVE_MIN_LEAD_HOURS, 24),
  // Series (one payment for several sessions; a cancelled session is a partial refund of it): off in production until the bank confirms
  // that several partial refunds of one payment are allowed (docs/QUESTIONS.md 2b). LIVE_SERIES=on turns it on.
  LIVE_SERIES_ENABLED: IS_PROD ? env.LIVE_SERIES === 'on' : env.LIVE_SERIES !== 'off',

  // Per-account login lockout (server/loginGuard.js): this many wrong passwords for one email within the window, and it waits this long.
  LOGIN_LOCK_FAILURES: int(env.LOGIN_LOCK_FAILURES, 10),
  LOGIN_LOCK_WINDOW_MINUTES: int(env.LOGIN_LOCK_WINDOW_MINUTES, 15),
  LOGIN_LOCK_MINUTES: int(env.LOGIN_LOCK_MINUTES, 5),

  // Cloudflare Turnstile, the "are you a person?" check on sign-up, login, forgot password, contact, the waiting list and mentor requests
  // (server/turnstile.js). Both keys come from the Cloudflare dashboard (Turnstile -> the site); with either one empty the check is off.
  TURNSTILE_SITE_KEY: (env.TURNSTILE_SITE_KEY || '').trim(),
  TURNSTILE_SECRET_KEY: (env.TURNSTILE_SECRET_KEY || '').trim(),
  // Only outside production: tests point the check at a fake server. Production always asks Cloudflare itself.
  TURNSTILE_VERIFY_URL: (IS_PROD ? '' : (env.TURNSTILE_VERIFY_URL || '').trim()) || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',

  // Public social links shown in the footer. An empty one is not shown; a value must be an https address.
  SOCIAL_URLS: Object.fromEntries(
    ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube']
      .map((name) => [name, String(env[`SOCIAL_${name.toUpperCase()}`] || '').trim()])
      .filter(([, url]) => /^https:\/\/[^\s]+$/i.test(url))
  )
};

// Which of the two outside services actually work with the keys that are set. Before launch a site can run without them (see LAUNCH_MODE):
// with no bank nothing can be booked or paid, and with no ID-check provider the ID-check step says "ID checks open soon". The fake providers
// (mock) exist only outside production.
config.PAYMENTS_ENABLED = (() => {
  const p = config.PAYMENT_PROVIDER;
  if (p === 'mock') return !IS_PROD;
  if (p === 'bog') return Boolean(config.BOG_CLIENT_ID && config.BOG_CLIENT_SECRET);
  if (p === 'tbc') return Boolean(config.TBC_API_KEY && config.TBC_CLIENT_ID && config.TBC_CLIENT_SECRET);
  return false;
})();
config.ID_CHECKS_ENABLED = (() => {
  const p = config.KYC_PROVIDER;
  if (p === 'mock') return !IS_PROD;
  if (p === 'didit') return Boolean(config.DIDIT_API_KEY && config.DIDIT_WORKFLOW_ID && config.DIDIT_WEBHOOK_SECRET);
  return false;
})();

Object.defineProperty(config, 'LAUNCH_MODE', {
  enumerable: true,
  get() {
    const s = this.LAUNCH_MODE_SETTING;
    if (s === 'prelaunch' || s === 'live') return s;
    // Automatic: live once the first mentor is listed, but never without what LAUNCH_MODE=live requires (a bank and the ID check).
    return this.PAYMENTS_ENABLED && this.ID_CHECKS_ENABLED && this.LISTED_MENTORS > 0 ? 'live' : 'prelaunch';
  }
});

config.ADMIN_2FA_REQUIRED = config.ADMIN_2FA !== 'off';
config.AUTO_APPROVE = config.AUTO_APPROVE_SETTING === 'on';
config.AI_REVIEW_ENABLED = Boolean(config.ANTHROPIC_API_KEY);
config.GOOGLE_ENABLED = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
config.TURNSTILE_ENABLED = Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY);
config.GOOGLE_CALLBACK_URL = `${config.PUBLIC_URL}/api/auth/google/callback`; // must be listed in Google Cloud Console

config.EMAIL_ENABLED = (() => {
  const p = config.EMAIL_PROVIDER;
  if (p === 'resend') return Boolean(config.RESEND_API_KEY);
  if (p === 'postmark') return Boolean(config.POSTMARK_TOKEN);
  if (p === 'log') return !IS_PROD;
  return false;
})();

// Fail fast: refuse to start with a configuration that would break or be unsafe.
const problems = [];
if (!config.DATABASE_URL) problems.push('DATABASE_URL is not set (e.g. postgresql://user:pass@localhost:5432/wisecall)');
if (!['resend', 'postmark', 'log'].includes(config.EMAIL_PROVIDER)) problems.push('EMAIL_PROVIDER must be resend, postmark or log');
if (config.PLATFORM_FEE_PERCENT < 0 || config.PLATFORM_FEE_PERCENT >= 100) problems.push('PLATFORM_FEE_PERCENT must be between 0 and 99');
if (config.LIVE_PROVIDER === 'fake' && IS_PROD) problems.push('LIVE_PROVIDER=fake is for development only (use daily, or leave it empty)');
if (config.LIVE_PROVIDER && !['daily', 'fake'].includes(config.LIVE_PROVIDER)) problems.push('LIVE_PROVIDER must be daily or fake (or empty)');
if (config.LIVE_MAX_PARTICIPANTS < 2 || config.LIVE_MAX_PARTICIPANTS > 200) problems.push('LIVE_MAX_PARTICIPANTS must be between 2 and 200');
if (!['manual'].includes(config.PAYOUT_METHOD)) problems.push('PAYOUT_METHOD must be "manual" (bank_api and split are not built yet)');
if (config.ANSWER_DEADLINE_DAYS < 1) problems.push('ANSWER_DEADLINE_DAYS must be at least 1');
if (config.PAYOUT_HOLD_DAYS < 0) problems.push('PAYOUT_HOLD_DAYS cannot be negative');
if (config.UNPAID_ATTEMPT_DAYS < 1) problems.push('UNPAID_ATTEMPT_DAYS must be at least 1');
if (!['required', 'off'].includes(config.ADMIN_2FA)) problems.push('ADMIN_2FA must be required (or, on a developer\'s computer only, off)');
if (config.ADMIN_2FA_SESSION_HOURS < 1 || config.ADMIN_2FA_SESSION_HOURS > 72) problems.push('ADMIN_2FA_SESSION_HOURS must be between 1 and 72');
if (IS_PROD && config.ADMIN_2FA === 'off') problems.push('ADMIN_2FA=off is not allowed in production: admin accounts must use two-step verification');
if (config.PAYMENT_TTL_MINUTES < 5 || config.PAYMENT_TTL_MINUTES > 1440) problems.push('PAYMENT_TTL_MINUTES must be between 5 and 1440');
if (config.PAYMENT_PROVIDER && !['bog', 'tbc', 'mock'].includes(config.PAYMENT_PROVIDER)) problems.push('PAYMENT_PROVIDER must be bog, tbc or mock');
if (config.KYC_PROVIDER && !['didit', 'mock'].includes(config.KYC_PROVIDER)) problems.push('KYC_PROVIDER must be didit or mock');
if (Boolean(config.GOOGLE_CLIENT_ID) !== Boolean(config.GOOGLE_CLIENT_SECRET)) problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set (Google sign-in) or both be empty (no Google button)');
if (!['prelaunch', 'live', 'auto'].includes(config.LAUNCH_MODE_SETTING)) problems.push('LAUNCH_MODE must be prelaunch or live (or empty: prelaunch until a mentor is listed)');
if (!['on', 'off'].includes(config.AUTO_APPROVE_SETTING)) problems.push('AUTO_APPROVE must be on or off (off: a person approves every mentor)');
if (!['low', 'medium', 'high'].includes(config.ANTHROPIC_EFFORT)) problems.push('ANTHROPIC_EFFORT must be low, medium or high');
if (!(config.AI_MONTHLY_BUDGET_USD >= 0)) problems.push('AI_MONTHLY_BUDGET_USD must be a number of US dollars (0 or more)');
if (!(config.AI_REVIEWS_PER_MENTOR_PER_DAY >= 0)) problems.push('AI_REVIEWS_PER_MENTOR_PER_DAY must be 0 or more');
if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(config.ANTHROPIC_MODEL)) problems.push('ANTHROPIC_MODEL must be a model name such as claude-sonnet-5');
if (config.ANTHROPIC_FALLBACK_MODEL && !/^[a-z0-9][a-z0-9.\-]*$/i.test(config.ANTHROPIC_FALLBACK_MODEL)) problems.push('ANTHROPIC_FALLBACK_MODEL must be a model name (or empty)');
if (IS_PROD && config.LINK_CHECK_ALLOW_PRIVATE) problems.push('LINK_CHECK_ALLOW_PRIVATE is for tests on a developer\'s computer and is not allowed in production');

if (IS_PROD) {
  const secret = env.SESSION_SECRET || env.JWT_SECRET;
  if (!secret || secret === JWT_DEFAULT || secret.length < 24) problems.push('SESSION_SECRET must be set to 24+ random characters');
  if (!env.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY.length < 32) problems.push('DATA_ENCRYPTION_KEY must be set to 32+ random characters (it encrypts mentors\' IBANs)');
  if (!env.PUBLIC_URL && !env.APP_URL) problems.push('PUBLIC_URL is required: your site\'s public https:// address (for example https://wisecallge.ge)');
  else if (!/^https:\/\//.test(config.PUBLIC_URL)) problems.push('PUBLIC_URL must be your public https:// address');
  else if (/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(config.PUBLIC_URL)) problems.push('PUBLIC_URL must be your real public address, not localhost');
  if (!['resend', 'postmark'].includes(config.EMAIL_PROVIDER)) problems.push('EMAIL_PROVIDER must be resend or postmark in production');
  if (config.EMAIL_PROVIDER === 'resend' && !config.RESEND_API_KEY) problems.push('RESEND_API_KEY is required (verification codes and password resets are sent by email)');
  if (config.EMAIL_PROVIDER === 'postmark' && !config.POSTMARK_TOKEN) problems.push('POSTMARK_TOKEN is required (verification codes and password resets are sent by email)');
  if (!env.EMAIL_FROM) problems.push('EMAIL_FROM is required (an address on a domain you verified with your email provider)');
  if (config.ADMIN_EMAILS.length === 0) problems.push('ADMIN_EMAILS is required (who can approve mentors)');

  // The fake providers are never allowed in production, launched or not.
  if (config.KYC_PROVIDER === 'mock') problems.push('KYC_PROVIDER=mock is a fake ID check for development and is not allowed in production');
  if (config.PAYMENT_PROVIDER === 'mock') problems.push('PAYMENT_PROVIDER=mock is a fake bank for development and is not allowed in production');

  // The real bank and the real ID check are required only to OPEN the site (LAUNCH_MODE=live). Before that (LAUNCH_MODE=prelaunch, or empty:
  // automatic) the server starts without them: nothing can be booked or paid, the ID-check step says "ID checks open soon", mentors can still
  // sign up and fill in their application, and visitors can join the waiting list. In automatic mode the site does not open by itself until
  // a bank is set up (see LAUNCH_MODE above).
  if (config.LAUNCH_MODE_SETTING === 'live') {
    const opening = ' (LAUNCH_MODE=live opens the site to payments; use LAUNCH_MODE=prelaunch until the keys are ready)';
    if (config.KYC_PROVIDER !== 'mock' && config.KYC_PROVIDER !== 'didit') problems.push('KYC_PROVIDER is required in production: didit' + opening);
    if (config.KYC_PROVIDER === 'didit') {
      if (!config.DIDIT_API_KEY) problems.push('DIDIT_API_KEY is required when KYC_PROVIDER=didit' + opening);
      if (!config.DIDIT_WORKFLOW_ID) problems.push('DIDIT_WORKFLOW_ID is required when KYC_PROVIDER=didit' + opening);
      if (!config.DIDIT_WEBHOOK_SECRET) problems.push('DIDIT_WEBHOOK_SECRET is required when KYC_PROVIDER=didit (webhooks are refused without it)' + opening);
    }

    if (config.PAYMENT_PROVIDER !== 'mock' && !['bog', 'tbc'].includes(config.PAYMENT_PROVIDER)) problems.push('PAYMENT_PROVIDER is required in production: bog or tbc' + opening);
    if (config.PAYMENT_PROVIDER === 'bog') {
      if (!config.BOG_CLIENT_ID) problems.push('BOG_CLIENT_ID is required when PAYMENT_PROVIDER=bog' + opening);
      if (!config.BOG_CLIENT_SECRET) problems.push('BOG_CLIENT_SECRET is required when PAYMENT_PROVIDER=bog' + opening);
    }
    if (config.PAYMENT_PROVIDER === 'tbc') {
      if (!config.TBC_API_KEY) problems.push('TBC_API_KEY is required when PAYMENT_PROVIDER=tbc' + opening);
      if (!config.TBC_CLIENT_ID) problems.push('TBC_CLIENT_ID is required when PAYMENT_PROVIDER=tbc' + opening);
      if (!config.TBC_CLIENT_SECRET) problems.push('TBC_CLIENT_SECRET is required when PAYMENT_PROVIDER=tbc' + opening);
    }
  }
}

config.PROBLEMS = problems; // read by the launch check (npm run check:launch), which sets WISECALL_NO_EXIT
if (problems.length && !env.WISECALL_NO_EXIT) {
  console.error('\nCannot start — fix these environment variables:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
  process.exit(1);
}

module.exports = config;
