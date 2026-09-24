// End-to-end tests (npm run test:e2e). A real Wisecall server runs against the TEST database (wiped) with the
// fake bank, the fake ID check and a mail log; Playwright drives it in a real Chromium, like a person would.
require('dotenv').config();
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1, // the tests share one server and one database, and run in order
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  outputDir: 'e2e/results',
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: 'http://localhost:4620',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 }
  }
});
