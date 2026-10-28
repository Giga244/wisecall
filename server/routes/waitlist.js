const express = require('express');
const { asyncHandler } = require('../util');
const waitlist = require('../waitlist');

const router = express.Router();

// Anyone can join the list. The answer is the same whether or not the address was already there.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  try {
    const source = require('../attribution').read(req);
    const { position } = await waitlist.add({ email: b.email, niche: b.niche, language: b.language, wantedQuestion: b.wantedQuestion, source });
    require('../analytics').event('waitlist_join', req, { field: String(b.niche || 'any').slice(0, 40), source: (source && source.source) || 'unknown' });
    // (the link to pass on: the home page in their language, tagged so a friend's sign-up shows where it came from)
    const share = `${require('../config').PUBLIC_URL}${b.language === 'ka' ? '/ka/' : '/'}?ref=share`;
    res.status(201).json({ ok: true, position, share });
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
