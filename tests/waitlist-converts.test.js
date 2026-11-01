// A waiting list that converts (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 5): "You're #N on the list" and a link to share,
// the same answer whether or not the address was there; ?ref=tiktok / ?ref=instagram kept with the existing attribution, on each waiting-list
// entry and each sign-up; one email per address when it is time to tell them; on a phone before launch, the form above the fold; the hero
// shows real sample answers once there are some.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base;

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4784, { RATE_LIMIT_MULTIPLIER: '30', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecallge.ge>' });
  base = srv.base;
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

// A visitor who came from a link: the page sets the attribution cookie, the API calls carry it.
async function visitor(landing) {
  const c = client(base);
  const res = await fetch(base + landing, { redirect: 'manual' });
  const set = (res.headers.getSetCookie() || []).find((x) => x.startsWith('wc_src='));
  if (set) c.setCookie('wc_src', set.split(';')[0].slice('wc_src='.length));
  return c;
}
const join = (c, email, niche, language = 'ka') => c.api('/waitlist', { method: 'POST', body: { over16: true, email, niche, language } });

describe('joining the list', () => {
  test('"You\'re #N on the list" and a share link in their language', async () => {
    const a = await join(client(base), 'ana-list@example.com', 'tech');
    assert.equal(a.status, 201, a.text);
    assert.equal(a.position, 1);
    assert.equal(a.share, `${base}/ka/?ref=share`);
    const b = await join(client(base), 'beka-list@example.com', 'any', 'en');
    assert.equal(b.position, 2);
    assert.equal(b.share, `${base}/?ref=share`);
  });

  test('the same answer whether or not the address was there (it says nothing about who is on the list)', async () => {
    const again = await join(client(base), 'ANA-list@example.com', 'tech');
    assert.equal(again.status, 201);
    assert.equal(again.position, 2, 'the size of the list, not a place that would give away an earlier sign-up');
    assert.equal((await join(client(base), 'ana-list@example.com', 'business')).position, 2, 'one person, two fields: still one on the list');
  });
});

describe('where they came from', () => {
  test('?ref=tiktok and ?ref=instagram are kept on the waiting-list entry and on the sign-up', async () => {
    const tik = await visitor('/?ref=tiktok');
    await join(tik, 'tiko-tiktok@example.com', 'study_abroad');
    const ig = await visitor('/ka/?ref=Instagram');
    await join(ig, 'insta-ig@example.com', 'tech');
    const src = async (email) => (await pool.query('SELECT source FROM waitlist WHERE email = $1', [email])).rows[0].source;
    assert.equal((await src('tiko-tiktok@example.com')).source, 'tiktok');
    assert.equal((await src('insta-ig@example.com')).source, 'instagram');
    assert.equal((await ig.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Insta Person', email: 'insta-signup@example.com', password: 'test-pass-12345' } })).status, 201);
    assert.equal((await pool.query('SELECT signup_source FROM users WHERE email = $1', ['insta-signup@example.com'])).rows[0].signup_source.source, 'instagram');
  });

  test('utm_source wins over ref, and a TikTok referrer counts as TikTok', async () => {
    const res = await fetch(`${base}/?ref=tiktok&utm_source=newsletter`, { redirect: 'manual' });
    const set = (res.headers.getSetCookie() || []).find((x) => x.startsWith('wc_src='));
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(set.split(';')[0].slice('wc_src='.length)), 'base64url').toString('utf8'));
    assert.equal(decoded.source, 'newsletter');
    const { fromRequest } = require('../server/attribution');
    const req = { query: {}, path: '/', hostname: 'localhost', get: (h) => (h === 'referer' ? 'https://www.tiktok.com/@wisecall' : undefined) };
    assert.equal(fromRequest(req).source, 'tiktok');
  });
});

test('one email per address when it is time to tell them (two fields, one email)', async () => {
  await pool.query(`INSERT INTO waitlist (email, niche, language, token, prelaunch) VALUES ('two-fields@example.com', 'business', 'en', $1, true), ('two-fields@example.com', 'any', 'en', $2, true)`,
    ['a'.repeat(48), 'b'.repeat(48)]);
  const admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  const m = await signupByEmail(resend, base, 'Biz Mentor', 'biz-mentor@example.com');
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20 } });
  await m.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Founder', niche: 'business', customNiche: 'Startups' } });
  await approveMentor(admin, m);
  await addPayoutDetails(m, undefined, 'Biz Mentor');
  await resend.waitFor('two-fields@example.com');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(resend.to('two-fields@example.com').length, 1);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM waitlist WHERE email = 'two-fields@example.com' AND notified_at IS NOT NULL`);
  assert.equal(rows[0].n, 2, 'both entries count as told');
});

test('the page: the form in the hero before launch, the only one (Browse is hidden); real sample answers in the hero once there are some', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('id="heroWait"') < html.indexOf('id="heroSearch"'), 'above the search');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  // (at every width, docs/CLAUDE-CODE-HOME-ONE-WAITLIST.md)
  assert.doesNotMatch(css, /@media \(min-width: \d+px\) \{ \.hero-wait \{ display: none/);
  assert.match(css, /\[data-launch="prelaunch"\] #experts \{ display: none; \}/);
  assert.match(css, /html:not\(\[data-launch="prelaunch"\]\) \.hero-wait \{ display: none !important; \}/);
  const ka = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/ka.json'), 'utf8'));
  assert.equal(ka['wait.position'], 'შენ ხარ #{n} სიაში');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/js/home.js'), 'utf8'), /filter\(\(a\) => a\.sample\)/);
});
