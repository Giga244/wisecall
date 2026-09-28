#!/usr/bin/env node
// npm run lighthouse -- [--base http://localhost:4242] [--login email:password] [--pages home,expert,signup,dashboard,settings]
//   (other pages: login, contact, faq, verify, help, ka = the Georgian home) [--details] [--dark] [--shots folder]
// Runs Lighthouse (mobile and desktop) on the main pages of a RUNNING site and prints the four scores per page. Pages
// that need an account (dashboard, settings) are audited signed in as --login. Set CHROME_PATH to use a browser other
// than the one Chrome finds by itself. The exit code is 1 when any score is below 90.
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const BASE = String(arg('base', 'http://localhost:4242')).replace(/\/+$/, '');
const LOGIN = arg('login', '');
const WANT = String(arg('pages', 'home,expert,signup,dashboard,settings')).split(',');
const DETAILS = arg('details', false) !== false;
const DARK = arg('dark', false) !== false;
const SHOTS = arg('shots', '') || ''; // a folder to keep the final screenshot of every audit in (to see what was audited)
const TARGET = 90;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

async function signedInCookie() {
  const [email, ...rest] = String(LOGIN).split(':');
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ email, password: rest.join(':') }) });
  if (!res.ok) throw new Error(`Could not sign in as ${email}: ${res.status}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

(async () => {
  const { default: lighthouse } = await import('lighthouse');
  const desktop = (await import('lighthouse/core/config/desktop-config.js')).default;
  const chromeLauncher = await import('chrome-launcher');

  const experts = await (await fetch(`${BASE}/api/experts`)).json().catch(() => ({ experts: [] }));
  const pages = {
    home: '/',
    expert: experts.experts && experts.experts[0] ? `/u/${experts.experts[0].username}` : null,
    signup: '/signup.html',
    login: '/login.html',
    contact: '/contact.html',
    faq: '/faq.html',
    verify: '/how-we-verify.html',
    help: '/help.html',
    ka: '/ka/',
    dashboard: LOGIN ? '/dashboard.html' : null,
    settings: LOGIN ? '/settings.html' : null
  };
  // Signed-in pages, and the sign-up and login pages, are kept out of search engines on purpose (noindex, and robots.txt for the
  // signed-in ones). Lighthouse's "page is blocked from indexing" check always fails for them, so it is left out of their SEO score here
  // and reported as n/a.
  const PRIVATE = new Set(['dashboard', 'settings', 'signup', 'login']);
  const cookie = LOGIN ? await signedInCookie() : '';

  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'], chromePath: process.env.CHROME_PATH });
  if (DARK) {
    // --dark audits the dark theme. Chrome cannot be told from the command line that its device prefers dark, so the choice is stored
    // the way the header's theme menu stores it (Lighthouse then keeps the storage instead of clearing it).
    const { chromium } = require('@playwright/test');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
    const page = await (browser.contexts()[0] || await browser.newContext()).newPage();
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.setItem('wisecall_theme', 'dark'));
    await page.close();
    await browser.close();
  }
  const rows = [];
  let worst = 100;
  try {
    for (const name of WANT) {
      const path = pages[name];
      if (!path) { console.log(`skipping ${name} (needs ${name === 'expert' ? 'a listed expert' : '--login email:password'})`); continue; }
      for (const form of ['mobile', 'desktop']) {
        const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES, ...(DARK ? { disableStorageReset: true } : {}), ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}) };
        const result = await lighthouse(BASE + path, flags, form === 'desktop' ? desktop : undefined);
        const lhr = result.lhr;
        if (SHOTS) require('fs').writeFileSync(require('path').join(SHOTS, `lighthouse-${DARK ? 'dark' : 'light'}-${name}-${form}.jpg`), Buffer.from(String(lhr.audits['final-screenshot'].details.data).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        const scores = CATEGORIES.map((c) => Math.round((lhr.categories[c].score || 0) * 100));
        const seoFails = lhr.categories.seo.auditRefs.filter((r) => lhr.audits[r.id].score !== null && lhr.audits[r.id].score < 1 && !['informative', 'notApplicable', 'manual'].includes(lhr.audits[r.id].scoreDisplayMode)).map((r) => r.id);
        const seoNa = PRIVATE.has(name) && seoFails.length === 1 && seoFails[0] === 'is-crawlable';
        worst = Math.min(worst, ...scores.filter((s, i) => !(seoNa && CATEGORIES[i] === 'seo')));
        rows.push({ page: name, form, scores, seoNa });
        const bad = [];
        for (const c of CATEGORIES) {
          for (const ref of lhr.categories[c].auditRefs) {
            const a = lhr.audits[ref.id];
            if (a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual') {
              const all = a.details && Array.isArray(a.details.items) ? a.details.items : [];
              const items = all.slice(0, 3).map((it) => (it.node && it.node.snippet) || it.url || (it.source && it.source.url) || it.label || '').filter(Boolean);
              bad.push(`    - [${c}] ${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}${items.length ? `\n        ${items.join('\n        ').slice(0, 400)}` : ''}`);
            }
          }
        }
        const shown = bad.filter((line) => !(seoNa && line.includes('[seo]')));
        if (DETAILS || scores.some((s, i) => s < TARGET && !(seoNa && CATEGORIES[i] === 'seo'))) console.log(`${name} (${form}): ${scores.join(' / ')}${shown.length ? '\n' + shown.join('\n') : ''}`);
      }
    }
  } finally {
    // On Windows Chrome can still hold its temporary profile for a moment, and removing it then fails; that is harmless.
    try { await chrome.kill(); } catch (e) { /* the temporary profile is left behind in the temp folder */ }
  }
  console.log('\nLighthouse scores (Performance / Accessibility / Best Practices / SEO)');
  console.log('page'.padEnd(12) + 'device'.padEnd(10) + 'Perf'.padStart(6) + 'A11y'.padStart(6) + 'BP'.padStart(6) + 'SEO'.padStart(6));
  for (const r of rows) console.log(r.page.padEnd(12) + r.form.padEnd(10) + r.scores.map((s, i) => (r.seoNa && i === 3 ? 'n/a*' : String(s)).padStart(6)).join(''));
  if (rows.some((r) => r.seoNa)) console.log('* signed-in pages and the sign-up / login pages are kept out of search engines on purpose, so the indexing check does not apply to them');
  console.log(worst >= TARGET ? `\nEvery score is ${TARGET} or more.` : `\nLowest score: ${worst} (target ${TARGET}).`);
  process.exitCode = worst >= TARGET ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 2; });
