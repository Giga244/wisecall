// End-to-end flows from the cloud quality pack, on a desktop and a phone viewport.
//   npx playwright test -c tests/e2e-cloud
// It reuses the project's own browser-test server (e2e/global-setup.js): a real Wisecall server on port 4620 against TEST_DATABASE_URL
// (WIPED first), the fake bank, the fake ID check, a fake AI and every email written to e2e/.tmp/mail.jsonl. Nothing here is real.
// Uses the @playwright/test and @axe-core/playwright already in the root devDependencies (nothing new to install). If Playwright's own
// browser is not installed, set CHROMIUM_PATH (in the cloud container: /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { defineConfig, devices } = require('@playwright/test');

const FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync(FALLBACK) ? FALLBACK : undefined);

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1, // one server, one database, flows in order
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, 'results', 'results.json') }]],
  outputDir: path.join(__dirname, 'results', 'artifacts'),
  globalSetup: require.resolve('../../e2e/global-setup.js'),
  use: {
    baseURL: 'http://localhost:4620',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {}
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 375, height: 812 } } }
  ]
});
