// Rich profile sections (docs/PROFILES-PLAN.md): the list sections (experience, education, licences, projects, journey), skills, language
// levels, links, per-section visibility, and the "verified" mark. Everything is optional; every text is checked (length, rude words,
// contact details); links are http/https only. Who may see what is decided here, once (visibleSections).
const { query, tx } = require('./db');
const textSafety = require('./textSafety');

class ProfileError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const LIST_SECTIONS = ['experience', 'education', 'licence', 'project', 'journey'];
// Every section that has a visibility of its own (name and photo follow "who can open my profile").
const SECTIONS = ['headline', 'about', 'experience', 'education', 'licences', 'skills', 'languages', 'projects', 'journey', 'links'];
const LIST_KEY = { experience: 'experience', education: 'education', licence: 'licences', project: 'projects', journey: 'journey' };
const VISIBILITY = ['everyone', 'signed_in', 'only_me'];
const TYPES = ['full_time', 'part_time', 'self_employed', 'freelance', 'internship', 'volunteer'];
const LEVELS = ['basic', 'conversational', 'fluent', 'native'];
const LINK_KINDS = { github: /(^|\.)github\.com$/, behance: /(^|\.)behance\.net$/, instagram: /(^|\.)instagram\.com$/, youtube: /(^|\.)(youtube\.com|youtu\.be)$/ };
const MAX_ITEMS = 30;
const MAX_SKILLS = 30;
const MENTOR_PUBLIC = ['headline', 'about', 'experience', 'education', 'skills', 'languages', 'links'];
const UUID = /^[0-9a-f-]{36}$/i;

// ---- Checking what people type ----------------------------------------------------------------------------------------------------------
const clean = (v) => textSafety.cleanText(typeof v === 'string' ? v : '');
function text(v, { max, min = 0, field, required = false, oneLine = false }) {
  let t = clean(v);
  if (oneLine) t = t.replace(/\s+/g, ' ');
  if (!t && !required) return null;
  if ([...t].length < Math.max(min, required ? 1 : 0) || [...t].length > max) throw new ProfileError('invalid_' + field, { field, max });
  if (textSafety.isOffensive(t)) throw new ProfileError('offensive', { field });
  if (textSafety.findContactDetails(t).length) throw new ProfileError('contact_details', { field });
  return t;
}
const THIS_YEAR = () => new Date().getUTCFullYear();
function when(v, field, { required = true } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw new ProfileError('invalid_' + field, { field }); return null; }
  const year = Number(v.year);
  const month = v.month === undefined || v.month === null || v.month === '' ? null : Number(v.month);
  if (!Number.isInteger(year) || year < 1950 || year > THIS_YEAR() + 10) throw new ProfileError('invalid_' + field, { field });
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new ProfileError('invalid_' + field, { field });
  return month === null ? { year } : { year, month };
}
const order = (d) => d.year * 12 + (d.month || 1);
function link(v, field) {
  const raw = String(v || '').trim();
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch (e) { throw new ProfileError('invalid_link', { field }); }
  if (!['http:', 'https:'].includes(u.protocol) || raw.length > 300 || u.username || u.password || !u.hostname.includes('.')) throw new ProfileError('invalid_link', { field });
  return u.toString();
}

// One item of a list section -> its clean data (throws ProfileError).
function cleanItem(section, b = {}) {
  switch (section) {
    case 'experience': {
      const start = when(b.start, 'start');
      const current = b.current === true;
      const end = current ? null : when(b.end, 'end', { required: false });
      if (end && order(end) < order(start)) throw new ProfileError('end_before_start', { field: 'end' });
      if (!TYPES.includes(b.type || 'full_time')) throw new ProfileError('invalid_type', { field: 'type' });
      const achievements = (Array.isArray(b.achievements) ? b.achievements : []).map((a) => text(a, { max: 150, field: 'achievement', oneLine: true })).filter(Boolean);
      if (achievements.length > 5) throw new ProfileError('too_many_achievements', { max: 5 });
      return { title: text(b.title, { max: 100, field: 'title', required: true, oneLine: true }), organisation: text(b.organisation, { max: 120, field: 'organisation', required: true, oneLine: true }),
        location: text(b.location, { max: 80, field: 'location', oneLine: true }), type: b.type || 'full_time', start, end, current,
        description: text(b.description, { max: 1000, field: 'description' }), achievements };
    }
    case 'education': {
      const start = b.startYear ? when({ year: b.startYear }, 'start') : null;
      const end = b.endYear ? when({ year: b.endYear }, 'end') : null;
      if (start && end && end.year < start.year) throw new ProfileError('end_before_start', { field: 'end' });
      return { school: text(b.school, { max: 150, field: 'school', required: true, oneLine: true }), degree: text(b.degree, { max: 100, field: 'degree', oneLine: true }),
        field: text(b.field, { max: 100, field: 'field', oneLine: true }), startYear: start ? start.year : null, endYear: end ? end.year : null,
        description: text(b.description, { max: 1000, field: 'description' }) };
    }
    case 'licence': {
      const issued = when(b.issued, 'issued');
      const expires = when(b.expires, 'expires', { required: false });
      if (expires && order(expires) < order(issued)) throw new ProfileError('end_before_start', { field: 'expires' });
      return { name: text(b.name, { max: 150, field: 'name', required: true, oneLine: true }), issuer: text(b.issuer, { max: 150, field: 'issuer', required: true, oneLine: true }),
        issued, expires, url: link(b.url, 'url') };
    }
    case 'project':
      return { title: text(b.title, { max: 100, field: 'title', required: true, oneLine: true }), url: link(b.url, 'url'), description: text(b.description, { max: 500, field: 'description' }) };
    case 'journey':
      return { date: when(b.date, 'date'), title: text(b.title, { max: 100, field: 'title', required: true, oneLine: true }), text: text(b.text, { max: 500, field: 'text' }) };
    default:
      throw new ProfileError('invalid_section');
  }
}

// ---- Durations ("3 yrs 4 mos"): whole months between two dates; a missing month counts as January (start) / December (end) -----------
function months(start, end, now = new Date()) {
  const a = start.year * 12 + ((start.month || 1) - 1);
  const b = end ? end.year * 12 + ((end.month || 12) - 1) : now.getUTCFullYear() * 12 + now.getUTCMonth();
  return Math.max(1, b - a + 1);
}
// Positions grouped by organisation (consecutive in the order the person chose), with the total time there.
function groupExperience(items, now) {
  const groups = [];
  for (const it of items) {
    const key = it.data.organisation.toLowerCase();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it); else groups.push({ key, organisation: it.data.organisation, items: [it] });
  }
  for (const g of groups) {
    const start = g.items.reduce((m, it) => (order(it.data.start) < order(m) ? it.data.start : m), g.items[0].data.start);
    const ends = g.items.map((it) => (it.data.current ? null : it.data.end || it.data.start));
    const end = ends.includes(null) ? null : ends.reduce((m, e) => (order(e) > order(m) ? e : m));
    g.months = months(start, end, now);
    g.current = ends.includes(null);
  }
  return groups.map(({ key, ...g }) => g);
}
// Years of experience on the cards: from the earliest start to now, whole years.
function yearsOf(items, now = new Date()) {
  const starts = items.filter((it) => it.section === 'experience').map((it) => it.data.start);
  if (!starts.length) return null;
  const first = starts.reduce((m, s) => (order(s) < order(m) ? s : m));
  return Math.floor(months(first, null, now) / 12);
}


// ---- Who sees what ----------------------------------------------------------------------------------------------------------------------
const isMentorRole = (u) => u && (u.role === 'mentor' || u.role === 'both');
// The level of one section: what the person chose, or the default (askers: only me; mentors: the usual public sections).
function levelOf(owner, settings, section) {
  const chosen = settings && settings.visibility ? settings.visibility[section] : null;
  if (VISIBILITY.includes(chosen)) return chosen;
  return isMentorRole(owner) && MENTOR_PUBLIC.includes(section) ? 'everyone' : 'only_me';
}
function seesLevel(level, owner, viewer) {
  if (viewer && (viewer.id === owner.id || isAdminUser(viewer))) return true;
  if (level === 'everyone') return true;
  if (level === 'signed_in') return Boolean(viewer);
  return false;
}
// May this viewer see this section of this owner's profile (its level, and whether an admin hid it)?
function sees(owner, settings, section, viewer) {
  const hidden = settings && settings.admin_hidden && settings.admin_hidden[section];
  if (hidden && !(viewer && (viewer.id === owner.id || isAdminUser(viewer)))) return false;
  return seesLevel(levelOf(owner, settings, section), owner, viewer);
}
// (an admin who passed the second step in this session: their login cookie travels with the viewer, adminAuth.viewerFrom)
const isAdminUser = (u) => require('./adminAuth').isVerifiedAdminViewer(u);

async function settingsOf(userId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows: [s] } = await run('SELECT * FROM profile_settings WHERE user_id = $1', [userId]);
  return s || { user_id: userId, skills: [], top_skills: [], language_levels: {}, links: {}, visibility: {}, admin_hidden: {}, hidden_at: null };
}
async function itemsOf(userId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT i.*, EXISTS (SELECT 1 FROM profile_item_images m WHERE m.item_id = i.id) AS has_image
                                FROM profile_items i WHERE i.user_id = $1 ORDER BY i.section, i.position, i.created_at`, [userId]);
  return rows;
}
const itemView = (it) => ({ id: it.id, section: it.section, ...it.data, verified: Boolean(it.verified_at),
  ...(it.section === 'project' ? { imageUrl: it.has_image ? `/api/profile-images/${it.id}.webp?v=${new Date(it.updated_at).getTime()}` : null } : {}) });

// Everything this viewer may see of the owner's rich sections. The owner (and admins) get every section, with its level and whether an
// admin hid it; others get only what they may see, never the levels.
async function sectionsFor(owner, viewer) {
  const settings = await settingsOf(owner.id);
  const self = Boolean(viewer && viewer.id === owner.id);
  const admin = Boolean(viewer && isAdminUser(viewer));
  if (settings.hidden_at && !self && !admin) return { hidden: true };
  const items = await itemsOf(owner.id);
  const can = (section) => sees(owner, settings, section, viewer);
  const listOf = (section) => items.filter((i) => i.section === section).map(itemView);
  const out = {};
  if (can('headline')) Object.assign(out, { headline: owner.headline || null, currentWork: owner.currentWork || null, city: owner.city || null });
  if (can('about')) out.about = owner.bio || null;
  if (can('experience')) {
    const exp = items.filter((i) => i.section === 'experience');
    out.experience = groupExperience(exp).map((g) => ({ ...g, items: g.items.map(itemView) }));
    out.yearsOfExperience = yearsOf(exp);
  }
  if (can('education')) out.education = listOf('education');
  if (can('licences')) out.licences = listOf('licence');
  if (can('projects')) out.projects = listOf('project');
  if (can('journey')) out.journey = listOf('journey').sort((a, b) => order(a.date) - order(b.date));
  if (can('skills')) { out.skills = settings.skills || []; out.topSkills = settings.top_skills || []; }
  if (can('languages')) out.languages = (owner.languages || []).map((code) => ({ code, level: (settings.language_levels || {})[code] || null }));
  if (can('links')) out.links = { linkedin: owner.linkedinUrl || null, website: owner.websiteUrl || null, ...(settings.links || {}) };
  if (self || admin) {
    out.visibility = Object.fromEntries(SECTIONS.map((s) => [s, levelOf(owner, settings, s)]));
    out.adminHidden = settings.admin_hidden || {};
    out.profileHidden = settings.hidden_at ? { at: settings.hidden_at, reason: settings.hidden_reason } : null;
  }
  if (self) out.strength = strength(owner, settings, items);
  return out;
}

// The quiet "profile strength" shown only to the owner, with the next useful tip.
function strength(owner, settings, items) {
  const has = (section) => items.some((i) => i.section === section);
  const checks = [
    ['photo', Boolean(owner.photoUpdatedAt)], ['headline', Boolean(owner.headline)], ['about', Boolean(owner.bio && owner.bio.length >= 80)],
    ['experience', has('experience')], ['education', has('education')], ['skills', (settings.skills || []).length >= 3], ['languages', (owner.languages || []).length > 0]
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), next: (checks.find(([, ok]) => !ok) || [null])[0] };
}

// ---- Writing (the owner) -------------------------------------------------------------------------------------------------------------
// The public text Browse search looks in (only sections everyone may see), kept up to date after every change.
async function refreshSearch(owner, client) {
  const settings = await settingsOf(owner.id, client);
  const items = await itemsOf(owner.id, client);
  const anyone = (section) => sees(owner, settings, section, null);
  const parts = [];
  if (anyone('experience')) items.filter((i) => i.section === 'experience').forEach((i) => parts.push(i.data.title, i.data.organisation));
  if (anyone('education')) items.filter((i) => i.section === 'education').forEach((i) => parts.push(i.data.school, i.data.degree, i.data.field));
  if (anyone('skills')) parts.push(...(settings.skills || []));
  const run = client ? client.query.bind(client) : query;
  await run(`INSERT INTO profile_settings (user_id, search_text) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET search_text = EXCLUDED.search_text`,
    [owner.id, parts.filter(Boolean).join(' ').toLowerCase().slice(0, 4000)]);
}
const ensureSettings = (client, userId) => client.query('INSERT INTO profile_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);

async function addItem(owner, section, body) {
  if (!LIST_SECTIONS.includes(section)) throw new ProfileError('invalid_section');
  const data = cleanItem(section, body);
  let item;
  await tx(async (client) => {
    const { rows: [n] } = await client.query('SELECT count(*)::int AS n, COALESCE(max(position), -1) + 1 AS next FROM profile_items WHERE user_id = $1 AND section = $2', [owner.id, section]);
    if (n.n >= MAX_ITEMS) throw new ProfileError('too_many_items', { max: MAX_ITEMS });
    ({ rows: [item] } = await client.query('INSERT INTO profile_items (user_id, section, position, data) VALUES ($1, $2, $3, $4) RETURNING *', [owner.id, section, n.next, data]));
    await refreshSearch(owner, client);
  });
  return itemView(item);
}

// The same value as text whatever the order of its keys; empty parts (null, '', [], false) count as absent.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => !(v[k] === null || v[k] === undefined || v[k] === '' || v[k] === false || (Array.isArray(v[k]) && !v[k].length)))
      .sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Editing an item that was verified removes the check (until it is reviewed again), unless nothing actually changed.
async function updateItem(owner, id, body) {
  let item;
  await tx(async (client) => {
    const { rows: [old] } = await client.query('SELECT * FROM profile_items WHERE id = $1 AND user_id = $2 FOR UPDATE', [UUID.test(String(id)) ? id : null, owner.id]);
    if (!old) throw new ProfileError('not_found');
    const data = cleanItem(old.section, body);
    // (compared field by field: the database keeps an object's keys in its own order)
    const changed = canonical(data) !== canonical(old.data);
    ({ rows: [item] } = await client.query(
      `UPDATE profile_items SET data = $2, updated_at = now(), verified_at = CASE WHEN $3 THEN NULL ELSE verified_at END,
         verified_by = CASE WHEN $3 THEN NULL ELSE verified_by END, verified_note = CASE WHEN $3 THEN NULL ELSE verified_note END WHERE id = $1 RETURNING *`,
      [old.id, data, changed]));
    await refreshSearch(owner, client);
  });
  return itemView(item);
}
async function deleteItem(owner, id) {
  const { rowCount } = await query('DELETE FROM profile_items WHERE id = $1 AND user_id = $2', [UUID.test(String(id)) ? id : null, owner.id]);
  if (!rowCount) throw new ProfileError('not_found');
  await refreshSearch(owner);
  return { ok: true };
}
// The new order of one section: every id of it, once.
async function reorder(owner, section, ids) {
  if (!LIST_SECTIONS.includes(section) || !Array.isArray(ids)) throw new ProfileError('invalid_order');
  await tx(async (client) => {
    const { rows } = await client.query('SELECT id FROM profile_items WHERE user_id = $1 AND section = $2 FOR UPDATE', [owner.id, section]);
    const mine = new Set(rows.map((r) => r.id));
    if (ids.length !== mine.size || new Set(ids).size !== ids.length || ids.some((i) => !mine.has(i))) throw new ProfileError('invalid_order');
    for (let i = 0; i < ids.length; i += 1) await client.query('UPDATE profile_items SET position = $2 WHERE id = $1', [ids[i], i]);
  });
  return { ok: true };
}

async function setSkills(owner, skills, top) {
  const list = [...new Set((Array.isArray(skills) ? skills : []).map((s) => text(s, { max: 40, field: 'skill', oneLine: true })).filter(Boolean))];
  if (list.length > MAX_SKILLS) throw new ProfileError('too_many_skills', { max: MAX_SKILLS });
  const tops = [...new Set((Array.isArray(top) ? top : []).map((s) => clean(s)))].filter((s) => list.includes(s));
  if (tops.length > 3) throw new ProfileError('too_many_top_skills', { max: 3 });
  await tx(async (client) => {
    await ensureSettings(client, owner.id);
    await client.query('UPDATE profile_settings SET skills = $2, top_skills = $3, updated_at = now() WHERE user_id = $1', [owner.id, list, tops]);
    await refreshSearch(owner, client);
  });
  return { skills: list, topSkills: tops };
}
async function setLanguageLevels(owner, levels) {
  const out = {};
  for (const [code, level] of Object.entries(levels || {})) {
    if (!(owner.languages || []).includes(code) || !LEVELS.includes(level)) throw new ProfileError('invalid_language_level');
    out[code] = level;
  }
  await query(`INSERT INTO profile_settings (user_id, language_levels) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET language_levels = EXCLUDED.language_levels, updated_at = now()`,
    [owner.id, out]);
  return { levels: out };
}
async function setLinks(owner, links) {
  const out = {};
  for (const [kind, re] of Object.entries(LINK_KINDS)) {
    const v = link((links || {})[kind], kind);
    if (v && !re.test(new URL(v).hostname.toLowerCase())) throw new ProfileError('invalid_link', { field: kind });
    if (v) out[kind] = v;
  }
  await query(`INSERT INTO profile_settings (user_id, links) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET links = EXCLUDED.links, updated_at = now()`, [owner.id, out]);
  return { links: out };
}
async function setVisibility(owner, section, level) {
  if (!SECTIONS.includes(section) || !VISIBILITY.includes(level)) throw new ProfileError('invalid_visibility');
  await tx(async (client) => {
    await ensureSettings(client, owner.id);
    await client.query(`UPDATE profile_settings SET visibility = visibility || jsonb_build_object($2::text, $3::text), updated_at = now() WHERE user_id = $1`, [owner.id, section, level]);
    await refreshSearch(owner, client);
  });
  return { section, level };
}

// ---- A project's picture (the profile-photo pipeline: checked, resized, re-encoded, no EXIF) -----------------------------------------------
async function setImage(owner, itemId, buf) {
  const { rows: [it] } = await query(`SELECT id FROM profile_items WHERE id = $1 AND user_id = $2 AND section = 'project'`, [UUID.test(String(itemId)) ? itemId : null, owner.id]);
  if (!it) throw new ProfileError('not_found');
  const img = await require('./images').processPhoto(buf);
  await query(`INSERT INTO profile_item_images (item_id, mime, data) VALUES ($1, $2, $3)
               ON CONFLICT (item_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`, [it.id, img.mime, img.data]);
  await query('UPDATE profile_items SET updated_at = now() WHERE id = $1', [it.id]);
  return { ok: true };
}
async function removeImage(owner, itemId) {
  await query(`DELETE FROM profile_item_images m USING profile_items i WHERE m.item_id = i.id AND i.id = $1 AND i.user_id = $2`, [UUID.test(String(itemId)) ? itemId : null, owner.id]);
  return { ok: true };
}
// The picture, for whoever may see the owner's projects (and may open the profile).
async function imageFor(itemId, viewer) {
  if (!UUID.test(String(itemId))) return null;
  const { rows: [r] } = await query(`SELECT m.mime, m.data, i.user_id FROM profile_item_images m JOIN profile_items i ON i.id = m.item_id WHERE m.item_id = $1`, [itemId]);
  if (!r) return null;
  const owner = await require('./models').getUserById(r.user_id);
  if (!owner || !(await require('./profiles').canView(owner, viewer))) return null;
  const settings = await settingsOf(owner.id);
  if ((settings.hidden_at && !(viewer && (viewer.id === owner.id || isAdminUser(viewer)))) || !sees(owner, settings, 'projects', viewer)) return null;
  return { mime: r.mime, data: r.data };
}

// ---- What the public page, search engines and Browse get (only sections everyone may see) ------------------------------------------
async function publicSummary(owner) {
  const s = await sectionsFor(owner, null);
  if (s.hidden) return null;
  const current = (s.experience || []).flatMap((g) => g.items).find((i) => i.current);
  return { headline: s.headline || null, currentPosition: current ? { title: current.title, organisation: current.organisation } : null,
    yearsOfExperience: s.yearsOfExperience === undefined ? null : s.yearsOfExperience, topSkills: s.topSkills || [] };
}
// For many mentors at once (the Browse cards): { [userId]: summary } from public sections only, in two queries.
async function publicSummaries(users) {
  const out = {};
  if (!users.length) return out;
  const ids = users.map((u) => u.id);
  const { rows: st } = await query('SELECT * FROM profile_settings WHERE user_id = ANY($1::uuid[])', [ids]);
  const { rows: exp } = await query(`SELECT * FROM profile_items WHERE user_id = ANY($1::uuid[]) AND section = 'experience' ORDER BY position, created_at`, [ids]);
  const settings = Object.fromEntries(st.map((r) => [r.user_id, r]));
  for (const u of users) {
    const s = settings[u.id] || { visibility: {}, admin_hidden: {} };
    if (s.hidden_at) { out[u.id] = null; continue; }
    const mine = sees(u, s, 'experience', null) ? exp.filter((i) => i.user_id === u.id) : [];
    const current = mine.find((i) => i.data.current);
    out[u.id] = { headline: sees(u, s, 'headline', null) ? u.headline || null : null,
      currentPosition: current ? { title: current.data.title, organisation: current.data.organisation } : null,
      yearsOfExperience: mine.length ? yearsOf(mine) : null, topSkills: sees(u, s, 'skills', null) ? s.top_skills || [] : [], showAbout: sees(u, s, 'about', null) };
  }
  return out;
}
// JSON-LD Person fields from public sections only.
async function jsonLdFields(owner) {
  const s = await sectionsFor(owner, null);
  if (s.hidden) return {};
  const out = {};
  const works = (s.experience || []).filter((g) => g.current).map((g) => ({ '@type': 'Organization', name: g.organisation }));
  if (works.length) out.worksFor = works.length === 1 ? works[0] : works;
  const schools = [...new Set((s.education || []).map((e) => e.school))].map((name) => ({ '@type': 'EducationalOrganization', name }));
  if (schools.length) out.alumniOf = schools;
  if ((s.skills || []).length) out.knowsAbout = s.skills;
  if ((s.languages || []).length) out.knowsLanguage = s.languages.map((l) => l.code);
  return out;
}

// ---- Reports (signed-in people) and the admin's tools ---------------------------------------------------------------------------------
const REPORT_REASONS = ['fake', 'offensive', 'personal_info', 'spam', 'other'];
async function report(reporter, owner, { reason, details } = {}) {
  if (!reporter) throw new ProfileError('not_authenticated');
  if (reporter.id === owner.id) throw new ProfileError('own_profile');
  if (!REPORT_REASONS.includes(reason)) throw new ProfileError('invalid_reason');
  const d = details ? clean(details).slice(0, 1000) : null;
  const { rows } = await query(
    `INSERT INTO profile_reports (owner_id, reporter_id, reason, details) VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id, reporter_id) WHERE status = 'open' DO NOTHING RETURNING id`,
    [owner.id, reporter.id, reason, d]);
  if (!rows[0]) throw new ProfileError('already_reported');
  require('./notify').notifyAdmins('A profile was reported', '<p>A profile was reported. See the admin panel, Profiles.</p>');
  return { ok: true };
}
async function listReports() {
  const { rows } = await query(
    `SELECT r.*, o.name AS owner_name, o.username AS owner_username, rp.email AS reporter_email FROM profile_reports r JOIN users o ON o.id = r.owner_id
       LEFT JOIN users rp ON rp.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.created_at LIMIT 200`);
  return rows.map((r) => ({ id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, owner: { id: r.owner_id, name: r.owner_name, username: r.owner_username }, reporter: r.reporter_email }));
}
async function resolveReport(admin, id, resolution) {
  const note = clean(resolution || '');
  if (note.length < 3) throw new ProfileError('reason_required');
  const { rows: [r] } = await query(`UPDATE profile_reports SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING *`,
    [UUID.test(String(id)) ? id : null, note.slice(0, 500), admin.id]);
  if (!r) throw new ProfileError('not_found');
  await audit(admin, r.owner_id, 'profile_report_resolved', note);
  return { ok: true };
}
async function audit(admin, userId, action, reason) {
  await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, $4, $5)`,
    [userId, admin.id, admin.email, action, String(reason || '').slice(0, 1000)]).catch((e) => console.error('[profiles] audit failed:', e.message));
}

// (the names of the parts, for the email that tells the owner)
const SECTION_NAMES = {
  en: { headline: 'headline, work and city', about: 'about', experience: 'experience', education: 'education', licences: 'licences and certifications',
    skills: 'skills', languages: 'languages', projects: 'projects', journey: 'journey', links: 'links' },
  ka: { headline: 'სათაური, სამსახური და ქალაქი', about: 'ჩემ შესახებ', experience: 'გამოცდილება', education: 'განათლება', licences: 'ლიცენზიები და სერტიფიკატები',
    skills: 'უნარები', languages: 'ენები', projects: 'პროექტები', journey: 'ჩემი გზა', links: 'ბმულები' }
};

// Hiding one section (`section`) or the whole profile (no section), with the reason the owner is told; and showing it again.
async function hide(admin, owner, { section, reason } = {}) {
  const r = clean(reason || '');
  if (r.length < 5) throw new ProfileError('reason_required');
  if (section !== undefined && section !== null && !SECTIONS.includes(section)) throw new ProfileError('invalid_section');
  await tx(async (client) => {
    await ensureSettings(client, owner.id);
    if (section) await client.query(`UPDATE profile_settings SET admin_hidden = admin_hidden || jsonb_build_object($2::text, $3::text) WHERE user_id = $1`, [owner.id, section, r.slice(0, 500)]);
    else await client.query('UPDATE profile_settings SET hidden_at = now(), hidden_reason = $2, hidden_by = $3 WHERE user_id = $1', [owner.id, r.slice(0, 500), admin.id]);
    await refreshSearch(owner, client);
  });
  await audit(admin, owner.id, section ? 'profile_section_hidden' : 'profile_hidden', `${section || 'whole profile'}: ${r}`);
  await require('./inbox').systemMessage(owner.id, 'profile_hidden', { section: section || null, reason: r.slice(0, 500) });
  require('./notify').notifyProfileHidden(owner, { section: section ? (SECTION_NAMES[owner.language === 'ka' ? 'ka' : 'en'][section] || section) : null, reason: r });
  return { ok: true };
}
async function unhide(admin, owner, { section } = {}) {
  if (section) await query(`UPDATE profile_settings SET admin_hidden = admin_hidden - $2::text WHERE user_id = $1`, [owner.id, section]);
  else await query('UPDATE profile_settings SET hidden_at = NULL, hidden_reason = NULL, hidden_by = NULL WHERE user_id = $1', [owner.id]);
  await refreshSearch(owner);
  await audit(admin, owner.id, section ? 'profile_section_shown' : 'profile_shown', section || 'whole profile');
  await require('./inbox').systemMessage(owner.id, 'profile_shown', { section: section || null });
  return { ok: true };
}

// The verified mark on one item (mentors; in the verification panel), with a note. It goes when the owner edits the item.
async function setVerified(admin, itemId, verified, note) {
  const n = clean(note || '');
  if (verified && n.length < 3) throw new ProfileError('reason_required');
  const { rows: [it] } = await query(
    `UPDATE profile_items SET verified_at = CASE WHEN $2 THEN now() ELSE NULL END, verified_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
       verified_note = CASE WHEN $2 THEN $4 ELSE NULL END WHERE id = $1 RETURNING *`, [UUID.test(String(itemId)) ? itemId : null, Boolean(verified), admin.id, n.slice(0, 500) || null]);
  if (!it) throw new ProfileError('not_found');
  await audit(admin, it.user_id, verified ? 'profile_item_verified' : 'profile_item_unverified', `${it.section} ${it.id}${n ? ': ' + n : ''}`);
  return itemView(it);
}
// For the verification panel: every item of a mentor, with its verified state and note.
async function itemsForAdmin(userId) {
  return (await itemsOf(userId)).map((it) => ({ ...itemView(it), verifiedNote: it.verified_note, verifiedAt: it.verified_at }));
}

// ---- The mentor application (they stay separate; these only copy) -----------------------------------------------------------------------
// From the profile to the application's experience step: the current position's title, years of experience, About as the story.
async function forApplication(owner) {
  const items = await itemsOf(owner.id);
  const exp = items.filter((i) => i.section === 'experience');
  const current = exp.find((i) => i.data.current) || exp[0];
  return { roleTitle: current ? current.data.title.slice(0, 100) : null, yearsExperience: yearsOf(exp), story: owner.bio || null };
}
// From the application to the profile: one experience item (when there is none) and the specialty tags as skills (added to any there).
async function fromApplication(owner) {
  const items = await itemsOf(owner.id);
  let added = 0;
  if (!items.some((i) => i.section === 'experience') && owner.roleTitle) {
    const year = new Date().getUTCFullYear() - Math.max(0, Number(owner.yearsExperience || 0));
    await addItem(owner, 'experience', { title: owner.roleTitle, organisation: owner.currentWork || owner.roleTitle, type: 'full_time', start: { year }, current: true });
    added += 1;
  }
  const settings = await settingsOf(owner.id);
  const tags = (owner.specialtyTags || []).filter(Boolean);
  if (tags.length) {
    const merged = [...new Set([...(settings.skills || []), ...tags])].slice(0, MAX_SKILLS);
    await setSkills(owner, merged, settings.top_skills || []);
    added += 1;
  }
  return { added };
}

module.exports = { ProfileError, LIST_SECTIONS, SECTIONS, VISIBILITY, TYPES, LEVELS, LINK_KINDS, MAX_ITEMS, MAX_SKILLS, REPORT_REASONS,
  cleanItem, months, groupExperience, yearsOf, levelOf, sees, settingsOf, itemsOf, sectionsFor, strength, addItem, updateItem, deleteItem, reorder,
  setSkills, setLanguageLevels, setLinks, setVisibility, setImage, removeImage, imageFor, publicSummary, publicSummaries, jsonLdFields, report,
  listReports, resolveReport, hide, unhide, setVerified, itemsForAdmin, forApplication, fromApplication, refreshSearch };
