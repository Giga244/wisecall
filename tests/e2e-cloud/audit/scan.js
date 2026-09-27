#!/usr/bin/env node
// Quality scan of a RUNNING local site with demo data (tests/e2e-cloud/seed-dev.js): every page, as a visitor, a buyer, a mentor, a mentor
// applicant and an admin, at 1280 and 375 px, light and dark, English and Georgian. For each combination it saves a screenshot and records:
//   - axe-core violations (WCAG 2.0/2.1/2.2 A + AA)
//   - sideways scrolling, and text cut off inside its box (buttons, labels, chips, table cells)
//   - console errors and failed requests
//   - in Georgian: visible Latin-script words that look like untranslated UI text
//   - keyboard: whether the first Tab stops show a visible focus style
// Output: docs/quality-screens/_all/<role>-<page>-<width>-<theme>-<lang>.jpg (git-ignored; the ones cited in docs/QUALITY-AUDIT.md are
// copied up to docs/quality-screens/) and docs/quality-screens/scan.json
//
//   node tests/e2e-cloud/audit/scan.js [--base http://localhost:4242] [--only home,profile] [--no-shots]
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const BASE = String(arg('base', 'http://localhost:4242')).replace(/\/+$/, '');
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null;
const SHOTS = !process.argv.includes('--no-shots');
const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'quality-screens');
const PASSWORD = 'demo-pass-12345';
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const ROLES = {
  visitor: null,
  buyer: 'nino.buyer@example.test',
  mentor: 'giorgi.mentor@example.test',
  applicant: 'ana.applicant@example.test',
  admin: (process.env.ADMIN_EMAILS || 'test.admin@example.com').split(',')[0].trim()
};
// [name, role, path, optional action after load]
const PAGES = [
  ['home', 'visitor', '/'],
  ['browse-tech', 'visitor', '/?niche=tech#experts'],
  ['profile-mentor', 'visitor', '/u/giorgi-kapanadze'],
  ['profile-mentor-ka', 'visitor', '/u/tamar-lomidze'],
  ['about', 'visitor', '/about.html'],
  ['contact', 'visitor', '/contact.html'],
  ['terms', 'visitor', '/terms.html'],
  ['privacy', 'visitor', '/privacy.html'],
  ['signup', 'visitor', '/signup.html'],
  ['signup-errors', 'visitor', '/signup.html', async (p) => { await p.click('#signupForm button[type="submit"]'); await p.waitForTimeout(400); }],
  ['login', 'visitor', '/login.html'],
  ['login-wrong', 'visitor', '/login.html', async (p) => { await p.fill('#email', 'nobody@example.test'); await p.fill('#password', 'wrong-password'); await p.click('#loginForm button[type="submit"]'); await p.waitForTimeout(800); }],
  ['forgot-password', 'visitor', '/forgot-password.html'],
  ['reset-password-bad', 'visitor', '/reset-password.html?token=bad'],
  ['not-found', 'visitor', '/no-such-page'],
  ['profile-ask-anon', 'visitor', '/u/tamar-lomidze', async (p) => { const q = p.locator('#question'); if (await q.count()) await q.first().fill('Test'); await p.waitForTimeout(300); }],
  ['dashboard-buyer', 'buyer', '/dashboard.html'],
  ['settings-account', 'buyer', '/settings.html?tab=account'],
  ['settings-profile', 'buyer', '/settings.html?tab=profile'],
  ['profile-own', 'buyer', '/u/nino-beridze'],
  ['ask-sheet', 'buyer', '/u/giorgi-kapanadze', async (p) => { const b = p.locator('#askOpen'); if (await b.isVisible().catch(() => false)) await b.click(); await p.waitForTimeout(400); }],
  ['dashboard-mentor', 'mentor', '/dashboard.html?tab=received'],
  ['dashboard-earnings', 'mentor', '/dashboard.html?tab=earnings'],
  ['settings-mentor', 'mentor', '/settings.html?tab=mentor'],
  ['settings-payouts', 'mentor', '/settings.html?tab=payouts'],
  ['settings-verification-applicant', 'applicant', '/settings.html?tab=verification'],
  ['dashboard-applicant', 'applicant', '/dashboard.html'],
  ['admin-mentors', 'admin', '/admin.html'],
  ['admin-bookings', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="bookings"]'); await p.waitForTimeout(600); }],
  ['admin-payouts', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="payouts"]'); await p.waitForTimeout(600); }],
  ['admin-queue', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="queue"]'); await p.waitForTimeout(600); }],
  ['admin-reviews', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="reviews"]'); await p.waitForTimeout(600); }],
  ['admin-waitlist', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="waitlist"]'); await p.waitForTimeout(600); }],
  ['admin-interviews', 'admin', '/admin.html', async (p) => { await p.click('[data-tab="interviews"]'); await p.waitForTimeout(600); }]
];
const VIEWPORTS = [{ w: 1280, h: 800 }, { w: 375, h: 812 }];
const THEMES = ['light', 'dark'];
const LANGS = ['en', 'ka'];

// Words that may appear in Latin letters on a Georgian page (brands, codes, user content we seeded).
const ALLOWED_LATIN = /^(wisecall|google|linkedin|iban|didit|gel|pdf|jpeg|jpg|png|webp|url|https?|www|email|e-mail|ok|id|faq|ux|figma|node|go|saas|seo|ceo|tbc|bog|visa|mastercard|apple|facebook|instagram|tiktok|youtube|x|giorgi|kapanadze|levan|tsereteli|sam|buyer|ana|applicant|demo|admin|tbilisi|batumi|nino|beridze|lomidze|tamar|senior|backend|engineer|founder|and|product|designer|research|test|example|mentor|js|com|ge|net|org)$/i;

async function login(context, email) {
  const res = await context.request.post(BASE + '/api/auth/login', { headers: { 'X-Requested-With': 'wisecall' }, data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email}: ${res.status()}`);
}

(async () => {
  fs.mkdirSync(path.join(OUT, '_all'), { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const results = [];
  for (const [role, email] of Object.entries(ROLES)) {
    const pages = PAGES.filter(([name, r]) => r === role && (!ONLY || ONLY.includes(name)));
    if (!pages.length) continue;
    for (const vp of VIEWPORTS) for (const theme of THEMES) for (const lang of LANGS) {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: theme, deviceScaleFactor: 1, isMobile: vp.w < 500, hasTouch: vp.w < 500 });
      await context.addInitScript(([l, t]) => { try { localStorage.setItem('wisecall_lang', l); localStorage.setItem('wisecall_theme', t); } catch (e) { /* */ } }, [lang, theme]);
      if (email) await login(context, email);
      for (const [name, , url, action] of pages) {
        const page = await context.newPage();
        const consoleErrors = [];
        const failed = [];
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
        page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));
        page.on('response', (r) => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
        const t0 = Date.now();
        await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch((e) => consoleErrors.push('goto: ' + e.message.slice(0, 120)));
        await page.waitForTimeout(300);
        if (action) await action(page).catch((e) => consoleErrors.push('action: ' + e.message.slice(0, 120)));
        const loadMs = Date.now() - t0;

        const layout = await page.evaluate(() => {
          const doc = document.documentElement;
          const clipped = [];
          for (const el of document.querySelectorAll('button, a.btn, .btn, label, .chip, .badge, th, td, h1, h2, h3, .nav a, .tab, [role="tab"], .price, .booking-amount, input[type="submit"]')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
            const text = (el.innerText || el.value || '').trim();
            if (!text) continue;
            const hides = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
            if (hides && el.scrollWidth > el.clientWidth + 2) clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: text.slice(0, 60), over: el.scrollWidth - el.clientWidth });
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 && cs.position !== 'fixed') clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: text.slice(0, 60), offscreen: Math.round(r.right - window.innerWidth) });
          }
          // Visible Latin words (for the Georgian check), skipping inputs and user content blocks.
          const words = new Set();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            const p = n.parentElement;
            if (!p || !p.offsetParent || p.closest('script,style,code,pre,[data-user-content],.answer-text,.q-text,.review-text,textarea,input')) continue;
            (n.textContent.match(/[A-Za-z][A-Za-z'-]{2,}/g) || []).forEach((w) => words.add(w));
          }
          return { sideways: doc.scrollWidth > window.innerWidth + 1 ? doc.scrollWidth - window.innerWidth : 0, clipped: clipped.slice(0, 15), latin: [...words] };
        });

        // Keyboard: the first 12 Tab stops must show some visible focus style.
        const noFocus = [];
        if (vp.w === 1280 && theme === 'light') {
          await page.mouse.click(1, 1).catch(() => {});
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(() => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const cs = getComputedStyle(el);
              const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
              return visible ? null : `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
            });
            if (f) noFocus.push(f);
          }
        }

        let axe = [];
        try {
          const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
          axe = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 2).join(' ').slice(0, 200) })), count: v.nodes.length }));
        } catch (e) { axe = [{ id: 'axe-error', help: e.message.slice(0, 100) }]; }

        const file = `${role}-${name}-${vp.w}-${theme}-${lang}.jpg`;
        if (SHOTS) await page.screenshot({ path: path.join(OUT, '_all', file), fullPage: true, type: 'jpeg', quality: 65 }).catch(() => {});
        const latin = lang === 'ka' ? layout.latin.filter((w) => !ALLOWED_LATIN.test(w)) : [];
        results.push({ role, page: name, url, width: vp.w, theme, lang, file, loadMs, sideways: layout.sideways, clipped: layout.clipped, latin, noFocus, consoleErrors, failed, axe });
        process.stdout.write(`${file}: axe ${axe.reduce((s, v) => s + (v.count || 1), 0)}, sideways ${layout.sideways}, clipped ${layout.clipped.length}, latin ${latin.length}, errors ${consoleErrors.length}\n`);
        await page.close();
      }
      await context.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'scan.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} page views scanned -> ${path.relative(process.cwd(), path.join(OUT, 'scan.json'))}`);
})().catch((e) => { console.error(e); process.exit(1); });
