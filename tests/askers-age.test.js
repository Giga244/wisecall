// Askers 16+, mentors stay 18+ (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 1): the age at sign-up, what is kept, and turning 18.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client } = require('./helpers');
const ageGate = require('../server/ageGate');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base;

// A birth month that makes somebody exactly this old now (their whole birth month has passed).
function bornAgo(years, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const signup = (c, body) => c.api('/auth/signup', { method: 'POST', body: { name: 'Nika Test', password: 'test-pass-12345', ...body } });
const stored = async (email) => (await pool.query('SELECT birth_ym, age_group, age_confirmed_at, adult_confirmed_at, profile_visibility, role FROM users WHERE lower(email) = lower($1)', [email])).rows[0];

describe('the rules, with no database', () => {
  const NOV_2026 = new Date(Date.UTC(2026, 10, 15));
  test('somebody counts as an age only once their whole birth month has passed', () => {
    assert.equal(ageGate.ageOf('2010-11', NOV_2026), 15);
    assert.equal(ageGate.ageOf('2010-10', NOV_2026), 16);
    assert.equal(ageGate.groupOf('2010-11', NOV_2026), 'under_16');
    assert.equal(ageGate.groupOf('2010-10', NOV_2026), 'minor_16_17');
    assert.equal(ageGate.groupOf('2008-11', NOV_2026), 'minor_16_17');
    assert.equal(ageGate.groupOf('2008-10', NOV_2026), 'adult');
    assert.equal(ageGate.groupOf('1975-01', NOV_2026), 'adult');
    assert.equal(ageGate.groupOf(null, NOV_2026), null);
  });
  test('only a real year and month is accepted', () => {
    for (const bad of ['', null, undefined, 2008, '2008', '2008-13', '2008-00', '2008-1', '08-2008', '2008-11-02', '1800-01', '2999-01', { a: 1 }]) {
      assert.equal(ageGate.parseYm(bad, NOV_2026), null, String(bad));
      assert.equal(ageGate.check(bad).error, 'birth_required', String(bad));
    }
    assert.equal(ageGate.parseYm('2008-11', NOV_2026), '2008-11');
  });
});

describe('at sign-up', () => {
  before(async () => {
    await resetDatabase();
    srv = await startServer(4791, { RATE_LIMIT_MULTIPLIER: '50' });
    base = srv.base;
  });
  after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

  test('age 15 is refused and nothing at all is stored', async () => {
    const before_ = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const r = await signup(client(base), { email: 'fifteen@example.com', birthYm: bornAgo(15) });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'under_16');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, before_);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = 'fifteen@example.com'`)).rows[0].n, 0);
    assert.doesNotMatch(srv.logs(), /fifteen@example\.com/);
  });

  test('no birth year and month, no account', async () => {
    assert.equal((await signup(client(base), { email: 'noage@example.com' })).error, 'birth_required');
    assert.equal((await signup(client(base), { email: 'noage@example.com', adult: true })).error, 'birth_required', 'the old box is not enough for an asker');
    assert.equal(await stored('noage@example.com'), undefined);
  });

  for (const years of [16, 17]) {
    test(`age ${years}: the minor's group, with only the year and month kept, and a private profile`, async () => {
      const email = `minor${years}@example.com`;
      const ym = bornAgo(years);
      const without = await signup(client(base), { email, birthYm: ym });
      assert.equal(without.status, 400);
      assert.equal(without.error, 'parent_permission_required');
      assert.equal(await stored(email), undefined, 'a 16-17 sign-up cannot finish without the box');
      const r = await signup(client(base), { email, birthYm: ym, parentPermission: true });
      assert.equal(r.status, 201, JSON.stringify(r));
      const row = await stored(email);
      assert.equal(row.birth_ym, ym);
      assert.equal(row.age_group, 'minor_16_17');
      assert.ok(row.age_confirmed_at);
      assert.equal(row.adult_confirmed_at, null, 'not recorded as an adult');
      assert.equal(row.profile_visibility, 'contacts');
      assert.equal(r.user.ageGroup, 'minor_16_17');
      assert.ok(r.user.parentPermissionAt, 'the time they confirmed it is kept');
      assert.doesNotMatch(JSON.stringify(r.user), /parent.?email/i);
    });
  }

  test('age 18: an adult', async () => {
    const r = await signup(client(base), { email: 'eighteen@example.com', birthYm: bornAgo(18) });
    assert.equal(r.status, 201);
    const row = await stored('eighteen@example.com');
    assert.equal(row.age_group, 'adult');
    assert.ok(row.adult_confirmed_at);
    assert.equal(r.user.ageGroup, 'adult');
    assert.equal(r.user.parentPermissionAt, null, 'an adult needs none');
  });

  test('turning 18 changes the group by itself, in the sweep and when the person is read', async () => {
    const c = client(base);
    await signup(c, { email: 'birthday@example.com', birthYm: bornAgo(17), parentPermission: true });
    // (time passes: their 18th birth month is over)
    await pool.query(`UPDATE users SET birth_ym = $1 WHERE email = 'birthday@example.com'`, [bornAgo(18)]);
    assert.equal((await stored('birthday@example.com')).age_group, 'minor_16_17');
    assert.equal((await c.api('/me')).user.ageGroup, 'adult', 'read: at once');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    assert.ok(await ageGate.sweep() >= 1);
    assert.equal((await stored('birthday@example.com')).age_group, 'adult', 'the stored group follows');
    const minor = await stored('minor17@example.com');
    assert.equal(minor.age_group, 'minor_16_17', 'somebody still 17 is not touched');
  });

  test('a mentor\'s sign-up is unchanged: the 18+ box. Under 18 is refused', async () => {
    const ok = await signup(client(base), { email: 'mentor-new@example.com', adult: true, as: 'mentor' });
    assert.equal(ok.status, 201);
    assert.ok((await stored('mentor-new@example.com')).adult_confirmed_at);
    assert.equal((await signup(client(base), { email: 'mentor-nobox@example.com', as: 'mentor' })).error, 'adult_required');
    const young = await signup(client(base), { email: 'mentor-young@example.com', adult: true, as: 'mentor', birthYm: bornAgo(17) });
    assert.equal(young.status, 403);
    assert.equal(young.error, 'mentor_18');
    assert.equal(await stored('mentor-young@example.com'), undefined);
  });

  test('somebody under 18 cannot become a mentor, and has no "Become a mentor" button', async () => {
    const c = client(base);
    await signup(c, { email: 'wants-mentor@example.com', birthYm: bornAgo(17), parentPermission: true });
    const r = await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'mentor_18');
    assert.equal((await stored('wants-mentor@example.com')).role, 'seeker');
    assert.equal((await c.api('/me')).user.mentorPath.state, 'none');
    assert.equal((await c.api('/me', { method: 'PATCH', body: { profileVisibility: 'public' } })).status, 200);
    assert.equal((await stored('wants-mentor@example.com')).profile_visibility, 'contacts', 'a minor\'s profile stays private');
  });

  describe('an account from before the age rule', () => {
    let c;
    before(async () => {
      c = client(base);
      await signup(c, { email: 'old@example.com', birthYm: bornAgo(30) });
      await pool.query(`UPDATE users SET birth_ym = NULL, age_group = NULL, age_confirmed_at = NULL WHERE email = 'old@example.com'`);
    });
    test('is told to answer at login, and cannot ask until it has', async () => {
      assert.equal((await c.api('/me')).user.needsAge, true);
      const login = await client(base).api('/auth/login', { method: 'POST', body: { email: 'old@example.com', password: 'test-pass-12345' } });
      assert.equal(login.user.needsAge, true);
      const r = await c.api('/bookings', { method: 'POST', body: { mentorId: '00000000-0000-4000-8000-000000000000', question: 'x'.repeat(60) } });
      assert.equal(r.status, 403);
      assert.equal(r.error, 'age_required');
    });
    test('under 16 keeps nothing, and the account stays as it was', async () => {
      const r = await c.api('/me/age', { method: 'POST', body: { birthYm: bornAgo(15) } });
      assert.equal(r.error, 'under_16');
      assert.equal((await stored('old@example.com')).birth_ym, null);
      assert.equal((await c.api('/me')).user.email, 'old@example.com');
    });
    test('answers once: it cannot be changed afterwards', async () => {
      const ym = bornAgo(30);
      const r = await c.api('/me/age', { method: 'POST', body: { birthYm: ym } });
      assert.equal(r.status, 200);
      assert.equal(r.user.needsAge, false);
      assert.equal((await c.api('/me/age', { method: 'POST', body: { birthYm: bornAgo(17) } })).error, 'age_already_set');
      assert.equal((await stored('old@example.com')).birth_ym, ym);
    });
    test('a mentor\'s account cannot say it is under 18', async () => {
      const m = client(base);
      await signup(m, { email: 'old-mentor@example.com', adult: true, as: 'mentor' });
      await pool.query(`UPDATE users SET role = 'mentor' WHERE email = 'old-mentor@example.com'`);
      assert.equal((await m.api('/me/age', { method: 'POST', body: { birthYm: bornAgo(17) } })).error, 'mentor_18');
    });
  });

  test('the waiting list needs "I am 16 or older"', async () => {
    const c = client(base);
    const no = await c.api('/waitlist', { method: 'POST', body: { email: 'w16@example.com', niche: 'any' } });
    assert.equal(no.status, 400);
    assert.equal(no.error, 'age_required');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM waitlist WHERE email = 'w16@example.com'`)).rows[0].n, 0);
    assert.equal((await c.api('/waitlist', { method: 'POST', body: { email: 'w16@example.com', niche: 'any', over16: true } })).status, 201);
  });

  test('closing the account removes the birth year and month, and the export shows them', async () => {
    const c = client(base);
    await signup(c, { email: 'closing@example.com', birthYm: bornAgo(17), parentPermission: true });
    const { rows: [u] } = await pool.query(`SELECT id FROM users WHERE email = 'closing@example.com'`);
    const exported = await c.api('/me/export');
    assert.equal(exported.account.birthYm, bornAgo(17));
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await require('../server/account').anonymize(u.id);
    const row = (await pool.query('SELECT birth_ym, age_group, age_confirmed_at, parent_permission_at FROM users WHERE id = $1', [u.id])).rows[0];
    assert.deepEqual([row.birth_ym, row.age_group, row.age_confirmed_at, row.parent_permission_at], [null, null, null, null]);
  });
});

describe('analytics and the legal text', () => {
  test('Terms and Privacy say the same in both languages', () => {
    const fs = require('fs');
    const path = require('path');
    for (const [lang, words] of [['en', [/at least 16/, /18 or older/, /parent or guardian/, /birth year and month/i, /email to our support/]], ['ka', [/მინიმუმ 16/, /18 წლის ან უფროსი/, /მშობელი ან მეურვე/, /დაბადების წელსა და თვეს/, /მხარდაჭერის ელფოსტაზე/]]]) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', lang + '.json'), 'utf8'));
      const all = ['legal.terms.sections', 'legal.privacy.sections'].flatMap((k) => d[k]).flatMap((s) => s.p).join(' ');
      for (const w of words) assert.match(all, w, lang);
      assert.doesNotMatch(all, /18 and over|18 წლის და უფროსი ასაკის/, lang);
    }
  });
  test('the sign-up event carries the coarse group, and never a birth date', async () => {
    const http = require('http');
    const seen = [];
    const fake = http.createServer(async (req, res) => { const c = []; for await (const x of req) c.push(x); seen.push(JSON.parse(Buffer.concat(c).toString('utf8'))); res.writeHead(202); res.end('ok'); });
    await new Promise((r) => fake.listen(0, r));
    const s = await startServer(4793, { RATE_LIMIT_MULTIPLIER: '50', PLAUSIBLE_DOMAIN: 'wisecall.test', PLAUSIBLE_API_URL: `http://localhost:${fake.address().port}/api/event` });
    try {
      const pg = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      await pg.query(`DELETE FROM users WHERE email IN ('p-minor@example.com', 'p-adult@example.com')`);
      await pg.end();
      const ym = bornAgo(17);
      await signup(client(s.base), { email: 'p-minor@example.com', birthYm: ym, parentPermission: true });
      await signup(client(s.base), { email: 'p-adult@example.com', birthYm: bornAgo(30) });
      for (let i = 0; i < 50 && seen.filter((e) => e.name === 'signup').length < 2; i++) await new Promise((r) => setTimeout(r, 100));
      const events = seen.filter((e) => e.name === 'signup');
      assert.deepEqual(events.map((e) => e.props.age_group).sort(), ['adult', 'minor_16_17']);
      assert.ok(!JSON.stringify(seen).includes(ym), 'no birth date anywhere');
      assert.ok(seen.filter((e) => e.name !== 'signup').every((e) => !e.props || e.props.age_group === undefined), 'only on signup');
    } finally { s.proc.kill(); fake.close(); }
  });
});
