// "A user never loses what they typed, and the owner hears about failures first."
//   Drafts (server/drafts.js, /api/me/drafts/<key>): a signed-in person's unsaved text is kept on the server, encrypted, private to
//   them; an empty text removes it; it is deleted with the account and by itself after 60 days. The pages keep one for every long text
//   field (public/js/drafts.js) and clear it only after a successful save.
//   Alerts (server/saveAlerts.js): a signed-in user's save that is refused (4xx) or fails (5xx) emails ALERT_EMAIL with the user, the
//   page, the field and the error, at most once an hour for the same user and error, and never with what was typed.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, approveMentor, wait, SAMPLE } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const OWNER = 'owner-alerts@example.com';
const ID = '11111111-2222-4333-8444-555555555555';
let srv, base, admin, ana, mentor, mentorId;

const alerts = () => resend.to(OWNER).filter((m) => /a save failed/.test(m.body.subject));
const settle = () => wait(500);

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4888, { RATE_LIMIT_MULTIPLIER: '50', SWEEP_INTERVAL_SECONDS: '1', ALERT_EMAIL: OWNER,
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  ana = await signupByEmail(resend, base, 'Ana Asker', 'ana-drafts@example.com');
  mentor = await signupByEmail(resend, base, 'Mika Mentor', 'mika-drafts@example.com');
  assert.equal((await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } })).status, 200);
  mentorId = await approveMentor(admin, mentor);
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('drafts on the server', () => {
  const key = `question:${ID}`;
  const TEXT = 'როგორ დავიწყო პროგრამირება, თუ სკოლაში მათემატიკა მიჭირდა და ინგლისური თითქმის არ ვიცი?';

  test('kept exactly as typed, for its owner only, encrypted; an empty text or a delete removes it', async () => {
    assert.equal((await ana.api(`/me/drafts/${key}`)).draft, null);
    const put = await ana.api(`/me/drafts/${key}`, { method: 'PUT', body: { value: `  ${TEXT}\n\nმეორე აბზაცი.  ` } });
    assert.equal(put.status, 200, put.text);
    const got = (await ana.api(`/me/drafts/${key}`)).draft;
    assert.equal(got.value, `  ${TEXT}\n\nმეორე აბზაცი.  `, 'exactly what was typed: nothing trimmed, checked or changed');
    assert.ok(got.updatedAt);
    // only theirs
    assert.equal((await mentor.api(`/me/drafts/${key}`)).draft, null);
    assert.equal((await client(base).api(`/me/drafts/${key}`)).status, 401);
    assert.equal((await client(base).api(`/me/drafts/${key}`, { method: 'PUT', body: { value: 'x' } })).status, 401);
    // encrypted at rest
    const row = (await pool.query('SELECT value_enc FROM user_drafts WHERE key = $1', [key])).rows[0];
    assert.match(row.value_enc, /^v1:/);
    assert.ok(!row.value_enc.includes('პროგრამირება'));
    // a newer text replaces it; an empty one removes it
    assert.equal((await ana.api(`/me/drafts/${key}`, { method: 'PUT', body: { value: 'A newer text.', base: 'what was saved' } })).status, 200);
    assert.deepEqual([(await ana.api(`/me/drafts/${key}`)).draft.value, (await ana.api(`/me/drafts/${key}`)).draft.base], ['A newer text.', 'what was saved']);
    assert.equal((await ana.api(`/me/drafts/${key}`, { method: 'PUT', body: { value: '   ' } })).status, 200);
    assert.equal((await ana.api(`/me/drafts/${key}`)).draft, null);
    await ana.api('/me/drafts/story', { method: 'PUT', body: { value: '{"pathStart":"x"}' } });
    assert.equal((await ana.api('/me/drafts/story', { method: 'DELETE' })).status, 200);
    assert.equal((await ana.api('/me/drafts/story')).draft, null);
  });

  test('only the known fields, and not more than a text can be', async () => {
    for (const bad of ['anything', 'question:not-an-id', 'answer:', `question:${ID}:more`, '../users']) {
      assert.equal((await ana.api(`/me/drafts/${encodeURIComponent(bad)}`, { method: 'PUT', body: { value: 'x' } })).status, 400, bad);
    }
    for (const ok of ['story', 'apply-story', 'bio', `answer:${ID}`]) assert.equal((await ana.api(`/me/drafts/${ok}`, { method: 'PUT', body: { value: 'kept' } })).status, 200, ok);
    assert.equal((await ana.api('/me/drafts/bio', { method: 'PUT', body: { value: 'ა'.repeat(12001) } })).status, 413);
    assert.equal((await ana.api('/me/drafts/bio', { method: 'PUT', body: { value: 12 } })).status, 400);
    assert.equal((await ana.api('/me/drafts/bio', { method: 'PUT', body: { value: 'ა'.repeat(12000) } })).status, 200, 'the longest text there is, in Georgian');
  });

  test('deleted by itself after 60 days, and with the account', async () => {
    await ana.api(`/me/drafts/${key}`, { method: 'PUT', body: { value: 'an old draft' } });
    await pool.query(`UPDATE user_drafts SET updated_at = now() - interval '61 days' WHERE key = $1`, [key]);
    for (let i = 0; i < 40 && (await pool.query('SELECT 1 FROM user_drafts WHERE key = $1', [key])).rowCount; i++) await wait(150);
    assert.equal((await ana.api(`/me/drafts/${key}`)).draft, null);
    assert.ok((await pool.query(`SELECT 1 FROM user_drafts WHERE key = 'bio'`)).rowCount, 'a recent one stays');
    assert.match(fs.readFileSync(path.join(ROOT, 'server/account.js'), 'utf8'), /'DELETE FROM user_drafts WHERE user_id = \$1'/);
  });
});

describe('the pages keep a draft of every long text field', () => {
  const js = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
  test('the question, the answer, My path / About / sample answer (Settings and the application) and About me', () => {
    assert.match(js('profile.js'), /const questionKey = `question:\$\{expert\.id\}`;/);
    assert.match(js('profile.js'), /if \(v\) WisecallDrafts\.write\(questionKey, v\); else WisecallDrafts\.clear\(questionKey\);/);
    assert.match(js('dashboard.js'), /WisecallDrafts\.bindText\(textarea, `answer:\$\{form\.dataset\.id\}`/);
    assert.match(js('dashboard.js'), /if \(answerDraft\) answerDraft\.clear\(\); \/\/ \(sent: nothing to keep\)/);
    assert.match(js('settings-details.js'), /WisecallDrafts\.write\('story', JSON\.stringify\(WisecallStoryForm\.read\(storyForm\(\)\)\), savedStory\)/);
    assert.match(js('apply.js'), /WisecallDrafts\.write\('apply-story', now\(\), storySaved\)/);
    assert.match(js('settings-profile.js'), /WisecallDrafts\.bindText\(\$\('bio'\), 'bio'/);
    for (const page of ['dashboard.html', 'settings.html', 'apply.html', 'profile.html']) assert.match(fs.readFileSync(path.join(ROOT, 'public', page), 'utf8'), /<script src="\/js\/drafts\.js"><\/script>/, page);
  });
  test('a draft is cleared only by a successful save: the page never removes one when a save is refused', () => {
    // (in each page, clear() is only reached after the awaited save came back without an error)
    assert.match(js('apply.js'), /await WisecallAPI\.apiFetch\('\/verification\/experience', \{ method: 'PUT', body: story \}\);\s+\} catch \(e\) \{[\s\S]+?return false;\s+\}\s+\/\/ \(saved whole: the draft is done\.[^\n]+\n\s+if \(window\.WisecallDrafts\) \{ WisecallDrafts\.clear\('apply-story'\)/);
    assert.match(js('settings-profile.js'), /fillForm\(\);\s+if \(bioDraft\) bioDraft\.saved\(\$\('bio'\)\.value\);/);
    const drafts = js('drafts.js');
    assert.match(drafts, /if \(el\.value === base\) clear\(key\); else write\(key, el\.value, base\);/);
    for (const l of ['en', 'ka']) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'));
      for (const k of ['draft.restored', 'draft.restoredStep', 'expert.question.tooLong', 'apply.err.network', 'story.err.blockShort']) assert.ok(d[k], `${l} ${k}`);
    }
  });
});

describe('the owner is told when a user\'s save fails', () => {
  const PATH = {
    pathStart: 'I came to Tbilisi from a small village and did not know anybody in the city at all.',
    pathHow: 'Too short SECRET-TYPED-TEXT',
    pathNow: 'I am a professor now, and half of my students came from the regions just like me.'
  };
  const refused = () => mentor.api('/me/details', { method: 'PUT', body: PATH, headers: { Referer: `${base}/ka/settings.html?tab=details&token=abc123` } });

  test('a refused save: one email with the user, the page, the field and the error; never what was typed', async () => {
    const r = await refused();
    assert.equal(r.status, 400);
    assert.equal(r.error, 'path_short');
    await resend.waitFor(OWNER, 'a save failed');
    const mail = alerts()[0].body;
    assert.equal(mail.subject, 'Wisecall: a save failed (path_short, pathHow)');
    assert.match(mail.text, /User: Mika Mentor <mika-drafts@example\.com>/);
    assert.match(mail.text, new RegExp(`User id: ${mentorId}`));
    assert.match(mail.text, /Request: PUT \/api\/me\/details/);
    assert.match(mail.text, /Page: \/ka\/settings\.html/);
    assert.match(mail.text, /Field: pathHow/);
    assert.match(mail.text, /Error: 400 path_short/);
    assert.doesNotMatch(mail.text + mail.html, /SECRET-TYPED-TEXT|token=abc123|small village/, 'nothing that was typed, and not the page\'s query');
    assert.match(srv.logs(), new RegExp(`\\[save-failed\\] PUT /api/me/details 400 path_short field=pathHow user=${mentorId}`));
  });

  test('the same user and error again within the hour: no second email; another error, or another user: one each', async () => {
    await refused();
    await refused();
    await settle();
    assert.equal(alerts().length, 1, 'once an hour for the same user and error');
    // another error of the same user
    const other = await mentor.api('/me', { method: 'PATCH', body: { price: 9999 } });
    assert.equal(other.error, 'invalid_price');
    // the same error of another user
    const second = await signupByEmail(resend, base, 'Second Mentor', 'second-drafts@example.com');
    await second.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
    assert.equal((await second.api('/me/details', { method: 'PUT', body: PATH })).error, 'path_short');
    for (let i = 0; i < 40 && alerts().length < 3; i++) await wait(150);
    assert.equal(alerts().length, 3);
    assert.ok(alerts().some((m) => m.body.subject === 'Wisecall: a save failed (invalid_price)'));
    assert.ok(alerts().some((m) => /second-drafts@example\.com/.test(m.body.text)));
  });

  test('not for an admin, a visitor, a page that is only read, a sign-in, or the drafts themselves', async () => {
    const n = alerts().length;
    assert.equal((await admin.api('/me', { method: 'PATCH', body: { price: 9999 } })).status, 400); // (the admin's own account)
    assert.equal((await client(base).api('/me/details', { method: 'PUT', body: PATH })).status, 401); // (nobody signed in)
    assert.equal((await mentor.api('/experts/not-a-mentor')).status, 404); // (read only)
    assert.equal((await mentor.api('/auth/login', { method: 'POST', body: { email: 'mika-drafts@example.com', password: 'wrong-password-1' } })).status, 401);
    assert.equal((await mentor.api('/me/drafts/nonsense', { method: 'PUT', body: { value: 'x' } })).status, 400);
    assert.equal((await mentor.api('/me/details', { method: 'PUT', body: { pathStart: PATH.pathStart, pathHow: PATH.pathStart, pathNow: PATH.pathNow } })).status, 200); // (a save that works)
    await settle();
    assert.equal(alerts().length, n);
  });

  test('ALERT_EMAIL is the setting; without it the admins get the email', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/saveAlerts.js'), 'utf8');
    assert.match(src, /config\.ALERT_EMAILS && config\.ALERT_EMAILS\.length \? config\.ALERT_EMAILS : config\.ADMIN_EMAILS/);
    assert.match(fs.readFileSync(path.join(ROOT, 'server/config.js'), 'utf8'), /ALERT_EMAILS: list\(env\.ALERT_EMAIL\)/);
    for (const f of ['.env.example', 'render.yaml']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /ALERT_EMAIL/, f);
    // (no address is written into the code)
    assert.doesNotMatch(src, /@[a-z0-9-]+\.(com|ge)/i);
  });
});
