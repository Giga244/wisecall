const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { meProfile, asyncHandler } = require('../util');
const { userFromRow, getUserById, updateUser, mentorStatsFor } = require('../models');
const config = require('../config');

const router = express.Router();

const requireAdmin = asyncHandler(async (req, res, next) => {
  if (config.ADMIN_EMAILS.length === 0) {
    return res.status(400).json({ error: 'admin_not_configured', message: 'Set ADMIN_EMAILS in .env to enable the admin panel.' });
  }
  const user = await getUserById(req.userToken.id);
  if (!user || !config.ADMIN_EMAILS.includes(user.email.toLowerCase())) return res.status(403).json({ error: 'not_admin' });
  req.adminUser = user;
  next();
});

router.get('/mentors', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = `role IN ('mentor', 'both')`;
  if (status) { params.push(String(status)); where += ` AND verification_status = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  const mentors = rows.map(userFromRow);
  const stats = await mentorStatsFor(mentors.map((m) => m.id));
  res.json({ mentors: mentors.map((m) => ({ ...meProfile(m), ...stats[m.id] })) });
}));

router.post('/mentors/:id/review', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { approve, note, checks } = req.body || {};
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'missing_approve' });
  const c = checks || {};
  if (approve && !(c.identity && c.credential && c.sample)) return res.status(400).json({ error: 'checklist_incomplete' });

  const mentor = await getUserById(req.params.id);
  if (!mentor) return res.status(404).json({ error: 'not_found' });

  const updated = await updateUser(mentor.id, {
    verificationStatus: approve ? 'verified' : 'rejected',
    verificationNote: note ? String(note).slice(0, 1000) : null,
    verificationChecks: approve ? { identity: true, credential: true, sample: true, at: new Date().toISOString() } : null
  });
  res.json({ mentor: meProfile(updated) });
}));

module.exports = router;
