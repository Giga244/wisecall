const express = require('express');
const { query } = require('../db');
const { userFromRow, listableSql, mentorStatsFor, getUserById } = require('../models');
const { publicProfile, isListable, asyncHandler } = require('../util');
const { badgesFor } = require('../verification/badges');
const { requireAuth } = require('../auth');
const reports = require('../reports');
const ratings = require('../ratings');

const router = express.Router();

async function withStats(users) {
  const ids = users.map((u) => u.id);
  const [stats, badges] = await Promise.all([mentorStatsFor(ids), badgesFor(ids)]);
  return users.map((u) => ({ ...publicProfile(u), ...stats[u.id], badges: badges[u.id] }));
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

router.get('/', asyncHandler(async (req, res) => {
  const { niche, q } = req.query;
  const params = [];
  let where = listableSql();
  if (niche && niche !== 'all') { params.push(String(niche)); where += ` AND niche = $${params.length}`; }
  if (q && String(q).trim()) {
    params.push('%' + escapeLike(String(q).trim().slice(0, 100)) + '%');
    where += ` AND (name ILIKE $${params.length} OR role_title ILIKE $${params.length} OR bio ILIKE $${params.length} OR custom_niche ILIKE $${params.length})`;
  }
  const { rows } = await query(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.json({ experts: await withStats(rows.map(userFromRow)) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const mentor = await getUserById(req.params.id);
  if (!isListable(mentor)) return res.status(404).json({ error: 'not_found' });
  const [expert] = await withStats([mentor]);
  res.json({ expert });
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
