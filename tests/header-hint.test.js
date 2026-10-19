// The header's "signed in" hint (server/auth.js, public/js/header.js): a readable cookie next to the login cookie, so a signed-in
// person's header is drawn right from the first frame. Set at sign-in ("1", or "admin" for an admin), never HttpOnly and never anything
// personal; cleared at sign-out, when a session has run out, and when /api/me finds nobody behind it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resetDatabase, startServer, signupVerified, client } = require('./helpers');

let srv;
before(async () => {
  await resetDatabase();
  srv = await startServer(4734, { ADMIN_EMAILS: 'hint-admin@example.com' });
});
after(() => srv && srv.proc.kill());

const login = (email) => fetch(srv.base + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ email, password: 'test-pass-12345' })
});

test('signing in sets the hint "1" (readable, Lax, no personal data) next to the HttpOnly login cookie; signing out clears both', async () => {
  const c = await signupVerified(srv.base, 'Hint Person', 'hint.person@example.com');
  assert.equal(c.getCookie('wc_authed'), '1', 'set as soon as the account is confirmed and signed in');
  const r = await login('hint.person@example.com');
  assert.equal(r.status, 200);
  const cookies = r.headers.getSetCookie();
  const hint = cookies.find((x) => x.startsWith('wc_authed='));
  assert.match(hint, /^wc_authed=1; Max-Age=2592000; Path=\//);
  assert.match(hint, /SameSite=Lax/);
  assert.doesNotMatch(hint, /HttpOnly/i, 'the page must be able to read it');
  assert.match(cookies.find((x) => x.startsWith('wisecall_token=')), /HttpOnly/, 'the login cookie stays out of reach of scripts');
  await c.api('/auth/logout', { method: 'POST' });
  assert.equal(c.getCookie('wc_authed'), '');
  assert.equal(c.getCookie('wisecall_token'), '');
});

test('an admin\'s hint says "admin" (the header then draws the Admin button from the first frame)', async () => {
  await signupVerified(srv.base, 'Hint Admin', 'hint-admin@example.com');
  const r = await login('hint-admin@example.com');
  assert.equal(r.status, 200);
  assert.match(r.headers.getSetCookie().find((x) => x.startsWith('wc_authed=')), /^wc_authed=admin;/);
});

test('a hint with nobody behind it is cleared: by /api/me, and with the login cookie when a session is not valid', async () => {
  const c = client(srv.base);
  c.setCookie('wc_authed', '1');
  const me = await c.api('/me');
  assert.equal(me.user, null);
  assert.equal(c.getCookie('wc_authed'), '');
  // a session that has ended (signed out on another copy of the same cookies): the next request clears both cookies
  const a = await signupVerified(srv.base, 'Hint Ended', 'hint.ended@example.com');
  const b = client(srv.base);
  b.setCookie('wisecall_token', a.getCookie('wisecall_token'));
  b.setCookie('wc_authed', a.getCookie('wc_authed'));
  await a.api('/auth/logout', { method: 'POST' });
  assert.equal((await b.api('/bookings/mine')).status, 401);
  assert.equal(b.getCookie('wc_authed'), '');
  assert.equal(b.getCookie('wisecall_token'), '');
});

test('the header draws itself from the hint before it asks the server; the server\'s answer changes it only if they disagree, with a fade', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  const header = read('public/js/header.js');
  assert.match(header, /const signedIn = \(\(\) => \{ try \{ return \(\/\(\?:\^\|;\\s\*\)wc_authed=\(1\|admin\|mentor\)/);
  assert.match(header, /<header class="nav\$\{signedIn \? ' is-authed' : ''\}" id="siteHeader">/);
  assert.match(header, /<div class="nav-actions" id="navLoggedIn"\$\{off\(!signedIn\)\}>/);
  assert.match(header, /<div class="mm-actions" id="mmLoggedIn"\$\{off\(!signedIn\)\}>/);
  const nav = read('public/js/nav.js');
  assert.match(nav, /if \(header && Boolean\(user\) !== drawnSignedIn\) \{/);
  assert.match(nav, /setHint\(user \? \(user\.isAdmin \? 'admin' : \(\['mentor', 'both'\]\.includes\(user\.role\) \? 'mentor' : '1'\)\) : null\);/);
  assert.match(read('public/css/style.css'), /html\.motion \.nav\.auth-swap \.nav-links, html\.motion \.nav\.auth-swap \.nav-right \{ animation: auth-swap 0\.2s ease-out; \}/);
});

test('the header\'s own words (drawn before the dictionary arrives) are the dictionary\'s words, in English and Georgian', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/header.js'), 'utf8');
  const table = src.slice(src.indexOf('const WORDS = {') + 'const WORDS = '.length, src.indexOf('const w = (key)'));
  const WORDS = new Function(`return ${table.trim().replace(/;$/, '')}`)();
  for (const lang of ['en', 'ka']) {
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/i18n', `${lang}.json`), 'utf8'));
    assert.ok(Object.keys(WORDS[lang]).length >= 16);
    for (const [key, value] of Object.entries(WORDS[lang])) assert.equal(value, dict[key], `${lang} ${key}`);
  }
  assert.deepEqual(Object.keys(WORDS.ka).sort(), Object.keys(WORDS.en).sort());
});
