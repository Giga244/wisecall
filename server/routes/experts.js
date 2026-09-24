const express = require('express');
const { query } = require('../db');
const { userFromRow, listableSql, mentorStatsFor, getUserById } = require('../models');
const { publicProfile, isListable, asyncHandler } = require('../util');
const { badgesFor } = require('../verification/badges');

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
    where += ` AND (name ILIKE $${params.length} OR role_title ILIKE $${params.length} OR bio ILIKE $${params.length})`;
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

router.get('/:id/reviews', asyncHandler(async (req, res) => {
  const mentor = await getUserById(req.params.id);
  if (!isListable(mentor)) return res.status(404).json({ error: 'not_found' });

  const { rows } = await query(
    `SELECT b.rating, b.review, b.reviewed_at, u.name AS seeker_name
       FROM bookings b JOIN users u ON u.id = b.seeker_id
      WHERE b.mentor_id = $1 AND b.rating IS NOT NULL
      ORDER BY b.reviewed_at DESC LIMIT 100`,
    [mentor.id]
  );
  const reviews = rows.map((r) => {
    const parts = String(r.seeker_name || 'Anonymous').trim().split(/\s+/);
    const reviewerName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
    return { rating: r.rating, review: r.review, reviewedAt: r.reviewed_at, reviewerName };
  });
  res.json({ reviews });
}));

module.exports = router;
