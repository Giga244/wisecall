// Checks that run after a mentor is approved: low ratings, and the expiry of a professional license.
// Everything here only raises a flag or delists; an admin decides what happens next.
const { query } = require('../db');
const rules = require('./rules');
const steps = require('./steps');
const flags = require('./flags');
const notify = require('../notify');
const { getUserById, updateUser, mentorStatsFor } = require('../models');

const DAY = 86400000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// After a review: an average under the limit, once there are enough reviews, is flagged.
async function afterReview(mentorId) {
  const s = (await mentorStatsFor([mentorId]))[mentorId];
  const { lowRatingAverage, lowRatingMinReviews } = rules.LIMITS;
  if (s.reviewCount >= lowRatingMinReviews && s.ratingAvg !== null && s.ratingAvg < lowRatingAverage) {
    if (await flags.openFlag(mentorId, 'low_rating', { average: s.ratingAvg, reviews: s.reviewCount })) {
      const mentor = await getUserById(mentorId);
      notify.notifyAdmins('A mentor has a low rating', `<p>${esc(mentor.name)} (${esc(mentor.email)}) has an average rating of ${s.ratingAvg} from ${s.reviewCount} reviews. Please have a look in the mentor review.</p>`);
    }
  }
}

// One warning per licence expiry date, however often an admin closes the flag.
async function alreadyWarned(mentorId, kind, expiresAt) {
  const { rows } = await query(`SELECT 1 FROM mentor_flags WHERE mentor_id = $1 AND kind = $2 AND detail->>'expiresAt' = $3 LIMIT 1`, [mentorId, kind, expiresAt]);
  return rows.length > 0;
}

// Licenses that expire soon (a reminder for the admin) and licenses that have expired (the mentor leaves
// Browse experts until a renewed license is approved).
async function licenseSweep() {
  const soon = new Date(Date.now() + rules.LIMITS.licenseReminderDays * DAY);
  const { rows } = await query(
    `SELECT s.user_id, s.expires_at FROM verification_steps s JOIN users u ON u.id = s.user_id
      WHERE s.step = 'license' AND s.status = 'passed' AND s.expires_at IS NOT NULL AND s.expires_at <= $1 AND u.verification_status = 'verified'
      ORDER BY s.expires_at LIMIT 200`, [soon]
  );
  let reminded = 0;
  let delisted = 0;
  for (const r of rows) {
    const expiresAt = new Date(r.expires_at).toISOString();
    const mentor = await getUserById(r.user_id);
    if (!mentor) continue;
    if (new Date(r.expires_at) > new Date()) {
      if (await alreadyWarned(mentor.id, 'license_expiring', expiresAt)) continue;
      if (await flags.openFlag(mentor.id, 'license_expiring', { expiresAt })) {
        reminded += 1;
        notify.notifyAdmins('A mentor license expires soon',
          `<p>The license of ${esc(mentor.name)} (${esc(mentor.email)}) expires on ${expiresAt.slice(0, 10)}. Ask them for the renewed one, or they will leave Browse experts on that day.</p>`);
      }
    } else {
      // Expired: a required step no longer holds, so the mentor is taken off the site (the same rule as a failed step).
      await updateUser(mentor.id, { verificationStatus: 'pending' });
      await steps.audit(mentor.id, steps.SYSTEM, 'delisted', { from: 'verified', to: 'pending', step: 'license', reason: 'license expired' });
      await flags.openFlag(mentor.id, 'license_expired', { expiresAt });
      require('./updates').stepDecided(mentor.id, 'license', 'failed', null, 'license_expired');
      notify.notifyAdmins('A mentor license expired', `<p>The license of ${esc(mentor.name)} (${esc(mentor.email)}) expired on ${expiresAt.slice(0, 10)}. They were taken off Browse experts and asked for a renewed license.</p>`);
      delisted += 1;
    }
  }
  return { reminded, delisted };
}

module.exports = { afterReview, licenseSweep };
