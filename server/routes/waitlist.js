const express = require('express');
const { asyncHandler } = require('../util');
const waitlist = require('../waitlist');

const router = express.Router();

// Anyone can join the list. The answer is the same whether or not the address was already there.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  try {
    await waitlist.add({ email: b.email, niche: b.niche, language: b.language });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e instanceof waitlist.WaitlistError) return res.status(400).json({ error: e.code });
    throw e;
  }
}));

// The link in the email opens a page that posts the token here.
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  try {
    await waitlist.unsubscribe((req.body || {}).token);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof waitlist.WaitlistError) return res.status(404).json({ error: e.code });
    throw e;
  }
}));

module.exports = router;
