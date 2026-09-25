// Things that are fine on a developer's computer but must never be true on a live site. Production refuses
// to start with most of them (see config.js); outside production they are listed clearly at startup so
// nobody forgets that a fake bank or fake ID check is active.
const config = require('./config');

function warnings() {
  const list = [];
  if (config.PAYMENT_PROVIDER === 'mock') list.push('MOCK BANK is active: nobody pays anything real. Set PAYMENT_PROVIDER=bog or tbc for real payments.');
  if (config.KYC_PROVIDER === 'mock') list.push('MOCK ID CHECK is active: no ID is really checked. Set KYC_PROVIDER=didit for real checks.');
  if (!config.EMAIL_ENABLED) list.push('EMAIL IS OFF: verification codes and reset links are shown on screen instead of being emailed. Set RESEND_API_KEY and EMAIL_FROM.');
  if (!config.ADMIN_2FA_REQUIRED) list.push('ADMIN 2FA IS OFF (ADMIN_2FA=off): admin accounts can act with just a password. This is only for automated tests; it is refused in production.');
  if (config.SESSION_SECRET === 'dev-secret-change-me-before-production') list.push('SESSION_SECRET is the built-in development value.');
  if (config.DATA_ENCRYPTION_KEY === 'dev-only-data-key-never-use-in-production') list.push('DATA_ENCRYPTION_KEY is the built-in development value: IBANs and documents are not really protected.');
  if (/localhost|127\.0\.0\.1/.test(config.PUBLIC_URL)) list.push(`PUBLIC_URL is ${config.PUBLIC_URL}: emailed links and bank callbacks point at this computer.`);
  return list;
}

// Prints the list (in yellow when the terminal supports it). Returns the list so tests can check it.
function printWarnings() {
  const list = warnings();
  if (!list.length) return list;
  const yellow = (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);
  console.warn(yellow('\n[WARNING] Development mode. Do not use this configuration for a live site:'));
  list.forEach((w) => console.warn(yellow('  - ' + w)));
  console.warn('');
  return list;
}

module.exports = { warnings, printWarnings };
