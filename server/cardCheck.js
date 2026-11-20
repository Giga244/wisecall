// Every mentor's expert card, kept whole (docs/CLAUDE-CODE-CARD-CHECKS.md). A card once showed a sentence about a mentor's family (from "ჩემი
// გზა"), another nothing at all, and a role read "FInance". Three guards:
//   1. the mentor's form: "შესახებ" counted and hinted (150 for a new application, up to 2000), with a live preview of the card;
//   2. the admin's review: the card as students will see it, the warnings below, and the texts editable from there (audit-logged);
//   3. once a day: the admins get a list of approved mentors whose card has no text or has a warning (nothing to report: no email).
//
//   warningsFor(user, { showAbout })  -> [{ code, field, word? }] (an empty list: nothing to fix)
//     card_empty      no About everyone may see and no "რაში დაგეხმარები": the card has no text
//     about_missing   no About of their own (empty, or only the copy of their path)
//     about_short     an About under 150 characters (a warning: an approved mentor is never refused a save for it)
//     about_personal  an About that reads like the personal story (a family, children…): a warning, never a refusal
//     odd_caps        a name, role, headline or field with two capitals and then small letters at the start of a word ("FInance")
//     headline_missing, photo_missing
//   cardFor(user)        the card as /api/experts sends it (for the previews)
//   adminEdit(admin, mentorId, input)  the About, headline, role, "რაში დაგეხმარები" and "ჩემი გზა", set by an admin, each change audit-logged
//   dailyReport()        at most once a day; emails the list, or nothing
const { query } = require('./db');
const config = require('./config');
const mentorStory = require('./mentorStory');

// Two or more capitals, then a small letter, at the start of a word: "FInance", "INternational". (All capitals is an abbreviation, "MBA";
// one capital is a name, "Finance"; "PhD" and "iOS" start otherwise.)
const ODD_CAPS = /(?:^|[^\p{L}])(\p{Lu}{2,}\p{Ll}[\p{L}]*)/gu;
function oddCaps(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ODD_CAPS)) out.push(m[1]);
  return out;
}
// Words of a personal story rather than a professional About (family, children, marriage), Georgian and English. Only a warning: an admin
// reads it and decides.
const PERSONAL = /(ცოლ|ქმარ|შვილ|ოჯახ|დაქორწინ|\bwife\b|\bhusband\b|\bkids?\b|\bchildren\b|\bsons?\b|\bdaughters?\b|\bfamily\b|\bmarried\b)/iu;
const looksPersonal = (text) => PERSONAL.test(String(text || ''));

// level: 'error' (the card has no text, or there is no About) or 'warning' (the rest, an About under 150 among them: an approved mentor is
// never refused a save for it, it is only pointed out).
const ERRORS = ['card_empty', 'about_missing'];
function warningsFor(u, { showAbout = true } = {}) {
  const out = [];
  const add = (w) => out.push({ ...w, level: ERRORS.includes(w.code) ? 'error' : 'warning' });
  const about = mentorStory.ownAbout(u).trim();
  const help = (u.helpPoints || []).filter((x) => String(x || '').trim());
  if (!(showAbout && (about || help.length))) add({ code: 'card_empty', field: 'about' });
  if (!about) add({ code: 'about_missing', field: 'about' });
  else if (mentorStory.aboutReason(about) === 'short') add({ code: 'about_short', field: 'about' });
  if (about && looksPersonal(about)) add({ code: 'about_personal', field: 'about' });
  for (const [field, value] of [['name', u.name], ['roleTitle', u.roleTitle], ['headline', u.headline], ['customNiche', u.customNiche]]) {
    for (const word of oddCaps(value)) add({ code: 'odd_caps', field, word });
  }
  if (!String(u.headline || '').trim()) add({ code: 'headline_missing', field: 'headline' });
  if (!u.photoUpdatedAt) add({ code: 'photo_missing', field: 'photo' });
  return out;
}

// The card as Browse shows it: the same fields as /api/experts sends (server/routes/experts.js).
async function cardFor(u) {
  const { publicProfile } = require('./util');
  const { mentorStatsFor } = require('./models');
  const { badgesFor } = require('./verification/badges');
  const [summaries, stats, badges] = await Promise.all([require('./profileSections').publicSummaries([u]), mentorStatsFor([u.id]), badgesFor([u.id])]);
  const s = summaries[u.id] || null;
  const showAbout = Boolean(s && s.showAbout);
  return {
    ...publicProfile(u), ...(stats[u.id] || {}), badges: badges[u.id] || [],
    bio: showAbout ? (mentorStory.ownAbout(u) || null) : null, profile: s, trust: mentorStory.cardView(u, { showAbout })
  };
}

// ---- The admin edits a mentor's texts -----------------------------------------------------------------------------------------------------
class CardEditError extends Error { constructor(code, field) { super(code); this.code = code; this.field = field; } }
const ADMIN_FIELDS = ['about', 'headline', 'roleTitle', 'helpPoints', 'pathStart', 'pathHow', 'pathNow'];
// (the About's limit, as for the mentor)
const ADMIN_ABOUT_MAX = mentorStory.LIMITS.aboutMax;
const shown = (v) => (Array.isArray(v) ? v.join(' | ') : String(v === null || v === undefined ? '' : v));
const cut = (s, n = 400) => ([...s].length > n ? [...s].slice(0, n).join('') + '…' : s);

async function adminEdit(admin, mentorId, input) {
  const { getUserById, updateUser } = require('./models');
  const textSafety = require('./textSafety');
  const user = await getUserById(mentorId);
  if (!user || !(user.role === 'mentor' || user.role === 'both')) throw new CardEditError('not_found');
  const b = input || {};
  const patch = {};
  const one = (v, max, field) => {
    if (v !== null && typeof v !== 'string') throw new CardEditError('invalid_field', field);
    const s = textSafety.cleanText(v || '').replace(/\s+/g, ' ').trim();
    if ([...s].length > max) throw new CardEditError(`${field}_too_long`, field);
    return s || null;
  };
  if (b.about !== undefined) {
    if (b.about !== null && typeof b.about !== 'string') throw new CardEditError('invalid_field', 'about');
    const s = textSafety.cleanText(b.about || '');
    if ([...s].length > ADMIN_ABOUT_MAX) throw new CardEditError('about_too_long', 'about');
    if (s && textSafety.findBlockedContact(s).length) throw new CardEditError('contact_details', 'about');
    patch.bio = s || null;
  }
  if (b.headline !== undefined) patch.headline = one(b.headline, 100, 'headline');
  if (b.roleTitle !== undefined) {
    const v = one(b.roleTitle, require('./verification/rules').LIMITS.titleMax, 'roleTitle');
    if (!v) throw new CardEditError('invalid_field', 'roleTitle'); // (a listed mentor always has a role: Browse needs it)
    patch.roleTitle = v;
  }
  // ("რაში დაგეხმარები" and "ჩემი გზა": the mentor's own limits and checks, as a draft: an admin may fix one block without the others)
  const story = {};
  for (const k of ['helpPoints', 'pathStart', 'pathHow', 'pathNow']) if (b[k] !== undefined) story[k] = b[k];
  if (Object.keys(story).length) {
    const r = mentorStory.parse(story, { draft: true, current: user });
    if (r.error) throw new CardEditError(r.error, r.field);
    Object.assign(patch, r.patch);
  }
  const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k] ?? null) !== JSON.stringify(user[k] ?? null));
  if (!changed.length) return { user, changed: [] };
  const only = Object.fromEntries(changed.map((k) => [k, patch[k]]));
  require('./verification/experience').pathToStory(user, only); // (a complete path is the application's story, as a mentor's save makes it)
  const updated = await updateUser(user.id, only);
  const label = admin.email || 'admin';
  for (const k of changed) {
    await query(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, step, reason) VALUES ($1, $2, $3, 'admin_text_edit', $4, $5)`,
      [user.id, admin.id, label, k === 'bio' ? 'about' : k, `${cut(shown(user[k]))} → ${cut(shown(patch[k]))}`]);
  }
  return { user: updated, changed: changed.map((k) => (k === 'bio' ? 'about' : k)) };
}

// ---- Once a day: the list for the admins --------------------------------------------------------------------------------------------------
// Claimed in site_settings ('card_check'), so one instance sends it, at most once in 23 hours. -> the number of mentors listed (0: no email)
async function dailyReport({ force = false } = {}) {
  const { rows: claimed } = await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('card_check', '{}'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET updated_at = now() WHERE site_settings.updated_at < now() - interval '23 hours' OR $1
     RETURNING key`, [force]);
  if (!claimed.length) return 0;
  const list = await problems();
  if (!list.length) return 0;
  await send(list);
  return list.length;
}

// Approved mentors with something to fix on their card.
async function problems() {
  const { userFromRow } = require('./models');
  const { rows } = await query(`SELECT * FROM users WHERE role IN ('mentor', 'both') AND verification_status = 'verified' AND deleted_at IS NULL AND deletion_requested_at IS NULL ORDER BY created_at`);
  const users = rows.map(userFromRow);
  if (!users.length) return [];
  const summaries = await require('./profileSections').publicSummaries(users);
  return users.map((u) => ({ user: u, warnings: warningsFor(u, { showAbout: Boolean(summaries[u.id] && summaries[u.id].showAbout) }) }))
    .filter((x) => x.warnings.length);
}

// (the admins' email is in English, like the other admin emails)
const WORDS = {
  card_empty: 'the card has no text (no About, no "I can help with")', about_missing: 'no About', about_short: 'About under 150 characters (a warning)',
  about_personal: 'About may be personal story text', odd_caps: 'odd capitals', headline_missing: 'no headline', photo_missing: 'no photo'
};
const warningText = (w) => (w.code === 'odd_caps' ? `odd capitals in ${w.field}: "${w.word}"` : WORDS[w.code] || w.code);

async function send(list) {
  const { sendEmail, escapeHtml } = require('./email');
  const to = config.ALERT_EMAILS && config.ALERT_EMAILS.length ? config.ALERT_EMAILS : config.ADMIN_EMAILS;
  if (!to.length) return;
  const link = (u) => `${config.PUBLIC_URL}/ka/u/${encodeURIComponent(u.username || '')}`;
  const html = `<p>${list.length} approved mentor(s) have something to fix on their expert card. You can fix the texts from the admin panel (Mentors → Review).</p><ul>`
    + list.map(({ user: u, warnings }) => `<li><strong>${escapeHtml(u.name || '')}</strong> — <a href="${escapeHtml(link(u))}">${escapeHtml(link(u))}</a><br>${warnings.map((w) => escapeHtml(warningText(w))).join('; ')}</li>`).join('')
    + '</ul><p>Sent once a day while there is something on the list.</p>';
  const text = `${list.length} approved mentor(s) have something to fix on their expert card.\n\n${list.map(({ user: u, warnings }) => `- ${u.name} (${link(u)}): ${warnings.map(warningText).join('; ')}`).join('\n')}\n\nSent once a day while there is something on the list.`;
  const subject = `Wisecall: ${list.length} mentor card(s) to check`;
  await Promise.all(to.map((address) => sendEmail({ to: address, subject, html, text }).catch((e) => console.error('[card-check] email failed:', e.message))));
}

module.exports = { warningsFor, oddCaps, looksPersonal, cardFor, adminEdit, CardEditError, ADMIN_FIELDS, dailyReport, problems, warningText };
