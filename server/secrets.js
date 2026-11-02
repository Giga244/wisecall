// Which environment variables are secret, and a guard so their values never reach the logs (docs/SECRETS.md).
//
//   SECRET  must never leave the server: not to a page, not to a log, not to an error report.
//   PUBLIC  meant to be seen by every browser (the page needs it to talk to Google, Cloudflare or Plausible).
// Everything else is ordinary settings (numbers, addresses of the providers' APIs, on/off switches).
const util = require('util');

const SECRET = [
  'SESSION_SECRET', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'DATABASE_URL', 'TEST_DATABASE_URL', 'BACKUP_SOURCE_URL',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'POSTMARK_TOKEN', 'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET_KEY',
  'DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'FLITT_SECRET_KEY', 'FLITT_PAYOUT_SECRET_KEY', 'BOG_CLIENT_SECRET', 'TBC_API_KEY', 'TBC_CLIENT_SECRET',
  'DAILY_API_KEY', 'ANTHROPIC_API_KEY', 'SENTRY_DSN'
];
const PUBLIC = ['GOOGLE_CLIENT_ID', 'TURNSTILE_SITE_KEY', 'PLAUSIBLE_DOMAIN', 'FLITT_MERCHANT_ID'];

// [name, value] for every secret that is set and long enough to recognise (a database address also gives its password on its own).
function secretValues(env = process.env) {
  const out = [];
  for (const name of SECRET) {
    const v = String(env[name] || '').trim();
    if (v.length < 8) continue;
    out.push([name, v]);
    const pw = /^[a-z]+:\/\/[^:/@\s]+:([^@\s]+)@/i.exec(v);
    if (pw && pw[1].length >= 6) out.push([name, decodeURIComponent(pw[1])], [name, pw[1]]);
  }
  return out.sort((a, b) => b[1].length - a[1].length);
}

// The text with every secret value replaced by its name.
function redact(text, values = secretValues()) {
  let s = String(text);
  for (const [name, v] of values) if (s.includes(v)) s = s.split(v).join(`[${name} hidden]`);
  return s;
}

// console.log/info/warn/error/debug: what would be written is written with the secrets taken out. Installed once, first thing at start.
let guarded = false;
function guardConsole() {
  if (guarded) return;
  guarded = true;
  const values = secretValues();
  if (!values.length) return;
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => original(redact(util.format(...args), values));
  }
}

module.exports = { SECRET, PUBLIC, secretValues, redact, guardConsole };
