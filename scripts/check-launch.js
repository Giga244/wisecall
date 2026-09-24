#!/usr/bin/env node
// npm run check:launch  [-- --deep]
// Run it where the site will run (your host's console), or on your computer with the production values in
// .env plus NODE_ENV=production. Exit code 0 = ready, 1 = something must be fixed. It never prints a secret.
// --deep also opens one ID-check session with Didit (never used, costs nothing) to prove the workflow id.
process.env.WISECALL_NO_EXIT = '1'; // let the config report its problems instead of stopping the program
const config = require('../server/config');
const { runChecks, format } = require('../server/launchCheck');

(async () => {
  const sections = await runChecks(config, process.env, { deep: process.argv.includes('--deep') });
  const { text, fails } = format(sections);
  console.log(text);
  process.exitCode = fails ? 1 : 0; // no process.exit(): on Windows it can abort while a network socket is closing
})().catch((e) => {
  console.error('The launch check itself crashed:', e.message);
  process.exitCode = 2;
});
