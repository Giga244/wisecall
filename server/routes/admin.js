const express = require('express');
const { load, withDb } = require('../db');
const { requireAuth } = require('../auth');
const { meProfile, mentorStats } = require('../util');
const config = require('../config');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!config.ADMIN_EMAIL) {
    return res.status(400).json({ error: 'admin_not_configured', message: 'Set ADMIN_EMAIL in .env to enable the admin review panel.' });
  }
  const data = load();
  const user = data.users.find(u => u.id === req.userToken.id);
  if (!user || user.email !== config.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'not_admin' });
  }
  next();
}

router.get('/mentors', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.query;
  const data = load();
  let mentors = data.users.filter(u => u.role === 'mentor' || u.role === 'both');
  if (status) {
    mentors = mentors.filter(u => (u.verificationStatus || 'none') === status);
  }
  mentors.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ mentors: mentors.map(m => ({ ...meProfile(m), ...mentorStats(m.id, data.bookings) })) });
});

router.post('/mentors/:id/review', requireAuth, requireAdmin, (req, res) => {
  const { approve, note, checks } = req.body || {};
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'missing_approve' });
  const c = checks || {};
  if (approve && !(c.identity && c.credential && c.sample)) return res.status(400).json({ error: 'checklist_incomplete' });

  const result = withDb(data => {
    const mentor = data.users.find(u => u.id === req.params.id);
    if (!mentor) return { error: 'not_found' };
    mentor.verificationStatus = approve ? 'verified' : 'rejected';
    mentor.verificationNote = note ? String(note).slice(0, 1000) : null;
    mentor.verificationChecks = approve ? { identity: true, credential: true, sample: true, at: new Date().toISOString() } : null;
    return { mentor };
  });

  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ mentor: meProfile(result.mentor) });
});

module.exports = router;
