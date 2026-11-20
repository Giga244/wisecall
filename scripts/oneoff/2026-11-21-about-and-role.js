#!/usr/bin/env node
// One-off, run by the owner in the Render shell (docs/CLAUDE-CODE-CARD-ABOUT.md):
//
//   node scripts/oneoff/2026-11-21-about-and-role.js            -> shows the old and new values and the list; changes nothing
//   node scripts/oneoff/2026-11-21-about-and-role.js --apply    -> makes the two changes below, then shows the list again
//
// 1. lasha-gogiberidze-9997: his About ("შესახებ", users.bio), which is empty, becomes his own sentence from his story, exactly. Only that
//    field; his story is not touched. Done only while the About is still empty.
// 2. iraklilaitadze1972: "FInance, International Relations and Politics" -> "Finance, …" in the one field that holds it (the card's role
//    line: the custom field name). Stops if it is in more than one field, or in none.
// 3. Lists every other approved mentor whose card has no text: no About everyone may see and no "რაში დაგეხმარები". Changes nothing there.
// No email to anybody. Each change writes an audit row.
process.env.WISECALL_NO_EXIT = process.env.WISECALL_NO_EXIT || '1';
const db = require('../../server/db');
const { userFromRow } = require('../../server/models');
const mentorStory = require('../../server/mentorStory');

const ABOUT_USER = 'lasha-gogiberidze-9997';
const ABOUT = 'I am one of the top ranked lawyers in Georgia with the longest tenure of being the top ranked lawyer by an international directory.';
const ROLE_USER = 'iraklilaitadze1972';
const ROLE_FROM = 'FInance, International Relations and Politics';
const ROLE_TO = 'Finance, International Relations and Politics';
const show = (v) => (v === null || v === undefined ? 'NULL' : JSON.stringify(v));
const audit = (id, action, reason) => db.query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, NULL, 'owner (script)', $2, $3)`, [id, action, reason]);

async function byUsername(name) {
  const { rows } = await db.query('SELECT * FROM users WHERE lower(username) = $1', [name]);
  // (not found, or not one: that part is skipped and said so; the other part still runs)
  if (rows.length !== 1) { console.log(`   ${rows.length} accounts have the username ${name}: nothing changed for it.`); return {}; }
  return rows[0];
}

async function emptyCards() {
  const { rows } = await db.query(`SELECT * FROM users WHERE role IN ('mentor', 'both') AND verification_status = 'verified' ORDER BY created_at`);
  const users = rows.map(userFromRow);
  const summaries = await require('../../server/profileSections').publicSummaries(users);
  return users.filter((u) => {
    const s = summaries[u.id];
    const seen = Boolean(s && s.showAbout);
    return !(seen && mentorStory.ownAbout(u).trim()) && !(seen && (u.helpPoints || []).length);
  }).map((u) => {
    const s = summaries[u.id];
    const why = !s ? 'profile hidden' : !s.showAbout ? 'About not visible to everyone' : (u.bio && mentorStory.aboutIsPathCopy(u) ? 'About is only a copy of "ჩემი გზა"' : 'no About, no "რაში დაგეხმარები"');
    return `${u.name} — /ka/u/${u.username} — ${why}`;
  });
}

(async () => {
  const apply = process.argv.includes('--apply');

  // ---- 1. Lasha's About ----
  const l = await byUsername(ABOUT_USER);
  const story = [l.path_start, l.path_how, l.path_now, l.story].filter(Boolean).join('\n');
  console.log(`1. ${l.name} (/ka/u/${l.username}), About (users.bio)`);
  console.log(`   old: ${show(l.bio)}`);
  console.log(`   new: ${show(ABOUT)}  (${[...ABOUT].length} characters)`);
  console.log(`   the sentence is in his story: ${story.includes(ABOUT) ? 'yes, word for word' : 'NOT word for word (it is set as given anyway)'}`);
  const aboutOk = Boolean(l.id) && !String(l.bio || '').trim();
  if (l.id && !aboutOk) console.log('   STOPPED for this one: his About is not empty any more. Nothing changed.');

  // ---- 2. Irakli's role line ----
  const r = await byUsername(ROLE_USER);
  const hits = Object.entries(r).filter(([, v]) => (typeof v === 'string' && v.includes(ROLE_FROM)) || (Array.isArray(v) && v.some((x) => typeof x === 'string' && x.includes(ROLE_FROM))));
  console.log(`\n2. ${r.name || ROLE_USER} (/ka/u/${r.username || ROLE_USER}), "${ROLE_FROM}" is in: ${hits.map(([k]) => k).join(', ') || 'no field'}`);
  const roleOk = Boolean(r.id) && hits.length === 1 && typeof hits[0][1] === 'string';
  if (roleOk) {
    const [col, oldV] = hits[0];
    console.log(`   ${col} old: ${show(oldV)}`);
    console.log(`   ${col} new: ${show(oldV.replace(ROLE_FROM, ROLE_TO))}`);
  } else console.log(hits.length ? '   STOPPED for this one: more than one field (or a list) holds it. Nothing changed.' : '   Nothing to change (already fixed?).');

  if (apply) {
    if (aboutOk) {
      const u = await db.query(`UPDATE users SET bio = $2 WHERE id = $1 AND COALESCE(btrim(bio), '') = ''`, [l.id, ABOUT]);
      if (u.rowCount === 1) { await audit(l.id, 'about_set_by_admin', 'About set to his own sentence from his story (2026-11-21-about-and-role.js).'); console.log('\n   1: done.'); }
      else console.log('\n   1: his About changed meanwhile: nothing written.');
    }
    if (roleOk) {
      const [col, oldV] = hits[0];
      // (the column name comes from his own row, not from anyone's input)
      const u = await db.query(`UPDATE users SET ${'"' + col.replace(/"/g, '') + '"'} = $2 WHERE id = $1 AND ${'"' + col.replace(/"/g, '') + '"'} = $3`, [r.id, oldV.replace(ROLE_FROM, ROLE_TO), oldV]);
      if (u.rowCount === 1) { await audit(r.id, 'role_typo_fixed', `${col}: "${ROLE_FROM}" -> "${ROLE_TO}" (2026-11-21-about-and-role.js).`); console.log(`   2: done (${col}).`); }
      else console.log('   2: the field changed meanwhile: nothing written.');
    }
    if (l.id) { const { rows: [a] } = await db.query('SELECT bio FROM users WHERE id = $1', [l.id]); console.log(`\n   now: ${ABOUT_USER} bio = ${show(a.bio)}`); }
    if (roleOk) { const { rows: [b] } = await db.query(`SELECT "${hits[0][0].replace(/"/g, '')}" AS v FROM users WHERE id = $1`, [r.id]); console.log(`   now: ${ROLE_USER} ${hits[0][0]} = ${show(b.v)}`); }
  } else console.log('\nNothing changed (no --apply).');

  // ---- 3. The list ----
  const list = await emptyCards();
  console.log(`\n3. Approved mentors whose card has no text${apply ? ' (after the changes)' : ''}: ${list.length}`);
  list.forEach((x) => console.log(`   - ${x}`));
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close && db.close());
