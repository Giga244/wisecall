#!/usr/bin/env node
// One-off, run by the owner in the Render shell (docs/CLAUDE-CODE-STORY-SAVE.md): sets a mentor's "ჩემი გზა" texts exactly as given in a
// JSON file, as an admin change (saved at once and on the public profile; no review queue, no email to the mentor).
//
//   node scripts/oneoff/set-mentor-story.js scripts/oneoff/2026-11-20-story.json            -> shows what is stored now, changes nothing
//   node scripts/oneoff/set-mentor-story.js scripts/oneoff/2026-11-20-story.json --apply    -> sets the texts
//
// It stops, and changes nothing, when a text is over its field's limit (it is never cut), when the site's own checks would refuse it
// (contact details, rude words), or when a text would not be stored exactly as given (the line breaks and the words as they are).
// The JSON: { userId, pathStart, pathHow, pathNow, helpPoints: [...], addWorkLinks: [...], neverAddWorkLinks: [...] }
process.env.WISECALL_NO_EXIT = process.env.WISECALL_NO_EXIT || '1';
const fs = require('fs');
const path = require('path');
const db = require('../../server/db');
const { getUserById, updateUser } = require('../../server/models');
const mentorStory = require('../../server/mentorStory');
const { decrypt } = require('../../server/cryptoBox');

const len = (s) => [...String(s || '')].length;
const show = (label, v) => console.log(`  ${label} (${Array.isArray(v) ? `${v.length} item(s)` : `${len(v)} characters`}):\n${Array.isArray(v) ? v.map((x, i) => `    [${i + 1}] (${len(x)}) ${x}`).join('\n') || '    (none)' : `    ${v === null || v === undefined || v === '' ? '(empty)' : String(v).split('\n').join('\n    ')}`}`);

(async () => {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) { console.error('Usage: node scripts/oneoff/set-mentor-story.js <file.json> [--apply]'); process.exitCode = 1; return; }
  const want = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const user = await getUserById(want.userId);
  if (!user) { console.error(`No account has the id ${want.userId}.`); process.exitCode = 1; return; }

  // ---- What is stored now --------------------------------------------------------------------------------------------------------------------
  console.log(`\nAccount: ${user.name} <${user.email}> (id ${user.id}), role ${user.role}, verification ${user.verificationStatus}\n`);
  console.log('Stored now:');
  show('pathStart (where I started / what was hard)', user.pathStart);
  show('pathHow (how I dealt with it)', user.pathHow);
  show('pathNow (where I am now)', user.pathNow);
  show('helpPoints (what I can help with)', user.helpPoints || []);
  show('workLinks', user.workLinks || []);
  show('startTags', user.startTags || []);
  show('sampleQuestion', user.sampleQuestion);
  show('sampleReply', user.sampleReply);
  show('About (users.bio)', user.bio);
  show('application story (users.story)', user.story);
  const { rows: drafts } = await db.query('SELECT key, base, updated_at, value_enc FROM user_drafts WHERE user_id = $1 ORDER BY updated_at DESC', [user.id]);
  console.log(`\nDrafts (user_drafts): ${drafts.length}`);
  for (const d of drafts) {
    let value;
    try { value = decrypt(d.value_enc); } catch (e) { value = `(could not be read: ${e.message})`; }
    console.log(`  - key "${d.key}", saved ${new Date(d.updated_at).toISOString()}:`);
    let shown = value;
    try { shown = JSON.stringify(JSON.parse(value), null, 2); } catch (e) { /* plain text */ }
    console.log(`    ${String(shown).split('\n').join('\n    ')}`);
  }

  // ---- What it would be --------------------------------------------------------------------------------------------------------------------
  const L = mentorStory.LIMITS;
  const problems = [];
  for (const [k, max] of [['pathStart', L.pathMax], ['pathHow', L.pathMax], ['pathNow', L.pathMax]]) if (len(want[k]) > max) problems.push(`${k} is ${len(want[k])} characters; the limit is ${max}.`);
  (want.helpPoints || []).forEach((x, i) => { if (len(x) > L.pointMax) problems.push(`helpPoints[${i + 1}] is ${len(x)} characters; the limit is ${L.pointMax} per line.`); });
  if ((want.helpPoints || []).length > L.pointsMax) problems.push(`${want.helpPoints.length} help points; at most ${L.pointsMax}.`);
  const never = want.neverAddWorkLinks || [];
  const links = [...(user.workLinks || [])];
  for (const l of want.addWorkLinks || []) if (!links.includes(l) && !never.includes(l)) links.push(l);
  if (links.length > L.linksMax) problems.push(`${links.length} work links with the new one; at most ${L.linksMax}. Say which to drop.`);
  const already = (user.workLinks || []).filter((l) => never.some((n) => l.replace(/\/+$/, '') === n.replace(/\/+$/, '')));
  if (already.length) console.log(`\nNote: stored already, and on the "never add" list (not removed by this script): ${already.join(', ')}`);

  // (the site's own rules, as a save would apply them: the contact filter, rude words, all three blocks or none)
  const body = { pathStart: want.pathStart, pathHow: want.pathHow, pathNow: want.pathNow, helpPoints: want.helpPoints || [], workLinks: links };
  const parsed = problems.length ? null : mentorStory.parse(body, { draft: false, current: user });
  if (parsed && parsed.error) problems.push(`the site would refuse it: ${parsed.error} (field ${parsed.field}).`);
  // (stored exactly as given: no line break, space or word changed by the cleaning every save does)
  if (parsed && !parsed.error) {
    for (const k of ['pathStart', 'pathHow', 'pathNow']) if (parsed.patch[k] !== want[k]) problems.push(`${k} would not be stored exactly as given (the cleaning every save does changes it). Nothing was changed.`);
    (want.helpPoints || []).forEach((x, i) => { if (parsed.patch.helpPoints[i] !== x) problems.push(`helpPoints[${i + 1}] would not be stored exactly as given.`); });
  }
  if (problems.length) {
    console.log('\nSTOPPED, nothing was changed:');
    problems.forEach((p) => console.log(`  - ${p}`));
    process.exitCode = 1;
    return;
  }
  console.log('\nWould set:');
  show('pathStart', want.pathStart);
  show('pathHow', want.pathHow);
  show('pathNow', want.pathNow);
  show('helpPoints', parsed.patch.helpPoints);
  show('workLinks', parsed.patch.workLinks);
  if (!apply) { console.log('\nNothing changed (no --apply).'); return; }

  // ---- Set it: as an admin change, saved at once (a mentor's "ჩემი გზა" never waits in the review queue), and no email ----------------------
  const patch = { ...parsed.patch };
  require('../../server/verification/experience').pathToStory(user, patch); // (a complete path is the application's story too, as a save makes it)
  const updated = await updateUser(user.id, patch);
  await db.query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, NULL, 'owner (script)', 'story_set_by_admin', $2)`,
    [user.id, `"ჩემი გზა", help points and a work link set from the mentor's own texts (${path.basename(file)}): ${want.why || ''}`.slice(0, 1000)]);
  console.log('\nDone. Stored now:');
  show('pathStart', updated.pathStart);
  show('pathHow', updated.pathHow);
  show('pathNow', updated.pathNow);
  show('helpPoints', updated.helpPoints);
  show('workLinks', updated.workLinks);
  const same = ['pathStart', 'pathHow', 'pathNow'].every((k) => updated[k] === want[k]) && JSON.stringify(updated.helpPoints) === JSON.stringify(want.helpPoints);
  console.log(same ? '\nEvery text is stored exactly as given.' : '\nWARNING: a stored text differs from the one given. Send this output to Claude.');
  console.log(`Public profile: /ka/u/${updated.username}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close && db.close());
