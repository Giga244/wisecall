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

test('no prelaunch rule hides a .filters row, Browse\'s search or its field filters (Browse is open before launch)', () => {
  const css = read('public/css/style.css');
  const rules = [...css.matchAll(/([^{}]*data-launch="prelaunch"[^{}]*)\{([^}]*)\}/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim());
  for (const selector of rules) {
    for (const part of selector.split(',').map((s) => s.trim())) {
      assert.doesNotMatch(part, /\.filters\b(?!-)/, `"${part}" would hide every .filters row (the admin's tabs among them)`);
    }
  }
  for (const selector of rules) assert.doesNotMatch(selector, /#experts|#filters|browse-toolbar/, `"${selector}" hides Browse before launch`);
  // the rows that must stay: the admin's tabs and status chips (and the support and dispute chips inside the admin page)
  assert.match(read('public/admin.html'), /<div class="filters" id="adminTabs"/);
  assert.match(read('public/admin.html'), /<div class="filters" id="statusFilters"/);
  // and Browse's own field filters (public/experts.html since the new home page)
  assert.match(read('public/experts.html'), /<div class="filters" id="filters"/);
});

test('the pages are served with data-launch="prelaunch" before launch (what the stylesheet reads)', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<html lang="en" data-launch="prelaunch"/);
});

test('?tab=mentors&status=verified opens the verified mentors (and status=all every mentor); the API lists them', async () => {
  const js = read('public/js/admin.js');
  assert.match(js, /const askedStatus = params\.get\('status'\);/);
  assert.match(js, /const s = askedStatus === 'all' \? '' : \(askedStatus === 'needs_human' && tab === 'mentors' \? 'pending' : askedStatus\);/);
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
