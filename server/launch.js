// Which mode the site is in. config.LAUNCH_MODE is "prelaunch" or "live":
//   - set explicitly with LAUNCH_MODE=prelaunch or LAUNCH_MODE=live, that is what it is;
//   - left empty ("auto"), it is prelaunch while nobody can be booked (no mentor is verified, with payout details saved)
//     and live from the moment there is at least one.
// This file keeps the number of bookable mentors up to date (config.LISTED_MENTORS).
const { query } = require('./db');
const config = require('./config');
const { listableSql } = require('./models');

let lastCheck = 0;

async function refresh() {
  const before = config.LAUNCH_MODE;
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE ${listableSql()}`);
    config.LISTED_MENTORS = rows[0].n;
  } catch (e) {
    console.error('[launch] could not count the listed mentors:', e.message);
  }
  lastCheck = Date.now();
  if (before !== config.LAUNCH_MODE) console.log(`[launch] the site is now in ${config.LAUNCH_MODE.toUpperCase()} mode (${config.LISTED_MENTORS} listed mentor(s))`);
  return config.LISTED_MENTORS;
}

// Cheap enough to call on every page load: the count is only re-read when it is older than maxAgeMs.
const ensureFresh = (maxAgeMs = 5000) => (Date.now() - lastCheck > maxAgeMs ? refresh() : Promise.resolve(config.LISTED_MENTORS));

// What to tell whoever runs the site (printed at startup, and by `npm run check:launch`): an explicit "live" with nobody to book is a
// mistake worth a warning, and so is a site with no public contact address.
function warnings() {
  const list = [];
  if (!config.SUPPORT_EMAIL) {
    list.push('SUPPORT_EMAIL is not set: no contact address appears in the footer, the Terms, the Privacy Policy or the emails, and the contact page shows only the form (messages still reach ADMIN_EMAILS). Set it to a role address such as support@yourdomain.ge before launch (for local testing, support@wisecall.test).');
  }
  // Before launch the site can run without the bank and the ID-check provider: say plainly what is closed, and why it does not open by itself.
  if (!config.PAYMENTS_ENABLED) list.push('PAYMENTS ARE OFF (no bank keys): bookings and payments are closed and the site stays in prelaunch. Set PAYMENT_PROVIDER (bog or tbc) and the bank keys, then LAUNCH_MODE=live (or empty), before you open it.');
  if (!config.ID_CHECKS_ENABLED) list.push('ID CHECKS ARE OFF (no Didit keys): mentors see "ID checks open soon" and cannot pass the ID step yet. Set KYC_PROVIDER=didit and the Didit keys before you approve mentors.');
  if (config.LAUNCH_MODE_SETTING === 'auto' && config.LISTED_MENTORS > 0 && !(config.PAYMENTS_ENABLED && config.ID_CHECKS_ENABLED)) {
    list.push(`${config.LISTED_MENTORS} mentor(s) are listed, but the site stays in prelaunch (nobody can book or pay): it opens by itself only once the bank keys and the Didit keys are set.`);
  }
  if (config.LAUNCH_MODE_SETTING === 'live' && config.LISTED_MENTORS === 0) {
    list.push('LAUNCH_MODE=live, but no mentor is listed yet: buyers would see an empty Browse page. Use LAUNCH_MODE=prelaunch, or leave it empty so the site opens by itself when the first mentor is listed.');
  }
  return list;
}

module.exports = { refresh, ensureFresh, warnings };
