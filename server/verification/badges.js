// Public trust badges: one per check a mentor has really passed, with the date. Nothing else about
// the check is ever public (no license number, no document, no personal data).
const steps = require('./steps');

// badge key -> the step that earns it. "Work email" and "Diploma" are optional: they appear only for mentors who added them.
// (Mentors approved under the first rules keep "Video interviewed" if they had one.)
const BADGE_STEPS = { id: 'id_kyc', experience: 'experience', license: 'license', workEmail: 'work_email', diploma: 'diploma', interview: 'video_interview' };

// -> { [mentorId]: [{ key, date }] }. An expired step (for example a lapsed license) earns nothing.
// Two more (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4): "Founding mentor" (approved before launch, for good) and
// "University lecturer · <university>" (a checked page on a known Georgian university's site, or confirmed by an admin; an admin can remove
// it). Only for approved mentors.
async function badgesFor(mentorIds) {
  const map = await steps.loadStepsFor(mentorIds);
  const extra = await extraBadges(mentorIds);
  const out = {};
  for (const id of mentorIds) {
    out[id] = Object.entries(BADGE_STEPS)
      .filter(([, step]) => steps.effectiveStatus(map[id][step]) === 'passed')
      .map(([key, step]) => ({ key, date: map[id][step].decidedAt }))
      .concat(extra[id] || []);
  }
  return out;
}

async function extraBadges(mentorIds) {
  const ids = mentorIds.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
  if (!ids.length) return {};
  const { query } = require('../db');
  const { knownUniversity, byDomain } = require('../universities');
  const [users, pages] = await Promise.all([
    query(`SELECT id, founding_mentor_at, university_domain, university_badge, verification_decided_at FROM users WHERE id = ANY($1::uuid[]) AND verification_status = 'verified'`, [ids]),
    query(`SELECT user_id, url, coalesce(checked_at, created_at) AS at FROM mentor_evidence WHERE user_id = ANY($1::uuid[]) AND kind = 'university' AND check_status = 'ok' ORDER BY created_at`, [ids])
  ]);
  const out = {};
  for (const u of users.rows) {
    const list = [];
    if (u.founding_mentor_at) list.push({ key: 'founding', date: u.founding_mentor_at });
    if (u.university_badge !== 'removed') {
      const page = pages.rows.find((p) => p.user_id === u.id && knownUniversity(p.url));
      const uni = u.university_badge === 'confirmed' && u.university_domain ? byDomain(u.university_domain) : (page ? knownUniversity(page.url) : null);
      if (uni) list.push({ key: 'university', date: page ? page.at : u.verification_decided_at, university: { en: uni.en, ka: uni.ka } });
    }
    out[u.id] = list;
  }
  return out;
}

// The university an admin would confirm for a mentor: a known one from any of their university pages (checked or not). -> { domain, en, ka } | null
async function universityGuess(mentorId) {
  const { query } = require('../db');
  const { knownUniversity } = require('../universities');
  const { rows } = await query(`SELECT url FROM mentor_evidence WHERE user_id = $1 AND kind IN ('university', 'website', 'other', 'publication') ORDER BY created_at`, [mentorId]);
  for (const r of rows) { const u = knownUniversity(r.url); if (u) return u; }
  return null;
}

module.exports = { badgesFor, BADGE_STEPS, universityGuess };
