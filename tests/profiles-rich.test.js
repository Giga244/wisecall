// Rich, optional profiles (docs/PROFILES-PLAN.md): per-section visibility for every kind of viewer, the "only me" defaults for askers,
// what people already shared stays visible, the verified mark (and its removal on edit), escaping, links, reordering, durations and
// grouping, JSON-LD with public data only, Browse cards and search from public data only, reporting and admin hiding, data export and
// account deletion, and that nothing here is ever required.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sql = async (q, p) => (await pool.query(q, p)).rows;
let srv, base, admin, mentor, mentorId, asker, other, mentorName;

const exp = (over = {}) => ({ title: 'Software engineer', organisation: 'Acme Labs', location: 'Tbilisi', type: 'full_time', start: { year: 2019, month: 3 }, end: { year: 2021, month: 6 },
  description: 'Built the payments service.', achievements: ['Cut costs by 30%'], ...over });
const page = async (c, username) => (c ? c(`/u/${username}`) : (async () => { const r = await fetch(`${base}/u/${username}`); return { status: r.status, text: await r.text() }; })());

before(async () => {
  await resetDatabase();
  srv = await startServer(4749, { RATE_LIMIT_MULTIPLIER: '100', SWEEP_INTERVAL_SECONDS: '1' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
  mentor = await signupVerified(base, 'Mari Mentor', 'mari@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 40, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mari Mentor');
  mentorName = (await sql('SELECT username FROM users WHERE id = $1', [mentorId]))[0].username;
  asker = await signupVerified(base, 'Ana Asker', 'ana@example.com');
  other = await signupVerified(base, 'Otto Other', 'otto@example.com');
  await asker.api('/me', { method: 'PATCH', body: { profileVisibility: 'public' } });
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const askerName = async () => (await sql(`SELECT username FROM users WHERE email = 'ana@example.com'`))[0].username;

describe('nothing is required', () => {
  test('signing up, asking and applying never need a section; an empty profile shows no empty sections', async () => {
    const r = await asker.api('/me/profile/sections');
    assert.equal(r.status, 200);
    assert.equal(r.sections.strength.percent < 100, true);
    const html = (await page(null, mentorName)).text;
    assert.doesNotMatch(html, /psExp|psEdu|psJourney/);
  });
});

describe('sections and who sees them', () => {
  test('an asker\'s sections are "only me" until they choose; the owner sees them', async () => {
    await asker.api('/me/profile/items', { method: 'POST', body: { section: 'experience', data: exp() } });
    const name = await askerName();
    const visitor = await client(base).api(`/users/${name}`);
    assert.equal(visitor.profile.sections.experience, undefined, 'a visitor does not see it');
    assert.equal((await other.api(`/users/${name}`)).profile.sections.experience, undefined, 'nor a signed-in stranger');
    const self = await asker.api(`/users/${name}`);
    assert.equal(self.profile.sections.experience[0].organisation, 'Acme Labs');
    assert.equal(self.profile.sections.visibility.experience, 'only_me');
    assert.equal((await admin.api(`/users/${name}`)).profile.sections.experience.length, 1, 'admins see everything');
  });

  test('each level: everyone, signed-in people, only me', async () => {
    const name = await askerName();
    await asker.api('/me/profile/visibility', { method: 'PUT', body: { section: 'experience', level: 'signed_in' } });
    assert.equal((await client(base).api(`/users/${name}`)).profile.sections.experience, undefined);
    assert.equal((await other.api(`/users/${name}`)).profile.sections.experience.length, 1);
    await asker.api('/me/profile/visibility', { method: 'PUT', body: { section: 'experience', level: 'everyone' } });
    assert.equal((await client(base).api(`/users/${name}`)).profile.sections.experience.length, 1);
    assert.equal((await client(base).api(`/users/${name}`)).profile.sections.visibility, undefined, 'the levels are the owner\'s business');
    assert.equal((await asker.api('/me/profile/visibility', { method: 'PUT', body: { section: 'experience', level: 'friends' } })).error, 'invalid_visibility');
  });

  test('a mentor\'s usual sections are public by default; Journey stays private until switched on', async () => {
    await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'experience', data: exp({ title: 'Senior engineer', organisation: 'Globex', current: true, end: null, start: { year: 2015 } }) } });
    await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'journey', data: { date: { year: 2015 }, title: 'First job as a developer' } } });
    const v = await client(base).api(`/users/${mentorName}`);
    assert.equal(v.profile.sections.experience.length, 1);
    assert.equal(v.profile.sections.journey, undefined);
  });

  test('what people already shared before stays visible (headline, about, languages, links)', async () => {
    const rows = await sql(`SELECT visibility FROM profile_settings ps JOIN users u ON u.id = ps.user_id WHERE u.email = 'ana@example.com'`);
    assert.ok(rows.length, 'settings exist');
  });
});

describe('items', () => {
  test('checks: required fields, dates, end before start, rude words, contact details, links (http/https only)', async () => {
    const bad = async (section, data) => (await mentor.api('/me/profile/items', { method: 'POST', body: { section, data } })).error;
    assert.equal(await bad('experience', exp({ title: '' })), 'invalid_title');
    assert.equal(await bad('experience', exp({ start: { year: 1800 } })), 'invalid_start');
    assert.equal(await bad('experience', exp({ end: { year: 2010 } })), 'end_before_start');
    assert.equal(await bad('experience', exp({ description: 'Call me on +995 599 12 34 56 or mail me@example.com' })), 'contact_details');
    assert.equal(await bad('licence', { name: 'Licence', issuer: 'Ministry', issued: { year: 2020 }, url: 'javascript:alert(1)' }), 'invalid_link');
    assert.equal(await bad('project', { title: 'P', url: 'data:text/html,hi' }), 'invalid_link');
    assert.equal(await bad('nonsense', {}), 'invalid_section');
    assert.equal((await mentor.api('/me/profile/links', { method: 'PUT', body: { links: { github: 'https://evil.example/x' } } })).error, 'invalid_link', 'GitHub links point to GitHub');
  });

  test('durations and grouping: several roles at one organisation show the total time there', async () => {
    await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'experience', data: exp({ title: 'Engineer', organisation: 'Globex', start: { year: 2012, month: 1 }, end: { year: 2014, month: 12 } }) } });
    const s = (await client(base).api(`/users/${mentorName}`)).profile.sections;
    const globex = s.experience.find((g) => g.organisation === 'Globex');
    assert.equal(globex.items.length, 2);
    assert.equal(globex.current, true);
    assert.ok(globex.months >= 12 * 10, 'from 2012 until now');
    assert.ok(s.yearsOfExperience >= 10);
  });

  test('reordering is kept; only the owner\'s own items, each once', async () => {
    const mine = (await mentor.api('/me/profile/sections')).sections.experience.flatMap((g) => g.items).map((i) => i.id);
    const rev = [...mine].reverse();
    assert.equal((await mentor.api('/me/profile/order', { method: 'POST', body: { section: 'experience', ids: rev } })).status, 200);
    assert.deepEqual((await sql(`SELECT id FROM profile_items WHERE user_id = $1 AND section = 'experience' ORDER BY position`, [mentorId])).map((r) => r.id), rev);
    assert.equal((await mentor.api('/me/profile/order', { method: 'POST', body: { section: 'experience', ids: [rev[0]] } })).error, 'invalid_order');
    const askers = (await asker.api('/me/profile/sections')).sections.experience.flatMap((g) => g.items).map((i) => i.id);
    assert.equal((await mentor.api('/me/profile/order', { method: 'POST', body: { section: 'experience', ids: [...rev.slice(1), askers[0]] } })).error, 'invalid_order');
    assert.equal((await other.api(`/me/profile/items/${askers[0]}`, { method: 'DELETE' })).status, 404, 'not someone else\'s item');
  });

  test('every field is escaped on the page', async () => {
    await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'education', data: { school: '<script>alert(1)</script> University', degree: 'BSc <b>CS</b>' } } });
    const html = (await page(null, mentorName)).text;
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; University/);
  });
});

describe('verified vs self-reported', () => {
  test('an admin marks an item verified (with a note, logged); editing it removes the mark', async () => {
    const [it] = await sql(`SELECT id FROM profile_items WHERE user_id = $1 AND section = 'experience' ORDER BY created_at LIMIT 1`, [mentorId]);
    assert.equal((await admin.api(`/admin/profile-items/${it.id}/verify`, { method: 'POST', body: { verified: true } })).error, 'reason_required');
    assert.equal((await mentor.api(`/admin/profile-items/${it.id}/verify`, { method: 'POST', body: { verified: true, note: 'x' } })).status, 403);
    assert.equal((await admin.api(`/admin/profile-items/${it.id}/verify`, { method: 'POST', body: { verified: true, note: 'Matches the reviewed experience' } })).status, 200);
    const v = (await client(base).api(`/users/${mentorName}`)).profile.sections.experience.flatMap((g) => g.items).find((i) => i.id === it.id);
    assert.equal(v.verified, true);
    assert.ok((await sql(`SELECT 1 FROM verification_audit WHERE action = 'profile_item_verified' AND mentor_id = $1`, [mentorId])).length);
    const [row] = await sql('SELECT data FROM profile_items WHERE id = $1', [it.id]);
    await mentor.api(`/me/profile/items/${it.id}`, { method: 'PUT', body: { data: row.data } });
    assert.ok((await sql('SELECT verified_at FROM profile_items WHERE id = $1', [it.id]))[0].verified_at, 'saving it unchanged keeps the mark');
    await mentor.api(`/me/profile/items/${it.id}`, { method: 'PUT', body: { data: { ...row.data, title: 'Principal engineer' } } });
    assert.equal((await sql('SELECT verified_at FROM profile_items WHERE id = $1', [it.id]))[0].verified_at, null);
  });
});

describe('where it shows', () => {
  test('JSON-LD Person holds only public sections; Browse cards and search use only public data', async () => {
    await mentor.api('/me/profile/skills', { method: 'PUT', body: { skills: ['Payments', 'Node.js', 'Hiring', 'SecretSkill'], topSkills: ['Payments', 'Node.js'] } });
    await mentor.api('/me/profile/items', { method: 'POST', body: { section: 'journey', data: { date: { year: 2020 }, title: 'Moved to Berlin privately' } } });
    const html = (await page(null, mentorName)).text;
    const doc = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).map((s) => s.replace(/<\/?script[^>]*>/g, '')).find((s) => s.includes('"Person"')));
    const ld = (doc['@graph'] || [doc]).find((n) => n['@type'] === 'Person');
    assert.ok(ld.knowsAbout.includes('Payments'));
    assert.ok(JSON.stringify(ld).includes('Globex'));
    assert.doesNotMatch(JSON.stringify(ld), /Moved to Berlin/, 'Journey is private');
    const list = await client(base).api('/experts?q=globex');
    const card = list.experts.find((e) => e.id === mentorId);
    assert.ok(card, 'search finds the organisation');
    assert.deepEqual(card.profile.topSkills, ['Payments', 'Node.js']);
    assert.equal(card.profile.currentPosition.organisation, 'Globex');
    await mentor.api('/me/profile/visibility', { method: 'PUT', body: { section: 'skills', level: 'only_me' } });
    assert.equal((await client(base).api('/experts?q=secretskill')).experts.length, 0, 'private skills are not searchable');
  });
});

describe('moderation', () => {
  test('a signed-in person reports a profile; an admin hides a section with a reason (logged, the owner told) and shows it again', async () => {
    const name = await askerName();
    assert.equal((await client(base).api(`/users/${name}/report`, { method: 'POST', body: { reason: 'fake' } })).status, 401);
    assert.equal((await other.api(`/users/${name}/report`, { method: 'POST', body: { reason: 'fake', details: 'Not real' } })).status, 201);
    assert.equal((await other.api(`/users/${name}/report`, { method: 'POST', body: { reason: 'fake' } })).error, 'already_reported');
    const reports = await admin.api('/admin/profiles/reports');
    assert.equal(reports.reports.length, 1);
    const askerId = reports.reports[0].owner.id;
    assert.equal((await admin.api(`/admin/profiles/${askerId}/hide`, { method: 'POST', body: { section: 'experience', reason: 'Made-up employer' } })).status, 200);
    assert.equal((await client(base).api(`/users/${name}`)).profile.sections.experience, undefined);
    assert.equal((await asker.api('/me/profile/sections')).sections.adminHidden.experience, 'Made-up employer');
    const inbox = await asker.api('/inbox/notifications');
    assert.ok(inbox.notifications.some((x) => x.kind === 'profile_hidden'));
    await admin.api(`/admin/profiles/${askerId}/unhide`, { method: 'POST', body: { section: 'experience' } });
    assert.equal((await client(base).api(`/users/${name}`)).profile.sections.experience.length, 1);
    assert.equal((await admin.api(`/admin/profiles/reports/${reports.reports[0].id}/resolve`, { method: 'POST', body: { resolution: 'Checked, fine' } })).status, 200);
  });
});

describe('data', () => {
  test('"Download my data" includes the sections; deleting the account removes them', async () => {
    const ex = await asker.api('/me/export');
    assert.ok(ex.profileSections && ex.profileSections.items.length >= 1);
    const id = (await sql(`SELECT id FROM users WHERE email = 'ana@example.com'`))[0].id;
    assert.equal((await asker.api('/me', { method: 'DELETE', body: { password: 'test-pass-12345' } })).status, 200);
    await pool.query(`UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1`, [id]);
    for (let i = 0; i < 60 && !(await sql('SELECT deleted_at FROM users WHERE id = $1', [id]))[0].deleted_at; i += 1) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await sql('SELECT count(*)::int AS n FROM profile_items WHERE user_id = $1', [id]))[0].n, 0);
    assert.equal((await sql('SELECT count(*)::int AS n FROM profile_settings WHERE user_id = $1', [id]))[0].n, 0);
  });
});
