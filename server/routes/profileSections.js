// Rich profile sections (server/profileSections.js): the owner's editor (/api/me/profile/...), reporting a profile, a project's picture.
// Every rule is in server/profileSections.js; here only who is asking and the HTTP status of each refusal.
const express = require('express');
const { requireAuth, optionalAuth } = require('../auth');
const { getUserById } = require('../models');
const { asyncHandler } = require('../util');
const ps = require('../profileSections');

const router = express.Router();
const STATUS = { not_found: 404, not_authenticated: 401, own_profile: 409, already_reported: 409, too_many_items: 409, too_many_skills: 400,
  too_many_top_skills: 400, invalid_order: 400 };
const IMAGE_STATUS = { empty_file: 400, unsupported_image_type: 400, invalid_image: 400, file_too_large: 413 };
const run = (fn) => asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  try { await fn(user, req, res); } catch (e) {
    if (e instanceof ps.ProfileError) { const { code, message, stack, ...extra } = e; return res.status(STATUS[code] || 400).json({ error: code, ...extra }); }
    if (e instanceof require('../images').ImageError) return res.status(IMAGE_STATUS[e.code] || 400).json({ error: e.code });
    throw e;
  }
});

// ---- The owner ---------------------------------------------------------------------------------------------------------------------------
router.get('/me/profile/sections', requireAuth, run(async (user, req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ sections: await ps.sectionsFor(user, user), editor: { types: ps.TYPES, levels: ps.LEVELS, links: Object.keys(ps.LINK_KINDS) } });
}));
router.post('/me/profile/items', requireAuth, run(async (user, req, res) => {
  const b = req.body || {};
  res.status(201).json({ item: await ps.addItem(user, b.section, b.data || {}) });
}));
router.put('/me/profile/items/:id', requireAuth, run(async (user, req, res) => { res.json({ item: await ps.updateItem(user, req.params.id, (req.body || {}).data || {}) }); }));
router.delete('/me/profile/items/:id', requireAuth, run(async (user, req, res) => { res.json(await ps.deleteItem(user, req.params.id)); }));
router.post('/me/profile/order', requireAuth, run(async (user, req, res) => { const b = req.body || {}; res.json(await ps.reorder(user, b.section, b.ids)); }));
router.put('/me/profile/skills', requireAuth, run(async (user, req, res) => { const b = req.body || {}; res.json(await ps.setSkills(user, b.skills, b.topSkills)); }));
router.put('/me/profile/language-levels', requireAuth, run(async (user, req, res) => { res.json(await ps.setLanguageLevels(user, (req.body || {}).levels)); }));
router.put('/me/profile/links', requireAuth, run(async (user, req, res) => { res.json(await ps.setLinks(user, (req.body || {}).links)); }));
router.put('/me/profile/visibility', requireAuth, run(async (user, req, res) => { const b = req.body || {}; res.json(await ps.setVisibility(user, b.section, b.level)); }));
router.post('/me/profile/items/:id/image', requireAuth, run(async (user, req, res) => { res.json(await ps.setImage(user, req.params.id, Buffer.isBuffer(req.body) ? req.body : null)); }));
router.delete('/me/profile/items/:id/image', requireAuth, run(async (user, req, res) => { res.json(await ps.removeImage(user, req.params.id)); }));
// The mentor application and the profile fill each other in on request (they stay separate).
router.get('/me/profile/for-application', requireAuth, run(async (user, req, res) => { res.set('Cache-Control', 'no-store'); res.json(await ps.forApplication(user)); }));
router.post('/me/profile/from-application', requireAuth, run(async (user, req, res) => { res.json(await ps.fromApplication(user)); }));

// ---- Everyone else ------------------------------------------------------------------------------------------------------------------------
router.post('/users/:username/report', requireAuth, run(async (user, req, res) => {
  const { rows: [r] } = await require('../db').query('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [String(req.params.username || '')]);
  const owner = r ? await getUserById(r.id) : null;
  if (!owner) throw new ps.ProfileError('not_found');
  const b = req.body || {};
  res.status(201).json(await ps.report(user, owner, { reason: b.reason, details: b.details }));
}));

module.exports = router;
