const express = require('express');
const { load } = require('../db');
const { isListable } = require('../util');

const router = express.Router();

router.get('/', (req, res) => {
  const data = load();
  const mentors = data.users.filter(isListable);
  const answered = data.bookings.filter(b => b.status === 'answered');
  const niches = new Set(mentors.map(m => m.niche).filter(Boolean));

  res.json({
    mentorCount: mentors.length,
    answeredCount: answered.length,
    nicheCount: niches.size
  });
});

module.exports = router;
