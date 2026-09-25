// Sign in with Google, against a fake Google that speaks the real protocol (see tests/fakeGoogle.js). The real server code and the
// real openid-client library run; only Google itself is fake.
require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');
const { createFakeGoogle, CLIENT_ID, CLIENT_SECRET } = require('./fakeGoogle');

const PORT = 4602;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, fake, admin;

// A browser: keeps cookies, never follows redirects by itself (so every hop can be looked at).
class Browser {
  constructor() { this.jar = new Map(); }
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
      const gone = !value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || attrs.some((a) => /^\s*expires=/i.test(a) && new Date(a.split('=')[1]).getTime() < Date.now());
      if (gone) this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async get(url, { theirs = false } = {}) {
    const res = await fetch(url.startsWith('http') ? url : base + url, { redirect: 'manual', headers: theirs ? {} : { cookie: this.header() } });
    if (!theirs) this.store(res);
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, res, text: async () => res.text() };
  }
  async api(p, { method = 'GET', body } = {}) {
    const res = await fetch(base + '/api' + p, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall', cookie: this.header() }, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(res);
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, ...json };
  }
  // The whole round trip: our start address -> fake Google (the person picks an account) -> our callback. Returns the last redirect.
  async google(who, { start = '/api/auth/google/start?mode=login', beforeCallback } = {}) {
    fake.auto = who;
    const first = await this.get(start);
    if (first.status !== 302 || !first.location.startsWith(fake.url)) return { first, final: first };
    const atGoogle = await this.get(first.location, { theirs: true });
    if (!atGoogle.location) return { first, atGoogle, final: atGoogle };
    if (beforeCallback) await beforeCallback(atGoogle.location);
    const final = await this.get(atGoogle.location);
    return { first, atGoogle, callback: atGoogle.location, final };
  }
  async me() { return (await this.api('/me')).user; }
}

const usersWith = async (email) => (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows;
const identityCount = async () => (await pool.query('SELECT count(*)::int AS n FROM user_identities')).rows[0].n;
const userCount = async () => (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
const pathOf = (loc) => (loc ? new URL(loc, base).pathname + new URL(loc, base).search : loc);

describe('Google sign-in', () => {
  before(async () => {
    await resetDatabase();
    fake = await createFakeGoogle().start();
    srv = await startServer(PORT, { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_ISSUER: fake.url, RATE_LIMIT_MULTIPLIER: '30' });
    base = srv.base;
    admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  });
  after(async () => { if (srv) srv.proc.kill(); if (fake) await fake.stop(); await pool.end(); });
  beforeEach(() => fake.reset());

  describe('the request we send to Google', () => {
    test('is the authorization code flow with PKCE, state and nonce, asking only for openid, email and profile', async () => {
      const b = new Browser();
      const r = await b.get('/api/auth/google/start?mode=login');
      assert.equal(r.status, 302);
      const url = new URL(r.location);
      assert.equal(url.origin, fake.url);
      assert.equal(url.pathname, '/authorize');
      const q = Object.fromEntries(url.searchParams);
      assert.equal(q.response_type, 'code');
      assert.equal(q.client_id, CLIENT_ID);
      assert.equal(q.redirect_uri, `${base}/api/auth/google/callback`);
      assert.equal(q.scope, 'openid email profile');
      assert.equal(q.code_challenge_method, 'S256');
      assert.match(q.code_challenge, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(q.state.length >= 20 && q.nonce.length >= 20);
      assert.equal(q.client_secret, undefined, 'the secret never goes through the browser');
      // the state is remembered in a short-lived, signed, httpOnly cookie that only the callback address receives
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('wisecall_oauth='));
      assert.ok(cookie, 'a cookie holds the state');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\/api\/auth\/google/i);
      assert.match(cookie, /Max-Age=600/i);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    });

    test('every start is different (a fresh state, nonce and PKCE challenge each time)', async () => {
      const a = new URL((await new Browser().get('/api/auth/google/start')).location).searchParams;
      const c = new URL((await new Browser().get('/api/auth/google/start')).location).searchParams;
      for (const k of ['state', 'nonce', 'code_challenge']) assert.notEqual(a.get(k), c.get(k), k);
    });

    test('the server sends the client secret and PKCE verifier to Google itself, never through the browser', async () => {
      await new Browser().google('newcomer');
      const req = fake.tokenRequests.at(-1);
      assert.equal(req.authenticated, true);
      assert.equal(req.grant_type, 'authorization_code');
      assert.ok(req.code_verifier && req.code_verifier.length >= 43);
      assert.equal(req.redirect_uri, `${base}/api/auth/google/callback`);
      await pool.query(`DELETE FROM users WHERE email = 'giorgi.google@e2e.test'`);
    });

    test('the button and the address are only there when Google is set up (config and the pages)', async () => {
      assert.equal((await (await fetch(`${base}/api/config`)).json()).googleEnabled, true);
      assert.doesNotMatch(await (await fetch(`${base}/login.html`)).text(), /google-block[^>]*hidden/);
      const off = await startServer(PORT + 1, {});
      try {
        assert.equal((await (await fetch(`${off.base}/api/config`)).json()).googleEnabled, false);
        for (const page of ['login', 'signup']) assert.match(await (await fetch(`${off.base}/${page}.html`)).text(), /class="google-block" hidden/, `${page} hides the button`);
        const r = await fetch(`${off.base}/api/auth/google/start`, { redirect: 'manual' });
        assert.equal(r.status, 302);
        assert.equal(r.headers.get('location'), '/login.html?google=unavailable');
        assert.match(off.logs(), /Google sign-in: off/);
      } finally { off.proc.kill(); }
      assert.match(srv.logs(), /Google sign-in: on/);
    });

    test('?redirect= is kept when it is a path on this site and dropped when it is anything else', async () => {
      for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)']) {
        const b = new Browser();
        const { final } = await b.google('newcomer', { start: `/api/auth/google/start?redirect=${encodeURIComponent(bad)}` });
        assert.equal(final.status, 302);
        assert.ok(!final.location.includes('evil'), `${bad} was followed`);
        assert.equal(pathOf(final.location), '/choose-username.html', bad);
        await pool.query(`DELETE FROM users WHERE email = 'giorgi.google@e2e.test'`);
      }
    });
  });

  describe('a new person', () => {
    let b, me;
    test('gets an account with their name, email and picture, verified because Google said so, and is signed in', async () => {
      b = new Browser();
      const { final } = await b.google('newcomer', { start: '/api/auth/google/start?mode=signup&redirect=%2Fsettings.html%3Ftab%3Dprofile' });
      assert.equal(final.status, 302);
      // first login: pick a username, then carry on to where they were going
      assert.equal(final.location, '/choose-username.html?redirect=%2Fsettings.html%3Ftab%3Dprofile');
      me = await b.me();
      assert.ok(me, 'signed in');
      assert.equal(me.name, 'Giorgi Google');
      assert.equal(me.email, 'giorgi.google@e2e.test');
      assert.equal(me.emailVerified, true);
      assert.equal(me.hasPassword, false);
      assert.equal(me.role, 'seeker');
      assert.equal(me.username, 'giorgi-google');
      assert.equal(me.usernameConfirmed, false, 'the username is only a suggestion until they accept it');
      assert.ok(me.photoUrl, 'the Google picture became their photo');
      const photo = await fetch(base + me.photoUrl);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get('content-type'), 'image/webp');
      assert.equal((await pool.query('SELECT source FROM user_photos WHERE user_id = $1', [me.id])).rows[0].source, 'google');
      const ids = (await pool.query('SELECT * FROM user_identities WHERE user_id = $1', [me.id])).rows;
      assert.equal(ids.length, 1);
      assert.equal(ids[0].provider, 'google');
      assert.equal(ids[0].subject, 'g-newcomer');
      assert.equal(ids[0].email_verified, true);
    });

    test('the one-use cookie is gone afterwards and the login cookie is httpOnly', async () => {
      assert.ok(!b.jar.has('wisecall_oauth'));
      assert.ok(b.jar.has('wisecall_token'));
    });

    test('confirms the suggested username on the next page', async () => {
      const kept = await b.api('/me/username', { method: 'PUT', body: { username: 'giorgi-google' } });
      assert.equal(kept.status, 200);
      assert.equal(kept.user.usernameConfirmed, true);
    });

    test('signing in again with the same Google account is the same person, and goes where they were going', async () => {
      const again = new Browser();
      const { final } = await again.google('newcomer', { start: '/api/auth/google/start?redirect=%2Fsettings.html' });
      assert.equal(final.location, '/settings.html');
      assert.equal((await again.me()).id, me.id);
      assert.equal((await usersWith('giorgi.google@e2e.test')).length, 1, 'no second account');
      assert.equal(await identityCount(), 1);
      assert.equal((await again.google('newcomer')).final.location, '/dashboard.html');
    });

    test('a Google-only account has no password to log in with, but can ask for a reset link', async () => {
      const anon = new Browser();
      assert.equal((await anon.api('/auth/login', { method: 'POST', body: { email: 'giorgi.google@e2e.test', password: 'anything-at-all-123' } })).error, 'invalid_credentials');
      const forgot = await anon.api('/auth/forgot-password', { method: 'POST', body: { email: 'giorgi.google@e2e.test' } });
      assert.equal(forgot.status, 200);
    });

    test('a new person whose email Google says is NOT verified must still verify it with the emailed code', async () => {
      const u = new Browser();
      const { final } = await u.google('unverified', { start: '/api/auth/google/start?mode=signup' });
      assert.match(final.location, /^\/verify-email\.html\?redirect=%2Fchoose-username\.html&devCode=\d{6}$/);
      const meU = await u.me();
      assert.equal(meU.emailVerified, false, 'Google did not vouch for this address');
      assert.equal(meU.name, 'Una Unverified');
      const code = new URL(final.location, base).searchParams.get('devCode');
      const ok = await u.api('/auth/verify-email', { method: 'POST', body: { code } });
      assert.equal(ok.status, 200);
      assert.equal(ok.user.emailVerified, true);
    });
  });

  describe('an email address that already has an account', () => {
    test('verified on both sides: Google is linked to that account and they are signed in as themselves', async () => {
      const local = await signupVerified(base, 'Existing Person', 'existing.person@e2e.test', 'their-own-password-1');
      const before = await userCount();
      const b = new Browser();
      const { final } = await b.google('existing');
      assert.equal(final.location, '/dashboard.html');
      assert.equal(await userCount(), before, 'no second account was made');
      const mine = (await local('/api/me')).user;
      assert.equal((await b.me()).id, mine.id);
      const ids = (await pool.query('SELECT * FROM user_identities WHERE user_id = $1', [mine.id])).rows;
      assert.equal(ids.length, 1);
      assert.equal(ids[0].subject, 'g-existing');
      // their password still works
      assert.equal((await new Browser().api('/auth/login', { method: 'POST', body: { email: 'existing.person@e2e.test', password: 'their-own-password-1' } })).status, 200);
      // and their own profile details were not overwritten by Google's
      assert.equal(mine.name, 'Existing Person');
    });

    test('NOT verified on our side: nothing is linked and nobody is signed in; they are asked to use their password first', async () => {
      // an account made by email + password whose email was never confirmed (anybody could have typed that address)
      const un = new Browser();
      assert.equal((await un.api('/auth/signup', { method: 'POST', body: { name: 'Unverified Here', email: 'unverified.here@e2e.test', password: 'their-own-password-2' } })).status, 201);
      const before = { users: await userCount(), ids: await identityCount() };
      const attacker = new Browser();
      const { final } = await attacker.google('existing2');
      assert.equal(final.status, 302);
      assert.equal(final.location, '/login.html?google=link_needed');
      assert.equal(await userCount(), before.users);
      assert.equal(await identityCount(), before.ids, 'no identity was linked');
      assert.equal((await attacker.api('/me')).user, null, 'not signed in');
      assert.ok(!attacker.jar.has('wisecall_token'));
      assert.equal((await pool.query('SELECT password_hash IS NOT NULL AS has FROM users WHERE email = $1', ['unverified.here@e2e.test'])).rows[0].has, true, 'their password is untouched');
    });

    test('NOT verified on Google\'s side either: nothing is linked', async () => {
      fake.personas.notSure = { sub: 'g-notsure', email: 'existing.person@e2e.test', email_verified: false, name: 'Someone Else' };
      const ids = await identityCount();
      const b = new Browser();
      const { final } = await b.google('notSure');
      assert.equal(final.location, '/login.html?google=link_needed');
      assert.equal(await identityCount(), ids);
      assert.equal((await b.api('/me')).user, null);
    });

    test('...but the person can sign in with their password and connect Google from Settings, and it works from then on', async () => {
      const un = new Browser();
      const login = await un.api('/auth/login', { method: 'POST', body: { email: 'unverified.here@e2e.test', password: 'their-own-password-2' } });
      assert.equal(login.status, 200);
      const state = await un.api('/me/identities');
      assert.equal(state.google, null);
      assert.equal(state.googleEnabled, true);
      assert.equal(state.hasPassword, true);
      // connect (the page calls this, then the browser goes to Google and comes back)
      const started = await un.api('/auth/google/link/start', { method: 'POST' });
      assert.equal(started.status, 200);
      assert.ok(started.url.startsWith(fake.url + '/authorize'));
      fake.auto = 'existing2';
      const atGoogle = await un.get(started.url, { theirs: true });
      const back = await un.get(atGoogle.location);
      assert.equal(back.location, '/settings.html?tab=account&google=linked');
      const after = await un.api('/me/identities');
      assert.equal(after.google.email, 'unverified.here@e2e.test');
      // now Google sign-in finds them (even though their address was never confirmed by code: they proved both by connecting)
      const again = new Browser();
      assert.equal((await again.google('existing2')).final.location, '/dashboard.html');
      assert.equal((await again.me()).email, 'unverified.here@e2e.test');
    });
  });

  describe('declined, forged and broken sign-ins change nothing', () => {
    test('cancelled at Google: back to the page they came from with a friendly code; nothing created, nobody signed in', async () => {
      const before = { users: await userCount(), ids: await identityCount() };
      const b = new Browser();
      const login = await b.google('cancel');
      assert.equal(login.final.location, '/login.html?google=cancelled');
      const signup = await b.google('cancel', { start: '/api/auth/google/start?mode=signup&redirect=%2Fsettings.html' });
      assert.equal(signup.final.location, '/signup.html?google=cancelled&redirect=%2Fsettings.html');
      assert.equal(await userCount(), before.users);
      assert.equal(await identityCount(), before.ids);
      assert.ok(!b.jar.has('wisecall_token'));
      assert.ok(!b.jar.has('wisecall_oauth'), 'the state cookie is cleared');
    });

    test('a wrong state (forged callback) is refused', async () => {
      fake.defect = 'state';
      const before = { users: await userCount(), ids: await identityCount() };
      const b = new Browser();
      const { final } = await b.google('newcomer');
      assert.equal(final.location, '/login.html?google=bad_state');
      assert.equal(await userCount(), before.users);
      assert.ok(!b.jar.has('wisecall_token'));
    });

    test('a callback with no state cookie (another browser, or an attacker\'s link) is refused', async () => {
      const victim = new Browser(); // never started a sign-in
      let captured;
      const starter = new Browser();
      const { callback } = await starter.google('newcomer', { beforeCallback: (loc) => { captured = loc; } });
      assert.ok(captured);
      const before = await userCount();
      const r = await victim.get(captured);
      assert.equal(r.location, '/login.html?google=bad_state');
      assert.equal(await userCount(), before, 'the attacker\'s callback did not sign the victim in as somebody else');
      assert.ok(!victim.jar.has('wisecall_token'));
      assert.ok(callback);
    });

    test('a callback cannot be replayed: the state cookie is used once, and Google\'s code too', async () => {
      const b = new Browser();
      const first = await b.google('newcomer');
      assert.equal(first.final.status, 302);
      const replay = await b.get(first.callback);
      assert.equal(replay.location, '/login.html?google=bad_state');
      // even with the state cookie put back, Google refuses a code it already gave out
      const b2 = new Browser();
      let cb1, cookieCopy;
      await b2.google('newcomer', { beforeCallback: (loc) => { cb1 = loc; cookieCopy = b2.header(); } });
      const again = await fetch(cb1, { redirect: 'manual', headers: { cookie: cookieCopy } });
      assert.match(again.headers.get('location') || '', /google=(bad_state|error)/);
    });

    for (const [defect, why] of [['nonce', 'a different nonce'], ['audience', 'made for another app'], ['issuer', 'from another issuer'], ['signature', 'signed with a key Google does not publish'], ['expired', 'already expired']]) {
      test(`an ID token ${why} is refused`, async () => {
        fake.defect = defect;
        const before = { users: await userCount(), ids: await identityCount() };
        const b = new Browser();
        const { final } = await b.google('newcomer');
        assert.equal(final.location, '/login.html?google=error', defect);
        assert.equal(await userCount(), before.users);
        assert.equal(await identityCount(), before.ids);
        assert.ok(!b.jar.has('wisecall_token'));
      });
    }

    test('Google being unreachable is a friendly error, not a crash', async () => {
      const dead = await createFakeGoogle().start();
      const url = dead.url;
      await dead.stop();
      const s = await startServer(PORT + 2, { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_ISSUER: url });
      try {
        const r = await fetch(`${s.base}/api/auth/google/start?mode=signup`, { redirect: 'manual' });
        assert.equal(r.status, 302);
        assert.equal(r.headers.get('location'), '/signup.html?google=error');
      } finally { s.proc.kill(); }
    });

    test('the fake Google refuses a request that lacks PKCE, so we know ours has it (sanity check of the fake itself)', async () => {
      const r = await fetch(`${fake.url}/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(base + '/api/auth/google/callback')}&scope=openid&state=s&nonce=n`, { redirect: 'manual' });
      assert.equal(r.status, 400);
    });
  });

  describe('Google never skips a mentor\'s verification', () => {
    test('a mentor who signed in with Google still has every step to pass: the ID check, and the rest', async () => {
      const b = new Browser();
      fake.personas.mentorish = { sub: 'g-mentorish', email: 'mentorish@e2e.test', email_verified: true, name: 'Mia Mentor' };
      await b.google('mentorish');
      assert.equal((await b.me()).emailVerified, true, 'the email is verified (Google said so)');
      const r = await b.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/mia', sampleAnswer: SAMPLE } });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.notEqual(r.user.verificationStatus, 'verified');
      const v = await b.api('/verification');
      assert.notEqual(v.status, 'verified');
      assert.equal(v.ready, false);
      const kyc = v.requirements.find((x) => x.step === 'id_kyc');
      assert.ok(kyc, 'the ID check is still required');
      assert.notEqual(kyc.status, 'passed');
      assert.ok(v.requirements.filter((x) => x.step && x.step !== 'email' && x.step !== 'work_email' && x.step !== 'proof_link' && x.step !== 'sample_answer').every((x) => x.status !== 'passed'), 'no other step was passed for them (only the email step, because Google said the address is verified)');
      // and without an admin's approval they can neither be found nor booked
      const list = await b.api('/experts');
      assert.ok(!list.experts.some((e) => e.name === 'Mia Mentor'));
      const me = await b.me();
      assert.equal(me.isListedMentor, false);
      const approveTooEarly = await admin.api(`/admin/mentors/${me.id}/approve`, { method: 'POST' });
      assert.equal(approveTooEarly.error, 'steps_incomplete', 'even an admin cannot approve before the steps are passed');
      assert.ok(approveTooEarly.missing.includes('id_kyc'));
    });

    test('once an admin has really verified them, Google made no difference to what is shown', async () => {
      const b = new Browser();
      await b.google('mentorish');
      const me = await b.me();
      const client = require('./helpers').client(base);
      // (log in as the same person through the helper client, using a reset password, to reuse the shared approval helpers)
      await b.api('/me/password', { method: 'POST', body: { newPassword: 'mentor-password-1' } });
      await client.api('/auth/login', { method: 'POST', body: { email: 'mentorish@e2e.test', password: 'mentor-password-1' } });
      await approveMentor(admin, client);
      await addPayoutDetails(client);
      assert.equal((await b.me()).isListedMentor, true);
      assert.equal(me.id, (await client.api('/me')).user.id);
    });
  });

  describe('connected accounts in Settings', () => {
    test('Google-only people cannot disconnect it until they have set a password; then they can', async () => {
      fake.personas.only = { sub: 'g-only', email: 'only.google@e2e.test', email_verified: true, name: 'Only Google' };
      const b = new Browser();
      await b.google('only');
      const state = await b.api('/me/identities');
      assert.equal(state.hasPassword, false);
      assert.equal(state.google.email, 'only.google@e2e.test');
      const refused = await b.api('/me/identities/google', { method: 'DELETE' });
      assert.equal(refused.status, 400);
      assert.equal(refused.error, 'set_password_first');
      assert.ok((await b.api('/me/identities')).google, 'still connected');

      // setting a password needs no "current password" for someone who has none
      assert.equal((await b.api('/me/password', { method: 'POST', body: { newPassword: 'short' } })).error, 'weak_password');
      assert.equal((await b.api('/me/password', { method: 'POST', body: { newPassword: 'a-good-new-password' } })).status, 200);
      const removed = await b.api('/me/identities/google', { method: 'DELETE' });
      assert.equal(removed.status, 200);
      assert.equal(removed.google, null);
      assert.equal(removed.hasPassword, true);
      assert.equal(await pool.query(`SELECT 1 FROM user_identities WHERE subject = 'g-only'`).then((r) => r.rowCount), 0);
      // with a password they are still able to log in
      assert.equal((await new Browser().api('/auth/login', { method: 'POST', body: { email: 'only.google@e2e.test', password: 'a-good-new-password' } })).status, 200);
      // and once someone has a password, changing it needs the current one again
      assert.equal((await b.api('/me/password', { method: 'POST', body: { newPassword: 'another-good-password' } })).error, 'missing_fields');
      assert.equal((await b.api('/me/password', { method: 'POST', body: { currentPassword: 'wrong-wrong-wrong', newPassword: 'another-good-password' } })).error, 'wrong_password');
    });

    test('a Google account can belong to only one Wisecall account', async () => {
      const other = await signupVerified(base, 'Other Person', 'other.person@e2e.test');
      const cookieJar = new Browser();
      await cookieJar.api('/auth/login', { method: 'POST', body: { email: 'other.person@e2e.test', password: 'test-pass-12345' } });
      const started = await cookieJar.api('/auth/google/link/start', { method: 'POST' });
      fake.auto = 'newcomer'; // already belongs to Giorgi
      const atGoogle = await cookieJar.get(started.url, { theirs: true });
      const back = await cookieJar.get(atGoogle.location);
      assert.equal(back.location, '/settings.html?tab=account&google=already_linked');
      assert.equal((await cookieJar.api('/me/identities')).google, null);
      assert.ok(other);
    });

    test('connecting needs a signed-in person, and the state must belong to that person', async () => {
      assert.equal((await new Browser().api('/auth/google/link/start', { method: 'POST' })).status, 401);
      // start linking as one person, finish in the browser of another
      const a = new Browser();
      await a.api('/auth/login', { method: 'POST', body: { email: 'other.person@e2e.test', password: 'test-pass-12345' } });
      const started = await a.api('/auth/google/link/start', { method: 'POST' });
      fake.personas.third = { sub: 'g-third', email: 'third@e2e.test', email_verified: true, name: 'Third' };
      fake.auto = 'third';
      const atGoogle = await a.get(started.url, { theirs: true });
      const c = new Browser();
      await c.api('/auth/login', { method: 'POST', body: { email: 'mentorish@e2e.test', password: 'mentor-password-1' } });
      c.jar.set('wisecall_oauth', a.jar.get('wisecall_oauth')); // (the state cookie of the first person)
      const back = await c.get(atGoogle.location);
      assert.equal(back.location, '/settings.html?tab=account&google=bad_state');
      assert.equal(await pool.query(`SELECT 1 FROM user_identities WHERE subject = 'g-third'`).then((r) => r.rowCount), 0);
    });

    test('a second Google account cannot be added on top of the first', async () => {
      const b = new Browser();
      await b.api('/auth/login', { method: 'POST', body: { email: 'existing.person@e2e.test', password: 'their-own-password-1' } });
      assert.equal((await b.api('/auth/google/link/start', { method: 'POST' })).error, 'already_connected');
    });

    test('CSRF: connecting cannot be started from another site (it is a POST with our header)', async () => {
      const r = await fetch(`${base}/api/auth/google/link/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      assert.equal(r.status, 403);
    });
  });

  describe('administrators', () => {
    test('an admin address must be verified: signing up with it is not enough, Google (verified) or the emailed code is', async () => {
      const b = new Browser();
      fake.personas.boss = { sub: 'g-boss', email: 'boss@e2e.test', email_verified: false, name: 'The Boss' };
      // (the admin list of this server is qa-admin@example.com: make that address, unverified, on a second server)
      const s = await startServer(PORT + 3, { ADMIN_EMAILS: 'squatter@example.com' });
      try {
        const c = new Browser();
        const squat = await fetch(`${s.base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ name: 'Squatter', email: 'squatter@example.com', password: 'squatter-password-1' }) });
        assert.equal(squat.status, 201);
        const cookie = squat.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
        const me = await (await fetch(`${s.base}/api/me`, { headers: { cookie } })).json();
        assert.equal(me.user.isAdmin, false, 'not an admin until the address is verified');
        const adminCall = await fetch(`${s.base}/api/admin/mentors`, { headers: { cookie, 'X-Requested-With': 'wisecall' } });
        assert.equal(adminCall.status, 403);
        assert.ok(c && b);
      } finally { s.proc.kill(); }
    });
  });

  describe('configuration', () => {
    const load = (env) => {
      const r = spawnSync('node', ['-e', `const c = require('./server/config'); console.log(JSON.stringify({ issuer: c.GOOGLE_ISSUER, enabled: c.GOOGLE_ENABLED, cb: c.GOOGLE_CALLBACK_URL, problems: c.PROBLEMS.filter((p) => /GOOGLE/.test(p)) }));`],
        { cwd: path.join(__dirname, '..'), env: { ...process.env, WISECALL_NO_EXIT: '1', DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://wisecall.example', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_ISSUER: '', ...env }, encoding: 'utf8' });
      return JSON.parse(r.stdout.trim().split('\n').pop());
    };
    test('the callback address comes from PUBLIC_URL', () => {
      assert.equal(load({}).cb, 'https://wisecall.example/api/auth/google/callback');
    });
    test('both keys or neither', () => {
      assert.equal(load({}).enabled, false);
      assert.equal(load({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }).enabled, true);
      assert.match(load({ GOOGLE_CLIENT_ID: 'a' }).problems[0], /both be set/);
      assert.match(load({ GOOGLE_CLIENT_SECRET: 'b' }).problems[0], /both be set/);
    });
    test('in production the issuer cannot be pointed anywhere but Google', () => {
      assert.equal(load({ NODE_ENV: 'production', GOOGLE_ISSUER: 'https://evil.example' }).issuer, 'https://accounts.google.com');
      assert.equal(load({ NODE_ENV: '', GOOGLE_ISSUER: 'http://localhost:1234/' }).issuer, 'http://localhost:1234');
    });
  });
});
