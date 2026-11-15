// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md): POST /api/match with the student's answers -> the mentors who fit, each with what
// matched. No account is needed; a signed-in person's answers are kept with the match (server/matching.js).
const express = require('express');
const { optionalAuth } = require('../auth');
const { asyncHandler } = require('../util');
const { getUserById } = require('../models');
const matching = require('../matching');

const router = express.Router();

router.post('/', optionalAuth, asyncHandler(async (req, res) => {
  const viewer = req.userToken ? await getUserById(req.userToken.id) : null;
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await matching.run(req.body || {}, viewer));
  } catch (e) {
    if (e instanceof matching.MatchError) return res.status(400).json({ error: e.code, ...(e.field ? { field: e.field } : {}) });
    throw e;
  }
}));

module.exports = router;
