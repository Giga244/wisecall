require('dotenv').config();

const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const JWT_DEFAULT = 'dev-secret-change-me-before-production';

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : fallback);

const config = {
  IS_PROD,
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
  SWEEP_INTERVAL_SECONDS: int(env.SWEEP_INTERVAL_SECONDS, 600),
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

  EMAIL_PROVIDER: (env.EMAIL_PROVIDER || 'resend').toLowerCase(),
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  RESEND_API_URL: env.RESEND_API_URL || 'https://api.resend.com/emails',
  POSTMARK_TOKEN: env.POSTMARK_TOKEN || '',
  EMAIL_LOG_FILE: env.EMAIL_LOG_FILE || '',
  EMAIL_FROM: env.EMAIL_FROM || 'Wisecall <onboarding@resend.dev>',
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || '',

  // ADMIN_EMAILS is a comma-separated list; the old single ADMIN_EMAIL still works.
  ADMIN_EMAILS: list(env.ADMIN_EMAILS || env.ADMIN_EMAIL)
};

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
if (config.ANSWER_DEADLINE_DAYS < 1) problems.push('ANSWER_DEADLINE_DAYS must be at least 1');
if (config.PAYOUT_HOLD_DAYS < 0) problems.push('PAYOUT_HOLD_DAYS cannot be negative');
if (config.PAYMENT_TTL_MINUTES < 5 || config.PAYMENT_TTL_MINUTES > 1440) problems.push('PAYMENT_TTL_MINUTES must be between 5 and 1440');
if (config.PAYMENT_PROVIDER && !['bog', 'tbc', 'mock'].includes(config.PAYMENT_PROVIDER)) problems.push('PAYMENT_PROVIDER must be bog, tbc or mock');

if (IS_PROD) {
  const secret = env.SESSION_SECRET || env.JWT_SECRET;
  if (!secret || secret === JWT_DEFAULT || secret.length < 24) problems.push('SESSION_SECRET must be set to 24+ random characters');
  if (!env.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY.length < 32) problems.push('DATA_ENCRYPTION_KEY must be set to 32+ random characters (it encrypts mentors\' IBANs)');
  if (!env.PUBLIC_URL && !env.APP_URL) problems.push('PUBLIC_URL is required: your site\'s public https:// address (for example https://wisecall.ge)');
  else if (!/^https:\/\//.test(config.PUBLIC_URL)) problems.push('PUBLIC_URL must be your public https:// address');
  else if (/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(config.PUBLIC_URL)) problems.push('PUBLIC_URL must be your real public address, not localhost');
  if (!['resend', 'postmark'].includes(config.EMAIL_PROVIDER)) problems.push('EMAIL_PROVIDER must be resend or postmark in production');
  if (config.EMAIL_PROVIDER === 'resend' && !config.RESEND_API_KEY) problems.push('RESEND_API_KEY is required (verification codes and password resets are sent by email)');
  if (config.EMAIL_PROVIDER === 'postmark' && !config.POSTMARK_TOKEN) problems.push('POSTMARK_TOKEN is required (verification codes and password resets are sent by email)');
  if (!env.EMAIL_FROM) problems.push('EMAIL_FROM is required (an address on a domain you verified with your email provider)');
  if (config.ADMIN_EMAILS.length === 0) problems.push('ADMIN_EMAILS is required (who can approve mentors)');

  if (config.PAYMENT_PROVIDER === 'mock') problems.push('PAYMENT_PROVIDER=mock is a fake bank for development and is not allowed in production');
  else if (!['bog', 'tbc'].includes(config.PAYMENT_PROVIDER)) problems.push('PAYMENT_PROVIDER is required in production: bog or tbc');
  if (config.PAYMENT_PROVIDER === 'bog') {
    if (!config.BOG_CLIENT_ID) problems.push('BOG_CLIENT_ID is required when PAYMENT_PROVIDER=bog');
    if (!config.BOG_CLIENT_SECRET) problems.push('BOG_CLIENT_SECRET is required when PAYMENT_PROVIDER=bog');
  }
  if (config.PAYMENT_PROVIDER === 'tbc') {
    if (!config.TBC_API_KEY) problems.push('TBC_API_KEY is required when PAYMENT_PROVIDER=tbc');
    if (!config.TBC_CLIENT_ID) problems.push('TBC_CLIENT_ID is required when PAYMENT_PROVIDER=tbc');
    if (!config.TBC_CLIENT_SECRET) problems.push('TBC_CLIENT_SECRET is required when PAYMENT_PROVIDER=tbc');
  }
}

if (problems.length) {
  console.error('\nCannot start — fix these environment variables:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
  process.exit(1);
}

module.exports = config;
