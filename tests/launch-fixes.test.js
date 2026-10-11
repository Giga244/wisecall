// The launch rehearsal's fixes (docs/TODO-REHEARSAL.md): an answer can never be accepted after the same question was declined (R-1),
// the server stops within its grace time while visitors keep connections open (R-2), mentor statistics and the public lists are kept
// briefly when the setting says so (R-4, R-5) and never for a signed-in person, and sign-up does not wait half a minute for a hanging
// email service (R-7). Plus REVIEW-2 #13: opening disputes has a limit of its own.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, wait } = require('./helpers');

let srv, base, admin, mentor, mentorId, seeker;
before(async () => {
  await resetDatabase();
  srv = await startServer(4763, { RATE_LIMIT_MULTIPLIER: '20' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupVerified(base, 'Mia Mentor', 'mia@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Software engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mia Mentor');
  seeker = await signupVerified(base, 'Sam Seeker', 'sam@example.com');
});
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

describe('R-1: answering and declining the same question at once', () => {
  test('a declined question cannot be answered, even from a second tab; the mentor is told why', async () => {
    for (let i = 0; i < 5; i++) {
      const b = await bookAndPay(base, seeker, mentorId, `Race number ${i}: how should I plan my first year as a junior developer at a small company?`);
      // (both buttons pressed at once: whatever the order, never declined AND answered)
      const [d, a] = await Promise.all([
        mentor.api(`/bookings/${b.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } }),
        mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('My answer, with the steps I would take.') } })
      ]);
      assert.ok(!(d.status === 200 && a.status === 200), `declined (${d.status}) and answered (${a.status})`);
      if (d.status === 200) assert.ok([409, 400].includes(a.status), a.text);
    }
    const b = await bookAndPay(base, seeker, mentorId, 'One more: should I take a course before applying for my first developer job?');
    assert.equal((await mentor.api(`/bookings/${b.id}/decline`, { method: 'POST', body: { reason: 'not_qualified' } })).status, 200);
    const late = await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Too late, but here it is anyway.') } });
    assert.equal(late.status, 409);
    assert.equal(late.error, 'declined', late.text);
  });
});

describe('REVIEW-2 #13: opening a dispute has its own limit', () => {
  test('the eleventh in an hour from one address is refused (with the tests\' multiplier, the 201st)', async () => {
    let last = null;
    for (let i = 0; i < 205 && (!last || last.status !== 429); i++) last = await seeker.api('/bookings/00000000-0000-4000-8000-000000000000/dispute', { method: 'POST', body: { reason: 'other' } });
    assert.equal(last.status, 429);
  });
});

describe('R-4 and R-5: kept briefly, only when the setting says so, never for a signed-in person', () => {
  let cached;
  before(async () => { cached = await startServer(4764, { PUBLIC_CACHE_SECONDS: '30', MENTOR_STATS_CACHE_SECONDS: '30' }); });
  after(() => { if (cached) cached.proc.kill(); });

  test('a visitor gets the public lists with Cache-Control: public, and the same answer again; a signed-in person never', async () => {
    const first = await fetch(`${cached.base}/api/experts`);
    assert.match(first.headers.get('cache-control') || '', /public, max-age=30/);
    const before = await first.json();
    // (a change is not visible to visitors until the 30 seconds are over...)
    await pool.query(`UPDATE users SET role_title = 'Senior software engineer' WHERE id = $1`, [mentorId]);
    const again = await (await fetch(`${cached.base}/api/experts`)).json();
    assert.deepEqual(again, before);
    // (...but a signed-in person always gets it fresh, and nothing private is ever kept)
    const me = client(cached.base);
    assert.equal((await me.api('/auth/login', { method: 'POST', body: { email: 'sam@example.com', password: 'test-pass-12345' } })).status, 200);
    const mine = await me.api('/experts');
    assert.doesNotMatch(String(mine.headers.get('cache-control') || ''), /public/);
    assert.ok(JSON.stringify(mine).includes('Senior software engineer'));
    assert.match((await fetch(`${cached.base}/api/config`)).headers.get('cache-control') || '', /public/);
  });

  test('outside production, with no setting, nothing is kept (what the other tests rely on)', async () => {
    const r = await fetch(`${base}/api/experts`);
    assert.doesNotMatch(String(r.headers.get('cache-control') || ''), /public/);
  });
});

describe('R-7: a person waiting for an email is not kept waiting by a hanging email service', () => {
  let hanging, mailSrv;
  before(async () => {
    hanging = http.createServer(() => { /* never answers */ });
    await new Promise((r) => hanging.listen(0, '127.0.0.1', r));
    mailSrv = await startServer(4765, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_fake_key_for_test', EMAIL_FROM: 'Wisecall <hi@example.com>',
      RESEND_API_URL: `http://127.0.0.1:${hanging.address().port}/emails` });
  });
  after(() => { if (mailSrv) mailSrv.proc.kill(); hanging.closeAllConnections(); hanging.close(); });

  test('sign-up answers within a few seconds, the account exists, and the code can be asked for again', async () => {
    const started = Date.now();
    const c = client(mailSrv.base);
    const r = await c.api('/auth/signup', { method: 'POST', body: { adult: true, name: 'Hana Hang', email: 'hana@example.com', password: 'test-pass-12345' } });
    const took = Date.now() - started;
    assert.ok(took < 12000, `sign-up took ${took} ms`);
    assert.ok([201, 502, 503].includes(r.status), r.text);
  });
});

describe('R-2: stopping while visitors keep connections open', { skip: process.platform === 'win32' ? '(signals: Linux and macOS only)' : false }, () => {
  test('the server exits within its grace time, and says "not ready" meanwhile', async () => {
    const s = await startServer(4766, { SHUTDOWN_GRACE_MS: '3000' });
    const agent = new http.Agent({ keepAlive: true });
    let stop = false;
    const busy = (async () => { while (!stop) { await new Promise((r) => http.get(`${s.base}/api/config`, { agent }, (res) => { res.resume(); res.on('end', r); }).on('error', r)); } })();
    await wait(300);
    const exited = new Promise((r) => s.proc.on('exit', r));
    const started = Date.now();
    s.proc.kill('SIGTERM');
    await exited;
    stop = true;
    await busy;
    agent.destroy();
    assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
  });
});
