// Public answers (server/publicAnswers.js): the published list for the pages, the asker's and the mentor's decisions, withdrawing, and
// "Helpful". Admins approve in /api/admin/public-answers.
const express = require('express');
const { requireAuth } = require('../auth');
const { getUserById } = require('../models');
const { asyncHandler } = require('../util');
const pa = require('../publicAnswers');

const router = express.Router();
const STATUS = { not_found: 404, not_answered: 409, rating_needed: 409, mentor_declines: 409, already_decided: 409, invalid_question: 400,
  invalid_answer: 400, offensive: 400, invalid_visitor: 400 };
const fail = (res, e) => {
  if (!(e instanceof pa.AnswerError)) throw e;
  res.status(STATUS[e.code] || 400).json({ error: e.code, ...(e.min ? { min: e.min, max: e.max } : {}) });
};
const isId = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
const me = async (req, res) => { const u = await getUserById(req.userToken.id); if (!u) res.status(401).json({ error: 'not_authenticated' }); return u; };

// The published answers: ?q= ?niche= ?sort=newest|helpful ?mentor=<id> ?limit=
router.get('/', asyncHandler(async (req, res) => {
  const { q, niche, sort, mentor, limit } = req.query;
  if (mentor && !isId(mentor)) return res.json({ answers: [] });
  res.json({ answers: await pa.list({ q, niche, sort, mentorId: mentor, limit }) });
}));

router.post('/offer', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res); if (!user) return;
  const b = req.body || {};
  if (!isId(b.bookingId)) return res.status(404).json({ error: 'not_found' });
  try { res.status(201).json({ publicAnswer: await pa.askerAgrees(user, b.bookingId, { question: b.question }) }); } catch (e) { fail(res, e); }
}));
router.post('/decline', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res); if (!user) return;
  if (!isId((req.body || {}).bookingId)) return res.status(404).json({ error: 'not_found' });
  try { res.json({ publicAnswer: await pa.askerDeclines(user, req.body.bookingId) }); } catch (e) { fail(res, e); }
}));
router.post('/:id/mentor', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res); if (!user) return;
  if (!isId(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  try { res.json({ publicAnswer: await pa.mentorDecides(user, req.params.id, { agree: b.agree === true, answer: b.answer }) }); } catch (e) { fail(res, e); }
}));
router.post('/:id/withdraw', requireAuth, asyncHandler(async (req, res) => {
  const user = await me(req, res); if (!user) return;
  if (!isId(req.params.id)) return res.status(404).json({ error: 'not_found' });
  try { res.json({ publicAnswer: await pa.withdraw(user, req.params.id) }); } catch (e) { fail(res, e); }
}));
router.post('/:slug/helpful', asyncHandler(async (req, res) => {
  try { res.json(await pa.helpful(req.params.slug, (req.body || {}).visitor)); } catch (e) { fail(res, e); }
}));

module.exports = router;
