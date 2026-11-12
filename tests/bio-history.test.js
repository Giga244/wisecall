// A mentor's "About me" is only ever their own words (docs/CLAUDE-CODE-FINISH.md part 2). A profile once showed a shortened third-person
// text that no code of ours writes. Now:
// - only two places in the code write it: the mentor's own Settings save (server/profiles.js) and the copy of their own story while the two
//   are the same text (storyToBio, server/verification/experience.js), which copies it exactly, never rewritten or shortened;
// - every change is kept by the database (migrations/063_bio_changes.sql), with what made it: the site, or a script or manual query.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, signupVerified, SAMPLE } = require('./helpers');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); // (like a script in a shell: no application name)
const STORY = Array.from({ length: 6 }, (x, i) => `${i + 1}. მაქვს გამოცდილება საჯარო სამსახურში და უნივერსიტეტში, ვკითხულობ ლექციებს და ვწერ სტატიებს.`).join('\n\n');
let srv, mentor, id;

before(async () => {
  await resetDatabase();
  srv = await startServer(4862, { RATE_LIMIT_MULTIPLIER: '50' });
  mentor = await signupVerified(srv.base, 'Bio Mentor', 'bio-history@example.com');
  assert.equal((await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Lecturer', niche: 'teaching', price: 20, proofUrl: 'https://example.org/in/bio', sampleAnswer: SAMPLE } })).status, 200);
  id = (await mentor.api('/me')).user.id;
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });
const history = async () => (await pool.query('SELECT old_bio, new_bio, source FROM bio_changes WHERE user_id = $1 ORDER BY id', [id])).rows;

describe('"About me" is the mentor\'s own words, and every change is kept', () => {
  test('the story copied into "About me" is the story exactly (never rewritten or shortened); the change is kept, made by the site', async () => {
    assert.equal((await mentor.api('/verification/experience', { method: 'PUT', body: { story: STORY } })).status, 200);
    const me = (await mentor.api('/me')).user;
    assert.equal(me.story, STORY);
    assert.equal(me.bio, STORY, 'byte for byte');
    const h = await history();
    assert.equal(h.length, 1);
    assert.equal(h[0].old_bio, null);
    assert.equal(h[0].new_bio, STORY);
    assert.equal(h[0].source, 'wisecall-site');
  });

  test('the mentor\'s own Settings save is kept with the text before it', async () => {
    const mine = `${STORY}\n\nდა კიდევ ერთი ჩემი წინადადება.`;
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { bio: mine, bioWas: STORY } })).status, 200);
    const last = (await history()).pop();
    assert.equal(last.old_bio, STORY);
    assert.equal(last.new_bio, mine);
    assert.equal(last.source, 'wisecall-site');
    // (a save that does not change it adds nothing)
    const n = (await history()).length;
    assert.equal((await mentor.api('/me', { method: 'PATCH', body: { city: 'Tbilisi' } })).status, 200);
    assert.equal((await history()).length, n);
  });

  test('a change from outside the site (a script, a manual query) is kept too, marked as such, and can be undone from it', async () => {
    const before = (await mentor.api('/me')).user.bio;
    await pool.query("UPDATE users SET bio = 'მესამე პირში გადაწერილი და შემოკლებული ტექსტი' WHERE id = $1", [id]);
    const last = (await history()).pop();
    assert.equal(last.source, 'unknown', 'not the site');
    assert.equal(last.old_bio, before, 'the text before it, to put back');
    await pool.query('UPDATE users SET bio = $2 WHERE id = $1', [id, last.old_bio]);
    assert.equal((await mentor.api('/me')).user.bio, before);
  });

  test('only two places in the code write "About me": the mentor\'s Settings save and the exact copy of their own story', () => {
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
    });
    walk(path.join(ROOT, 'server'));
    const writers = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (/\bpatch\.bio\s*=|\bSET\s+bio\s*=|\bbio\s*=\s*\$\d/i.test(src)) writers.push(rel);
    }
    assert.deepEqual(writers.sort(), ['server/account.js', 'server/profiles.js', 'server/verification/experience.js'].filter((w) => writers.includes(w)).sort(), `writers: ${writers.join(', ')}`);
    for (const w of writers) assert.ok(['server/account.js', 'server/profiles.js', 'server/verification/experience.js'].includes(w), `${w} writes "About me"`);
    // the copy is the story itself, never a summary or a model's text
    assert.match(fs.readFileSync(path.join(ROOT, 'server/verification/experience.js'), 'utf8'), /if \(patch\.story && inStep\(user\.bio, user\.story\)\) patch\.bio = patch\.story;/);
    // (server/account.js only empties it when an account is deleted)
    assert.match(fs.readFileSync(path.join(ROOT, 'server/account.js'), 'utf8'), /bio = NULL/);
  });
});
