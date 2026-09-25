// Two-way ratings (see server/ratings.js): rate a booking, reply to a review, report a review, and the admin's review tools.
const express = require('express');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const { getBookingById, getUserById } = require('../models');
const ratings = require('../ratings');

const router = express.Router();

const STATUS = {
  forbidden: 403, not_found: 404, not_available: 404,
  not_rateable: 409, window_closed: 409, already_revealed: 409, already_replied: 409, already_reported: 409,
  invalid_rating: 400, invalid_tags: 400, invalid_field: 400, review_too_long: 400, note_too_long: 400, empty: 400, too_long: 400,
  invalid_reason: 400, details_too_long: 400, reason_required: 400, invalid_decision: 400
};
function fail(res, e) {
  if (e instanceof ratings.RatingError) return res.status(STATUS[e.code] || 400).json({ error: e.code });
  throw e;
}

// What the person may see about their booking's ratings: their own, and the other person's once it is revealed.
router.get('/bookings/:id/ratings', requireAuth, asyncHandler(async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking || (booking.seekerId !== req.userToken.id && booking.mentorId !== req.userToken.id)) return res.status(404).json({ error: 'not_found' });
  res.json({ rating: await ratings.forBooking(booking, req.userToken.id) });
}));

// Give (or, while it is still hidden, change) your rating. Asker: { stars, tags, review }. Mentor: { stars, tags, privateNote }.
router.post('/bookings/:id/ratings', requireAuth, asyncHandler(async (req, res) => {
  const booking = await getBookingById(req.params.id);
  const user = await getUserById(req.userToken.id);
  if (!booking || !user || (booking.seekerId !== user.id && booking.mentorId !== user.id)) return res.status(404).json({ error: 'not_found' });
  try {
    await ratings.submit({ booking, user, input: req.body || {} });
    res.status(201).json({ rating: await ratings.forBooking(booking, user.id) });
  } catch (e) { fail(res, e); }
}));

// The mentor answers a review, once, in public.
router.post('/ratings/:id/reply', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  try { res.status(201).json({ reply: await ratings.reply(req.params.id, user, (req.body || {}).body) }); } catch (e) { fail(res, e); }
}));

// "Report this review": goes to the admin queue.
router.post('/ratings/:id/report', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  const b = req.body || {};
  try { await ratings.report({ reporter: user, ratingId: req.params.id, reason: b.reason, details: b.details }); res.status(201).json({ ok: true }); } catch (e) { fail(res, e); }
}));

// ---- Admin: the Reviews tab -------------------------------------------------------------------------------------------
router.get('/admin/reviews', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(await ratings.adminOverview());
}));
router.post('/admin/reviews/:id/hide', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { await ratings.hide(req.params.id, req.adminUser, (req.body || {}).reason); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));
router.post('/admin/reviews/:id/unhide', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { await ratings.unhide(req.params.id, req.adminUser, (req.body || {}).reason); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));
router.post('/admin/review-reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { await ratings.resolveReport(req.params.id, req.adminUser, b.decision, b.reason); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));

module.exports = router;
