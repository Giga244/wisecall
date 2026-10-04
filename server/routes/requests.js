// "Find me a mentor" (server/mentorRequests.js): send a request, confirm it from the email, remove it, and the public board's counts.
const express = require('express');
const { optionalAuth } = require('../auth');
const { getUserById } = require('../models');
const { asyncHandler } = require('../util');
const mr = require('../mentorRequests');

const router = express.Router();
const STATUS = { not_found: 404, already_requested: 409, invalid_email: 400, invalid_field: 400, invalid_niche: 400, invalid_need: 400, offensive: 400,
  contact_details: 400, invalid_budget: 400 };
const fail = (res, e) => {
  if (!(e instanceof mr.RequestError)) throw e;
  res.status(STATUS[e.code] || 400).json({ error: e.code, ...(e.min ? { min: e.min, max: e.max } : {}) });
};

router.post('/', optionalAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // (the hidden field only bots fill in: pretend it worked)
  const user = req.userToken ? await getUserById(req.userToken.id) : null;
  try {
    res.status(201).json(await mr.create({ user, email: b.email, field: b.field, niche: b.niche, need: b.need, language: b.language,
      budgetMin: b.budgetMin, budgetMax: b.budgetMax, showPublic: b.showPublic === true, lang: b.lang }));
  } catch (e) { fail(res, e); }
}));

// The links in the emails (opened in a browser): they lead to the request page, which says what happened.
router.get('/confirm', asyncHandler(async (req, res) => {
  try { await mr.confirm(req.query.token); res.redirect(302, '/find-a-mentor.html?confirmed=1'); }
  catch (e) { if (e instanceof mr.RequestError) return res.redirect(302, '/find-a-mentor.html?confirmed=0'); throw e; }
}));
router.get('/remove', asyncHandler(async (req, res) => {
  try { await mr.remove(req.query.token); res.redirect(302, '/find-a-mentor.html?removed=1'); }
  catch (e) { if (e instanceof mr.RequestError) return res.redirect(302, '/find-a-mentor.html?removed=0'); throw e; }
}));

router.get('/board', asyncHandler(async (req, res) => {
  const fields = await mr.board();
  res.json(fields ? { open: true, fields } : { open: false, fields: [] });
}));

module.exports = router;
