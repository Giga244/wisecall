// The 16 fields and their chips for the pages, with how many listed mentors each has; what a search word names; the universities mentors wrote (server/categories.js).
const express = require('express');
const { asyncHandler } = require('../util');
const categories = require('../categories');
const search = require('../categorySearch');
const { query } = require('../db');
const { listableSql } = require('../models');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(categories.forClient(await categories.counts()));
}));

// The fields and chips the words name (the chips the box offers while a student types), with their counts.
router.get('/search', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
  const m = search.matchCatalog(q);
  const n = await categories.counts();
  res.json({
    fields: m.fields.map((id) => ({ id, ka: categories.FIELD.get(id).ka, en: categories.FIELD.get(id).en, count: n.fields[id] || 0 })),
    chips: m.chips.map((id) => ({ id, field: categories.fieldOfChip(id), ka: categories.CHIP.get(id).ka, en: categories.CHIP.get(id).en, count: n.chips[id] || 0 })),
    countries: m.countries
  });
}));

// For the mentor's "where did you study": what others wrote, and the universities we know.
router.get('/universities', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT university, count(*)::int AS n FROM users WHERE university IS NOT NULL AND ${listableSql()} GROUP BY 1 ORDER BY n DESC, 1 LIMIT 100`);
  const known = require('../universities').LIST.flatMap((u) => [u.ka, u.en]);
  res.json({ universities: [...new Set([...rows.map((r) => r.university), ...known])] });
}));

module.exports = router;
