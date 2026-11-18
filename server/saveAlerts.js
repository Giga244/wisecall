// "I hear about failures before users do": when a signed-in person's save is refused or fails on the server (any 4xx or 5xx answer to a
// request that changes something), the owner is emailed: who, on which page, which field, and the error. At most once an hour for the
// same person and error, and never more than MAX_PER_HOUR in all (an outage must not become a flood).
//   to       ALERT_EMAILS (the ALERT_EMAIL setting; the admins, ADMIN_EMAILS, when it is not set)
//   never    what the person typed, passwords, tokens or the address's query: only the page's path, the field's name and the error's code
//   skipped  admins (their own panel), requests without a signed-in person, the drafts themselves, sign-in and code checks
//            (/api/auth: a wrong password or code is not a failed save), and the fake services of the tests
// The answer's { error, field, ref } is read as it is sent (res.json), so nothing has to be added to any route.
const config = require('./config');
const { escapeHtml } = require('./email');

const HOUR = 60 * 60 * 1000;
const MAX_PER_HOUR = 30;
const SKIP = /^\/api\/(?:auth\/|me\/drafts(?:\/|$)|mock-|admin\/|analytics|email\/webhook|waitlist|contact)/;
const seen = new Map(); // "user|error" -> when the owner was last told
let windowStart = 0;
let sentInWindow = 0;

const recipients = () => (config.ALERT_EMAILS && config.ALERT_EMAILS.length ? config.ALERT_EMAILS : config.ADMIN_EMAILS);

// The page the request came from: its path only (a query can hold a token or what was searched for).
function pageOf(req) {
  try { return new URL(req.get('referer')).pathname.slice(0, 200); } catch (e) { return ''; }
}

// Whether this failure should be told now (and notes that it was).
function due(userId, code, now = Date.now()) {
  if (now - windowStart > HOUR) { windowStart = now; sentInWindow = 0; for (const [k, at] of seen) if (now - at > HOUR) seen.delete(k); }
  const key = `${userId}|${code}`;
  if (seen.has(key) && now - seen.get(key) < HOUR) return false;
  if (sentInWindow >= MAX_PER_HOUR) return false;
  seen.set(key, now);
  sentInWindow += 1;
  return true;
}

async function tell(info) {
  const user = await require('./models').getUserById(info.userId);
  if (!user) return;
  // (an admin's own work in the panel, and their own account, is not "a user's save")
  if (user.email && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase())) return;
  if (!due(info.userId, info.error)) return;
  const rows = [
    ['User', `${user.name || ''} <${user.email || ''}>`], ['User id', user.id], ['Request', `${info.method} ${info.path}`], ['Page', info.page || '(not sent by the browser)'],
    ['Field', info.field || '(none named)'], ['Error', `${info.status} ${info.error}`], ...(info.ref ? [['Reference', info.ref]] : []), ['When', new Date().toISOString()]
  ];
  const html = `<p>A save failed for a signed-in user on Wisecall.</p><table>${rows.map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
    + '<p>You get this at most once an hour for the same user and error. What the user typed is never included.</p>';
  const text = `A save failed for a signed-in user on Wisecall.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAt most once an hour for the same user and error. What the user typed is never included.`;
  const subject = `Wisecall: a save failed (${info.error}${info.field ? `, ${info.field}` : ''})`;
  const { sendEmail } = require('./email');
  await Promise.all(recipients().map((to) => sendEmail({ to, subject, html, text }).catch((e) => console.error('[save-alert] email failed:', e.message))));
}

function middleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || SKIP.test(req.originalUrl || req.path)) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) res.locals.saveAnswer = { error: body.error, field: body.field, ref: body.ref };
    return json(body);
  };
  res.on('finish', () => {
    if (res.statusCode < 400 || !req.userToken || !req.userToken.id) return;
    const a = res.locals.saveAnswer || {};
    const info = { userId: req.userToken.id, method: req.method, path: String(req.originalUrl || '').split('?')[0].slice(0, 200), page: pageOf(req),
      field: typeof a.field === 'string' ? a.field.slice(0, 80) : '', error: typeof a.error === 'string' ? a.error.slice(0, 80) : `http_${res.statusCode}`,
      status: res.statusCode, ref: typeof a.ref === 'string' ? a.ref.slice(0, 40) : '' };
    console.warn(`[save-failed] ${info.method} ${info.path} ${info.status} ${info.error}${info.field ? ` field=${info.field}` : ''} user=${info.userId}${info.page ? ` page=${info.page}` : ''}`);
    if (!config.EMAIL_ENABLED) return;
    tell(info).catch((e) => console.error('[save-alert] failed:', e.message));
  });
  next();
}

module.exports = { middleware, due, MAX_PER_HOUR };
