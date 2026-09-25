// Public profiles: /api/users/:username, the photo, and the "is this username free?" check for the forms.
const express = require('express');
const { optionalAuth } = require('../auth');
const { asyncHandler } = require('../util');
const { query } = require('../db');
const { getUserById } = require('../models');
const usernames = require('../usernames');
const profiles = require('../profiles');

const router = express.Router();

// A profile, as the person asking is allowed to see it. A private profile says only that it is private.
router.get('/users/:username', optionalAuth, asyncHandler(async (req, res) => {
  const found = await usernames.resolve(req.params.username);
  if (!found) return res.status(404).json({ error: 'not_found' });
  if (found.redirectTo) return res.json({ redirectTo: found.redirectTo });
  const { userFromRow } = require('../models');
  const owner = userFromRow(found.row);
  const viewer = req.userToken ? await getUserById(req.userToken.id) : null;
  if (!(await profiles.canView(owner, viewer))) return res.json({ private: true, username: owner.username });
  res.json({ profile: await profiles.view(owner, viewer) });
}));

// The photo. Public profiles' photos can be cached by anyone; a private profile's photo is only for those who may see it.
router.get('/photo/:userId', optionalAuth, asyncHandler(async (req, res) => {
  const owner = await getUserById(req.params.userId);
  if (!owner || !owner.photoUpdatedAt) return res.status(404).end();
  const viewer = req.userToken ? await getUserById(req.userToken.id) : null;
  if (!(await profiles.canView(owner, viewer))) return res.status(404).end();
  const { rows } = await query('SELECT mime, data, updated_at FROM user_photos WHERE user_id = $1', [owner.id]);
  if (!rows[0]) return res.status(404).end();
  const isPublic = owner.profileVisibility === 'public';
  res.set({
    'Content-Type': rows[0].mime,
    'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, max-age=300',
    ETag: `"${new Date(rows[0].updated_at).getTime()}"`,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.fresh) return res.status(304).end();
  res.send(rows[0].data);
}));

// For the sign-up and settings forms: can this username be used? (Never says whose it is.)
router.get('/username/check', optionalAuth, asyncHandler(async (req, res) => {
  const wanted = String(req.query.u || '').trim().toLowerCase();
  const problem = usernames.check(wanted);
  if (problem) return res.json({ available: false, reason: problem });
  const me = req.userToken ? req.userToken.id : null;
  if (await usernames.isTaken(wanted, me)) return res.json({ available: false, reason: 'username_taken' });
  res.json({ available: true });
}));

// A suggestion made from a name, for the sign-up form to pre-fill.
router.get('/username/suggest', asyncHandler(async (req, res) => {
  res.json({ username: await usernames.suggest(String(req.query.name || '').slice(0, 100)) });
}));

module.exports = router;
