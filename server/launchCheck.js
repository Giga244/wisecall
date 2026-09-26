// The launch check behind `npm run check:launch`. It reads the same configuration the server uses, so what it
// says is what the server will do, and it talks to the real bank, ID-check and email providers through the
// same code the site uses. Each check returns { status, label, detail }:
//   ok    - fine
//   fail  - must be fixed before launch (the command exits with code 1)
//   warn  - worth a look, does not block
//   skip  - not run because something it depends on failed above
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PERSONAL_MAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|mail)\.[a-z.]+$/i;
const LOCAL_HOST = /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i;
const PLACEHOLDER = /^(change|your|xxx|todo|example|secret|password)/i;

const ok = (label, detail) => ({ status: 'ok', label, detail });
const fail = (label, detail) => ({ status: 'fail', label, detail });
const warn = (label, detail) => ({ status: 'warn', label, detail });
const skip = (label, detail) => ({ status: 'skip', label, detail });
const isEmail = (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);

// Environment settings: no network involved.
function settings(config, env) {
  const out = [];
  const prod = env.NODE_ENV === 'production';
  out.push(prod ? ok('NODE_ENV is "production"') : fail('NODE_ENV is "production"', `it is ${env.NODE_ENV ? `"${env.NODE_ENV}"` : 'empty'}. Set NODE_ENV=production; without it the site runs in development mode`));
  out.push(!config.DEV_MODE ? ok('Development mode (devMode) is off: no codes on screen, no fake bank or ID check pages') : fail('Development mode (devMode) is off', 'it is ON. It switches off by itself when NODE_ENV=production'));

  const secret = env.SESSION_SECRET || env.JWT_SECRET || '';
  out.push(secret.length >= 32 && !PLACEHOLDER.test(secret) ? ok(`SESSION_SECRET is set (${secret.length} characters)`) : fail('SESSION_SECRET is at least 32 characters', secret ? `it is ${secret.length} characters${PLACEHOLDER.test(secret) ? ' and looks like a placeholder' : ''}. Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` : 'it is not set'));
  const key = env.DATA_ENCRYPTION_KEY || '';
  out.push(key.length >= 32 && !PLACEHOLDER.test(key) ? ok(`DATA_ENCRYPTION_KEY is set (${key.length} characters)`) : fail('DATA_ENCRYPTION_KEY is at least 32 characters', key ? `it is ${key.length} characters` : 'it is not set (it encrypts mentors\' IBANs and ID documents; keep a safe copy)'));

  const url = env.PUBLIC_URL || env.APP_URL || '';
  if (!url) out.push(fail('PUBLIC_URL is your https:// address', 'it is not set (for example https://wisecallge.ge)'));
  else if (!/^https:\/\//i.test(url)) out.push(fail('PUBLIC_URL is your https:// address', `${url} is not https`));
  else if (LOCAL_HOST.test(url)) out.push(fail('PUBLIC_URL is your real address', `${url} points at this computer`));
  else out.push(ok(`PUBLIC_URL is ${config.PUBLIC_URL}`));

  out.push(config.ADMIN_EMAILS.length ? ok(`ADMIN_EMAILS has ${config.ADMIN_EMAILS.length} address${config.ADMIN_EMAILS.length > 1 ? 'es' : ''} (kept private)`) : fail('ADMIN_EMAILS is set', 'nobody could approve mentors or read contact messages'));
  out.push(config.ADMIN_2FA_REQUIRED
    ? ok(`Admin accounts need two-step verification (an authenticator app; a verified session lasts ${config.ADMIN_2FA_SESSION_HOURS} hours)`)
    : fail('Admin accounts need two-step verification', 'ADMIN_2FA=off switches it off, which is only for automated tests. Remove it (the default is required)'));
  if (!config.SUPPORT_EMAIL) out.push(warn('SUPPORT_EMAIL is set', 'it is empty, so no public contact address appears in the footer, Terms, Privacy Policy or emails, and the contact page shows only the form (messages still reach ADMIN_EMAILS). Set it to a role address such as support@wisecallge.ge before launch'));
  else if (!isEmail(config.SUPPORT_EMAIL)) out.push(fail('SUPPORT_EMAIL is an email address', `"${config.SUPPORT_EMAIL}" is not one`));
  else if (PERSONAL_MAIL.test(config.SUPPORT_EMAIL)) out.push(warn('SUPPORT_EMAIL is a role address on your own domain', `${config.SUPPORT_EMAIL} looks like a personal mailbox, and it is shown to everyone`));
  else out.push(ok(`SUPPORT_EMAIL is ${config.SUPPORT_EMAIL}`));

  if (!env.EMAIL_FROM) out.push(fail('EMAIL_FROM is set', 'it is the sender of every email, on a domain you verified with your email provider'));
  else if (/@resend\.dev>?\s*$/i.test(env.EMAIL_FROM)) out.push(fail('EMAIL_FROM is on your own domain', `${env.EMAIL_FROM} is Resend's test sender: it can only deliver to the account owner`));
  else out.push(ok(`EMAIL_FROM is ${env.EMAIL_FROM}`));

  out.push(config.DATABASE_URL ? ok('DATABASE_URL is set') : fail('DATABASE_URL is set', 'it is not set'));

  // An explicit mode is judged here; the automatic one (LAUNCH_MODE empty) needs the database, see launchModeCheck().
  const setting = config.LAUNCH_MODE_SETTING;
  if (setting === 'live') out.push(ok('LAUNCH_MODE is "live": buyers can pay'));
  else if (setting === 'prelaunch') out.push(warn('LAUNCH_MODE is "live"', 'it is "prelaunch": visitors join the waiting list and nobody can pay. Correct before opening; change to LAUNCH_MODE=live on launch day (or empty it, and the site opens by itself when the first mentor is listed)'));
  else if (setting !== 'auto') out.push(fail('LAUNCH_MODE is "prelaunch" or "live"', `"${setting}" is neither (or leave it empty for automatic)`));
  return out;
}

// Which providers are switched on, and whether they are real and have all their keys.
function providers(config) {
  const out = [];
  const ready = {};
  const missing = (names) => names.filter((n) => !config[n]);

  // Before launch (LAUNCH_MODE=prelaunch, or empty) the site runs without the bank and the ID-check provider: a missing key is a warning, not
  // a failure. It must be fixed before LAUNCH_MODE=live, where the server refuses to start without them. The fake providers are never fine.
  const early = config.LAUNCH_MODE_SETTING !== 'live';
  const problem = early ? warn : fail;
  const later = (closed) => `${early ? 'Fine while the site is in prelaunch (' + closed + ' stay closed); it must be done before LAUNCH_MODE=live' : 'LAUNCH_MODE=live needs it'}`;

  const pay = config.PAYMENT_PROVIDER;
  if (pay === 'mock') out.push(fail('Payments use a real bank', 'PAYMENT_PROVIDER=mock is the fake bank for development'));
  else if (pay === 'bog' || pay === 'tbc') {
    const need = pay === 'bog' ? ['BOG_CLIENT_ID', 'BOG_CLIENT_SECRET'] : ['TBC_API_KEY', 'TBC_CLIENT_ID', 'TBC_CLIENT_SECRET'];
    const gap = missing(need);
    ready.pay = gap.length === 0;
    out.push(gap.length ? problem(`Payment keys for ${pay.toUpperCase()} are set`, `missing: ${gap.join(', ')}. ${later('bookings and payments')}`) : ok(`Payments use ${pay === 'bog' ? 'Bank of Georgia' : 'TBC Bank'}, and its keys are set`));
  } else out.push(problem('Payments use a real bank', `PAYMENT_PROVIDER is not set (bog or tbc). ${later('bookings and payments')}`));

  const kyc = config.KYC_PROVIDER;
  if (kyc === 'mock') out.push(fail('ID checks use Didit', 'KYC_PROVIDER=mock is the fake ID check for development'));
  else if (kyc === 'didit') {
    const gap = missing(['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET']);
    ready.kyc = gap.length === 0;
    out.push(gap.length ? problem('Didit keys are set', `missing: ${gap.join(', ')}. ${later('ID checks (mentors see "ID checks open soon")')}`) : ok('ID checks use Didit, and its API key, workflow id and webhook secret are set'));
  } else out.push(problem('ID checks use Didit', `KYC_PROVIDER is not set (didit). ${later('ID checks (mentors see "ID checks open soon")')}`));

  const mail = config.EMAIL_PROVIDER;
  if (mail === 'log') out.push(fail('Email goes through a real provider', 'EMAIL_PROVIDER=log only writes to a file'));
  else if (mail === 'resend') {
    ready.mail = Boolean(config.RESEND_API_KEY);
    out.push(ready.mail ? ok('Email uses Resend, and the API key is set') : fail('Resend API key is set', 'RESEND_API_KEY is missing'));
  } else if (mail === 'postmark') {
    ready.mail = Boolean(config.POSTMARK_TOKEN);
    out.push(ready.mail ? ok('Email uses Postmark, and the server token is set') : fail('Postmark token is set', 'POSTMARK_TOKEN is missing'));
  }
  else out.push(fail('Email goes through a real provider', 'EMAIL_PROVIDER must be resend or postmark'));

  // Google sign-in is optional: off is fine, half-configured is not.
  if (Boolean(config.GOOGLE_CLIENT_ID) !== Boolean(config.GOOGLE_CLIENT_SECRET)) out.push(fail('Google sign-in keys are complete', 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty'));
  else if (config.GOOGLE_ENABLED) out.push(ok('Google sign-in is on', `in Google Cloud Console the authorised redirect URI must be exactly ${config.GOOGLE_CALLBACK_URL}`));
  else out.push(ok('Google sign-in is off', 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are empty, so people sign up with email and password only (DEPLOY.md explains how to add Google)'));

  const anyMock = pay === 'mock' || kyc === 'mock' || mail === 'log';
  out.push(anyMock ? fail('No fake (mock) provider is active', 'see above') : ok('No fake (mock) provider is active'));
  return { results: out, ready };
}

async function attempt(label, fn) {
  try {
    const r = await fn();
    if (r && typeof r === 'object') return r.warning ? warn(label, `${r.detail}. ${r.warning}`) : ok(label, r.detail);
    return ok(label, r);
  } catch (e) {
    return fail(label, e && e.message ? e.message : String(e));
  }
}

async function checkDatabase(config) {
  const label = 'The database is reachable and up to date';
  if (!config.DATABASE_URL) return skip(label, 'DATABASE_URL is not set');
  const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 8000 });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.query('SELECT 1');
    const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((f) => f.endsWith('.sql'));
    let applied = 0;
    try { applied = (await client.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n; } catch (e) { /* a brand new database */ }
    const detail = applied >= files.length ? `${applied} migrations applied` : `${applied} of ${files.length} migrations applied; the rest are applied automatically when the server starts`;
    return applied >= files.length ? ok(label, detail) : ok('The database is reachable', detail);
  } catch (e) {
    return fail(label, `cannot connect: ${e.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// How many mentors can be booked right now (null when the database has no tables yet).
async function countListed(config) {
  if (!config.DATABASE_URL) return null;
  const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 8000 });
  client.on('error', () => {});
  try {
    await client.connect();
    const { listableSql } = require('./models');
    return (await client.query(`SELECT count(*)::int AS n FROM users WHERE ${listableSql()}`)).rows[0].n;
  } catch (e) {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

// The launch mode is judged against the mentors that can really be booked.
function launchModeCheck(config, listed) {
  const s = config.LAUNCH_MODE_SETTING;
  if (s === 'live' && listed === 0) return warn('LAUNCH_MODE is "live" and there is somebody to book', 'no mentor is listed yet, so buyers would see an empty Browse page. Use prelaunch, or leave LAUNCH_MODE empty so the site opens by itself when the first mentor is listed');
  if (s !== 'auto') return null;
  if (!(config.PAYMENTS_ENABLED && config.ID_CHECKS_ENABLED)) return warn('Launch mode is automatic', `${listed ? listed + ' mentor(s) are listed, but t' : 'T'}he site stays in prelaunch (nobody can book or pay) until the bank keys and the Didit keys are set: it never opens by itself without them`);
  if (listed === null) return ok('Launch mode is automatic', 'the database has no mentors yet, so the site starts in prelaunch and opens by itself when the first mentor is listed');
  return listed === 0
    ? warn('Launch mode is automatic', '0 listed mentors, so the site is in prelaunch (visitors join the waiting list, nobody can pay). It opens by itself when the first mentor is listed')
    : ok('Launch mode is automatic', `${listed} listed mentor${listed === 1 ? '' : 's'}, so the site is live`);
}

// Every check, in the order they are shown. `deep` also opens one unused ID-check session.
async function runChecks(config, env, { deep = false } = {}) {
  const sections = [];
  const s1 = settings(config, env);
  const { results: s2, ready } = providers(config);
  sections.push({ title: 'Settings', results: s1 });
  sections.push({ title: 'Providers', results: s2 });

  const live = [];
  live.push(await checkDatabase(config));
  const modeLine = launchModeCheck(config, await countListed(config));
  if (modeLine) live.push(modeLine);

  const payName = config.PAYMENT_PROVIDER === 'tbc' ? 'TBC Bank' : 'Bank of Georgia';

  const early = config.LAUNCH_MODE_SETTING !== 'live';
  if (!ready.pay) live.push(skip(`${payName} answers and accepts your keys`, early ? 'no bank keys yet (fine in prelaunch)' : 'fix the payment settings first'));
  else live.push(await attempt(`${payName} answers and accepts your keys`, () => require(`./pay/${config.PAYMENT_PROVIDER}`).ping()));

  if (!ready.kyc) live.push(skip('Didit answers and accepts your key', early ? 'no Didit keys yet (fine in prelaunch)' : 'fix the ID-check settings first'));
  else live.push(await attempt('Didit answers and accepts your key', () => require('./kyc/didit').ping({ deep })));

  const mailName = config.EMAIL_PROVIDER === 'postmark' ? 'Postmark' : 'Resend';
  if (!ready.mail) live.push(skip(`${mailName} answers and can send from ${config.EMAIL_FROM}`, 'fix the email settings first'));
  else live.push(await attempt(`${mailName} answers and can send from your domain`, () => require('./email').ping()));

  sections.push({ title: 'Live connections', results: live });
  return sections;
}

const ICON = { ok: '✅', fail: '❌', warn: '⚠️ ', skip: '➖' };

function format(sections) {
  const lines = ['', 'Wisecall launch check', '=====================', ''];
  let fails = 0, warns = 0;
  for (const s of sections) {
    lines.push(s.title);
    for (const r of s.results) {
      if (r.status === 'fail') fails += 1;
      if (r.status === 'warn') warns += 1;
      lines.push(`  ${ICON[r.status]} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    lines.push('');
  }
  lines.push(fails
    ? `NOT READY: ${fails} thing${fails === 1 ? '' : 's'} to fix${warns ? `, ${warns} warning${warns === 1 ? '' : 's'}` : ''}.`
    : warns ? `READY, with ${warns} warning${warns === 1 ? '' : 's'} to read above.` : 'READY: every check passed.');
  lines.push('');
  return { text: lines.join('\n'), fails, warns };
}

module.exports = { runChecks, format, settings, providers };
