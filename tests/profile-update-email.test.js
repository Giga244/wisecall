// The one-off "profile update" email to approved mentors (server/profileUpdateEmail.js; admin → Mentors, "პროფილის განახლების წერილი"):
//   - the preview lists each approved mentor whose profile lacks "ჩემი გზა", "შენ შესახებ" or a photo, with what they lack and the exact
//     email; a complete profile, a mentor who is not approved and an asker are not on it; the preview itself sends nothing
//   - the email names only what THAT mentor lacks; Georgian, or English for a mentor whose language is English; through Resend, from
//     EMAIL_FROM, replies to SUPPORT_EMAIL, one button to Settings → My details, signed "გიგა, Wisecall"
//   - nothing is sent without the confirm click (confirm: true, the ticked ids); only the ticked mentors get it
//   - each mentor gets it at most once (logged with the date), even with two clicks at once; one the email service refused can be sent again
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');
const { render } = require('../server/mail/templates');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const SITE = 'https://wisecall.example';
const FROM = 'Wisecall <hello@wisecall.example>';
const SUPPORT = 'help@wisecall.example';
const SUBJECT_KA = 'Wisecall-ზე ახალი რამ დავამატეთ ✨';
let srv, base, admin;

const PATH = {
  pathStart: 'I came to Tbilisi from a small town and did not know anybody in the field at all.',
  pathHow: 'I studied at night with free courses and took small jobs to learn how the work is done.',
  pathNow: 'I have led a small team for six years now, and I teach a course for beginners too.'
};
const ABOUT = 'For many years I have worked in this field, first as a junior in a small company and now leading a team of my own. I also teach beginners and can help with where to start.';

let n = 0;
// An approved mentor (or not), with what their profile has: { path, about, photo, lang, approved }.
async function mentor(name, { path = false, about = null, photo = false, lang = 'ka', approved = true } = {}) {
  n += 1;
  const email = `pu-${n}@example.com`;
  const c = await signupByEmail(resend, base, name, email, lang);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Web designer' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Web designer', customNiche: 'Web design', niche: 'design', yearsExperience: 6, ...(path ? PATH : {}) } });
  assert.equal(r.status, 200, r.text);
  const id = r.user.id;
  if (about) await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [id, about]);
  if (photo) await pool.query('UPDATE users SET photo_updated_at = now() WHERE id = $1', [id]);
  if (approved) await approveMentor(admin, c);
  return { c, id, email, name };
}
const preview = () => admin.api('/admin/profile-update');
const send = (ids, extra = { confirm: true }) => admin.api('/admin/profile-update/send', { method: 'POST', body: { ids, ...extra } });
const updates = (email) => resend.to(email).filter((m) => /ახალი რამ დავამატეთ|added something new/.test(m.body.subject));
const sentAt = async (id) => (await pool.query('SELECT profile_update_sent_at FROM users WHERE id = $1', [id])).rows[0].profile_update_sent_at;

const people = {};
before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4897, { RATE_LIMIT_MULTIPLIER: '50', PUBLIC_URL: SITE, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: FROM, SUPPORT_EMAIL: SUPPORT });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  people.nothing = await mentor('ნესტან ბერიძე'); // (lacks all three)
  people.photoEn = await mentor('Anna Smith', { path: true, about: ABOUT, lang: 'en' }); // (lacks only the photo; English)
  people.complete = await mentor('Levan Complete', { path: true, about: ABOUT, photo: true });
  people.shortAbout = await mentor('ლაშა მოკლე', { path: true, about: 'Designer for ten years.', photo: true, lang: 'ka' }); // (an About of their own, however short: nothing lacks)
  people.copied = await mentor('ირაკლი ასლი', { path: true, photo: true }); // (only the copy of the path as About: lacks "შენ შესახებ")
  await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [people.copied.id, [PATH.pathStart, PATH.pathHow, PATH.pathNow].join('\n\n')]);
  people.pending = await mentor('Not Approved', { approved: false });
  people.asker = await signupByEmail(resend, base, 'Just Asker', 'pu-asker@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('the preview', () => {
  test('lists approved mentors who lack something, with what they lack; a complete profile, a pending mentor and an asker are not on it', async () => {
    const r = await preview();
    assert.equal(r.status, 200, r.text);
    const byId = Object.fromEntries(r.mentors.map((m) => [m.id, m]));
    assert.deepEqual(byId[people.nothing.id].missing, ['path', 'about', 'photo']);
    assert.deepEqual(byId[people.photoEn.id].missing, ['photo']);
    assert.deepEqual(byId[people.copied.id].missing, ['about'], 'a copy of the path is not an About');
    assert.equal(byId[people.complete.id], undefined, 'nothing missing: not on the list');
    assert.equal(byId[people.shortAbout.id], undefined, 'an About of their own, however short, counts');
    assert.equal(byId[people.pending.id], undefined, 'not approved');
    assert.equal(r.mentors.length, 3);
    assert.deepEqual(r.sent, []);
    assert.equal(byId[people.nothing.id].language, 'ka');
    assert.equal(byId[people.photoEn.id].language, 'en');
  });

  test('each email names only what that mentor lacks, in their language', async () => {
    const byId = Object.fromEntries((await preview()).mentors.map((m) => [m.id, m.message]));
    const ka = byId[people.nothing.id];
    assert.equal(ka.subject, SUBJECT_KA);
    assert.match(ka.text, /^გამარჯობა, ნესტან!/, 'personal: their first name');
    assert.match(ka.text, /თქვენი პროფილი საიტზე უკვე ჩანს\. Wisecall მალე იხსნება და მანამდე პროფილს ახალი ნაწილები დავამატეთ, რომ სტუდენტებმა უკეთ გაგიცნონ:/);
    assert.match(ka.text, /• „ჩემი გზა“ — სამი მოკლე პასუხი: სად დაიწყეთ, როგორ გაუმკლავდით, სად ხართ ახლა\. ამით სტუდენტები პოულობენ მენტორს, ვინც მათსავით დაიწყო\./);
    assert.match(ka.text, /• „შენ შესახებ“ — თქვენი კარიერა თქვენივე სიტყვებით\./);
    assert.match(ka.text, /• ფოტო — სტუდენტები ფოტოიან მენტორს მეტად ენდობიან\./);
    assert.match(ka.text, /3–5 წუთი სჭირდება\. რაც უკვე დაწერეთ, უცვლელი რჩება\./);
    assert.match(ka.text, new RegExp(`პროფილის განახლება: ${SITE}/ka/settings\\.html\\?tab=details`), 'one button to Settings → My details');
    assert.match(ka.text, /გიგა, Wisecall/);
    assert.equal((ka.html.match(/<a href="[^"]*settings\.html\?tab=details"/g) || []).length, 1, 'one button');
    assert.match(ka.html, /wisecall-logo-email\.png/, "Wisecall's normal email design");
    // only the photo
    const photo = byId[people.photoEn.id];
    assert.equal(photo.subject, "We've added something new to Wisecall ✨");
    assert.match(photo.text, /^Hello, Anna!/);
    assert.match(photo.text, /• A photo: students trust mentors with a photo more\./);
    assert.doesNotMatch(photo.text, /My path|About you/);
    assert.match(photo.text, new RegExp(`Update your profile: ${SITE}/en/settings\\.html\\?tab=details`));
    assert.match(photo.text, /Giga, Wisecall/);
    // only "შენ შესახებ"
    const about = byId[people.copied.id];
    assert.match(about.text, /„შენ შესახებ“/);
    assert.doesNotMatch(about.text, /„ჩემი გზა“|• ფოტო/);
    assert.equal((about.text.match(/^• /gm) || []).length, 1);
  });

  test('the preview sends nothing; only an admin can open it or send', async () => {
    await preview();
    for (const p of Object.values(people)) if (p.email) assert.equal(updates(p.email).length, 0, p.email);
    const asker = people.asker;
    assert.equal((await asker.api('/admin/profile-update')).status, 403);
    assert.equal((await asker.api('/admin/profile-update/send', { method: 'POST', body: { ids: [people.nothing.id], confirm: true } })).status, 403);
    assert.equal((await client(base).api('/admin/profile-update')).status, 401);
    assert.equal(await sentAt(people.nothing.id), null);
  });
});

describe('sending', () => {
  test('nothing without the confirm click; then only the ticked mentor, through Resend, from EMAIL_FROM, replies to SUPPORT_EMAIL', async () => {
    const without = await send([people.nothing.id], {});
    assert.equal(without.status, 400);
    assert.equal(without.error, 'confirm_required');
    assert.equal((await send([], { confirm: true })).error, 'nobody_chosen');
    assert.equal(updates(people.nothing.email).length, 0);

    // (Anna unticked: only Nestan)
    const r = await send([people.nothing.id]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.sent.map((x) => x.id), [people.nothing.id]);
    const mails = updates(people.nothing.email);
    assert.equal(mails.length, 1);
    const m = mails[0].body;
    assert.equal(m.from, FROM);
    assert.equal(m.reply_to, SUPPORT);
    assert.equal(m.subject, SUBJECT_KA);
    assert.match(m.text, /გამარჯობა, ნესტან!/);
    assert.equal(updates(people.photoEn.email).length, 0, 'unticked: nothing');
    assert.ok(await sentAt(people.nothing.id), 'logged with the date');

    // the preview: Nestan moves to "already got it", with the date
    const p = await preview();
    assert.ok(!p.mentors.some((x) => x.id === people.nothing.id));
    const done = p.sent.find((x) => x.id === people.nothing.id);
    assert.ok(done && done.sentAt);
  });

  test('nobody gets it twice: sent again, the one who got it and a complete profile are skipped', async () => {
    const r = await send([people.nothing.id, people.photoEn.id, people.complete.id]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.sent.map((x) => x.id), [people.photoEn.id]);
    assert.deepEqual(r.skipped.map((x) => [x.id, x.reason]), [[people.nothing.id, 'already_sent'], [people.complete.id, 'complete']]);
    assert.equal(updates(people.nothing.email).length, 1, 'still one');
    assert.equal(updates(people.complete.email).length, 0, 'a complete profile never gets it');
    const en = updates(people.photoEn.email);
    assert.equal(en.length, 1);
    assert.equal(en[0].body.subject, "We've added something new to Wisecall ✨", 'in English for an English-speaking mentor');
    assert.equal((await send([people.pending.id])).skipped[0].reason, 'not_approved');
    assert.equal(updates(people.pending.email).length, 0);
  });

  test('two clicks at once still send it once', async () => {
    const [a, b] = await Promise.all([send([people.copied.id]), send([people.copied.id])]);
    assert.equal(a.sent.length + b.sent.length, 1);
    assert.equal(updates(people.copied.email).length, 1);
  });

  test('refused by the email service: not marked as sent, still on the list, and it can be sent again', async () => {
    const m = await mentor('Refused Once', { path: true, about: ABOUT });
    resend.refuse.add(m.email);
    const r = await send([m.id]);
    assert.deepEqual(r.failed.map((x) => x.id), [m.id]);
    assert.equal(await sentAt(m.id), null);
    assert.ok((await preview()).mentors.some((x) => x.id === m.id));
    resend.refuse.delete(m.email);
    assert.deepEqual((await send([m.id])).sent.map((x) => x.id), [m.id]);
    assert.equal(updates(m.email).length, 1);
  });
});

describe('the template', () => {
  test('one line per part, in the same order, and only those; no "{name}" left when there is no name', () => {
    const all = render('profileUpdate', 'ka', { name: 'ნინო', parts: ['photo', 'path', 'about'] }).text;
    const lines = all.split('\n').filter((l) => l.startsWith('• '));
    assert.deepEqual(lines.map((l) => (l.includes('ჩემი გზა') ? 'path' : (l.includes('შენ შესახებ') ? 'about' : 'photo'))), ['path', 'about', 'photo']);
    assert.equal(render('profileUpdate', 'ka', { parts: ['photo'] }).text.split('\n')[0], 'გამარჯობა!');
    assert.doesNotMatch(render('profileUpdate', 'en', { parts: [] }).html, /\{name\}|• /);
  });
});
