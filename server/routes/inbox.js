// /api/inbox: conversations and notifications for the signed-in person, and (under /api/admin/support) the support inbox for admins.
// See server/inbox.js for the rules (no free messaging between strangers; one follow-up question and one reply per booking).
const express = require('express');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const { getUserById } = require('../models');
const inbox = require('../inbox');

const router = express.Router();
const adminRouter = express.Router();

const STATUS = {
  not_found: 404, read_only: 403, forbidden: 403, follow_up_used: 409, thread_closed: 409, follow_up_not_open: 409, nothing_to_reply: 409,
  already_reported: 409, too_many_open: 429, contact_details: 422, offensive: 422
};
// InboxError -> JSON reply; anything else is a real error.
const fail = (res, e) => {
  if (!(e instanceof inbox.InboxError)) throw e;
  const { code, message, stack, ...extra } = e; // (reasons, min, max)
  return res.status(STATUS[e.code] || 400).json({ error: e.code, ...extra });
};
const me = async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) res.status(401).json({ error: 'not_authenticated' });
  return user;
};

// The header badge polls this (every 30 seconds while a page is open and visible).
router.get('/unread', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ count: await inbox.unreadCount(req.userToken.id) });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [threads, unread] = await Promise.all([inbox.listThreads(req.userToken.id), inbox.unreadCount(req.userToken.id)]);
  res.json({ threads, unread, limits: inbox.LIMITS });
}));

router.get('/booking/:bookingId', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  try { res.json({ threadId: await inbox.threadIdForBooking(user, req.params.bookingId) }); } catch (e) { fail(res, e); }
}));

router.get('/threads/:id', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = await me(req, res);
  if (!user) return;
  try { res.json(await inbox.threadFor(user, req.params.id)); } catch (e) { fail(res, e); }
}));

router.post('/threads/:id/messages', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  try { res.status(201).json({ message: await inbox.postMessage(user, req.params.id, (req.body || {}).body) }); } catch (e) { fail(res, e); }
}));

router.post('/support', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  const b = req.body || {};
  try { res.status(201).json(await inbox.startSupport(user, { subject: b.subject, body: b.body })); } catch (e) { fail(res, e); }
}));

router.post('/messages/:id/report', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res);
  if (!user) return;
  const b = req.body || {};
  try { await inbox.reportMessage(user, req.params.id, { reason: b.reason, details: b.details }); res.status(201).json({ ok: true }); } catch (e) { fail(res, e); }
}));

router.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ notifications: await inbox.listNotifications(req.userToken.id) });
}));

router.post('/notifications/read', requireAuth, asyncHandler(async (req, res) => {
  await inbox.markNotificationsRead(req.userToken.id, (req.body || {}).ids);
  res.json({ count: await inbox.unreadCount(req.userToken.id) });
}));

// Settings -> Notifications: only the optional emails can be turned off.
router.get('/email-settings', requireAuth, asyncHandler(async (req, res) => {
  res.json(await inbox.emailSettings(req.userToken.id));
}));
router.put('/email-settings', requireAuth, asyncHandler(async (req, res) => {
  try { res.json(await inbox.setEmailOff(req.userToken.id, (req.body || {}).off)); } catch (e) { fail(res, e); }
}));

// The unsubscribe link in an optional email (no sign-in needed; the token is signed by the server).
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  try { res.json(await inbox.unsubscribe((req.body || {}).token)); } catch (e) { fail(res, e); }
}));

// ---- Admins: the support inbox and reported messages -----------------------------------------------------------------------------
adminRouter.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const status = ['open', 'closed'].includes(req.query.status) ? req.query.status : null;
  res.json({ threads: await inbox.adminList({ status }) });
}));
adminRouter.get('/reports', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ reports: await inbox.adminReports({ status: req.query.status === 'resolved' ? 'resolved' : 'open' }) });
}));
adminRouter.post('/reports/:id/resolve', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { await inbox.resolveReport(req.adminUser || await getUserById(req.userToken.id), req.params.id, (req.body || {}).resolution); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));
adminRouter.get('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try { res.json(await inbox.adminThread(req.params.id)); } catch (e) { fail(res, e); }
}));
adminRouter.post('/:id/messages', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const admin = req.adminUser || await getUserById(req.userToken.id);
  try { res.status(201).json({ message: await inbox.adminReply(admin, req.params.id, b.body, { internal: Boolean(b.internal) }) }); } catch (e) { fail(res, e); }
}));
adminRouter.patch('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const admin = req.adminUser || await getUserById(req.userToken.id);
  try { res.json(await inbox.adminUpdate(admin, req.params.id, { status: b.status, assign: b.assign })); } catch (e) { fail(res, e); }
}));

module.exports = { router, adminRouter };
