// A fake Google for tests: an OpenID Connect provider that speaks the real protocol (discovery, authorization endpoint,
// token endpoint with client secret and PKCE, JWKS) and signs ID tokens with a real RSA key, so the real server code and
// the real openid-client library are what get exercised. Nothing here trusts the server under test: it checks the client id,
// redirect URI, PKCE and client secret the way Google does.
//
// The person's part is a page that lists accounts ("Choose an account", like Google's). Playwright clicks on them; unit tests
// set `fake.auto` to an account id (or 'cancel') and skip the page.
//   fake.personas   id -> { sub, email, email_verified, name, picture }
//   fake.auto       null (show the page) | a persona id | 'cancel'
//   fake.defect     null | 'nonce' | 'audience' | 'issuer' | 'signature' | 'expired' | 'state'  (a broken token or callback, to prove it is refused)
//   fake.requests   what /authorize was asked, for the tests to look at
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = 'fake-google-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'fake-google-client-secret';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// A small PNG for the fake account picture (made by hand, so no image library is needed here).
function tinyPng(color = [66, 133, 244]) {
  const zlib = require('zlib');
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]; }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function createFakeGoogle() {
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); // to sign a token the wrong way
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'fake-1', use: 'sig', alg: 'RS256' };
  const pending = new Map(); // request id -> what /authorize was asked
  const codes = new Map(); // code -> { ...request, persona, used }
  let server, port, issuer;

  const fake = {
    CLIENT_ID, CLIENT_SECRET,
    personas: {},
    auto: null,
    defect: null,
    requests: [],
    tokenRequests: [],
    get url() { return issuer; },
    get port() { return port; }
  };

  function signToken(claims, { wrongKey = false } = {}) {
    const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fake-1' }));
    const payload = b64u(JSON.stringify(claims));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), (wrongKey ? otherKey : key).privateKey);
    return `${header}.${payload}.${b64u(sig)}`;
  }

  function idToken(code) {
    const p = code.persona, now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: fake.defect === 'issuer' ? 'https://evil.example' : issuer,
      aud: fake.defect === 'audience' ? 'somebody-elses-client-id' : CLIENT_ID,
      sub: p.sub, email: p.email, email_verified: p.email_verified, name: p.name, picture: p.picture, given_name: (p.name || '').split(' ')[0],
      iat: now, exp: fake.defect === 'expired' ? now - 3600 : now + 3600,
      nonce: fake.defect === 'nonce' ? 'not-the-nonce-we-sent' : code.nonce
    };
    for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
    return signToken(claims, { wrongKey: fake.defect === 'signature' });
  }

  const redirectBack = (res, request, params) => {
    const u = new URL(request.redirect_uri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    res.writeHead(302, { location: u.href });
    res.end();
  };

  function finishAuthorize(res, request, who) {
    if (who === 'cancel') return redirectBack(res, request, { error: 'access_denied', state: request.state });
    const persona = fake.personas[who];
    if (!persona) { res.writeHead(400); return res.end('unknown account'); }
    const code = crypto.randomBytes(16).toString('hex');
    codes.set(code, { ...request, persona, used: false });
    redirectBack(res, request, { code, state: fake.defect === 'state' ? 'forged-state' : request.state });
  }

  async function handle(req, res) {
    const url = new URL(req.url, issuer);
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'], code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'email', 'profile'], claims_supported: ['sub', 'email', 'email_verified', 'name', 'picture']
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/photo.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(tinyPng()); }

    if (url.pathname === '/authorize') {
      const q = Object.fromEntries(url.searchParams);
      fake.requests.push(q);
      const bad = (why) => { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('Fake Google refuses: ' + why); };
      if (q.client_id !== CLIENT_ID) return bad('unknown client_id');
      if (q.response_type !== 'code') return bad('response_type must be code');
      if (q.code_challenge_method !== 'S256' || !q.code_challenge) return bad('PKCE (S256) is required');
      if (!q.state) return bad('state is required');
      if (!q.nonce) return bad('nonce is required');
      if (!(q.scope || '').split(' ').includes('openid')) return bad('scope must include openid');
      if (!q.redirect_uri) return bad('redirect_uri is required');
      const request = { redirect_uri: q.redirect_uri, state: q.state, nonce: q.nonce, challenge: q.code_challenge, scope: q.scope, prompt: q.prompt };
      if (fake.auto) return finishAuthorize(res, request, fake.auto);
      const id = crypto.randomBytes(8).toString('hex');
      pending.set(id, request);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Choose an account (fake Google)</title></head><body>
        <h1 id="chooser">Choose an account</h1><p>to continue to Wisecall (this is a fake Google for tests)</p>
        <ul>${Object.entries(fake.personas).map(([pid, p]) => `<li><a data-account="${pid}" href="/select?rid=${id}&who=${encodeURIComponent(pid)}">${p.name} — ${p.email}</a></li>`).join('')}</ul>
        <p><a id="cancel" href="/select?rid=${id}&who=cancel">Cancel</a></p></body></html>`);
    }
    if (url.pathname === '/select') {
      const request = pending.get(url.searchParams.get('rid'));
      if (!request) { res.writeHead(400); return res.end('unknown request'); }
      pending.delete(url.searchParams.get('rid'));
      return finishAuthorize(res, request, url.searchParams.get('who'));
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      // client authentication: in the body (client_secret_post) or Basic
      let id = form.client_id, secret = form.client_secret;
      const basic = (req.headers.authorization || '').match(/^Basic (.+)$/i);
      if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
      fake.tokenRequests.push({ ...form, client_secret: undefined, authenticated: id === CLIENT_ID && secret === CLIENT_SECRET });
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json(401, { error: 'invalid_client' });
      if (form.grant_type !== 'authorization_code') return json(400, { error: 'unsupported_grant_type' });
      const code = codes.get(form.code);
      if (!code) return json(400, { error: 'invalid_grant', error_description: 'unknown code' });
      if (code.used) { codes.delete(form.code); return json(400, { error: 'invalid_grant', error_description: 'code already used' }); }
      code.used = true;
      if (form.redirect_uri !== code.redirect_uri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      const challenge = crypto.createHash('sha256').update(form.code_verifier || '').digest('base64url');
      if (challenge !== code.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return json(200, { access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 3600, scope: code.scope, id_token: idToken(code) });
    }
    res.writeHead(404); res.end('not found');
  }

  fake.start = (wantedPort = 0) => new Promise((resolve) => {
    server = http.createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
    server.listen(wantedPort, () => {
      port = server.address().port;
      issuer = `http://localhost:${port}`;
      fake.personas = {
        // a person Wisecall has never seen
        newcomer: { sub: 'g-newcomer', email: 'giorgi.google@e2e.test', email_verified: true, name: 'Giorgi Google', picture: `${issuer}/photo.png` },
        // Google says the address is not verified
        unverified: { sub: 'g-unverified', email: 'unverified.google@e2e.test', email_verified: false, name: 'Una Unverified' },
        // an address that already has a Wisecall account (the tests create it)
        existing: { sub: 'g-existing', email: 'existing.person@e2e.test', email_verified: true, name: 'Existing Person', picture: `${issuer}/photo.png` },
        existing2: { sub: 'g-existing2', email: 'unverified.here@e2e.test', email_verified: true, name: 'Unverified Here' }
      };
      resolve(fake);
    });
  });
  fake.stop = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  fake.reset = () => { fake.auto = null; fake.defect = null; fake.requests.length = 0; fake.tokenRequests.length = 0; };
  return fake;
}

module.exports = { createFakeGoogle, CLIENT_ID, CLIENT_SECRET };

// `node tests/fakeGoogle.js 4630` runs it on its own (the Playwright set-up starts it this way).
if (require.main === module) createFakeGoogle().start(Number(process.argv[2]) || 4630).then((f) => console.log(`fake Google on ${f.url}`));
