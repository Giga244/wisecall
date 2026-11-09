// The new home page, Browse without login and the Jikhva logo (docs/CLAUDE-CODE-NEW-HOME.md): the experts on the home page (approved and
// opted in), the waiting
// list's count (rounded, from 50), the welcome email, the social links, old Browse links, the "პირველი მენტორი" badge and the logo.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, client, approveMentor, addPayoutDetails, SAMPLE, longQuestion, longAnswer, wait } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let srv, base, admin, seeker, mentor, mentorId, bookingId;

async function makeMentor(name, email, price, show = true) {
  const c = await signupVerified(base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiology resident', niche: 'medicine', price, proofUrl: `https://example.org/in/${email.split('@')[0]}`, sampleAnswer: SAMPLE } });
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  const id = (await c.api('/me')).user.id;
  if (show) await pool.query('UPDATE users SET show_on_home = true WHERE id = $1', [id]);
  return { c, id };
}
before(async () => {
  await resetDatabase();
  srv = await startServer(4856, { RATE_LIMIT_MULTIPLIER: '50', PUBLIC_CACHE_SECONDS: '0' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  seeker = await signupVerified(base, 'Ana Studentashvili', 'ana-home@example.com');
  ({ c: mentor, id: mentorId } = await makeMentor('Nino Beridze', 'nino-home@example.com', 0));
  const asked = await seeker.api('/bookings', { method: 'POST', body: { mentorId, question: longQuestion('Is it worth studying medicine if biology is my weak subject?') } });
  bookingId = asked.booking.id;
  const answer = longAnswer('Yes, if medicine really interests you. ' + 'Start with the school textbook, one hour a day, and a test every week. '.repeat(6));
  assert.equal((await mentor.api(`/bookings/${bookingId}/answer`, { method: 'POST', body: { answer } })).status, 200);
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

// (the phone: tests/random-phone.test.js)

describe("the home page's experts", () => {
  test('only approved mentors who chose to be shown, with their role, field and price', async () => {
    await makeMentor('Levan Hidden', 'levan-home@example.com', 15, false);
    const pending = await signupVerified(base, 'Pending Person', 'pending-home@example.com');
    await pending.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Lawyer', niche: 'law', price: 20 } });
    await pool.query("UPDATE users SET show_on_home = true WHERE email = 'pending-home@example.com'");
    const { mentors } = await client(base).api('/home-mentors');
    assert.deepEqual(mentors.map((m) => m.name), ['Nino Beridze']);
    assert.equal(mentors[0].roleTitle, 'Cardiology resident');
    assert.equal(mentors[0].price, 0);
    // the page arrives with the section open and three skeleton cards (nothing below it moves when the cards come)
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /<section class="lsection lexperts" id="homeMentors" aria-labelledby="homeMentorsTitle">/);
    assert.equal((page.match(/<li class="lexpert lexpert-skeleton" aria-hidden="true">/g) || []).length, 3);
    await pool.query("UPDATE users SET show_on_home = false WHERE role IN ('mentor', 'both')");
    assert.match(await (await fetch(base + '/')).text(), /id="homeMentors" aria-labelledby="homeMentorsTitle" hidden>/, 'nobody to show: hidden');
    await pool.query("UPDATE users SET show_on_home = true WHERE email = 'nino-home@example.com'");
  });
});

describe("the waiting list's count", () => {
  test('null under 50; from 50 the number rounded down to ten', async () => {
    await pool.query('DELETE FROM waitlist');
    for (let i = 0; i < 49; i++) await pool.query("INSERT INTO waitlist (email, niche, token) VALUES ($1, 'any', md5(random()::text) || md5(random()::text))", [`c${i}@example.com`]);
    assert.equal((await client(base).api('/waitlist-count')).approx, null);
    for (let i = 49; i < 67; i++) await pool.query("INSERT INTO waitlist (email, niche, token) VALUES ($1, 'any', md5(random()::text) || md5(random()::text))", [`c${i}@example.com`]);
    assert.equal((await client(base).api('/waitlist-count')).approx, 60);
  });
});

describe('pages', () => {
  test('a visitor opens Browse and a profile without an account; the home page in launch mode has the search, not the waiting list', async () => {
    const browse = await fetch(`${base}/experts.html`);
    assert.equal(browse.status, 200);
    assert.match(await browse.text(), /id="expertGrid"/);
    const ka = await fetch(`${base}/ka/experts.html`);
    assert.equal(ka.status, 200);
    const me = (await mentor.api('/me')).user;
    assert.equal((await fetch(`${base}/u/${me.username}`)).status, 200);
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /id="heroSearch"/);
    assert.doesNotMatch(home, /id="heroWait"/);
    assert.match(home, /<div class="lhero-phone" id="homeQa">/); // (always there: real answers or marked examples)
  });

  test('an old link with Browse filters on the home page goes to Browse, in its language', async () => {
    const r = await fetch(`${base}/?field=it&chip=it.backend`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/experts.html?field=it&chip=it.backend');
    const k = await fetch(`${base}/ka/index.html?niche=medicine`, { redirect: 'manual' });
    assert.equal(k.headers.get('location'), '/ka/experts.html?niche=medicine');
  });

  test('before launch the hero has the waiting list instead of the search', async () => {
    const pre = await startServer(4857, { LAUNCH_MODE: 'prelaunch' });
    try {
      const home = await (await fetch(`${pre.base}/`)).text();
      assert.match(home, /id="heroWait"/);
      assert.match(home, /id="waitCount"/);
      assert.doesNotMatch(home, /id="heroSearch"/);
      assert.equal((await fetch(`${pre.base}/experts.html`)).status, 200, 'Browse stays open before launch');
    } finally { pre.proc.kill(); }
  });
});

describe('the welcome email and the social links', () => {
  test('sent once, when the address is verified, with Instagram, TikTok and Facebook; not again', async () => {
    const OUTBOX = path.join(os.tmpdir(), `wisecall-new-home-${process.pid}.jsonl`);
    fs.rmSync(OUTBOX, { force: true });
    const s2 = await startServer(4858, { EMAIL_PROVIDER: 'log', EMAIL_LOG_FILE: OUTBOX, EMAIL_FROM: 'Wisecall <hi@example.com>', RATE_LIMIT_MULTIPLIER: '50',
      SOCIAL_INSTAGRAM: 'https://www.instagram.com/wisecallge/', SOCIAL_TIKTOK: 'https://www.tiktok.com/@wisecall.ge', SOCIAL_FACEBOOK: 'https://www.facebook.com/Wisecall.ge' });
    try {
      const mails = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
      const c = client(s2.base);
      assert.equal((await c.api('/auth/signup', { method: 'POST', body: { adult: true, birthYm: '1990-01', name: 'Mari Welcome', email: 'mari-w@example.com', password: 'test-pass-12345', language: 'ka' } })).status, 201);
      let codeMail;
      for (let i = 0; i < 40 && !codeMail; i++) { codeMail = mails().find((m) => m.to === 'mari-w@example.com'); if (!codeMail) await wait(100); }
      assert.equal(mails().filter((m) => /მოგესალმებით/.test(m.subject)).length, 0, 'not before the address is verified');
      const code = codeMail.subject.match(/(\d{6})/)[1];
      assert.equal((await c.api('/auth/verify-email', { method: 'POST', body: { code } })).status, 200);
      let welcome = [];
      for (let i = 0; i < 40 && !welcome.length; i++) { welcome = mails().filter((m) => m.to === 'mari-w@example.com' && /მოგესალმებით/.test(m.subject)); if (!welcome.length) await wait(100); }
      assert.equal(welcome.length, 1);
      assert.match(welcome[0].html, /instagram\.com\/wisecallge/);
      assert.match(welcome[0].html, /tiktok\.com\/@wisecall\.ge/);
      assert.match(welcome[0].html, /facebook\.com\/Wisecall\.ge/);
      assert.match(welcome[0].html, /Mari/);
      await c.api('/auth/verify-email', { method: 'POST', body: { code } });
      await wait(300);
      assert.equal(mails().filter((m) => m.to === 'mari-w@example.com' && /მოგესალმებით/.test(m.subject)).length, 1, 'once');
      assert.deepEqual(Object.keys((await c.api('/config')).social).sort(), ['facebook', 'instagram', 'tiktok']);
      assert.match(await (await fetch(`${s2.base}/`)).text(), /"sameAs":\["https:\/\/www\.facebook\.com\/Wisecall\.ge","https:\/\/www\.instagram\.com\/wisecallge\/","https:\/\/www\.tiktok\.com\/@wisecall\.ge"\]/);
    } finally { s2.proc.kill(); fs.rmSync(OUTBOX, { force: true }); }
  });

  test('the three links are the defaults while SOCIAL_* are not set, and an empty one hides its icon', () => {
    const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
    for (const k of Object.keys(env)) if (k.startsWith('SOCIAL_')) delete env[k];
    const run = (extra) => JSON.parse(execFileSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./server/config').SOCIAL_URLS))"], { cwd: ROOT, env: { ...env, ...extra } }).toString());
    assert.deepEqual(run({}), { facebook: 'https://www.facebook.com/Wisecall.ge', instagram: 'https://www.instagram.com/wisecallge/', tiktok: 'https://www.tiktok.com/@wisecall.ge' });
    assert.deepEqual(Object.keys(run({ SOCIAL_TIKTOK: '' })).sort(), ['facebook', 'instagram']);
    assert.equal(run({ SOCIAL_INSTAGRAM: 'https://www.instagram.com/other/' }).instagram, 'https://www.instagram.com/other/');
  });
});

describe('words and the logo', () => {
  test('"დამფუძნებელი მენტორი" is "პირველი მენტორი" everywhere ("First mentor" in English)', () => {
    assert.equal(JSON.parse(read('public/i18n/ka.json'))['badge.founding'], 'პირველი მენტორი');
    assert.equal(JSON.parse(read('public/i18n/en.json'))['badge.founding'], 'First mentor');
    for (const f of ['public/i18n/ka.json', 'public/i18n/en.json', 'server/mail/templates.js']) {
      assert.doesNotMatch(read(f), /დამფუძნებელ(ი|მა|ს|თან)? მენტორ/, f);
      assert.doesNotMatch(read(f), /[Ff]ounding mentor/, f);
    }
  });

  test("the header draws Jikhva behind the wordmark; emails keep the plain logo; the new home's words exist in KA and EN", () => {
    const header = read('public/js/header.js');
    assert.match(header, /class="jlogo"/);
    assert.match(header, /jikhva-head\.webp/);
    assert.ok(fs.existsSync(path.join(ROOT, 'public/brand/jikhva-head.webp')));
    assert.match(read('server/mail/templates.js'), /wisecall-logo-email\.png/);
    const ka = JSON.parse(read('public/i18n/ka.json'));
    const en = JSON.parse(read('public/i18n/en.json'));
    for (const k of Object.keys(ka).filter((x) => x.startsWith('home2.'))) assert.ok(en[k], `en ${k}`);
    assert.equal(ka['home2.title1'] + ' ' + ka['home2.title2'], 'ჰკითხე მას, ვინც ეს გზა უკვე გაიარა');
    assert.equal(ka['home2.search.button'], 'ძებნა');
  });
});
