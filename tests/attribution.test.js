// Where people come from (PART 9): the first visit with utm_* parameters (or from another website) sets a first-party cookie with the
// campaign and the referring DOMAIN only; it is not replaced by a later campaign, not set for a browser that asks not to be tracked, nor
// for API calls or files. It is kept on sign-up, on each question and on a mentor application, and the admin overview counts sign-ups,
// applications and first paid questions per source and campaign.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE } = require('./helpers');

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
    assert.doesNotMatch(v.content, /[<>()/]/, 'only letters, digits and a few signs');
    assert.ok(!JSON.stringify(v).includes('ana@example.com'), 'other parameters are not kept');
  });

  test('another site: only its domain; this site, a file, an API call or "do not track": nothing', async () => {
    const ref = cookieOf(await visit('/faq.html', { referer: 'https://www.facebook.com/groups/some-group/posts/123?fbclid=abc' }));
    assert.deepEqual(Object.keys(decode(ref)).sort(), ['at', 'referrer']);
    assert.equal(decode(ref).referrer, 'facebook.com');
    assert.equal(cookieOf(await visit('/faq.html', { referer: `${base}/index.html` })), undefined, 'coming from this site is not a source');
    assert.equal(cookieOf(await visit('/faq.html')), undefined, 'a direct visit sets nothing');
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
});

describe('kept on sign-up, questions and applications, and counted for the admin', () => {
  test('the overview counts sign-ups, applications and first paid questions per source and campaign', async () => {
    const cookie = cookieOf(await visit('/?utm_source=facebook&utm_campaign=launch')).split(';')[0];
    // A visitor from the campaign signs up (the cookie goes along with every request, like in a browser) and asks two paid questions.
    const asker = client(base);
    asker.setCookie('wc_src', cookie.slice('wc_src='.length));
    assert.equal((await asker.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Ana Campaign', email: 'ana-c@example.com', password: 'test-pass-12345' } })).status, 201);
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
    assert.equal((await applicant.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Nino Applicant', email: 'nino-a@example.com', password: 'test-pass-12345' } })).status, 201);
    await pool.query(`UPDATE users SET email_verified = true WHERE email = 'nino-a@example.com'`);
    await applicant.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 25 } });
    await applicant.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Shop owner', customNiche: 'Running a small shop', niche: 'business', specialtyTags: ['retail'], yearsExperience: 5,
      story: 'I have run a small clothing shop in Kutaisi for five years and moved it online during the pandemic, with a team of three people.', sampleAnswer: longAnswer(SAMPLE) } });
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
    assert.equal((await direct.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Dato Direct', email: 'dato-d@example.com', password: 'test-pass-12345' } })).status, 201);
    await pool.query(`UPDATE users SET email_verified = true WHERE email = 'dato-d@example.com'`);
    await bookAndPay(base, direct, mentorId, 'What is the first thing to learn for a junior developer interview?');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE source IS NOT NULL AND jsonb_typeof(source) <> 'object'`)).rows[0].n, 0);
    assert.equal((await pool.query(`SELECT signup_source FROM users WHERE email = 'dato-d@example.com'`)).rows[0].signup_source, null);
  });

  test('a cookie a visitor changed by hand is cleaned again before it is kept', async () => {
    const forged = Buffer.from(JSON.stringify({ source: '<img src=x onerror=alert(1)>', campaign: 'ana@example.com', referrer: 'javascript:alert(1)' })).toString('base64url');
    const c = client(base);
    c.setCookie('wc_src', forged);
    assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Forged Cookie', email: 'forged@example.com', password: 'test-pass-12345' } })).status, 201);
    const { rows: [u] } = await pool.query(`SELECT signup_source FROM users WHERE email = 'forged@example.com'`);
    const s = JSON.stringify(u.signup_source || {});
    assert.doesNotMatch(s, /[<>@]|javascript/);
  });
});
