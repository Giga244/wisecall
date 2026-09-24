const express = require('express');
const { load } = require('../db');
const { publicProfile, isListable, mentorStats } = require('../util');

const router = express.Router();

function withStats(mentor, bookings) {
  return { ...publicProfile(mentor), ...mentorStats(mentor.id, bookings) };
}

router.get('/', (req, res) => {
  const { niche, q } = req.query;
  const data = load();
  let mentors = data.users.filter(isListable);
  if (niche && niche !== 'all') {
    mentors = mentors.filter(u => u.niche === niche);
  }
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    mentors = mentors.filter(u =>
      (u.name && u.name.toLowerCase().includes(needle)) ||
      (u.roleTitle && u.roleTitle.toLowerCase().includes(needle)) ||
      (u.bio && u.bio.toLowerCase().includes(needle))
    );
  }
  res.json({ experts: mentors.map(m => withStats(m, data.bookings)) });
});

router.get('/:id', (req, res) => {
  const data = load();
  const mentor = data.users.find(u => u.id === req.params.id && isListable(u));
  if (!mentor) return res.status(404).json({ error: 'not_found' });
  res.json({ expert: withStats(mentor, data.bookings) });
});

router.get('/:id/reviews', (req, res) => {
  const data = load();
  const mentor = data.users.find(u => u.id === req.params.id && isListable(u));
  if (!mentor) return res.status(404).json({ error: 'not_found' });

  const reviews = data.bookings
    .filter(b => b.mentorId === mentor.id && typeof b.rating === 'number')
    .map(b => {
      const seeker = data.users.find(u => u.id === b.seekerId);
      const name = seeker ? seeker.name : 'Anonymous';
      const parts = name.trim().split(' ');
      const displayName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
      return { rating: b.rating, review: b.review, reviewedAt: b.reviewedAt, reviewerName: displayName };
    })
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt));

  res.json({ reviews });
});

module.exports = router;
