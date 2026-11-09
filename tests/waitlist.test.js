// The "get notified when mentors in your field join" list, and the public settings the pages read.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, addPayoutDetails, approveMentor, wait, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, anon;

const join = (body) => anon.api('/waitlist', { method: 'POST', body: { over16: true, ...body } });
const rowsFor = async (email) => (await pool.query('SELECT * FROM waitlist WHERE lower(email) = lower($1)', [email])).rows;

async function listMentor(name, email, niche) {
  const c = await signupByEmail(resend, base, name, email);
  await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Specialist', niche, price: 30, proofUrl: 'https://example.com/me', sampleAnswer: SAMPLE } });
  await addPayoutDetails(c);
  return approveMentor(admin, c);
}

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4586, {
    SUPPORT_EMAIL: 'help@wisecall.example', SOCIAL_INSTAGRAM: 'https://instagram.com/wisecall', SOCIAL_FACEBOOK: 'javascript:alert(1)', SOCIAL_LINKEDIN: '',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>'
  });
  base = srv.base;
  anon = client(base);
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('public settings for the pages', () => {
  test('the fee, the mentor share, the deadline, the price range and the footer details', async () => {
    const c = await anon.api('/config');
    assert.equal(c.platformFeePercent, 20);
    assert.equal(c.mentorSharePercent, 80);
    assert.equal(c.answerDeadlineDays, 7);
    assert.equal(c.priceMin, 5);
    assert.equal(c.priceMax, 2000);
    assert.equal(c.contactEmail, 'help@wisecall.example');
    assert.deepEqual(c.social, { instagram: 'https://instagram.com/wisecall' }, 'empty and non-https links are not shown');
  });
});

describe('joining the list', () => {
  test('a valid address and field are stored; asking twice changes nothing and says the same thing', async () => {
    assert.equal((await join({ email: 'ann@example.com', niche: 'design', language: 'en' })).status, 201);
    assert.equal((await join({ email: 'ANN@example.com', niche: 'design', language: 'en' })).status, 201);
    assert.equal((await rowsFor('ann@example.com')).length, 1);
    assert.equal((await join({ email: 'ann@example.com', niche: 'medicine' })).status, 201);
    assert.equal((await rowsFor('ann@example.com')).length, 2, 'another field is another entry');
  });

  test('bad input is refused', async () => {
    assert.equal((await join({ email: 'nope', niche: 'design' })).error, 'invalid_email');
    assert.equal((await join({ email: '', niche: 'design' })).error, 'invalid_email');
    assert.equal((await join({ email: 'a@b.co', niche: 'astrology' })).error, 'invalid_niche');
    assert.equal((await join({ email: 'x'.repeat(250) + '@example.com', niche: 'design' })).error, 'invalid_email');
  });

  test('no field means any field; the language is remembered', async () => {
    assert.equal((await join({ email: 'gio@example.com', language: 'ka' })).status, 201);
    const r = (await rowsFor('gio@example.com'))[0];
    assert.equal(r.niche, 'any');
    assert.equal(r.language, 'ka');
    assert.equal((await join({ email: 'weird@example.com', niche: 'any', language: 'fr' })).status, 201);
    assert.equal((await rowsFor('weird@example.com'))[0].language, 'en');
  });

  test('only admins see the list, and the CSV is safe to open in a spreadsheet', async () => {
    await join({ email: '=cmd@example.com', niche: 'law' }).catch(() => {});
    assert.equal((await anon.api('/admin/waitlist')).status, 401);
    const list = await admin.api('/admin/waitlist');
    assert.ok(list.total >= 4);
    assert.ok(list.byNiche.design >= 1);
    assert.ok(list.signups.every((s) => s.email && s.niche && s.createdAt));
    const res = await admin.raw('/api/admin/waitlist.csv');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a byte-order mark so Excel reads Georgian');
    const csv = bytes.toString('utf8');
    assert.match(csv, /email,field,language,signed_up,notified/);
    assert.match(csv, /'=cmd@example\.com/, 'a value that could run as a formula is neutralised');
    assert.match(csv, /ann@example\.com,design,en,/);
  });
});

describe('telling the people waiting', () => {
  let token;
  test('when a design mentor is listed, waiting design and "any" subscribers get one email each in their language', async () => {
    const before = resend.sent.length;
    await listMentor('Nino Beridze', 'nino@example.com', 'design');
    const ann = await resend.waitFor('ann@example.com', 'mentor');
    const gio = await resend.waitFor('gio@example.com', 'მენტორი');
    assert.match(ann.body.text, /mentors in Design join/);
    assert.match(ann.body.html, /\/experts\.html\?niche=design"/);
    assert.match(gio.body.text, /მენტორი/);
    assert.equal(resend.to('ann@example.com', 'mentor').length, 1, 'one email, not one per event');
    // The medicine subscription (same person) is still waiting, and nothing went to other fields.
    const annRows = await rowsFor('ann@example.com');
    assert.ok(annRows.find((r) => r.niche === 'design').notified_at);
    assert.equal(annRows.find((r) => r.niche === 'medicine').notified_at, null);
    assert.equal(resend.sent.slice(before).filter((m) => m.body.subject.includes('mentor') && m.body.to === 'weird@example.com').length, 1, 'the "any" subscriber too');
    token = (ann.body.html.match(/waitlist-unsubscribe\.html\?token=([0-9a-f]{48})/) || [])[1];
    assert.ok(token, 'the email carries an unsubscribe link');
    assert.match(ann.body.text, /Leave the waiting list/);
    assert.match(gio.body.text, /მოლოდინის სიიდან გასვლა/);
    // (and the mail app's own one-click "Unsubscribe")
    assert.equal(ann.body.headers['List-Unsubscribe'], `<${base}/api/waitlist-one-click?token=${token}>`);
    assert.equal(ann.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  });

  test('a second mentor does not email the same people again', async () => {
    const n = resend.sent.length;
    await listMentor('Tamar Design', 'tamar@example.com', 'design');
    await wait(600);
    assert.equal(resend.sent.slice(n).filter((m) => /mentor just joined/i.test(m.body.subject)).length, 0);
  });

  test('a different field only reaches its own subscribers', async () => {
    const n = resend.sent.length;
    await listMentor('Levan Doctor', 'levan@example.com', 'medicine');
    await resend.waitForNew('ann@example.com', 'mentor just joined', 1);
    const joined = resend.sent.slice(n).filter((m) => /mentor just joined/i.test(m.body.subject));
    assert.deepEqual(joined.map((m) => m.body.to), ['ann@example.com'], 'only the medicine subscriber');
    assert.match(joined[0].body.text, /Medicine/);
  });

  test('the link removes the person; a wrong token does nothing', async () => {
    assert.equal((await anon.api('/waitlist/unsubscribe', { method: 'POST', body: { token: 'nonsense' } })).status, 404);
    assert.equal((await anon.api('/waitlist/unsubscribe', { method: 'POST', body: { token: '0'.repeat(48) } })).status, 404);
    assert.equal((await anon.api('/waitlist/unsubscribe', { method: 'POST', body: { token } })).status, 200);
    assert.equal((await rowsFor('ann@example.com')).length, 0, 'the address leaves the list: the design entry and the medicine one');
    assert.equal((await anon.api('/waitlist/unsubscribe', { method: 'POST', body: { token } })).status, 404, 'a link works once');
  });

  test('the one-click "Unsubscribe" of the mail app: a plain form post from the mail provider, no CSRF header, the token decides', async () => {
    await join({ email: 'oneclick@example.com', niche: 'design' });
    await join({ email: 'oneclick@example.com', niche: 'tech' });
    const [row] = await rowsFor('oneclick@example.com');
    const post = (token) => fetch(`${base}/api/waitlist-one-click?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal((await post('0'.repeat(48))).status, 200, 'a wrong token says nothing either');
    assert.equal((await rowsFor('oneclick@example.com')).length, 2);
    assert.equal((await post(row.token)).status, 200);
    assert.equal((await rowsFor('oneclick@example.com')).length, 0);
  });
});

describe('an admin deletes an address ("წაშლა")', () => {
  test('only an admin; every field of the address goes, its open "find me a mentor" requests close, others stay; logged without the address', async () => {
    // (straight into the table: the sign-up form allows 12 an hour, used up above)
    await pool.query(`INSERT INTO waitlist (email, niche, token) VALUES ('Sesili.Delete@example.com', 'design', md5(random()::text) || md5(random()::text)),
      ('sesili.delete@example.com', 'medicine', md5(random()::text) || md5(random()::text)), ('stays@example.com', 'design', md5(random()::text) || md5(random()::text))`);
    await pool.query(`INSERT INTO mentor_requests (email, field_text, field_key, niche, need, status, token, expires_at) VALUES
      ('sesili.delete@example.com', 'Dentistry', 'dentistry', 'medicine', 'I need advice about studying dentistry abroad.', 'active', 'tok-del-1', now() + interval '30 days'),
      ('stays@example.com', 'Dentistry', 'dentistry', 'medicine', 'I need advice about studying dentistry abroad.', 'active', 'tok-del-2', now() + interval '30 days')`);
    const [entry] = await rowsFor('sesili.delete@example.com');

    const seeker = await signupByEmail(resend, base, 'Not Admin', 'not-admin-wl@example.com');
    assert.equal((await seeker.api(`/admin/waitlist/${entry.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await anon.api(`/admin/waitlist/${entry.id}`, { method: 'DELETE' })).status, 401);
    assert.equal((await rowsFor('sesili.delete@example.com')).length, 2);

    const r = await admin.api(`/admin/waitlist/${entry.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.entries, 2);
    assert.equal(r.requests, 1);
    assert.equal((await rowsFor('sesili.delete@example.com')).length, 0);
    assert.equal((await rowsFor('stays@example.com')).length, 1);
    const reqs = (await pool.query(`SELECT email, status FROM mentor_requests WHERE token IN ('tok-del-1', 'tok-del-2') ORDER BY token`)).rows;
    assert.deepEqual(reqs.map((x) => x.status), ['removed', 'active']);

    const log = (await pool.query('SELECT * FROM waitlist_deletions')).rows;
    assert.equal(log.length, 1);
    assert.equal(log[0].by_label, 'qa-admin@example.com');
    assert.equal(log[0].entries, 2);
    assert.deepEqual([...log[0].fields].sort(), ['design', 'medicine']);
    assert.ok(!JSON.stringify(log).toLowerCase().includes('sesili'), 'the address is not in the log');
    const list = await admin.api('/admin/waitlist');
    assert.equal(list.deletions.length, 1);
    assert.ok(!list.signups.some((x) => /sesili/i.test(x.email)));
    assert.ok(!JSON.stringify(list.deletions).toLowerCase().includes('sesili'));

    assert.equal((await admin.api(`/admin/waitlist/${entry.id}`, { method: 'DELETE' })).status, 404, 'already gone');
    assert.equal((await admin.api('/admin/waitlist/not-an-id', { method: 'DELETE' })).status, 404);
  });
});
