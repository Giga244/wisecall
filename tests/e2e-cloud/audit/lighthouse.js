#!/usr/bin/env node
// Lighthouse (mobile, and desktop with --desktop) for home, a mentor profile and Browse, on a RUNNING local site with demo data.
//   node tests/e2e-cloud/audit/lighthouse.js [--base http://localhost:4242] [--desktop] [--runs 3]
// Writes docs/quality-screens/lighthouse.json (median of the runs per page) and prints the scores and the main opportunities.
// Uses the lighthouse and chrome-launcher packages already in the root devDependencies. CHROME_PATH picks the browser.
const fs = require('fs');
const path = require('path');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const BASE = String(arg('base', 'http://localhost:4242')).replace(/\/+$/, '');
const RUNS = Number(arg('runs', 3));
const DESKTOP = process.argv.includes('--desktop');
const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'quality-screens', DESKTOP ? 'lighthouse-desktop.json' : 'lighthouse.json');
process.env.CHROME_PATH = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const { default: lighthouse } = await import('lighthouse');
  const desktopConfig = (await import('lighthouse/core/config/desktop-config.js')).default;
  const chromeLauncher = await import('chrome-launcher');
  const experts = (await (await fetch(`${BASE}/api/experts`)).json()).experts || [];
  const profile = experts.find((e) => e.username) || {};
  const pages = { home: '/', profile: `/u/${profile.username}`, browse: '/?niche=tech#experts' };
  const out = {};
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  try {
    for (const [name, url] of Object.entries(pages)) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await lighthouse(BASE + url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] }, DESKTOP ? desktopConfig : undefined);
        const lhr = r.lhr;
        runs.push({
          scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)])),
          metrics: Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'].map((k) => [k, lhr.audits[k] && lhr.audits[k].displayValue])),
          weightKb: Math.round((lhr.audits['total-byte-weight'].numericValue || 0) / 1024),
          failing: Object.values(lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual').map((a) => `${a.id}${a.displayValue ? ' (' + a.displayValue + ')' : ''}`).slice(0, 12)
        });
      }
      runs.sort((a, b) => a.scores.performance - b.scores.performance);
      out[name] = { url, ...runs[Math.floor(runs.length / 2)], performanceRuns: runs.map((r) => r.scores.performance) };
      console.log(`${name.padEnd(8)} ${JSON.stringify(out[name].scores)}  LCP ${out[name].metrics['largest-contentful-paint']}  ${out[name].weightKb} KB`);
      if (out[name].failing.length) console.log('   below 90: ' + out[name].failing.join(', '));
    }
  } finally { await chrome.kill(); }
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, formFactor: DESKTOP ? 'desktop' : 'mobile', runs: RUNS, note: 'Local server over http on the same machine: network timings are optimistic, and HTTPS/HTTP2 checks do not apply.', pages: out }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
