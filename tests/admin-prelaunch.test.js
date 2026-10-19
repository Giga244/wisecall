// The admin's tabs and status chips stay visible before launch (docs/CLAUDE-CODE-ADMIN-TABS-BUG.md). The prelaunch rule that hides the
// home page's expert search and field filters once hid EVERY .filters row on every page, the admin's #adminTabs and #statusFilters too.
// (The page itself, in a browser: e2e/admin-prelaunch.spec.js.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let srv, base;
before(async () => { await resetDatabase(); srv = await startServer(4773, { LAUNCH_MODE: 'prelaunch', RATE_LIMIT_MULTIPLIER: '30' }); base = srv.base; });
after(() => { if (srv) srv.proc.kill(); });

test('the prelaunch rule hides only the home page\'s expert search and field filters, never another .filters row', () => {
  const css = read('public/css/style.css');
  const rules = [...css.matchAll(/([^{}]*data-launch="prelaunch"[^{}]*)\{([^}]*)\}/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim());
  assert.ok(rules.length >= 1);
  for (const selector of rules) {
    for (const part of selector.split(',').map((s) => s.trim())) {
      assert.doesNotMatch(part, /\.filters\b(?!-)/, `"${part}" would hide every .filters row (the admin's tabs among them)`);
    }
  }
  assert.match(css, /\[data-launch="prelaunch"\] #experts \.browse-toolbar,\n\[data-launch="prelaunch"\] #filters \{ display: none; \}/);
  // the rows that must stay: the admin's tabs and status chips (and the support and dispute chips inside the admin page)
  assert.match(read('public/admin.html'), /<div class="filters" id="adminTabs"/);
  assert.match(read('public/admin.html'), /<div class="filters" id="statusFilters"/);
  // and the home page's own: the field filters have the id the rule names (also once a phone moves them into the Filters sheet)
  assert.match(read('public/index.html'), /<div class="filters" id="filters"/);
});

test('the pages are served with data-launch="prelaunch" before launch (what the stylesheet reads)', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<html lang="en" data-launch="prelaunch"/);
});

test('?tab=mentors&status=verified opens the verified mentors (and status=all every mentor); the API lists them', async () => {
  const js = read('public/js/admin.js');
  assert.match(js, /const askedStatus = params\.get\('status'\);/);
  assert.match(js, /const s = askedStatus === 'all' \? '' : askedStatus;/);
  assert.match(js, /if \(statusesOf\(tab\)\.includes\(s\)\) activeStatus = s;/);
  assert.match(js, /url\.searchParams\.set\('status', activeStatus \|\| 'all'\)/, 'the address follows the chosen status');

  const admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  const m = await signupVerified(base, 'Vera Verified', 'vera@example.com');
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, niche: 'business', roleTitle: 'Founder', price: 20 } });
  const id = await approveMentor(admin, m);
  const p = await signupVerified(base, 'Pavle Pending', 'pavle@example.com');
  await p.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  const verified = await admin.api('/admin/mentors?status=verified');
  assert.equal(verified.status, 200);
  assert.deepEqual(verified.mentors.map((x) => x.id), [id]);
  const all = await admin.api('/admin/mentors');
  assert.deepEqual(all.mentors.map((x) => x.email).sort(), ['pavle@example.com', 'vera@example.com']);
});
