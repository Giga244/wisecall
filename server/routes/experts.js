const express = require('express');
const { query } = require('../db');
const { userFromRow, listableSql, mentorStatsFor, getUserById } = require('../models');
const { publicProfile, isListable, asyncHandler } = require('../util');
const { badgesFor } = require('../verification/badges');
const { requireAuth, optionalAuth } = require('../auth');
const reports = require('../reports');
const ratings = require('../ratings');

const router = express.Router();

async function withStats(users) {
  const ids = users.map((u) => u.id);
  const [stats, badges, week] = await Promise.all([mentorStatsFor(ids), badgesFor(ids), require('../freeQuestions').weekFor(users)]);
  // (a mentor who answers for free and has had this week's free questions: "Free questions are full this week")
  return users.map((u) => ({ ...publicProfile(u), ...stats[u.id], badges: badges[u.id], ...(week[u.id] ? { freeFull: week[u.id].full } : {}) }));
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// The About text (bio) follows the About section's visibility, as on the profile page (server/profileSections.js sees): everyone sees it
// unless the mentor chose "signed in" or "only me", an admin hid the section, or an admin hid the whole profile (docs/security-audit C5).
// The search matches it only when everyone may see it (listed experts are mentors: no choice means "everyone").
const ABOUT_PUBLIC_SQL = `NOT EXISTS (SELECT 1 FROM profile_settings ps WHERE ps.user_id = users.id
  AND (ps.hidden_at IS NOT NULL OR ps.admin_hidden ? 'about' OR ps.visibility->>'about' IN ('signed_in', 'only_me')))`;
async function aboutFor(owner, viewer) {
  const ps = require('../profileSections');
  const settings = await ps.settingsOf(owner.id);
  if (settings.hidden_at && !(viewer && viewer.id === owner.id) && !require('../adminAuth').isVerifiedAdminViewer(viewer)) return null;
  return ps.sees(owner, settings, 'about', viewer) ? owner.bio : null;
}

router.get('/', asyncHandler(async (req, res) => {
  const { niche, q, field, chip, country, years, price, start } = req.query;
  const categories = require('../categories');
  const search = require('../categorySearch');
  const params = [];
  let where = listableSql();
  if (req.query.free === '1' || price === 'free') where += ' AND price = 0'; // ("Free": mentors who answer for free)
  if (price === 'paid') where += ' AND price > 0';
  // (a field, a chip in it, a country, the years of experience: all optional)
  if (typeof field === 'string' && categories.isField(field)) { params.push(field); where += ` AND (field_id = $${params.length} OR $${params.length} = ANY(extra_fields))`; }
  if (typeof chip === 'string' && categories.isChip(chip)) { params.push(chip); where += ` AND $${params.length} = ANY(directions)`; }
  if (typeof country === 'string' && categories.isCountry(country)) { params.push(country); where += ` AND country = $${params.length}`; }
  // ("Where they started": a starting-point tag the mentor set themselves, server/mentorStory.js)
  // (several, separated by commas: a mentor with any of them)
  const starts = typeof start === 'string' ? [...new Set(start.split(',').filter((x) => require('../mentorStory').isTag(x)))] : [];
  if (starts.length) { params.push(starts); where += ` AND start_tags && $${params.length}::text[]`; }
  const band = { '1-2': 'years_experience <= 2', '3-5': 'years_experience BETWEEN 3 AND 5', '6-10': 'years_experience BETWEEN 6 AND 10', '10+': 'years_experience > 10' }[String(years)];
  if (band) where += ` AND ${band}`;
  if (niche && niche !== 'all') { params.push(String(niche)); where += ` AND (niche = $${params.length} OR $${params.length} = ANY(extra_niches))`; } // (the main category or an extra one)
  const term = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  let users;
  if (term) {
    // What the plain text match finds (names, titles, the About text...) and what the one search box adds: fields, chips, countries, specializations and universities,
    // in both languages and with typos (server/categorySearch.js).
    const textParams = [...params, '%' + escapeLike(term) + '%'];
    const p = `$${textParams.length}`;
    const textWhere = `${where} AND (name ILIKE ${p} OR role_title ILIKE ${p}
                OR (bio ILIKE ${p} AND ${ABOUT_PUBLIC_SQL}) OR custom_niche ILIKE ${p} OR array_to_string(specialty_tags, ' ') ILIKE ${p}
                OR EXISTS (SELECT 1 FROM niches n WHERE (n.key = users.niche OR n.key = ANY(users.extra_niches)) AND (n.name_en ILIKE ${p} OR n.name_ka ILIKE ${p}))
                OR EXISTS (SELECT 1 FROM profile_settings ps WHERE ps.user_id = users.id AND ps.hidden_at IS NULL AND ps.search_text ILIKE ${p}))`;
    const [byText, everyone] = await Promise.all([
      query(`SELECT id FROM users WHERE ${textWhere} LIMIT 1000`, textParams),
      query(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 2000`, params)
    ]);
    const found = new Set(byText.rows.map((r) => r.id));
    const catalog = search.matchCatalog(term);
    users = everyone.rows.map(userFromRow).filter((u) => found.has(u.id) || search.matches(term, catalog, u)).slice(0, 200);
  } else {
    users = (await query(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params)).rows.map(userFromRow);
  }
  // (headline, current position, years of experience and top skills: only what everyone may see)
  const summaries = await require('../profileSections').publicSummaries(users);
  // (a hidden profile has no summary, and so no bio)
  // (the card's line from "where I am now", its starting-point chips and "sample answer": nothing for a hidden profile)
  const byId = new Map(users.map((u) => [u.id, u]));
  const mentorStory = require('../mentorStory');
  // (the card's text is the mentor's own About: never an About that is only the copy of their path, which is personal)
  res.json({ experts: (await withStats(users)).map((e) => ({ ...e, bio: summaries[e.id] && summaries[e.id].showAbout ? (mentorStory.ownAbout(byId.get(e.id)) || null) : null, profile: summaries[e.id] || null,
    trust: summaries[e.id] ? mentorStory.cardView(byId.get(e.id), { showAbout: Boolean(summaries[e.id].showAbout) }) : null })) });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const mentor = await getUserById(req.params.id);
  if (!isListable(mentor)) return res.status(404).json({ error: 'not_found' });
  const [expert] = await withStats([mentor]);
  res.json({ expert: { ...expert, bio: await aboutFor(mentor, await require('../adminAuth').viewerFrom(req)) } });
}));

// "Report this mentor" (from a profile, or from an answer with bookingId). Signed-in users only; the
// reporter's identity is visible to admins only.
const REPORT_STATUS = { invalid_reason: 400, details_too_long: 400, invalid_booking: 400, cannot_report_self: 400, not_found: 404, already_reported: 409 };
router.post('/:id/report', requireAuth, asyncHandler(async (req, res) => {
  const reporter = await getUserById(req.userToken.id);
  if (!reporter) return res.status(401).json({ error: 'not_authenticated' });
  const b = req.body || {};
  try {
    await reports.create({ reporter, mentorId: req.params.id, bookingId: b.bookingId, reason: b.reason, details: b.details });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e instanceof reports.ReportError) return res.status(REPORT_STATUS[e.code] || 400).json({ error: e.code });
    throw e;
  }
}));

// A mentor's public reviews: the summary (average, count, tag counts) and the written reviews, newest first. Only ratings that were
// revealed (both people rated, or 7 days after the answer) and not hidden by an admin are counted or shown.
router.get('/:id/reviews', asyncHandler(async (req, res) => {
  const mentor = await getUserById(req.params.id);
  if (!isListable(mentor)) return res.status(404).json({ error: 'not_found' });
  const [summary, reviews] = await Promise.all([ratings.mentorSummary(mentor.id), ratings.reviewsForMentor(mentor.id)]);
  res.json({ summary, reviews });
}));
module.exports = router;
