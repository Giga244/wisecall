// Admin: the niche list, and the niches mentors suggested by choosing "Other (type your own)".
//   GET  /api/admin/niches                          every niche with its mentors, and the suggestions grouped by meaning
//   POST /api/admin/niches                          a new niche; with fromSuggestion, the mentors who typed it move into it ("promote")
//   PATCH /api/admin/niches/:key                    names, icon, order, active; "regulated" can be switched on (never off for a researched one)
//   POST /api/admin/niches/suggestions/move         the mentors of a suggestion move into an existing niche
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const niches = require('../niches');
const customNiche = require('../customNiche');
const steps = require('../verification/steps');
const { REGULATED } = require('../verification/registries');
const { listableSql } = require('../models');

const router = express.Router();
const ICONS = ['spark', 'business', 'medicine', 'teaching', 'tech', 'fitness', 'creative', 'law', 'finance', 'marketing', 'design', 'writing',
  'parenting', 'engineering', 'science', 'plane', 'briefcase', 'heart', 'house', 'map', 'grape', 'calculator', 'building', 'languages', 'camera',
  'music', 'chef', 'whistle', 'tooth', 'pill', 'nurse', 'cart', 'laptop', 'video', 'gamepad', 'shield', 'chip', 'leaf', 'paw', 'star'];

const name = (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/\s+/g, ' ').trim() : '');
function checkNames(b) {
  const en = name(b.en), ka = name(b.ka);
  if (en.length < 2 || en.length > 60 || ka.length < 2 || ka.length > 60) return { error: 'invalid_name' };
  return { en, ka };
}
// A key from the English name: "Pet care & training" -> "pet_care_training" (made unique if needed).
async function keyFor(en) {
  const base = en.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'niche';
  let key = /^[a-z]/.test(base) ? base : `n_${base}`;
  for (let i = 2; niches.get(key) || ['other', 'all', 'any'].includes(key); i++) key = `${base.slice(0, 26)}_${i}`;
  return key;
}

// The mentors who chose "Other", grouped: the same words whatever the case, alphabet or small spelling differences.
async function suggestions() {
  const { rows } = await query(`SELECT id, name, email, custom_niche, verification_status FROM users WHERE niche = 'other' AND custom_niche IS NOT NULL ORDER BY created_at`);
  const groups = new Map();
  for (const r of rows) {
    const g = customNiche.groupKey(r.custom_niche);
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, { group: g, labels: new Map(), mentors: [] });
    const item = groups.get(g);
    item.labels.set(r.custom_niche, (item.labels.get(r.custom_niche) || 0) + 1);
    item.mentors.push({ id: r.id, name: r.name, email: r.email, status: r.verification_status });
  }
  return [...groups.values()]
    .map((g) => ({ group: g.group, label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0], spellings: [...g.labels.keys()], count: g.mentors.length, mentors: g.mentors.slice(0, 20) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// "My field is not in the list" (docs/CLAUDE-CODE-MENTOR-STORY.md 1): what mentors typed, grouped the same way, with the closest category each
// of them chose meanwhile. A suggestion for a new field or direction; nobody is moved by it.
async function fieldSuggestions() {
  const { rows } = await query(`SELECT id, name, email, field_suggestion, field_id, niche, verification_status FROM users
    WHERE field_suggestion IS NOT NULL AND role IN ('mentor', 'both') AND deleted_at IS NULL ORDER BY created_at`);
  const groups = new Map();
  for (const r of rows) {
    const g = customNiche.groupKey(r.field_suggestion);
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, { group: g, labels: new Map(), mentors: [] });
    const item = groups.get(g);
    item.labels.set(r.field_suggestion, (item.labels.get(r.field_suggestion) || 0) + 1);
    item.mentors.push({ id: r.id, name: r.name, email: r.email, status: r.verification_status, fieldId: r.field_id, niche: r.niche });
  }
  return [...groups.values()]
    .map((g) => ({ group: g.group, label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0], spellings: [...g.labels.keys()], count: g.mentors.length, mentors: g.mentors.slice(0, 20) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Moves the mentors of one suggestion group into a niche. Returns how many moved. Each move is in the mentor's audit log. Their own words
// stay: they are "Your field" on the profile, next to the category.
async function moveGroup(group, key, admin) {
  const { rows } = await query(`SELECT id, custom_niche FROM users WHERE niche = 'other' AND custom_niche IS NOT NULL`);
  const ids = rows.filter((r) => customNiche.groupKey(r.custom_niche) === group);
  for (const r of ids) {
    await query(`UPDATE users SET niche = $2 WHERE id = $1 AND niche = 'other'`, [r.id, key]);
    await steps.audit(r.id, steps.adminActor(admin), 'niche_changed', { reason: `"${r.custom_niche}" is now the niche "${key}"` });
  }
  return ids.length;
}

router.get('/niches', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [counts, listed, extra] = await Promise.all([
    query(`SELECT niche, count(*)::int AS n FROM users WHERE role IN ('mentor', 'both') AND niche IS NOT NULL GROUP BY niche`),
    query(`SELECT niche, count(*)::int AS n FROM users WHERE ${listableSql()} GROUP BY niche`),
    // (mentors who have it as one of their two extra categories)
    query(`SELECT x AS niche, count(*)::int AS n FROM users, unnest(extra_niches) AS x WHERE role IN ('mentor', 'both') GROUP BY x`)
  ]);
  const asExtra = Object.fromEntries(extra.rows.map((r) => [r.niche, r.n]));
  const mentors = Object.fromEntries(counts.rows.map((r) => [r.niche, r.n]));
  const live = Object.fromEntries(listed.rows.map((r) => [r.niche, r.n]));
  res.json({
    icons: ICONS,
    niches: niches.all().map((n) => ({
      key: n.key, en: n.en, ka: n.ka, icon: n.icon, sort: n.sort, active: n.active, regulated: n.regulated,
      researched: Object.prototype.hasOwnProperty.call(REGULATED, n.key), promotedFrom: n.promotedFrom || null,
      mentors: mentors[n.key] || 0, listed: live[n.key] || 0, extra: asExtra[n.key] || 0
    })),
    other: mentors.other || 0,
    suggestions: await suggestions(),
    fieldSuggestions: await fieldSuggestions()
  });
}));

router.post('/niches', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const n = checkNames(b);
  if (n.error) return res.status(400).json(n);
  const icon = ICONS.includes(b.icon) ? b.icon : 'spark';
  const sort = Number.isInteger(b.sort) ? Math.max(0, Math.min(32000, b.sort)) : 1000;
  const key = await keyFor(n.en);
  let promotedFrom = null;
  if (b.fromSuggestion !== undefined) {
    const s = (await suggestions()).find((x) => x.group === b.fromSuggestion);
    if (!s) return res.status(404).json({ error: 'suggestion_not_found' });
    promotedFrom = s.label;
  }
  await query(`INSERT INTO niches (key, name_en, name_ka, icon, regulated, sort, promoted_from, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [key, n.en, n.ka, icon, b.regulated === true, sort, promotedFrom, req.adminUser.id]);
  await niches.load();
  const moved = b.fromSuggestion !== undefined ? await moveGroup(b.fromSuggestion, key, req.adminUser) : 0;
  console.log(`[admin] ${req.adminUser.email} created the niche "${key}"${promotedFrom ? ` from "${promotedFrom}" (${moved} mentor(s) moved)` : ''}`);
  res.status(201).json({ niche: niches.get(key), moved });
}));

router.patch('/niches/:key', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const current = niches.get(req.params.key);
  if (!current) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const patch = {};
  if (b.en !== undefined || b.ka !== undefined) {
    const n = checkNames({ en: b.en === undefined ? current.en : b.en, ka: b.ka === undefined ? current.ka : b.ka });
    if (n.error) return res.status(400).json(n);
    patch.name_en = n.en; patch.name_ka = n.ka;
  }
  if (b.icon !== undefined) { if (!ICONS.includes(b.icon)) return res.status(400).json({ error: 'invalid_icon' }); patch.icon = b.icon; }
  if (b.sort !== undefined) { if (!Number.isInteger(b.sort) || b.sort < 0 || b.sort > 32000) return res.status(400).json({ error: 'invalid_sort' }); patch.sort = b.sort; }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') return res.status(400).json({ error: 'invalid_active' }); patch.active = b.active; }
  if (b.regulated !== undefined) {
    if (typeof b.regulated !== 'boolean') return res.status(400).json({ error: 'invalid_regulated' });
    // A regulated field stays regulated when the research says so (server/verification/registries.js).
    if (!b.regulated && Object.prototype.hasOwnProperty.call(REGULATED, current.key)) return res.status(409).json({ error: 'regulated_by_law' });
    patch.regulated = b.regulated;
  }
  const keys = Object.keys(patch);
  if (!keys.length) return res.json({ niche: current });
  await query(`UPDATE niches SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE key = $1`, [current.key, ...keys.map((k) => patch[k])]);
  await niches.load();
  res.json({ niche: niches.get(current.key) });
}));

router.post('/niches/suggestions/move', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { group, to } = req.body || {};
  if (typeof group !== 'string' || !niches.isValid(to)) return res.status(400).json({ error: 'invalid_request' });
  const moved = await moveGroup(group, to, req.adminUser);
  if (!moved) return res.status(404).json({ error: 'suggestion_not_found' });
  res.json({ moved });
}));

module.exports = { router, suggestions, ICONS };
