// An approved mentor's "ჩემი გზა" (My path), saved in Settings → My details, is never wiped by a later step: sending new directions for a
// check, the field-suggestion save that goes with it, an admin's decision on that change, or saving the other sections. A refused save
// keeps what was there, and the log says what was refused and why (never the text). (e2e/mentor-path-approved.spec.js has the page.)
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, approveMentor, addPayoutDetails, ABOUT } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4885, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

const PATH = {
  pathStart: 'I came to Tbilisi from a small village and did not know anybody in the city at all.',
  pathHow: 'I studied at night in the library and worked in the day until I won my first grant.',
  pathNow: 'I am a professor now, and half of my students came from the regions just like me.'
};
const row = async (id) => (await pool.query('SELECT path_start, path_how, path_now, bio FROM users WHERE id = $1', [id])).rows[0];
const asPath = (r) => ({ pathStart: r.path_start, pathHow: r.path_how, pathNow: r.path_now });

async function approved(name, email) {
  const c = await signupVerified(base, name, email);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30, headline: 'Professor of physics' } })).status, 200);
  const r = await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Professor', customNiche: 'Physics research', fieldId: 'sci', yearsExperience: 20 } });
  assert.equal(r.status, 200, r.text);
  await approveMentor(admin, c);
  await addPayoutDetails(c);
  await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [r.user.id, ABOUT]); // (an About of their own already)
  const me = (await c.api('/me')).user;
  assert.equal(me.verificationStatus, 'verified');
  return { c, id: me.id, user: me };
}
// The whole story form, as the page sends it.
const storyBody = (over = {}) => ({ ...PATH, about: ABOUT, startTags: [], sampleQuestion: '', sampleReply: '', helpPoints: [], workLinks: [], ...over });

describe('an approved mentor saves "My path", then sends new directions for a check', () => {
  test('the path stays: after the directions are sent, after the field suggestion is saved, and after the admin approves or rejects', async () => {
    const m = await approved('Path Professor', 'path-prof@example.com');
    const saved = await m.c.api('/me/details', { method: 'PUT', body: storyBody() });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(asPath(await row(m.id)), PATH);

    // "შესამოწმებლად გაგზავნა": the directions (2-3 of them), then the field suggestion, as the page sends them
    const dirs = require('../server/categories').FIELD.get('sci').chips.filter((c) => !c.other && !c.moved).slice(0, 3).map((c) => c.id);
    const sent = await m.c.api('/me/fields', { method: 'PUT', body: { fieldId: 'sci', extraFields: [], directions: dirs, directionOther: {} } });
    assert.equal(sent.status, 200, sent.text);
    assert.ok(sent.change, 'it waits for an admin');
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { fieldSuggestion: '' } })).status, 200);
    assert.deepEqual(asPath(await row(m.id)), PATH, 'not wiped by sending the directions');

    // the admin sees it, and decides
    const changes = (await admin.api('/admin/changes')).changes.filter((c) => c.mentor.id === m.id);
    assert.equal(changes.length, 1);
    assert.equal((await admin.api(`/admin/changes/${changes[0].id}/approve`, { method: 'POST', body: {} })).status, 200);
    assert.deepEqual(asPath(await row(m.id)), PATH, 'not wiped by the approval');
    const p = (await m.c.api('/me/details')).story;
    assert.deepEqual({ pathStart: p.pathStart, pathHow: p.pathHow, pathNow: p.pathNow }, PATH, 'and the form shows it again');
    // and on the profile
    const prof = await (await fetch(`${base}/api/users/${m.user.username}`)).json();
    assert.deepEqual(prof.profile.mentor.trust.path, { start: PATH.pathStart, how: PATH.pathHow, now: PATH.pathNow });
  });

  test('saving the other sections (details, the price) never touches the path', async () => {
    const m = await approved('Other Sections', 'path-other@example.com');
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: storyBody() })).status, 200);
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: { specialtyTags: 'research, teaching', currentRole: 'Professor', university: '', country: null, yearsExperience: '21' } })).status, 200);
    assert.equal((await m.c.api('/me', { method: 'PATCH', body: { price: 40 } })).status, 200);
    assert.deepEqual(asPath(await row(m.id)), PATH);
  });
});

describe('a refused save', () => {
  test('a block under 40 characters: refused for that block, nothing saved, nothing that was there is lost; the log says why', async () => {
    const m = await approved('Short Block', 'path-short@example.com');
    assert.equal((await m.c.api('/me/details', { method: 'PUT', body: storyBody() })).status, 200);
    const r = await m.c.api('/me/details', { method: 'PUT', body: storyBody({ pathHow: 'Studied at night.' }) });
    assert.equal(r.status, 400);
    assert.equal(r.error, 'path_short');
    assert.equal(r.field, 'pathHow', 'the page says it under that block');
    assert.deepEqual(asPath(await row(m.id)), PATH, 'what was saved before is kept');
    const contact = await m.c.api('/me/details', { method: 'PUT', body: storyBody({ pathNow: `${PATH.pathNow} Write to me at prof.path@example.com any time.` }) });
    assert.equal(contact.error, 'contact_details');
    assert.equal(contact.field, 'pathNow');
    // (the log: what was refused and why, and which fields were sent; never the words)
    await new Promise((res) => setTimeout(res, 200));
    const log = srv.logs();
    assert.match(log, new RegExp(`\\[details\\] refused path_short field=pathHow user=${m.id} sent=pathStart,pathHow,pathNow,`));
    assert.match(log, /\[details\] refused contact_details field=pathNow/);
    assert.doesNotMatch(log, /Studied at night|prof\.path@example\.com/);
  });
});

describe('an old About next to a new path', () => {
  test('an About stored with other line breaks (and words today\'s filter would refuse) comes back from the browser: the path is saved, the About untouched', async () => {
    const m = await approved('Old Line Breaks', 'path-crlf@example.com');
    const old = 'I have taught at the university for twenty years.\r\n\r\nBefore that I worked at the ministry.\r\nMy page: prof-old.example';
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [m.id, old]);
    // (the page shows it in a text box and sends it back with \n line breaks)
    const r = await m.c.api('/me/details', { method: 'PUT', body: storyBody({ about: old.replace(/\r\n/g, '\n') }) });
    assert.equal(r.status, 200, r.text);
    const now = await row(m.id);
    assert.deepEqual(asPath(now), PATH, 'the path is saved');
    assert.equal(now.bio, old, 'the About is exactly as it was');
  });
});

describe('the page', () => {
  test('every other button saves an unsaved path first, and a redraw puts typed text back (the page\'s own code)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public/js/settings-details.js'), 'utf8');
    for (const form of ['#detailsError', '#fieldsError', '#licenceError', '#proofError']) {
      assert.match(src, new RegExp(`querySelector\\('${form}'\\);\\s+err\\.textContent = '';[\\s\\S]{0,260}?if \\(!\\(await storyFirst\\(err\\)\\)\\) return;`), form);
    }
    assert.match(src, /const carry = storyDirty\(\) \? WisecallStoryForm\.read\(storyForm\(\)\) : null;/);
    assert.match(src, /WisecallStoryForm\.restore\(box, draft\.values\)/);
    // the field's own line under each "My path" block
    const form = fs.readFileSync(path.join(ROOT, 'public/js/story-form.js'), 'utf8');
    assert.match(form, /data-field-error="\$\{key\}"/);
  });
});
