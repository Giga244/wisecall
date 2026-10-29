// Friendly reminders for an application left unfinished (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2). At most two of each,
// then nothing more; they can be switched off from the email's footer (the "apply_reminders" category, server/inbox.js).
//   unfinished   not sent: 2 days and 7 days after the application last changed, with a link to the exact step it stopped at (when only
//                the ID check is left, the reminder is about the ID check alone)
//   ID only      sent, but the ID check has not passed and is not with the partner (and ID checks are open): 2 and 7 days after sending
// Each reminder is claimed in the same statement that counts it (UPDATE ... RETURNING), so two servers never send the same one twice.
// Besides these: "Wisecall – one step left" right after sending without the ID check (once per mentor), and an admin's "send ID reminder"
// (at most once in 48 hours per mentor). Both are written to the mentor's audit log, which is how "once" is known.
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
    if (path.idLeft) await notify.notifyIdReminder(user, { draft: true, second: r.apply_reminders_sent === 2 });
    else await notify.notifyApplyReminder(user, { step: path.step, done: path.done, second: r.apply_reminders_sent === 2 });
    sent += 1;
  }
  if (config.ID_CHECKS_ENABLED) {
    const idOnly = await query(
      `UPDATE users SET id_reminders_sent = id_reminders_sent + 1
        WHERE id IN (SELECT u.id FROM users u WHERE ${MENTOR_DRAFT.replace(/(role|email_verified|deleted_at|deletion_requested_at)/g, 'u.$1')}
                       AND u.verification_status = 'pending' AND u.application_submitted_at IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM verification_steps s WHERE s.user_id = u.id AND s.step = 'id_kyc'
                                         AND (s.status = 'passed' OR (s.status = 'pending' AND s.evidence->>'state' = 'in_review')))
                       AND NOT EXISTS (SELECT 1 FROM verification_steps s WHERE s.user_id = u.id AND s.step = 'age' AND s.status = 'failed')
                       AND ${due('u.id_reminders_sent', 'u.application_submitted_at')} LIMIT 50)
        RETURNING id, id_reminders_sent`);
    for (const r of idOnly.rows) {
      const user = await getUserById(r.id);
      if (user) { await notify.notifyIdReminder(user, { second: r.id_reminders_sent === 2 }); sent += 1; }
    }
  }
  return sent;
}

// The application changed: the reminders count from now (the two already sent stay sent).
const touch = (userId) => query('UPDATE users SET apply_touched_at = now() WHERE id = $1', [userId]);

const steps = () => require('./steps');
// Sent while the ID check is still to do: "Wisecall – one step left", with a link that starts it. Once per mentor, ever (a second send
// after "Edit my application" gets nothing more). -> true when it was sent now
async function oneStepLeft(user) {
  const claimed = await query(
    `INSERT INTO verification_audit (mentor_id, actor_label, action, reason)
       SELECT $1, 'system', 'id_one_step_email', 'Sent without the ID check: "one step left" emailed'
        WHERE NOT EXISTS (SELECT 1 FROM verification_audit WHERE mentor_id = $1 AND action = 'id_one_step_email') RETURNING id`, [user.id]);
  if (!claimed.rowCount) return false;
  await require('../notify').notifyIdOneStep(user);
  return true;
}

// An admin's "send ID reminder" for an application stuck on the ID check: the same email as the reminders, at most once in 48 hours per
// mentor. -> { sent: true } or { sent: false, nextAt } (when the next one is allowed)
const ADMIN_EVERY_HOURS = 48;
async function adminIdReminder(mentor, admin) {
  const experience = require('./experience');
  const path = await experience.progressFor(mentor);
  if (!path.idLeft) throw new (steps().VerificationError)('not_waiting_for_id');
  const claimed = await query(
    `INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason)
       SELECT $1, $2, $3, 'id_reminder_sent', 'ID reminder emailed by an admin'
        WHERE NOT EXISTS (SELECT 1 FROM verification_audit WHERE mentor_id = $1 AND action = 'id_reminder_sent'
                            AND created_at > now() - make_interval(hours => $4)) RETURNING id`, [mentor.id, admin.id, admin.email, ADMIN_EVERY_HOURS]);
  if (!claimed.rowCount) {
    const { rows: [last] } = await query(`SELECT max(created_at) AS at FROM verification_audit WHERE mentor_id = $1 AND action = 'id_reminder_sent'`, [mentor.id]);
    return { sent: false, nextAt: new Date(new Date(last.at).getTime() + ADMIN_EVERY_HOURS * 3600 * 1000) };
  }
  await require('../notify').notifyIdReminder(mentor, { draft: path.state === 'draft' });
  return { sent: true };
}

module.exports = { sweep, touch, oneStepLeft, adminIdReminder, AFTER_DAYS, ADMIN_EVERY_HOURS };
