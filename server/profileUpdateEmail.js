// The one-off "profile update" email (admin → Mentors, "პროფილის განახლების წერილი"): approved mentors whose profile lacks one of the
// parts added since they were approved get one short, personal email naming only what THEY lack:
//   path   "ჩემი გზა" is not complete (server/mentorStory.js pathComplete)
//   about  no "შენ შესახებ" of their own (ownAbout: a copy of the path does not count; an About they wrote, however short, does)
//   photo  no profile photo
// Mentors with nothing missing are not on the list. Each mentor gets it at most once: users.profile_update_sent_at is set before the email
// goes out (by one UPDATE that only succeeds while it is empty, so two clicks can never send it twice), and cleared again only when the
// email service refused it. Nothing is sent by the preview: only send(), from the admin's "გაგზავნა", with the mentors they left ticked.
// Georgian, or English for a mentor whose language is English; from EMAIL_FROM, replies to SUPPORT_EMAIL (server/email.js).
const { query } = require('./db');
const { userFromRow, userColumnsSql } = require('./models');
const mentorStory = require('./mentorStory');
const { render, sendTemplate } = require('./mail');

const PARTS = ['path', 'about', 'photo'];

// What this mentor's profile lacks, in the email's order.
function missingParts(u) {
  return PARTS.filter((p) => ({
    path: !mentorStory.pathComplete(u),
    about: !mentorStory.ownAbout(u).trim(),
    photo: !u.photoUpdatedAt
  }[p]));
}
// The mentor's site language (the preview's choice starts on it): Georgian, or English for a mentor whose language is English.
const langOf = (u) => (u.language === 'en' ? 'en' : 'ka');
const LANGS = ['ka', 'en'];
// The first name for "გამარჯობა, {name}!" (the whole name when it is one word).
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const emailFor = (u, parts, lang) => render('profileUpdate', lang, { name: firstName(u.name), parts });
const shown = (m) => ({ subject: m.subject, html: m.html, text: m.text });

// Approved mentors (not being deleted), each with when they got the email.
async function approvedMentors(ids = null) {
  const { rows } = await query(
    `SELECT ${userColumnsSql()}, users.profile_update_sent_at AS pu_sent_at FROM users
      WHERE role IN ('mentor', 'both') AND verification_status = 'verified' AND deleted_at IS NULL AND deletion_requested_at IS NULL
        AND email IS NOT NULL ${ids ? 'AND id = ANY($1::uuid[])' : ''}
      ORDER BY name`, ids ? [ids] : []);
  return rows.map((r) => ({ user: userFromRow(r), sentAt: r.pu_sent_at || null }));
}

// The admin's preview: who would get it, what each lacks and the exact email in each language (language: the one chosen to begin with,
// from their site language; the admin can choose the other); and who already got it (with the date).
async function preview() {
  const all = await approvedMentors();
  const list = [];
  const sent = [];
  for (const { user: u, sentAt } of all) {
    const parts = missingParts(u);
    if (sentAt) { sent.push({ id: u.id, name: u.name, email: u.email, sentAt, missing: parts }); continue; }
    if (!parts.length) continue; // (a complete profile: nothing to ask for)
    const messages = Object.fromEntries(LANGS.map((l) => [l, shown(emailFor(u, parts, l))]));
    list.push({ id: u.id, name: u.name, email: u.email, username: u.username, language: langOf(u), missing: parts, message: messages[langOf(u)], messages });
  }
  return { mentors: list, sent };
}

// "გაგზავნა": to each of these mentors who is still approved, still lacks something and has not had it, in the language the admin chose
// for them (langs: { [id]: 'ka' | 'en' }; anything else, or none: their site language). -> { sent: [{ id, sentAt, language }], skipped, failed }
async function send(ids, langs = {}) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))))];
  const out = { sent: [], skipped: [], failed: [] };
  if (!wanted.length) return out;
  const found = new Map((await approvedMentors(wanted)).map((m) => [m.user.id, m]));
  for (const id of wanted) {
    const m = found.get(id);
    const parts = m ? missingParts(m.user) : [];
    if (!m || m.sentAt || !parts.length) { out.skipped.push({ id, reason: !m ? 'not_approved' : (m.sentAt ? 'already_sent' : 'complete') }); continue; }
    // (claimed first: a second click, or a second admin, finds it taken)
    const claim = await query(`UPDATE users SET profile_update_sent_at = now() WHERE id = $1 AND profile_update_sent_at IS NULL RETURNING profile_update_sent_at`, [id]);
    if (!claim.rowCount) { out.skipped.push({ id, reason: 'already_sent' }); continue; }
    const u = m.user;
    const chosen = langs && Object.prototype.hasOwnProperty.call(langs, id) && LANGS.includes(langs[id]) ? langs[id] : langOf(u);
    try {
      const r = await sendTemplate('profileUpdate', { to: u.email, lang: chosen, data: { name: firstName(u.name), parts } });
      if (r && r.sent === false) throw new Error(r.reason || 'not_sent');
      out.sent.push({ id, sentAt: claim.rows[0].profile_update_sent_at, language: chosen });
    } catch (e) {
      // (refused by the email service: not marked as sent, so it can be tried again)
      await query(`UPDATE users SET profile_update_sent_at = NULL WHERE id = $1`, [id]);
      console.error('[profile-update] not sent:', e.message);
      out.failed.push({ id });
    }
  }
  return out;
}

module.exports = { missingParts, preview, send, PARTS };
