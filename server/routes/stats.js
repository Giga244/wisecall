const express = require('express');
const { query } = require('../db');
const { listableSql } = require('../models');
const { asyncHandler } = require('../util');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const [{ rows: [m] }, { rows: [a] }] = await Promise.all([
    query(`SELECT count(*) AS mentors, count(DISTINCT niche) AS niches FROM users WHERE ${listableSql()}`),
    query(`SELECT count(*) AS answered FROM bookings WHERE status = 'answered'`)
  ]);
  res.json({ mentorCount: Number(m.mentors), nicheCount: Number(m.niches), answeredCount: Number(a.answered) });
}));

module.exports = router;
