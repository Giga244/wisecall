// Secrets (docs/SECRETS.md): nothing secret reaches a browser or a log, production will not start with a key missing, and a commit that adds a key is
// blocked. Every "key" here is made up at run time; none is real.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { resetDatabase, startServer, client, ROOT } = require('./helpers');
const secrets = require('../server/secrets');

// A made-up value per secret, built at run time so no file holds anything that looks like a key.
const made = (name) => `${name.toLowerCase().replace(/_/g, '')}-${'k'.repeat(4)}${Date.now().toString(36)}Zq9`;
const FAKE = Object.fromEntries(secrets.SECRET.filter((n) => !/DATABASE_URL|BACKUP_SOURCE_URL|SENTRY_DSN/.test(n)).map((n) => [n, made(n)]));

describe('the list', () => {
  test('every secret the server reads is on the list, and nothing is both secret and public', () => {
    const read = new Set(fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8').match(/env\.[A-Z0-9_]+/g).map((x) => x.slice(4)));
    for (const name of read) {
      if (/SECRET|_KEY$|TOKEN|PASSWORD|_DSN$/.test(name) && !secrets.PUBLIC.includes(name) && name !== 'BOG_CALLBACK_PUBLIC_KEY') assert.ok(secrets.SECRET.includes(name), name);
    }
    assert.deepEqual(secrets.SECRET.filter((n) => secrets.PUBLIC.includes(n)), []);
  });
  test('docs/SECRETS.md names every secret and every public value', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'SECRETS.md'), 'utf8');
    for (const name of [...secrets.SECRET, ...secrets.PUBLIC]) assert.ok(doc.includes('`' + name + '`'), name);
  });
  test('.env files are kept out of git, and .env.example holds no secret value', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    for (const name of secrets.SECRET) {
      const m = new RegExp(`^${name}=(.*)$`, 'm').exec(example);
      if (m) assert.equal(m[1].trim(), '', `${name} is empty in .env.example`);
    }
    assert.doesNotMatch(example, /^[A-Z_]+=\S*:\/\/[^:\s]+:[^@\s]+@/m, 'no address with a password');
  });
});

describe('redacting', () => {
  test('a secret, and a database password on its own, become their name', () => {
    const env = { RESEND_API_KEY: 're_made_up_value_123456', DATABASE_URL: 'postgresql://app:pa55word-made-up@db.internal:5432/x' };
    const values = secrets.secretValues(env);
    const out = secrets.redact('key re_made_up_value_123456; url postgresql://app:pa55word-made-up@db.internal:5432/x; pw pa55word-made-up', values);
    assert.doesNotMatch(out, /re_made_up|pa55word/);
    assert.match(out, /\[RESEND_API_KEY hidden\]/);
    assert.match(out, /\[DATABASE_URL hidden\]/);
  });
  test('the console of a running process never writes a secret, whatever is logged', () => {
    const value = made('ANTHROPIC_API_KEY');
    const r = spawnSync(process.execPath, ['-e', `require('./server/secrets').guardConsole(); console.log('key', process.env.ANTHROPIC_API_KEY); console.error(new Error('failed with ' + process.env.ANTHROPIC_API_KEY)); console.warn({ k: process.env.ANTHROPIC_API_KEY });`],
      { cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: value }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(value));
    assert.equal(((r.stdout + r.stderr).match(/\[ANTHROPIC_API_KEY hidden\]/g) || []).length, 3);
  });
  test('an error report is scrubbed of secrets too', () => {
    const value = made('DAILY_API_KEY');
    const r = spawnSync(process.execPath, ['-e', `console.log(require('./server/errorReport').scrub('x ' + process.env.DAILY_API_KEY))`], { cwd: ROOT, env: { ...process.env, DAILY_API_KEY: value }, encoding: 'utf8' });
    assert.ok(!r.stdout.includes(value));
  });
});

describe('the browser', () => {
  let srv;
  before(async () => {
    await resetDatabase();
    srv = await startServer(4797, { ...FAKE, GOOGLE_CLIENT_ID: 'made-up-client-id.apps.example', GOOGLE_ISSUER: 'http://127.0.0.1:9', TURNSTILE_SITE_KEY: 'made-up-site-key', PLAUSIBLE_DOMAIN: 'wisecall.test',
      KYC_PROVIDER: 'mock', PAYMENT_PROVIDER: 'mock', EMAIL_PROVIDER: 'log' });
  });
  after(() => { if (srv) srv.proc.kill(); });

  test('no page, API answer or script sent to a browser holds a secret; the public values are the only ones there', async () => {
    const c = client(srv.base);
    const bodies = [];
    for (const p of ['/', '/ka/', '/signup.html', '/login.html', '/apply.html', '/admin.html', '/terms.html', '/privacy.html', '/about.html', '/find-a-mentor.html', '/index.html?field=med',
      '/js/api.js', '/js/i18n.js', '/js/turnstile.js', '/js/google-signin.js', '/js/main.js', '/sitemap.xml', '/robots.txt']) {
      const r = await fetch(srv.base + p);
      bodies.push([p, await r.text()]);
    }
    for (const p of ['/config', '/experts', '/categories', '/answers', '/me', '/i18n/en', '/i18n/ka']) bodies.push([p, JSON.stringify(await c.api(p))]);
    for (const [p, body] of bodies) {
      for (const [name, value] of Object.entries(FAKE)) assert.ok(!body.includes(value), `${name} in ${p}`);
      assert.ok(!body.includes(process.env.TEST_DATABASE_URL), `the database address in ${p}`);
    }
    // (what /api/config sends, by name: only public ids among the keys)
    const config = await c.api('/config');
    assert.equal(config.turnstileSiteKey, 'made-up-site-key');
    assert.ok(!JSON.stringify(config).match(/secret|password/i), 'no secret-looking field');
  });

  test('the start-up messages and an error show no secret', async () => {
    await fetch(srv.base + '/api/no-such-thing');
    for (const [name, value] of Object.entries(FAKE)) assert.ok(!srv.logs().includes(value), `${name} in the logs`);
  });
});

describe('production refuses to start with a key missing', () => {
  const PROD = {
    NODE_ENV: 'production', SESSION_SECRET: made('SESSION_SECRET') + 'x'.repeat(10), DATA_ENCRYPTION_KEY: made('DATA_ENCRYPTION_KEY') + 'y'.repeat(20),
    PUBLIC_URL: 'https://wisecall.example', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: made('RESEND_API_KEY'), EMAIL_FROM: 'Wisecall <hello@wisecall.example>',
    ADMIN_EMAILS: 'qa-admin@example.com', LAUNCH_MODE: 'prelaunch', KYC_PROVIDER: '', PAYMENT_PROVIDER: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', JWT_SECRET: ''
  };
  const refused = async (extra, what) => {
    await assert.rejects(startServer(4798, { ...PROD, ...extra }), (e) => { assert.match(String(e.message), what); return true; });
  };
  test('Didit chosen with a key missing', () => refused({ KYC_PROVIDER: 'didit', DIDIT_API_KEY: made('DIDIT_API_KEY'), DIDIT_WORKFLOW_ID: 'wf', DIDIT_WEBHOOK_SECRET: '' }, /DIDIT_WEBHOOK_SECRET is required/));
  test('one Turnstile key without the other', () => refused({ TURNSTILE_SITE_KEY: 'site-only-made-up' }, /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be set/));
  test('no session secret', () => refused({ SESSION_SECRET: '' }, /SESSION_SECRET must be set/));
  test('the refusal itself shows no secret', async () => {
    await assert.rejects(startServer(4798, { ...PROD, SESSION_SECRET: '' }), (e) => {
      assert.ok(!String(e.message).includes(PROD.DATA_ENCRYPTION_KEY));
      assert.ok(!String(e.message).includes(PROD.RESEND_API_KEY));
      return true;
    });
  });
});

describe('a commit that adds a key is blocked', () => {
  test('the hook is stored as executable, or git on Linux and macOS would skip it without a word', () => {
    assert.match(execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '.githooks/pre-commit'], { encoding: 'utf8' }), /^100755 /);
  });
  test('the pre-commit hook stops it, and lets a normal commit through', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wisecall-hook-'));
    try {
      const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      git('init', '-q');
      git('config', 'user.email', 'hook@example.com');
      git('config', 'user.name', 'Hook Test');
      fs.mkdirSync(path.join(dir, 'scripts'));
      fs.copyFileSync(path.join(ROOT, 'scripts', 'secret-scan.js'), path.join(dir, 'scripts', 'secret-scan.js'));
      fs.cpSync(path.join(ROOT, '.githooks'), path.join(dir, '.githooks'), { recursive: true });
      // (git runs a hook only when it may be executed: on Linux and macOS that is the file's mode, which git keeps, see the hook's mode below)
      fs.chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);
      git('config', 'core.hooksPath', '.githooks');
      // (gitleaks is not installed on every computer: the hook then uses the project's own scan; here it is made sure of)
      const env = { ...process.env, PATH: process.env.PATH.split(path.delimiter).filter((p) => !/gitleaks/i.test(p)).join(path.delimiter) };
      fs.writeFileSync(path.join(dir, 'ok.txt'), 'nothing secret\n');
      git('add', '.');
      assert.equal(spawnSync('git', ['-C', dir, 'commit', '-q', '-m', 'fine'], { env, encoding: 'utf8' }).status, 0);
      fs.writeFileSync(path.join(dir, 'config.js'), `const key = '${'AKIA' + 'Q7'.repeat(8)}';\n`);
      git('add', 'config.js');
      const r = spawnSync('git', ['-C', dir, 'commit', '-q', '-m', 'oops'], { env, encoding: 'utf8' });
      assert.notEqual(r.status, 0, 'blocked');
      assert.match(r.stdout + r.stderr, /Commit blocked/);
      assert.match(r.stdout + r.stderr, /aws-access-key {2}staged {2}config\.js:1/);
      assert.ok(!(r.stdout + r.stderr).includes('Q7Q7'), 'no part of the value is printed');
      assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
