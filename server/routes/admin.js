const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { meProfile, asyncHandler } = require('../util');
const { userFromRow, bookingFromRow, getUserById, updateUser, mentorStatsFor } = require('../models');
const config = require('../config');
const payments = require('../payments');
const notify = require('../notify');

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
  if (note !== undefined && note !== null && typeof note !== 'string') return res.status(400).json({ error: 'invalid_note' });
  const c = checks && typeof checks === 'object' ? checks : {};
  const reason = note ? note.trim().slice(0, 1000) : '';
  if (!approve && !reason) return res.status(400).json({ error: 'reason_required' });
  if (approve && !(c.identity && c.credential && c.sample)) return res.status(400).json({ error: 'checklist_incomplete' });

  const mentor = await getUserById(req.params.id);
  if (!mentor) return res.status(404).json({ error: 'not_found' });

  const updated = await updateUser(mentor.id, {
    verificationStatus: approve ? 'verified' : 'rejected',
    verificationNote: reason || null,
    verificationChecks: approve ? { identity: true, credential: true, sample: true, at: new Date().toISOString() } : null
  });
  notify.notifyMentorDecision(updated, approve, reason || null);
  res.json({ mentor: meProfile(updated) });
}));

const BOOKING_STATUSES = ['pending_payment', 'paid', 'answered', 'refund_pending', 'refunded', 'expired'];

// All bookings, newest first, with both people's names so support can see what happened.
router.get('/bookings', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = 'TRUE';
  if (status) {
    if (!BOOKING_STATUSES.includes(String(status))) return res.status(400).json({ error: 'invalid_status' });
    params.push(String(status)); where = `b.status = $1`;
  }
  const { rows } = await query(
    `SELECT b.*, s.name AS seeker_name, s.email AS seeker_email, m.name AS mentor_name, m.email AS mentor_email
       FROM bookings b JOIN users s ON s.id = b.seeker_id JOIN users m ON m.id = b.mentor_id
      WHERE ${where} ORDER BY b.created_at DESC LIMIT 200`, params);
  res.json({
    bookings: rows.map((r) => ({
      ...bookingFromRow(r),
      seekerName: r.seeker_name, seekerEmail: r.seeker_email, mentorName: r.mentor_name, mentorEmail: r.mentor_email
    }))
  });
}));

router.post('/bookings/:id/refund', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try {
    const booking = await payments.refundBooking(req.params.id, 'admin');
    console.log(`[admin] ${req.adminUser.email} refunded booking ${booking.id}`);
    res.json({ booking });
  } catch (e) {
    if (e instanceof payments.PaymentError) {
      return res.status(e.code === 'not_found' ? 404 : (e.code === 'refund_failed' ? 502 : 409)).json({ error: e.code, message: e.code === 'refund_failed' ? e.message : undefined });
    }
    throw e;
  }
}));
module.exports = router;
