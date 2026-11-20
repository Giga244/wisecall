// Every mentor's expert card kept whole (docs/CLAUDE-CODE-CARD-CHECKS.md):
//   - "შესახებ": at least 150 for an application that is not approved yet, up to 2000; an approved mentor is never refused a save of
//     "My details" for its length (131 or 1256 characters both save)
//   - the warnings: no About, a short one, a personal-looking one, odd capitals ("FInance"), no headline, no photo, a card with no text
//   - the admin's review shows the card as students see it and the warnings, and fixes the texts (audit-logged, no email to the mentor)
//   - once a day the admins get the list, and nothing when there is nothing to report
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'qa-admin@example.com';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, client } = require('./helpers');
const cardCheck = require('../server/cardCheck');
const mentorStory = require('../server/mentorStory');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4901, { RATE_LIMIT_MULTIPLIER: '50', ADMIN_EMAILS: 'qa-admin@example.com' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); await require('../server/db').close(); });

const ABOUT = 'ათ წელზე მეტია ვმუშაობ ფინანსურ ანალიტიკაში და ვასწავლი უნივერსიტეტში. ვეხმარები დამწყებებს პირველი სამსახურის პოვნაში და ინტერვიუსთვის მზადებაში. ასევე ვკითხულობ ლექციებს საბანკო რისკებზე.';
const PATH = {
  pathStart: 'სოფლიდან ჩამოვედი თბილისში, ქალაქში არავის ვიცნობდი და სწავლის ფულიც არ მქონდა.',
  pathHow: 'ღამით ბიბლიოთეკაში ვმეცადინეობდი და დღისით ვმუშაობდი, სანამ პირველი გრანტი არ მოვიგე.',
  pathNow: 'ახლა ბანკში ვმუშაობ ანალიტიკოსად და სტუდენტებს ვეხმარები, რომ უფრო მარტივი გზა გაიარონ.'
};
const of = (n, ch = 'ა') => Array.from({ length: n }, (x, i) => (i % 7 === 6 ? ' ' : String.fromCodePoint(ch.codePointAt(0) + (i % 20)))).join('');

let n = 0;
// (an application sent and not decided yet)
async function applicant() {
  n += 1;
  const c = await signupVerified(base, `Card Applicant ${n}`, `card-applicant-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Analyst' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Analyst', customNiche: 'Finance', niche: 'design', yearsExperience: 10, story: 'I worked ten years in banking and I teach financial analysis at a university now.' } });
  assert.equal(r.status, 200, r.text);
  await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() WHERE id = $1`, [r.user.id]);
  return { c, id: r.user.id };
}
async function listedMentor({ about = ABOUT } = {}) {
  n += 1;
  const c = await signupVerified(base, `Card Check ${n}`, `card-check-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Financial analyst and lecturer' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Analyst', customNiche: 'Finance', niche: 'design', yearsExperience: 10, story: 'I worked ten years in banking and I teach financial analysis at a university now.' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.api('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: `https://work-card-${n}.invalid/` } })).status, 200);
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  // (an application's story is copied into the About when it is written: set here as each test wants it, none included)
  await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [r.user.id, about || null]);
  return { c, id: r.user.id, username: r.user.username };
}
const details = (c, body) => c.api('/me/details', { method: 'PUT', body: { ...PATH, startTags: [], sampleQuestion: '', sampleReply: '', helpPoints: [], workLinks: [], ...body } });

describe('"შესახებ": 150 for a new application, up to 2000, and never a refused save for an approved mentor', () => {
  test('the limits the form is given', () => {
    assert.equal(mentorStory.LIMITS.aboutMin, 150);
    assert.equal(mentorStory.LIMITS.aboutMax, 2000);
  });

  test('an application not approved yet: under 150 refused under the About (the rest saved); 150 saved; over 2000 refused', async () => {
    const m = await applicant();
    const short = await details(m.c, { about: of(149) });
    assert.equal(short.status, 400);
    assert.equal(short.error, 'about_short');
    assert.equal(short.field, 'about');
    assert.ok(short.saved.includes('pathStart'), 'the path is saved without it');
    assert.equal((await details(m.c, { about: of(2001) })).error, 'about_too_long');
    assert.equal((await details(m.c, { about: `${ABOUT}` })).status, 200);
  });

  test('an approved mentor: an About of 131 or of 1256 characters, or none, never stops "My details" from saving', async () => {
    const m = await listedMentor({ about: null });
    const short = 'I am one of the top ranked lawyers in Georgia with the longest tenure of being the top ranked lawyer by an international directory.';
    assert.equal([...short].length, 131);
    const r = await details(m.c, { about: short });
    assert.equal(r.status, 200, r.text);
    assert.equal((await pool.query('SELECT bio FROM users WHERE id = $1', [m.id])).rows[0].bio, short);
    // (1256 characters of real writing: one sentence over and over is refused as repeated, for anybody)
    const W = ['ბანკი', 'ანალიზი', 'სტუდენტი', 'ლექცია', 'პროექტი', 'გუნდი', 'ბაზარი', 'რისკი', 'კრედიტი', 'ბიუჯეტი', 'ანგარიში', 'სტრატეგია', 'ინვესტიცია', 'კომპანია', 'მენეჯმენტი', 'აუდიტი', 'ფინანსი', 'გეგმა', 'მიზანი', 'შედეგი'];
    const long = Array.from({ length: 40 }, (x, i) => `${i + 1}) ${W[i % 20]} და ${W[(i * 3 + 1) % 20]} ${W[(i * 7 + 2) % 20]}-ში ვმუშაობდი ${2000 + i} წელს.`).join(' ').slice(0, 1256);
    assert.equal([...long].length, 1256);
    assert.equal((await details(m.c, { about: long })).status, 200);
    assert.equal((await details(m.c, { about: long, pathNow: `${PATH.pathNow} ახლა სხვა რამეც დავამატე.` })).status, 200, 'sent back unchanged with another change');
    assert.equal((await details(m.c, { about: '' })).status, 200, 'not refused (the daily check lists the card)');
    // (only the hard limit stays: over 2000)
    assert.equal((await details(m.c, { about: of(2001) })).error, 'about_too_long');
  });

  test('the Profile tab: a mentor\'s short About saves as before (no new rule there)', async () => {
    const m = await listedMentor();
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { bio: 'Short text about my work.', bioWas: ABOUT } })).status, 200);
  });
});

describe('the warnings', () => {
  test('odd capitals: two capitals and then small letters at the start of a word ("FInance"), never an abbreviation or a name', () => {
    assert.deepEqual(cardCheck.oddCaps('FInance, International Relations and Politics'), ['FInance']);
    assert.deepEqual(cardCheck.oddCaps('INternational law'), ['INternational']);
    assert.deepEqual(cardCheck.oddCaps('ფინანსები · FInance'), ['FInance']);
    for (const fine of ['Finance, International Relations and Politics', 'MBA, BGI Legal', 'PhD', 'iOS developer', 'IT და ტექნოლოგიები', 'McDonald', '']) assert.deepEqual(cardCheck.oddCaps(fine), [], fine);
    const w = cardCheck.warningsFor({ name: 'Irakli Test', roleTitle: 'Dr.', customNiche: 'FInance, International Relations and Politics', headline: 'x', bio: ABOUT, helpPoints: [], photoUpdatedAt: new Date() });
    assert.deepEqual(w, [{ code: 'odd_caps', field: 'customNiche', word: 'FInance', level: 'warning' }]);
  });

  test('an empty card, no About, a short one, a personal one, no headline, no photo', () => {
    const codes = (u, o) => cardCheck.warningsFor({ name: 'A B', photoUpdatedAt: new Date(), headline: 'Lawyer', helpPoints: [], ...u }, o).map((x) => x.code);
    assert.deepEqual(codes({ bio: null }), ['card_empty', 'about_missing']);
    assert.deepEqual(codes({ bio: null, helpPoints: ['Contracts'] }), ['about_missing'], 'the help lines are the card\'s text');
    assert.deepEqual(codes({ bio: 'Lawyer in Tbilisi.' }), ['about_short']);
    // (under 150 is a warning; no text at all is an error)
    assert.equal(cardCheck.warningsFor({ name: 'A', bio: 'Lawyer in Tbilisi.', headline: 'x', photoUpdatedAt: new Date() })[0].level, 'warning');
    assert.equal(cardCheck.warningsFor({ name: 'A', bio: null, headline: 'x', photoUpdatedAt: new Date() })[0].level, 'error');
    assert.deepEqual(codes({ bio: `${ABOUT} მყავს ცოლი და ოთხი შვილი.` }), ['about_personal']);
    assert.deepEqual(codes({ bio: ABOUT, headline: '', photoUpdatedAt: null }), ['headline_missing', 'photo_missing']);
    assert.deepEqual(codes({ bio: ABOUT }, { showAbout: false }), ['card_empty'], 'an About only some may see: the card has no text');
    // (an About that is only the old copy of the path counts as none: it is never shown)
    assert.deepEqual(codes({ ...PATH, bio: [PATH.pathStart, PATH.pathHow, PATH.pathNow].join('\n\n') }), ['card_empty', 'about_missing']);
  });
});

describe('the admin\'s review: the card, the warnings, the texts fixed from there', () => {
  test('the review has the card as Browse has it and the warnings; an admin fixes the role\'s field and the About; audit-logged; nobody else can', async () => {
    const m = await listedMentor({ about: null });
    await pool.query(`UPDATE users SET custom_niche = 'FInance, International Relations and Politics' WHERE id = $1`, [m.id]);
    const d = await admin.api(`/admin/mentors/${m.id}/verification`);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.card.name, 'Card Check ' + n);
    assert.equal(d.card.bio, null);
    assert.deepEqual(d.card.trust.helpPoints, []);
    assert.equal(d.card.price, 20);
    assert.deepEqual(d.cardWarnings.map((w) => w.code), ['card_empty', 'about_missing', 'odd_caps', 'photo_missing']);
    assert.equal(d.texts.about, '');
    // (the same card as Browse sends)
    const browse = (await client(base).api('/experts')).experts.find((e) => e.id === m.id);
    for (const k of ['name', 'roleTitle', 'customNiche', 'price', 'bio']) assert.deepEqual(d.card[k], browse[k], k);
    assert.deepEqual(d.card.trust, browse.trust);

    assert.equal((await m.c.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { about: ABOUT } })).status, 403, 'an admin only');
    const r = await admin.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { about: ABOUT, helpPoints: ['Pricing an order', 'Writing a CV'] } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.changed.sort(), ['about', 'helpPoints']);
    assert.equal(r.card.bio, ABOUT);
    assert.deepEqual(r.cardWarnings.map((w) => w.code), ['odd_caps', 'photo_missing']);
    // (the field's typo: the admin's own field edit, server/routes/adminVerification.js /field; here the role and the headline)
    const role = await admin.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { roleTitle: 'Financial analyst', headline: 'Finance, International Relations and Politics' } });
    assert.equal(role.status, 200, role.text);
    const row = (await pool.query('SELECT bio, role_title, headline, help_points FROM users WHERE id = $1', [m.id])).rows[0];
    assert.equal(row.bio, ABOUT);
    assert.equal(row.role_title, 'Financial analyst');
    assert.deepEqual(row.help_points, ['Pricing an order', 'Writing a CV']);
    const audit = (await pool.query(`SELECT step, reason, actor_label FROM verification_audit WHERE mentor_id = $1 AND action = 'admin_text_edit' ORDER BY created_at`, [m.id])).rows;
    assert.deepEqual(audit.map((a) => a.step).sort(), ['about', 'headline', 'helpPoints', 'roleTitle']);
    assert.ok(audit.every((a) => a.actor_label === 'qa-admin@example.com'));
    assert.match(audit.find((a) => a.step === 'roleTitle').reason, /Analyst → Financial analyst/);
    // refused: a contact in the About, an empty role
    assert.equal((await admin.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { about: 'Write to me: someone@gmail.com' } })).error, 'contact_details');
    assert.equal((await admin.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { roleTitle: '' } })).error, 'invalid_field');
    // (the story stays as it was when only the About is fixed)
    assert.deepEqual((await admin.api(`/admin/mentors/${m.id}/texts`, { method: 'PUT', body: { about: ABOUT } })).changed, []);
  });
});

describe('once a day: the list for the admins', () => {
  test('emailed once in a day, with each mentor and what is wrong; nothing to report: no email', async () => {
    const email = require('../server/email');
    const sent = [];
    const real = email.sendEmail;
    email.sendEmail = async (m) => { sent.push(m); };
    try {
      await pool.query(`DELETE FROM site_settings WHERE key = 'card_check'`);
      const listed = await cardCheck.problems();
      assert.ok(listed.length >= 1);
      const count = await cardCheck.dailyReport();
      assert.equal(count, listed.length);
      assert.ok(sent.length >= 1);
      assert.match(sent[0].subject, /mentor card\(s\) to check/);
      assert.match(sent[0].text, /\/ka\/u\//);
      sent.length = 0;
      assert.equal(await cardCheck.dailyReport(), 0, 'not twice in a day');
      assert.equal(sent.length, 0);
      // nothing to report: the claim is made, no email
      await pool.query(`UPDATE users SET bio = $1, headline = 'Lawyer', custom_niche = 'Finance', photo_updated_at = now() WHERE role IN ('mentor', 'both') AND verification_status = 'verified'`, [ABOUT]);
      assert.deepEqual(await cardCheck.problems(), []);
      assert.equal(await cardCheck.dailyReport({ force: true }), 0);
      assert.equal(sent.length, 0);
    } finally { email.sendEmail = real; }
  });
});
