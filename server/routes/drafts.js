// /api/me/drafts/<key>: a signed-in person's unsaved text (server/drafts.js). Only ever their own.
const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler } = require('../util');
const drafts = require('../drafts');

const router = express.Router();
const fail = (res, e) => { if (!(e instanceof drafts.DraftError)) throw e; res.status(e.code === 'draft_too_long' ? 413 : 400).json({ error: e.code }); };

router.get('/:key', requireAuth, asyncHandler(async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ draft: await drafts.get(req.userToken.id, req.params.key) }); } catch (e) { fail(res, e); }
}));
router.put('/:key', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  try { await drafts.put(req.userToken.id, req.params.key, b.value, b.base); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));
router.delete('/:key', requireAuth, asyncHandler(async (req, res) => {
  try { await drafts.remove(req.userToken.id, req.params.key); res.json({ ok: true }); } catch (e) { fail(res, e); }
}));

module.exports = router;
