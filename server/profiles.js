// Profiles: what people may put on theirs, who may see it, and what the public page gets to know.
// Never included, whoever asks: email, payout details, proof links, verification documents, anything private.
const config = require('./config');
const { query } = require('./db');
const { mentorStatsFor } = require('./models');
const { badgesFor } = require('./verification/badges');
const { isListable, photoUrl } = require('./util');

const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'az', 'hy', 'uk', 'de', 'fr', 'es', 'it', 'ar'];
const LIMITS = { headline: 100, currentWork: 120, city: 80, bio: 500, url: 200, languages: 6 };

const isAdmin = (user) => Boolean(user && user.email && user.emailVerified && config.ADMIN_EMAILS.includes(String(user.email).toLowerCase()));

// One line of plain text: no control characters, no line breaks, spaces collapsed.
function oneLine(v, max) {
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanUrl(value, { linkedin = false } = {}) {
  const raw = String(value).trim();
  if (!raw) return { value: null };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw); } catch (e) { return { error: true }; }
  if (u.protocol !== 'https:' || raw.length > LIMITS.url) return { error: true };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host === 'localhost' || u.username || u.password) return { error: true };
  if (linkedin && !/(^|\.)linkedin\.com$/.test(host)) return { error: true };
  return { value: u.toString() };
}

// Validates what someone sends for their profile. Returns { patch } (only the fields that were sent) or { error, field }.
function parseProfileUpdates(updates, { listable }) {
  const patch = {};
  const bad = (error, field) => ({ error, field });
  for (const field of ['headline', 'currentWork', 'city', 'bio', 'linkedinUrl', 'websiteUrl', 'profileVisibility']) {
    const v = updates[field];
    if (v !== undefined && v !== null && typeof v !== 'string') return bad('invalid_field', field);
  }
  if (updates.languages !== undefined && !Array.isArray(updates.languages)) return bad('invalid_field', 'languages');

  if (updates.headline !== undefined) patch.headline = oneLine(updates.headline || '', LIMITS.headline) || null;
  if (updates.currentWork !== undefined) patch.currentWork = oneLine(updates.currentWork || '', LIMITS.currentWork) || null;
  if (updates.city !== undefined) patch.city = oneLine(updates.city || '', LIMITS.city) || null;
  if (updates.bio !== undefined) {
    const bio = String(updates.bio || '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (bio.length > LIMITS.bio) return bad('bio_too_long', 'bio');
    patch.bio = bio || null;
  }
  if (updates.languages !== undefined) {
    const list = [...new Set(updates.languages)];
    if (list.length > LIMITS.languages || list.some((l) => !LANGUAGES.includes(l))) return bad('invalid_language', 'languages');
    patch.languages = list;
  }
  if (updates.linkedinUrl !== undefined) {
    const r = cleanUrl(updates.linkedinUrl || '', { linkedin: true });
    if (r.error) return bad('invalid_linkedin_url', 'linkedinUrl');
    patch.linkedinUrl = r.value;
  }
  if (updates.websiteUrl !== undefined) {
    const r = cleanUrl(updates.websiteUrl || '');
    if (r.error) return bad('invalid_website_url', 'websiteUrl');
    patch.websiteUrl = r.value;
  }
  if (updates.profileVisibility !== undefined) {
    if (!['public', 'contacts'].includes(updates.profileVisibility)) return bad('invalid_visibility', 'profileVisibility');
    // Someone buyers can book has to be found, so a bookable mentor's profile is always public.
    if (listable && updates.profileVisibility !== 'public') return bad('mentor_profile_must_be_public', 'profileVisibility');
    patch.profileVisibility = updates.profileVisibility;
  }
  return { patch };
}

// Have these two people had a question together (a paid booking in either direction)?
async function haveContact(aId, bId) {
  if (!aId || !bId) return false;
  const { rows } = await query(
    `SELECT 1 FROM bookings
      WHERE ((seeker_id = $1 AND mentor_id = $2) OR (seeker_id = $2 AND mentor_id = $1))
        AND status IN ('paid', 'answered', 'refund_pending', 'refunded') LIMIT 1`, [aId, bId]);
  return rows.length > 0;
}

// May `viewer` (a user row, or null for a visitor) see this profile?
async function canView(owner, viewer) {
  if (owner.profileVisibility === 'public' || isListable(owner)) return true;
  if (!viewer) return false;
  if (viewer.id === owner.id || isAdmin(viewer)) return true;
  return haveContact(owner.id, viewer.id);
}

// The public page's data. `viewer` decides what the owner sees of their own profile (their visibility setting).
async function view(owner, viewer) {
  const listable = isListable(owner);
  const self = Boolean(viewer && viewer.id === owner.id);
  const out = {
    id: owner.id,
    username: owner.username,
    name: owner.name,
    headline: owner.headline,
    currentWork: owner.currentWork,
    city: owner.city,
    languages: owner.languages || [],
    bio: owner.bio,
    linkedinUrl: owner.linkedinUrl,
    websiteUrl: owner.websiteUrl,
    photoUrl: photoUrl(owner),
    color: owner.color,
    memberSince: owner.createdAt,
    isMentor: listable,
    isSelf: self,
    ...(self ? { visibility: owner.profileVisibility } : {})
  };
  if (listable) {
    const [stats, badges] = await Promise.all([mentorStatsFor([owner.id]), badgesFor([owner.id])]);
    out.mentor = { roleTitle: owner.roleTitle, niche: owner.niche, price: owner.price, badges: badges[owner.id] || [], ...stats[owner.id] };
  }
  return out;
}

// The stored photo (already processed by server/images.js). source: 'upload' or 'google'.
async function setPhoto(userId, img, source) {
  await query(
    `INSERT INTO user_photos (user_id, mime, data, source) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, source = EXCLUDED.source, updated_at = now()`,
    [userId, img.mime, img.data, source]
  );
  await query('UPDATE users SET photo_updated_at = now() WHERE id = $1', [userId]);
}

async function removePhoto(userId) {
  await query('DELETE FROM user_photos WHERE user_id = $1', [userId]);
  await query('UPDATE users SET photo_updated_at = NULL WHERE id = $1', [userId]);
}

module.exports = { LANGUAGES, LIMITS, parseProfileUpdates, canView, haveContact, view, isAdmin, setPhoto, removePhoto };
