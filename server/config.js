require('dotenv').config();

const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const resendKey = process.env.RESEND_API_KEY || '';

const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_DEFAULT = 'dev-secret-change-me-before-production';
if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === JWT_DEFAULT || process.env.JWT_SECRET.length < 24)) {
  console.error('FATAL: set JWT_SECRET (24+ random characters) before running with NODE_ENV=production.');
  process.exit(1);
}

module.exports = {
  IS_PROD,
  PORT: process.env.PORT || 4242,
  JWT_SECRET: process.env.JWT_SECRET || JWT_DEFAULT,
  CURRENCY: (process.env.CURRENCY || 'usd').toLowerCase(),
  PLATFORM_FEE_PERCENT: Number(process.env.PLATFORM_FEE_PERCENT || 3),
  STRIPE_SECRET_KEY: stripeKey,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_ENABLED: Boolean(stripeKey && stripeKey.startsWith('sk_')),
  APP_URL: process.env.APP_URL || `http://localhost:${process.env.PORT || 4242}`,
  RESEND_API_KEY: resendKey,
  EMAIL_FROM: process.env.EMAIL_FROM || 'Wisecall <onboarding@resend.dev>',
  EMAIL_ENABLED: Boolean(resendKey),
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
};
