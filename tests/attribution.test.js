// Where people come from (PART 9): the first visit with utm_* parameters (or from another website) sets a first-party cookie with the
// campaign and the referring DOMAIN only; it is not replaced by a later campaign, not set for a browser that asks not to be tracked, nor
// for API calls or files. It is kept on sign-up, on each question and on a mentor application, and the admin overview counts sign-ups,
// applications and first paid questions per source and campaign.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, ABOUT } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

const visit = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
const cookieOf = (res) => (res.headers.getSetCookie() || []).find((c) => c.startsWith('wc_src='));
const decode = (setCookie) => JSON.parse(Buffer.from(decodeURIComponent(setCookie.split(';')[0].slice('wc_src='.length)), 'base64url').toString('utf8'));

before(async () => {
  await resetDatabase();
  srv = await startServer(4737, { RATE_LIMIT_MULTIPLIER: '30' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('the cookie', () => {
  test('the first visit from a campaign keeps the campaign, cleaned, with nothing personal', async () => {
    const res = await visit('/?utm_source=facebook&utm_medium=social&utm_campaign=Launch%20week&utm_content=%3Cscript%3Ealert(1)%3C/script%3E&email=ana@example.com');
    const c = cookieOf(res);
    assert.ok(c, 'a cookie is set');
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Lax/i);
    assert.match(c, /Max-Age=2592000/, '30 days');
    const v = decode(c);
    assert.equal(v.source, 'facebook');
    assert.equal(v.medium, 'social');
    assert.equal(v.campaign, 'Launch week');
    assert.equal(v.content, undefined, 'only the source, medium, campaign, referring domain and landing path are kept');
    assert.equal(v.landing, '/');
    assert.deepEqual(Object.keys(v).sort(), ['campaign', 'landing', 'medium', 'source']);
    assert.ok(!JSON.stringify(v).includes('ana@example.com'), 'other parameters are not kept');
  });

  test('another site: only its domain; this site or a direct visit: "direct"; a file, an API call or "do not track": nothing', async () => {
    const ref = cookieOf(await visit('/faq.html', { referer: 'https://www.facebook.com/groups/some-group/posts/123?fbclid=abc' }));
    assert.deepEqual(decode(ref), { referrer: 'facebook.com', source: 'facebook', landing: '/faq.html' }, 'its domain only (never the address or the fbclid)');
    assert.deepEqual(decode(cookieOf(await visit('/faq.html', { referer: `${base}/index.html` }))), { source: 'direct', landing: '/faq.html' }, 'this site is not a source');
    assert.deepEqual(decode(cookieOf(await visit('/faq.html'))), { source: 'direct', landing: '/faq.html' }, 'a direct visit says so');
    assert.deepEqual(decode(cookieOf(await visit('/faq.html', { referer: 'https://www.google.com/search?q=wisecall' }))), { referrer: 'google.com', landing: '/faq.html' });
    assert.equal(cookieOf(await visit('/api/config?utm_source=x')), undefined);
    assert.equal(cookieOf(await visit('/css/style.css?utm_source=x')), undefined);
    assert.equal(cookieOf(await visit('/?utm_source=x', { dnt: '1' })), undefined, 'Do Not Track');
    assert.equal(cookieOf(await visit('/?utm_source=x', { 'sec-gpc': '1' })), undefined, 'Global Privacy Control');
  });

  test('a later campaign does not replace the first one', async () => {
    const first = cookieOf(await visit('/?utm_source=instagram'));
    const cookie = first.split(';')[0];
    assert.equal(cookieOf(await visit('/?utm_source=linkedin', { cookie })), undefined);
  });

  // (docs/CLAUDE-CODE-SIGNUP-CHECKS.md #1: an ad click without utm_* tags carries only fbclid, and the in-app browser often sends no referrer)
  test('Facebook and Instagram without tags: fbclid, or a referrer from facebook.com / instagram.com (m., l., ...); never the fbclid itself', async () => {
    const fb = decode(cookieOf(await visit('/?fbclid=IwAR0abcDEF123')));
    assert.deepEqual(fb, { source: 'facebook', landing: '/' });
    assert.ok(!JSON.stringify(fb).includes('IwAR0abcDEF123'));
    for (const [host, source] of [['facebook.com', 'facebook'], ['m.facebook.com', 'facebook'], ['l.facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['l.instagram.com', 'instagram']]) {
      assert.equal(decode(cookieOf(await visit('/ka/', { referer: `https://${host}/` }))).source, source, host);
    }
    // (tags win: utm_source says which campaign it was)
    assert.equal(decode(cookieOf(await visit('/?utm_source=fb_ads&fbclid=x'))).source, 'fb_ads');
  });

  test('a first visit that was "direct" is replaced by the next real source; a real source is not replaced by a direct visit', async () => {
    const direct = cookieOf(await visit('/')).split(';')[0];
    const later = cookieOf(await visit('/?fbclid=abc', { cookie: direct }));
    assert.equal(decode(later).source, 'facebook');
    assert.equal(cookieOf(await visit('/faq.html', { cookie: later.split(';')[0] })), undefined, 'browsing on keeps it');
    assert.equal(cookieOf(await visit('/faq.html', { cookie: direct })), undefined, 'direct again: nothing to change');
  });
});

describe('the real path to a sign-up', () => {
  // A browser: one cookie jar for the pages (fetch with the jar) and the API (the test client).
  async function browse(paths) {
    const c = client(base);
    for (const p of paths) {
      const res = await fetch(base + p, { headers: { cookie: c.cookie(), referer: p === paths[0] ? '' : `${base}/` }, redirect: 'manual' });
      const set = cookieOf(res);
      if (set) c.setCookie('wc_src', set.split(';')[0].slice('wc_src='.length));
    }
    return c;
  }
  const signUp = async (c, email) => {
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Path Person', email, password: 'test-pass-12345' } })).status, 201);
    return (await pool.query('SELECT signup_source FROM users WHERE email = $1', [email])).rows[0].signup_source;
  };

  test('an ad with tags, then a few pages, the Georgian site, and a sign-up later: the campaign is on the account', async () => {
    const c = await browse(['/?utm_source=facebook&utm_medium=paid&utm_campaign=test3', '/faq.html', '/ka/become-a-mentor.html', '/ka/signup.html']);
    assert.deepEqual(await signUp(c, 'path-utm@example.com'), { source: 'facebook', medium: 'paid', campaign: 'test3', landing: '/' });
  });

  test('an ad click with only fbclid: facebook', async () => {
    const c = await browse(['/?fbclid=abc', '/how-we-verify.html', '/signup.html']);
    const s = await signUp(c, 'path-fbclid@example.com');
    assert.equal(s.source, 'facebook');
    assert.ok(!JSON.stringify(s).includes('abc'), 'never the fbclid value');
  });

  test('a direct visit: "direct" (nothing at all only when it is unknown)', async () => {
    const c = await browse(['/', '/signup.html']);
    assert.deepEqual(await signUp(c, 'path-direct@example.com'), { source: 'direct', landing: '/' });
    assert.equal(await signUp(client(base), 'path-unknown@example.com'), null, 'no visit seen (no cookie): unknown');
  });

  test('the admin overview: sign-ups by source, counts only, "unknown" included', async () => {
    const o = await admin.api('/admin/overview');
    const by = Object.fromEntries(o.signupsBySource.map((r) => [r.source, r.signups]));
    assert.ok(by.facebook >= 2 && by.direct >= 1 && by.unknown >= 1, JSON.stringify(by));
    assert.deepEqual(Object.keys(o.signupsBySource[0]).sort(), ['signups', 'source']);
    assert.ok(!JSON.stringify(o.signupsBySource).includes('@'));
  });
});

describe('kept on sign-up, questions and applications, and counted for the admin', () => {
  test('the overview counts sign-ups, applications and first paid questions per source and campaign', async () => {
    const cookie = cookieOf(await visit('/?utm_source=facebook&utm_campaign=launch')).split(';')[0];
    // A visitor from the campaign signs up (the cookie goes along with every request, like in a browser) and asks two paid questions.
    const asker = client(base);
    asker.setCookie('wc_src', cookie.slice('wc_src='.length));
    assert.equal((await asker.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Ana Campaign', email: 'ana-c@example.com', password: 'test-pass-12345' } })).status, 201);
    const { rows: [u] } = await pool.query(`SELECT signup_source FROM users WHERE email = 'ana-c@example.com'`);
    assert.equal(u.signup_source.source, 'facebook');
    assert.equal(u.signup_source.campaign, 'launch');
    await pool.query(`UPDATE users SET email_verified = true WHERE email = 'ana-c@example.com'`); // (the email code has its own tests)

    const mentor = await signupVerified(base, 'Mika Mentor', 'mika@example.com');
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 20, sampleAnswer: SAMPLE } });
    const mentorId = await approveMentor(admin, mentor);
    await addPayoutDetails(mentor, undefined, 'Mika Mentor');
    for (const q of ['How should I prepare for my first engineering interview next month?', 'What should I learn first to become a backend developer?']) {
      assert.equal((await bookAndPay(base, asker, mentorId, q)).status, 'paid');
    }
    const { rows: books } = await pool.query(`SELECT source FROM bookings WHERE seeker_id = (SELECT id FROM users WHERE email = 'ana-c@example.com')`);
    assert.ok(books.length === 2 && books.every((b) => b.source && b.source.source === 'facebook'));

    // Someone from a LinkedIn link applies to be a mentor.
    const applicant = client(base);
    applicant.setCookie('wc_src', cookieOf(await visit('/?utm_source=linkedin&utm_campaign=mentors')).split(';')[0].slice('wc_src='.length));
    assert.equal((await applicant.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Nino Applicant', email: 'nino-a@example.com', password: 'test-pass-12345' } })).status, 201);
    await pool.query(`UPDATE users SET email_verified = true WHERE email = 'nino-a@example.com'`);
    await applicant.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 25, headline: 'Shop owner' } });
    await applicant.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Shop owner', customNiche: 'Running a small shop', niche: 'business', specialtyTags: ['retail'], yearsExperience: 5,
      story: 'I have run a small clothing shop in Kutaisi for five years and moved it online during the pandemic, with a team of three people.', about: ABOUT, sampleAnswer: longAnswer(SAMPLE) } });
    await applicant.api('/verification/evidence', { method: 'POST', body: { kind: 'website', url: 'https://nino-applicant.invalid/' } });
    assert.equal((await applicant.api('/verification/submit', { method: 'POST' })).status, 200);
    assert.equal((await pool.query(`SELECT application_source FROM users WHERE email = 'nino-a@example.com'`)).rows[0].application_source.source, 'linkedin');

    const o = await admin.api('/admin/overview');
    const fb = o.sources.find((s) => s.source === 'facebook' && s.campaign === 'launch');
    assert.deepEqual([fb.signups, fb.applications, fb.paid], [1, 0, 1], 'one sign-up, one FIRST paid question');
    const li = o.sources.find((s) => s.source === 'linkedin' && s.campaign === 'mentors');
    assert.deepEqual([li.signups, li.applications, li.paid], [1, 1, 0]);
    assert.ok(!JSON.stringify(o.sources).includes('@'), 'no emails in the overview');
    // (a question from a visitor with no campaign has no source at all, not a JSON null)
    const direct = client(base);
    assert.equal((await direct.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Dato Direct', email: 'dato-d@example.com', password: 'test-pass-12345' } })).status, 201);
    await pool.query(`UPDATE users SET email_verified = true WHERE email = 'dato-d@example.com'`);
    await bookAndPay(base, direct, mentorId, 'What is the first thing to learn for a junior developer interview?');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE source IS NOT NULL AND jsonb_typeof(source) <> 'object'`)).rows[0].n, 0);
    assert.equal((await pool.query(`SELECT signup_source FROM users WHERE email = 'dato-d@example.com'`)).rows[0].signup_source, null);
  });

  test('a cookie a visitor changed by hand is cleaned again before it is kept', async () => {
    const forged = Buffer.from(JSON.stringify({ source: '<img src=x onerror=alert(1)>', campaign: 'ana@example.com', referrer: 'javascript:alert(1)' })).toString('base64url');
    const c = client(base);
    c.setCookie('wc_src', forged);
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Forged Cookie', email: 'forged@example.com', password: 'test-pass-12345' } })).status, 201);
    const { rows: [u] } = await pool.query(`SELECT signup_source FROM users WHERE email = 'forged@example.com'`);
    const s = JSON.stringify(u.signup_source || {});
    assert.doesNotMatch(s, /[<>@]|javascript/);
  });
});
