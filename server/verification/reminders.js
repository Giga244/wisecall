// Friendly reminders for an application left unfinished (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2). At most two of each,
// then nothing more; they can be switched off from the email's footer (the "apply_reminders" category, server/inbox.js).
//   unfinished   not sent: 2 days and 7 days after the application last changed, with a link to the exact step it stopped at
//   ID only      sent, but the ID check has not passed (and ID checks are open): 2 and 7 days after sending
// Each reminder is claimed in the same statement that counts it (UPDATE ... RETURNING), so two servers never send the same one twice.
const { query } = require('../db');
const config = require('../config');
const { getUserById } = require('../models');

const AFTER_DAYS = [2, 7];
const due = (sent, at) => `${sent} < 2 AND ${at} < now() - make_interval(days => CASE ${sent} WHEN 0 THEN ${AFTER_DAYS[0]} ELSE ${AFTER_DAYS[1]} END)`;
const MENTOR_DRAFT = `role IN ('mentor', 'both') AND email_verified AND deleted_at IS NULL AND deletion_requested_at IS NULL`;

async function sweep() {
  const notify = require('../notify');
  const experience = require('./experience');
  let sent = 0;
  const unfinished = await query(
    `UPDATE users SET apply_reminders_sent = apply_reminders_sent + 1
      WHERE id IN (SELECT id FROM users WHERE ${MENTOR_DRAFT} AND verification_status IN ('none', 'pending', 'rejected')
                     AND application_submitted_at IS NULL AND apply_touched_at IS NOT NULL AND ${due('apply_reminders_sent', 'apply_touched_at')} LIMIT 50)
      RETURNING id, apply_reminders_sent`);
  for (const r of unfinished.rows) {
    const user = await getUserById(r.id);
    if (!user) continue;
    const path = await experience.progressFor(user);
    if (path.state !== 'draft') continue;
    await notify.notifyApplyReminder(user, { step: path.step, done: path.done, second: r.apply_reminders_sent === 2 });
    sent += 1;
  }
  if (config.ID_CHECKS_ENABLED) {
    const idOnly = await query(
      `UPDATE users SET id_reminders_sent = id_reminders_sent + 1
        WHERE id IN (SELECT u.id FROM users u WHERE ${MENTOR_DRAFT.replace(/(role|email_verified|deleted_at|deletion_requested_at)/g, 'u.$1')}
                       AND u.verification_status = 'pending' AND u.application_submitted_at IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM verification_steps s WHERE s.user_id = u.id AND s.step = 'id_kyc' AND s.status = 'passed')
                       AND ${due('u.id_reminders_sent', 'u.application_submitted_at')} LIMIT 50)
        RETURNING id`);
    for (const r of idOnly.rows) {
      const user = await getUserById(r.id);
      if (user) { await notify.notifyIdReminder(user); sent += 1; }
    }
  }
  return sent;
}

// The application changed: the reminders count from now (the two already sent stay sent).
const touch = (userId) => query('UPDATE users SET apply_touched_at = now() WHERE id = $1', [userId]);

module.exports = { sweep, touch, AFTER_DAYS };
