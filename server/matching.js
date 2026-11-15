// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md, stage 1): a student answers a few questions and sees the mentors who fit best,
// each with a short reason that is true. Rules only, no AI; the weights are in server/matchConfig.js.
//
//   who takes part   approved, ID-verified, listed mentors (the same rule as Browse: models.listableSql) of the chosen category (their
//                    main field or an extra one), whose profile an admin has not hidden. Nobody else, ever: there are no placeholder mentors.
//   the points       each shared direction, each shared starting-point tag, a start or way of working that fits where the student is now,
//                    "My path" filled in, a sample answer.
//   ties             the mentor with fewer questions waiting for an answer first, then by chance (so the same mentor is not always first).
//   the reason       built only from what matched (why: { tags, directions, stage, field }): the page words it, and can never say more.
//   the free text    checked by the contact filter, never scored in this stage, never shown to mentors or admins. A signed-in person's
//                    answers are kept (the text for 30 days); a visitor leaves only the count of the match.
const { query } = require('./db');
const config = require('./matchConfig');
const categories = require('./categories');
const mentorStory = require('./mentorStory');
const textSafety = require('./textSafety');

const STAGES = Object.keys(config.stageFit);

class MatchError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

// What the student sent, checked. -> { fieldId, directions, stage, startTags, worry }
function parse(input) {
  const b = input || {};
  if (typeof b.fieldId !== 'string' || !categories.isField(b.fieldId)) throw new MatchError('invalid_field', { field: 'fieldId' });
  if (!STAGES.includes(b.stage)) throw new MatchError('invalid_stage', { field: 'stage' });
  const list = (v) => (v === undefined || v === null ? [] : v);
  const directions = list(b.directions);
  if (!Array.isArray(directions) || directions.some((d) => typeof d !== 'string' || !categories.isChip(d) || categories.fieldOfChip(d) !== b.fieldId)) throw new MatchError('invalid_directions', { field: 'directions' });
  if (new Set(directions).size > config.directionsMax) throw new MatchError('too_many_directions', { field: 'directions' });
  const startTags = list(b.startTags);
  if (!Array.isArray(startTags) || startTags.some((x) => !config.studentTags.includes(x))) throw new MatchError('invalid_start_tags', { field: 'startTags' });
  if (new Set(startTags).size > config.startTagsMax) throw new MatchError('too_many_start_tags', { field: 'startTags' });
  if (b.worry !== undefined && b.worry !== null && typeof b.worry !== 'string') throw new MatchError('invalid_worry', { field: 'worry' });
  const worry = textSafety.cleanText(b.worry || '');
  if ([...worry].length > config.worryMax) throw new MatchError('worry_too_long', { field: 'worry' });
  // (the student is told not to write a phone number or an address: the same filter as a question)
  if (worry && textSafety.findBlockedContact(worry, { strict: true }).length) throw new MatchError('contact_details', { field: 'worry' });
  return { fieldId: b.fieldId, directions: [...new Set(directions)], stage: b.stage, startTags: config.studentTags.filter((id) => startTags.includes(id)), worry: worry || null };
}

// One mentor's points for one student, and what they are made of. -> { score, why }
// why holds only what really matched: the page builds "Why them" from it, so it cannot claim anything else.
function score(student, mentor) {
  const P = config.points;
  const tags = (mentor.startTags || []).filter((id) => student.startTags.includes(id));
  const directions = (mentor.directions || []).filter((id) => student.directions.includes(id));
  const fit = config.stageFit[student.stage] || { tags: [], kinds: [] };
  const fitTags = fit.tags.filter((id) => (mentor.startTags || []).includes(id));
  // (a sign the student did not already name themselves: said in the reason; one they share is said by "like you")
  const fitTag = fitTags.find((id) => !tags.includes(id)) || null;
  const fitKind = fit.kinds.includes(mentor.practiceKind) ? mentor.practiceKind : null;
  const hasPath = mentorStory.pathComplete(mentor);
  const hasSample = mentorStory.hasSample(mentor);
  const total = directions.length * P.direction + tags.length * P.startTag + (fitTags.length || fitKind ? P.stageFit : 0) + (hasPath ? P.hasPath : 0) + (hasSample ? P.hasSample : 0);
  return {
    score: total,
    why: {
      tags, directions,
      // (one sign of the fit is enough for the reason)
      stage: fitTag ? { tag: fitTag } : (fitKind ? { kind: fitKind } : null),
      field: student.fieldId
    }
  };
}

// The order: points, then fewer questions waiting, then chance. `random` can be given by a test.
function rank(student, mentors, { open = {}, random = Math.random } = {}) {
  return mentors
    .map((m) => ({ mentor: m, ...score(student, m), open: open[m.id] || 0, luck: random() }))
    .sort((a, b) => b.score - a.score || a.open - b.open || a.luck - b.luck);
}

// The mentors of a category who may be shown (listed, and not hidden by an admin).
async function candidates(fieldId) {
  const { listableSql, userColumnsSql, userFromRow } = require('./models');
  const { rows } = await query(`SELECT ${userColumnsSql()} FROM users WHERE ${listableSql()} AND (field_id = $1 OR $1 = ANY(extra_fields)) LIMIT 500`, [fieldId]);
  const users = rows.map(userFromRow);
  const summaries = await require('./profileSections').publicSummaries(users);
  return users.filter((u) => summaries[u.id]).map((u) => ({ user: u, showAbout: Boolean(summaries[u.id].showAbout) }));
}
async function openQuestions(ids) {
  if (!ids.length) return {};
  const { rows } = await query(`SELECT mentor_id, count(*)::int AS n FROM bookings WHERE status = 'paid' AND mentor_id = ANY($1::uuid[]) GROUP BY mentor_id`, [ids]);
  return Object.fromEntries(rows.map((r) => [r.mentor_id, r.n]));
}

// A match: the best mentors of the category for this student, as cards. viewer: the signed-in person, or null.
// -> { mentors: [{ ...card, why }], inField: how many mentors the category has, fieldId }
async function run(input, viewer) {
  const student = parse(input);
  const found = await candidates(student.fieldId);
  // (a mentor does not match themselves)
  const pool = found.filter((c) => !(viewer && viewer.id === c.user.id));
  // (the path and the sample answer count only when everyone may see them: the texts follow "About")
  const seen = pool.map((c) => (c.showAbout ? c.user : { ...c.user, pathStart: null, pathHow: null, pathNow: null, sampleQuestion: null, sampleReply: null }));
  const about = new Map(pool.map((c) => [c.user.id, c.showAbout]));
  const ranked = rank(student, seen, { open: await openQuestions(seen.map((u) => u.id)) }).slice(0, config.top);
  const { publicProfile } = require('./util');
  const mentors = ranked.map(({ mentor, why }) => {
    const p = publicProfile(mentor);
    return { id: p.id, username: p.username, name: p.name, roleTitle: p.roleTitle, niche: p.niche, customNiche: p.customNiche, fieldId: p.fieldId, color: p.color, photoUrl: p.photoUrl, price: p.price,
      trust: mentorStory.cardView(mentor, { showAbout: about.get(mentor.id) }), why };
  });
  await remember(student, mentors.length, viewer);
  return { fieldId: student.fieldId, mentors, inField: pool.length };
}

// The count of the match (always), and a signed-in person's answers with it (never a visitor's).
async function remember(student, results, viewer) {
  if (viewer && viewer.id) {
    await query(`INSERT INTO match_runs (field_id, results, user_id, stage, start_tags, directions, worry) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [student.fieldId, results, viewer.id, student.stage, student.startTags, student.directions, student.worry]);
  } else {
    await query(`INSERT INTO match_runs (field_id, results) VALUES ($1, $2)`, [student.fieldId, results]);
  }
}

// The free text is kept for 30 days, then emptied (the rest of a signed-in person's answers stays). -> how many were emptied
async function purgeOld() {
  const r = await query(`UPDATE match_runs SET worry = NULL WHERE worry IS NOT NULL AND created_at < now() - make_interval(days => $1)`, [config.worryDays]);
  return r.rowCount;
}

// For the admins: counts only (never the free text, never who asked). -> { total, month, byResults: {0..3}, fields: [{ fieldId, runs, short, mentors }] }
// short: matches in that category that found fewer than the full number of mentors (where more mentors are needed).
async function stats() {
  const [totals, byResults, byField, counts] = await Promise.all([
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month FROM match_runs`),
    query(`SELECT results, count(*)::int AS n FROM match_runs GROUP BY results`),
    query(`SELECT field_id, count(*)::int AS runs, count(*) FILTER (WHERE results < $1)::int AS short, count(*) FILTER (WHERE results = 0)::int AS none
             FROM match_runs GROUP BY field_id ORDER BY runs DESC, field_id`, [config.top]),
    categories.counts()
  ]);
  const dist = Object.fromEntries(Array.from({ length: config.top + 1 }, (x, i) => [i, 0]));
  for (const r of byResults.rows) dist[Math.min(r.results, config.top)] = (dist[Math.min(r.results, config.top)] || 0) + r.n;
  return {
    total: totals.rows[0].total, month: totals.rows[0].month, top: config.top, byResults: dist,
    fields: byField.rows.map((r) => ({ fieldId: r.field_id, runs: r.runs, short: r.short, none: r.none, mentors: counts.fields[r.field_id] || 0 }))
  };
}

module.exports = { MatchError, STAGES, parse, score, rank, run, purgeOld, stats, config };
