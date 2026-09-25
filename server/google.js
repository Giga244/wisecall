// Sign in with Google: OAuth 2 / OpenID Connect, the "authorization code" flow with PKCE, all on our server.
// The browser is only redirected to Google and back: no Google script is ever loaded, so the strict CSP stays as it is.
//   1. start:    we make a random state, nonce and PKCE verifier, keep them in a short-lived signed cookie, and send the
//                browser to Google with the state, the nonce and the PKCE challenge
//   2. Google:   the person signs in and agrees; Google sends the browser back to /api/auth/google/callback with a code
//   3. finish:   we check the state, exchange the code (with the PKCE verifier and our client secret) for tokens straight
//                from Google's servers, and check the ID token's signature, issuer, audience, expiry and nonce
// The library (openid-client) does the protocol work: discovery, the checks and the token request.
const client = require('openid-client');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'wisecall_oauth';
const AUDIENCE = 'wisecall-google-oauth'; // (so a login cookie can never be mistaken for this one, or the other way round)
const MAX_AGE_SECONDS = 10 * 60;

let configuration = null;
function discovered() {
  if (!configuration) {
    // A fake Google in the tests speaks plain http; the real one never does.
    const insecure = !config.IS_PROD && config.GOOGLE_ISSUER.startsWith('http:');
    configuration = client.discovery(new URL(config.GOOGLE_ISSUER), config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, undefined, {
      timeout: 10,
      ...(insecure ? { execute: [client.allowInsecureRequests] } : {})
    }).catch((err) => { configuration = null; throw err; }); // try again next time if Google could not be reached
  }
  return configuration;
}

// The address to send the browser to, and what must be remembered until it comes back (as a signed cookie value).
async function start({ redirect, mode, userId, lang }) {
  const conf = await discovered();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(conf, {
    redirect_uri: config.GOOGLE_CALLBACK_URL,
    scope: 'openid email profile',
    response_type: 'code',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: 'select_account' // always let the person choose which Google account
  });
  const cookie = jwt.sign({ state, nonce, cv: codeVerifier, redirect: redirect || null, mode, uid: userId || null, lang }, config.SESSION_SECRET, { expiresIn: MAX_AGE_SECONDS, audience: AUDIENCE });
  return { url: url.href, cookie };
}

// What was remembered at the start (null when there is no cookie, it has expired or it is not ours).
function readCookie(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, config.SESSION_SECRET, { audience: AUDIENCE }); } catch (e) { return null; }
}

const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: config.IS_PROD, path: '/api/auth/google' });
const setCookie = (res, value) => res.cookie(COOKIE, value, { ...cookieOptions(), maxAge: MAX_AGE_SECONDS * 1000 });
const clearCookie = (res) => res.clearCookie(COOKIE, cookieOptions());

// Google's public keys (fetched once and cached; the library refreshes them when Google rotates them).
let keys = null;
async function publicKeys() {
  const conf = await discovered();
  if (!keys) keys = createRemoteJWKSet(new URL(conf.serverMetadata().jwks_uri), { timeoutDuration: 10000 });
  return keys;
}

// Exchanges the code Google sent for the person's verified claims (sub, email, email_verified, name, picture).
// Throws when anything does not check out: state, nonce, PKCE, the token request itself, or the ID token's signature,
// issuer, audience or expiry. (openid-client checks the claims; the OpenID Connect spec lets a client skip the signature
// of a token that came straight from the token endpoint over TLS, but we check it anyway.)
async function finish(callbackUrl, remembered) {
  const conf = await discovered();
  const tokens = await client.authorizationCodeGrant(conf, callbackUrl, {
    pkceCodeVerifier: remembered.cv,
    expectedState: remembered.state,
    expectedNonce: remembered.nonce,
    idTokenExpected: true
  });
  await jwtVerify(tokens.id_token, await publicKeys(), { issuer: conf.serverMetadata().issuer, audience: config.GOOGLE_CLIENT_ID, algorithms: ['RS256'] });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) throw new Error('the ID token has no subject');
  return claims;
}

module.exports = { start, finish, readCookie, setCookie, clearCookie, COOKIE };
