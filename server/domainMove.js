// Moving the site to another domain (docs/DOMAIN-MOVE.md). Two rules, both a permanent 301 to the same path and query on PUBLIC_URL:
//
//   OLD_DOMAINS   the site's earlier address(es), comma-separated ("old-site.ge,www.old-site.ge"). A request whose host is one of them is
//                 sent to PUBLIC_URL before anything else runs, so every old link, bookmark and search result lands on the same page of
//                 the new address. Empty (the default) = no redirect at all: nothing changes until the owner sets it.
//   www           "www." + the site's own host goes to the host without it (always; nothing to set).
//
// What is NOT redirected, on any host: the addresses outside services call themselves. They keep calling the old address until the owner
// changes it at each service, and a redirect would lose the call (a POST does not survive a 301), so these answer on both domains:
//   /api/kyc/webhook             the ID check's result (Didit)
//   /api/payments/...            the bank's callback, and the payout callback
//   /api/email/webhook           the email provider's delivery results (Resend)
//   /api/auth/google/callback    Google sign-in coming back
//   /api/waitlist-one-click      the mail app's one-click "Unsubscribe" (the address is inside emails that were already sent)
//   /healthz                     the hosting platform's health check
const config = require('./config');

const KEEP = [/^\/api\/kyc\/webhook(?:\/|$)/, /^\/api\/payments\//, /^\/api\/email\/webhook(?:\/|$)/, /^\/api\/auth\/google\/callback(?:\/|$)/, /^\/api\/waitlist-one-click(?:\/|$)/, /^\/healthz$/];
const answersEverywhere = (path) => KEEP.some((re) => re.test(path));

// The host a request came for, without its port, in small letters (behind the hosting platform's proxy: the host the visitor asked for).
const hostOf = (req) => String(req.hostname || '').toLowerCase().replace(/\.$/, '');
const siteHost = () => { try { return new URL(config.PUBLIC_URL).hostname.toLowerCase(); } catch (e) { return ''; } };

// (an old domain's "www." form counts too, set or not: www.old-site.ge goes straight to PUBLIC_URL in one step, never through old-site.ge)
function moved(host) {
  const own = siteHost();
  if (!host || !own || host === own) return false;
  if (!own.startsWith('www.') && host === `www.${own}`) return true;
  return config.OLD_DOMAINS.includes(host) || (host.startsWith('www.') && config.OLD_DOMAINS.includes(host.slice(4)));
}

function redirectOldDomains(req, res, next) {
  if (!moved(hostOf(req)) || answersEverywhere(req.path)) return next();
  // (the same path and query; always a path of this site, so the redirect can only ever lead to PUBLIC_URL)
  const rest = typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/') ? req.originalUrl : '/';
  res.set('Cache-Control', 'public, max-age=3600');
  res.redirect(301, config.PUBLIC_URL + rest);
}

module.exports = { redirectOldDomains, moved, answersEverywhere, KEEP };
