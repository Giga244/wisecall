#!/usr/bin/env node
// One-off, run by the owner in the Render shell (docs/CLAUDE-CODE-CARD-ABOUT.md). For one mentor, by the username in their profile address:
//
//   node scripts/oneoff/2026-11-21-card-and-stop.js iraklilaitadze1972            -> shows his row, changes nothing
//   node scripts/oneoff/2026-11-21-card-and-stop.js iraklilaitadze1972 --apply    -> adds the one full stop in "სად დავიწყე"
//
// Shows: the About (bio), the three "ჩემი გზა" parts, "რაში დაგეხმარები", the headline and role title, whether a story sentence sits in any of
// the texts a card could read, and what his Browse card shows after this deploy.
// --apply changes ONE thing: in path_start, "გავრცელებული სწორედ აქ" becomes "გავრცელებული. სწორედ აქ" (only if it is there exactly once).
// Nothing else, no other mentor, no email.
process.env.WISECALL_NO_EXIT = process.env.WISECALL_NO_EXIT || '1';
const db = require('../../server/db');
const { userFromRow } = require('../../server/models');
const mentorStory = require('../../server/mentorStory');

const FROM = 'გავრცელებული სწორედ აქ';
const TO = 'გავრცელებული. სწორედ აქ';
const STORY_WORDS = 'მყავს ცოლი და ოთხი შვილი';
const len = (s) => [...String(s || '')].length;
const block = (label, v) => console.log(`\n${label} (${len(v)} characters):\n  ${v === null || v === undefined || v === '' ? '(empty)' : String(v).split('\n').join('\n  ')}`);

(async () => {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  const apply = process.argv.includes('--apply');
  if (!username) { console.error('Usage: node scripts/oneoff/2026-11-21-card-and-stop.js <username> [--apply]'); process.exitCode = 1; return; }
  const { rows } = await db.query('SELECT * FROM users WHERE lower(username) = $1', [username]);
  if (rows.length !== 1) { console.error(`${rows.length} accounts have the username ${username}.`); process.exitCode = 1; return; }
  const u = userFromRow(rows[0]);
  console.log(`Account: ${u.name} (id ${u.id}), /ka/u/${u.username}, role ${u.role}, verification ${u.verificationStatus}`);
  block('roleTitle', u.roleTitle);
  block('headline', u.headline);
  block('About / შესახებ (users.bio)', u.bio);
  block('სად დავიწყე (path_start)', u.pathStart);
  block('როგორ გავუმკლავდი (path_how)', u.pathHow);
  block('სად ვარ ახლა (path_now)', u.pathNow);
  console.log(`\nრაში დაგეხმარები (help_points): ${JSON.stringify(u.helpPoints || [])}`);
  block('application story (users.story, for the admin only)', u.story);

  // Where the story sentence is, among what a card could read.
  const where = [['roleTitle', u.roleTitle], ['headline', u.headline], ['bio', u.bio], ['path_now', u.pathNow]].filter(([, v]) => String(v || '').includes(STORY_WORDS)).map(([k]) => k);
  console.log(`\n"${STORY_WORDS}" is in: ${where.join(', ') || 'none of them'}`);
  console.log(`The About is only a copy of the path: ${mentorStory.aboutIsPathCopy(u) ? 'YES' : 'no'}`);
  const about = mentorStory.ownAbout(u);
  const card = about ? about : (u.helpPoints || []).join(' · ');
  console.log(`Before this deploy the card showed: ${mentorStory.pathComplete(u) ? 'the first sentence of path_now (the cause)' : 'the About'}`);
  console.log(`After it the card shows (cut to 2 lines on the page): ${card ? card.slice(0, 160) + (len(card) > 160 ? '…' : '') : '(nothing: the headline only)'}`);

  // The full stop.
  const count = String(u.pathStart || '').split(FROM).length - 1;
  console.log(`\n"${FROM}" in path_start: ${count} time(s)`);
  if (count !== 1) { console.log(count ? 'More than once: STOPPED, nothing changed.' : 'Not there (already fixed?): nothing to change.'); return; }
  const next = u.pathStart.replace(FROM, TO);
  console.log(`  old: …${u.pathStart.slice(Math.max(0, u.pathStart.indexOf(FROM) - 40), u.pathStart.indexOf(FROM) + FROM.length + 30)}…`);
  console.log(`  new: …${next.slice(Math.max(0, next.indexOf(TO) - 40), next.indexOf(TO) + TO.length + 30)}…`);
  if (!apply) { console.log('\nNothing changed (no --apply).'); return; }
  const r = await db.query('UPDATE users SET path_start = $2 WHERE id = $1 AND path_start = $3', [u.id, next, u.pathStart]);
  if (r.rowCount !== 1) { console.log('\nThe row changed meanwhile: nothing written. Run it again.'); process.exitCode = 1; return; }
  await db.query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, NULL, 'owner (script)', 'story_typo_fixed', $2)`,
    [u.id, 'A full stop added in "სად დავიწყე" after "გავრცელებული" (2026-11-21-card-and-stop.js).']);
  const { rows: [after] } = await db.query('SELECT path_start FROM users WHERE id = $1', [u.id]);
  block('\nDone. path_start now', after.path_start);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close && db.close());
