require('dotenv').config();

const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const JWT_DEFAULT = 'dev-secret-change-me-before-production';

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : fallback);

const stripeKey = env.STRIPE_SECRET_KEY || '';
const config = {
  IS_PROD,
  PORT: int(env.PORT, 4242),
  APP_URL: (env.APP_URL || `http://localhost:${int(env.PORT, 4242)}`).replace(/\/+$/, ''),
  DATABASE_URL: env.DATABASE_URL || '',
  JWT_SECRET: env.JWT_SECRET || JWT_DEFAULT,

  CURRENCY: (env.CURRENCY || 'usd').toLowerCase(),
  PLATFORM_FEE_PERCENT: int(env.PLATFORM_FEE_PERCENT, 20),
  ANSWER_DEADLINE_DAYS: int(env.ANSWER_DEADLINE_DAYS, 7),
  SWEEP_INTERVAL_SECONDS: int(env.SWEEP_INTERVAL_SECONDS, 600),

  STRIPE_SECRET_KEY: stripeKey,
  STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY || '',
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_ENABLED: Boolean(stripeKey && stripeKey.startsWith('sk_')),
  // Set true when mentors live in a different country than your Stripe platform account.
  STRIPE_CROSS_BORDER_PAYOUTS: env.STRIPE_CROSS_BORDER_PAYOUTS === 'true',
  // Without Stripe keys every question is marked paid instantly and nobody is charged. Fine for a
  // demo, but in production it must be switched on deliberately.
  ALLOW_SIMULATED_PAYMENTS: env.ALLOW_SIMULATED_PAYMENTS === 'true',

  EMAIL_PROVIDER: (env.EMAIL_PROVIDER || 'resend').toLowerCase(),
  RESEND_API_KEY: env.RESEND_API_KEY || '',
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

if (IS_PROD) {
  if (!env.JWT_SECRET || env.JWT_SECRET === JWT_DEFAULT || env.JWT_SECRET.length < 24) problems.push('JWT_SECRET must be set to 24+ random characters');
  if (!/^https:\/\//.test(config.APP_URL)) problems.push('APP_URL must be your public https:// address');
  if (!['resend', 'postmark'].includes(config.EMAIL_PROVIDER)) problems.push('EMAIL_PROVIDER must be resend or postmark in production');
  if (config.EMAIL_PROVIDER === 'resend' && !config.RESEND_API_KEY) problems.push('RESEND_API_KEY is required (verification codes and password resets are sent by email)');
  if (config.EMAIL_PROVIDER === 'postmark' && !config.POSTMARK_TOKEN) problems.push('POSTMARK_TOKEN is required (verification codes and password resets are sent by email)');
  if (!env.EMAIL_FROM) problems.push('EMAIL_FROM is required (an address on a domain you verified with your email provider)');
  if (config.ADMIN_EMAILS.length === 0) problems.push('ADMIN_EMAILS is required (who can approve mentors)');
  if (!config.STRIPE_ENABLED && !config.ALLOW_SIMULATED_PAYMENTS && !config.STRIPE_SECRET_KEY) problems.push('STRIPE_SECRET_KEY is required in production, or nobody is charged. To run a demo with fake payments on purpose, set ALLOW_SIMULATED_PAYMENTS=true');
  if (config.STRIPE_SECRET_KEY && !config.STRIPE_SECRET_KEY.startsWith('sk_')) problems.push('STRIPE_SECRET_KEY does not look like a Stripe secret key');
  if (config.STRIPE_ENABLED && !config.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET is required when Stripe is enabled');
  if (config.STRIPE_ENABLED && !config.STRIPE_PUBLISHABLE_KEY) problems.push('STRIPE_PUBLISHABLE_KEY is required when Stripe is enabled');
}

if (problems.length) {
  console.error('\nCannot start — fix these environment variables:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
  process.exit(1);
}

module.exports = config;
