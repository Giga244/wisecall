// Live sessions switched on and off (LIVE_SESSIONS, server/live/switch.js). Two servers on one database: "on" (as outside production)
// publishes a session; "off" (the production default) must then behave as if live sessions never existed for users: their pages and API
// are "not found" (in English and Georgian), the home page, dashboard, help centre and sitemap say nothing about them, no "new session"
// email can be sent, and admins see a read-only Live tab. Turning them back on is only LIVE_SESSIONS=on.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, SAMPLE, wait } = require('./helpers');

const OUTBOX = path.join(os.tmpdir(), `wisecall-live-switch-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
const ENV = { RATE_LIMIT_MULTIPLIER: '100', EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', LIVE_PROVIDER: 'fake' };
let on, off, admin, mentor, mentorId, follower, session;

async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${message}`); await wait(150); }
}
async function signupVerified(b, name, email) {
  const c = client(b);
  const su = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name, email, password: 'test-pass-12345' } });
  assert.equal(su.status, 201, su.text);
  const mail = await until(() => outbox().find((m) => m.to === email), 'sign-up email');
  assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code: mail.html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1] } })).status, 200);
  return c;
}
// The same account on the other server (the session cookie is signed with the same secret, the database is shared).
const onServer = (c, b) => {
  const other = client(b);
  for (const pair of c.cookie().split('; ').filter(Boolean)) other.setCookie(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  return other;
};
const page = async (b, p) => { const r = await fetch(b + p, { headers: { Accept: 'text/html' } }); return { status: r.status, html: await r.text() }; };
const day = (n) => new Date(Date.now() + n * 86400000 + 4 * 3600000).toISOString().slice(0, 10);

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await resetDatabase();
  on = await startServer(4760, ENV);
  off = await startServer(4761, { ...ENV, LIVE_SESSIONS: 'off' });
  admin = await signupVerified(on.base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupVerified(on.base, 'Mika Host', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Software engineer and teacher', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Host');
  assert.equal((await admin.api('/admin/live/hosts', { method: 'POST', body: { email: 'mika@example.com', allow: true } })).status, 200); // (no answers yet)
  follower = await signupVerified(on.base, 'Fia Follower', 'fia@example.com');
  assert.equal((await follower.api(`/live/follows/${mentorId}`, { method: 'POST' })).status, 200);
  const c = await mentor.api('/live', { method: 'POST', body: { title: 'Ask me about studying medicine abroad',
    description: 'An hour of answers about applying, exams, money and the first year. For anyone thinking about it.',
    learnPoints: ['How to choose a country'], niche: 'tech', kind: 'qa', language: 'en', date: day(3), time: '19:00', durationMin: 60, price: 20, maxSeats: 30, minSeats: 1 } });
  assert.equal(c.status, 201, c.text);
  const p = await mentor.api(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
  assert.equal(p.status, 200, p.text);
  if (p.session.status === 'review') assert.equal((await admin.api(`/admin/live/${c.session.id}/approve`, { method: 'POST' })).status, 200);
  session = (await sql('SELECT * FROM live_sessions WHERE id = $1', [c.session.id]))[0];
});
after(async () => { for (const s of [on, off]) if (s) s.proc.kill(); await pool.end(); fs.rmSync(OUTBOX, { force: true }); });

describe('switched on (LIVE_SESSIONS=on, the default outside production)', () => {
  test('the pages, the home section, the dashboard tab, the help article and the sitemap are there; the follower was emailed', async () => {
    assert.equal((await client(on.base).api('/config')).liveSessions, true);
    for (const p of ['/live', '/ka/live', `/live/${session.slug}`, `/ka/live/${session.slug}`]) assert.equal((await page(on.base, p)).status, 200, p);
    assert.match((await page(on.base, '/')).html, /id="liveHome"/);
    const dash = (await page(on.base, '/dashboard.html')).html;
    assert.match(dash, /id="tab-live"/);
    assert.match(dash, /live-dashboard\.js/);
    assert.equal((await page(on.base, '/help/live-sessions')).status, 200);
    assert.match((await page(on.base, '/help.html')).html, /\/help\/live-sessions/);
    assert.match((await page(on.base, '/sitemap.xml')).html, new RegExp(`/live/${session.slug}<`));
    assert.equal((await client(on.base).api('/live')).sessions.length, 1);
    await until(() => outbox().find((m) => m.to === 'fia@example.com' && /new live session/i.test(m.subject)), 'the follower email');
  });
});

describe('switched off (LIVE_SESSIONS=off, the default in production)', () => {
  test('/api/config says so', async () => {
    assert.equal((await client(off.base).api('/config')).liveSessions, false);
  });

  test('every live page is "not found", in English and Georgian, even for a session that exists', async () => {
    for (const p of ['/live', '/live/', '/ka/live', `/live/${session.slug}`, `/ka/live/${session.slug}`, `/live/${session.slug}/room`, `/live/${session.slug}/replay`,
      '/live/series/some-series', '/live-edit.html', '/live-series-edit.html', '/live-claim.html', '/unfollow.html', '/ka/live-edit.html']) {
      const r = await page(off.base, p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.html, /Ask me about studying medicine abroad/, p);
    }
    assert.match((await page(off.base, '/ka/live')).html, /<html lang="ka"/); // (the Georgian "not found" page)
  });

  test('every live API answers 404 (reading, buying, following, covers, share images), signed in or not', async () => {
    const asMentor = onServer(mentor, off.base), asFollower = onServer(follower, off.base);
    const checks = [
      [client(off.base), '/live', 'GET'], [client(off.base), `/live/${session.id}`, 'GET'], [client(off.base), `/live/by-slug/${session.slug}`, 'GET'],
      [asMentor, '/live', 'POST'], [asMentor, `/live/${session.id}/publish`, 'POST'], [asFollower, `/live/${session.id}/tickets`, 'POST'],
      [asFollower, `/live/follows/${mentorId}`, 'GET'], [asFollower, `/live/follows/${mentorId}`, 'DELETE'], [asFollower, '/live/mine', 'GET']
    ];
    for (const [c, p, method] of checks) {
      const r = await c.api(p, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 404, `${method} ${p}: ${r.text}`);
    }
    for (const p of [`/api/live-covers/${session.id}.webp`, `/api/live-share/${session.id}.png`]) assert.equal((await fetch(off.base + p)).status, 404, p);
    // (the follow still exists: switching back on brings everything back)
    assert.equal((await sql('SELECT count(*)::int AS n FROM mentor_follows WHERE mentor_id = $1', [mentorId]))[0].n, 1);
  });

  test('no page says a word about them: home (EN and KA), dashboard, help centre, sitemap', async () => {
    for (const p of ['/', '/ka/']) {
      const h = (await page(off.base, p)).html;
      assert.doesNotMatch(h, /liveHome|href="\/live|live sessions|ცოცხალი სესი/i, p);
    }
    const dash = (await page(off.base, '/dashboard.html')).html;
    assert.doesNotMatch(dash, /tab-live|panel-live|live-dashboard\.js|dash\.tab\.live/);
    assert.match(dash, /id="tab-asked"/); // (the rest of the page is untouched)
    assert.doesNotMatch((await page(off.base, '/help.html')).html, /live-sessions/);
    assert.equal((await page(off.base, '/help/live-sessions')).status, 404);
    assert.equal((await page(off.base, '/ka/help/live-sessions')).status, 404);
    assert.doesNotMatch((await page(off.base, '/sitemap.xml')).html, /\/live/);
    // (the scripts: the footer has no link to live sessions at all (docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md #3); the profile asks before drawing them)
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'footer.js'), 'utf8'), /footerLive|href="\/live/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'profile.js'), 'utf8'), /isMentor && !isSelf && liveOn \?/);
  });

  test('admins keep a read-only Live tab: they can see the sessions, every action is refused', async () => {
    const a = onServer(admin, off.base);
    const d = await a.api('/admin/live');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.switchedOff, true);
    assert.ok(d.sessions.some((s) => s.id === session.id));
    for (const p of [`/admin/live/${session.id}/end`, `/admin/live/${session.id}/approve`, '/admin/live/hosts', `/admin/live/${session.id}/replay/delete`]) {
      const r = await a.api(p, { method: 'POST', body: { reason: 'checking the switch', email: 'mika@example.com', allow: true } });
      assert.equal(r.status, 409, `${p}: ${r.text}`);
      assert.equal(r.error, 'live_off');
    }
    assert.equal((await sql('SELECT status FROM live_sessions WHERE id = $1', [session.id]))[0].status, 'published'); // (nothing changed)
    assert.equal((await onServer(follower, off.base).api('/admin/live')).status, 403); // (and it is still admins only)
    assert.equal((await onServer(admin, on.base).api('/admin/live')).switchedOff, false);
  });

  test('an unknown LIVE_SESSIONS value stops the server from starting', async () => {
    await assert.rejects(startServer(4762, { ...ENV, LIVE_SESSIONS: 'maybe' }), /LIVE_SESSIONS must be on or off/);
  });
});
