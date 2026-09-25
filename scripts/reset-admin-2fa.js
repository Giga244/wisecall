#!/usr/bin/env node
// npm run admin:reset-2fa -- someone@example.com
// For an admin who lost their phone AND their recovery codes. It removes their two-step verification, so at their next sign-in the site shows
// the set-up page again (a new QR code and new recovery codes). Only somebody with access to the server can run it, which is the point.
process.env.WISECALL_NO_EXIT = process.env.WISECALL_NO_EXIT || '1';
const config = require('../server/config');
const db = require('../server/db');
const { getUserByEmail } = require('../server/models');
const twoFactor = require('../server/twoFactor');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) { console.error('Usage: npm run admin:reset-2fa -- someone@example.com'); process.exitCode = 1; return; }
  const user = await getUserByEmail(email);
  if (!user) { console.error(`No account has the address ${email}.`); process.exitCode = 1; return; }
  if (!config.ADMIN_EMAILS.includes(email)) console.warn(`Note: ${email} is not in ADMIN_EMAILS, so they cannot use the admin panel anyway.`);
  const removed = await twoFactor.reset(user.id);
  console.log(removed ? `Two-step verification was removed for ${email}. They set it up again at their next admin sign-in.` : `${email} had no two-step verification set up.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close && db.close());
