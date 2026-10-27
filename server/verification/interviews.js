// Video interviews for regulated niches: an admin publishes time slots, the mentor picks one, the admin
// adds the meeting link and afterwards records the result. The result goes through the same step
// decision as everything else, so it needs a written reason and is written to the audit log.
const { query, tx } = require('../db');
const rules = require('./rules');
const steps = require('./steps');
const notify = require('../notify');
const { getUserById } = require('../models');

const { VerificationError } = steps;
const STEP = 'video_interview';
const HOUR = 3600000;
const URL_RE = /^https:\/\/[^\s]+\.[^\s]+$/i;

const slotFromRow = (r) => ({
  id: r.id, startsAt: r.starts_at, minutes: r.minutes, status: r.status,
  meetingLink: r.meeting_link, linkSentAt: r.link_sent_at, result: r.result, reason: r.reason, decidedAt: r.decided_at
});

// ---- Admin: publish and manage slots ---------------------------------------------------------------
async function createSlots(admin, startsAtList, minutes) {
  const list = (Array.isArray(startsAtList) ? startsAtList : [startsAtList]).slice(0, 40);
  const length = minutes === undefined ? rules.LIMITS.interviewMinutes : Number(minutes);
  if (!list.length || !Number.isInteger(length) || length < 5 || length > 120) throw new VerificationError('invalid_slot');
  const latest = Date.now() + rules.LIMITS.interviewMaxDaysAhead * 24 * HOUR;
  const times = list.map((v) => {
    const d = new Date(v);
    if (typeof v !== 'string' || Number.isNaN(d.getTime()) || d.getTime() <= Date.now() || d.getTime() > latest) throw new VerificationError('invalid_slot');
    return d;
  });
  const out = [];
  for (const d of times) {
    const { rows } = await query(
      `INSERT INTO interview_slots (starts_at, minutes, created_by) VALUES ($1, $2, $3) RETURNING *`, [d, length, admin.id]
    );
    out.push(slotFromRow(rows[0]));
  }
  return out;
}

// Upcoming slots, plus what happened in the last month, each with the mentor who booked it.
async function listForAdmin() {
  const { rows } = await query(
    `SELECT s.*, u.name AS mentor_name, u.email AS mentor_email, u.niche AS mentor_niche
       FROM interview_slots s LEFT JOIN users u ON u.id = s.booked_by
      WHERE s.status IN ('open', 'booked') OR s.decided_at > now() - interval '30 days' OR (s.status = 'cancelled' AND s.starts_at > now() - interval '30 days')
      ORDER BY s.starts_at`
  );
  return rows.map((r) => ({
    ...slotFromRow(r), notes: r.notes,
    mentor: r.booked_by ? { id: r.booked_by, name: r.mentor_name, email: r.mentor_email, niche: r.mentor_niche } : null
  }));
}

async function deleteOpenSlot(id) {
  const { rowCount } = await query(`DELETE FROM interview_slots WHERE id = $1 AND status = 'open'`, [id]);
  if (!rowCount) throw new VerificationError('not_found');
}

async function loadBooked(id) {
  const { rows } = await query(`SELECT * FROM interview_slots WHERE id = $1 AND status = 'booked'`, [id]);
  if (!rows[0]) throw new VerificationError('not_found');
  return rows[0];
}

async function setMeetingLink(admin, id, link) {
  const value = String(link || '').trim();
  if (!URL_RE.test(value) || value.length > 500) throw new VerificationError('invalid_link');
  const row = await loadBooked(id);
  const { rows } = await query(`UPDATE interview_slots SET meeting_link = $2, link_sent_at = now() WHERE id = $1 RETURNING *`, [id, value]);
  const mentor = await getUserById(row.booked_by);
  await steps.audit(mentor.id, steps.adminActor(admin), 'interview_link_sent', { step: STEP });
  notify.notifyInterviewLink(mentor, slotFromRow(rows[0]));
  return slotFromRow(rows[0]);
}

// An admin cancels a booked interview. The mentor is told and can pick another time.
async function adminCancel(admin, id, reason) {
  const row = await loadBooked(id);
  const text = String(reason || '').trim().slice(0, 500);
  if (text.length < 5) throw new VerificationError('reason_required');
  await tx(async (client) => {
    await client.query(`UPDATE interview_slots SET status = 'cancelled' WHERE id = $1`, [id]);
    await client.query(`UPDATE verification_steps SET evidence = '{"requested": true}'::jsonb, updated_at = now() WHERE user_id = $1 AND step = $2 AND status = 'pending'`, [row.booked_by, STEP]);
  });
  const mentor = await getUserById(row.booked_by);
  await steps.audit(mentor.id, steps.adminActor(admin), 'interview_cancelled', { step: STEP, reason: text });
  notify.notifyInterviewCancelled(mentor, slotFromRow(row), text);
}

// Records how the interview went. `reason` is shown to the mentor; `notes` stay with the admins.
async function recordResult(admin, id, { result, reason, notes }) {
  if (!['passed', 'failed'].includes(result)) throw new VerificationError('invalid_decision');
  const row = await loadBooked(id);
  if (new Date(row.starts_at).getTime() > Date.now()) throw new VerificationError('not_started');
  // An interview's result always says why (passing an ordinary step no longer needs a reason: docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md).
  if (String(reason || '').trim().length < 5) throw new VerificationError('reason_required');
  // The same decision every other step goes through: audit log, delisting of a live mentor.
  await require('./review').decideStep({ mentorId: row.booked_by, step: STEP, decision: result, reason, admin });
  await query(
    `UPDATE interview_slots SET status = 'completed', result = $2, reason = $3, notes = $4, decided_by = $5, decided_at = now() WHERE id = $1`,
    [id, result, String(reason).trim().slice(0, 1000), notes ? String(notes).trim().slice(0, 2000) : null, admin.id]
  );
}

// ---- Mentor: pick, see, change --------------------------------------------------------------------
// A video interview is never required by default: only when an admin has asked this mentor for one (the step then exists).
const requires = async (user) => Boolean((await steps.loadSteps(user.id))[STEP]);

async function overview(user) {
  const required = await requires(user);
  if (!required) return { required: false, slots: [], booking: null, result: null };
  const cutoff = new Date(Date.now() + rules.LIMITS.interviewMinNoticeHours * HOUR);
  const [open, mine, last] = await Promise.all([
    query(`SELECT * FROM interview_slots WHERE status = 'open' AND starts_at > $1 ORDER BY starts_at LIMIT 60`, [cutoff]),
    query(`SELECT * FROM interview_slots WHERE status = 'booked' AND booked_by = $1`, [user.id]),
    query(`SELECT * FROM interview_slots WHERE status = 'completed' AND booked_by = $1 ORDER BY decided_at DESC LIMIT 1`, [user.id])
  ]);
  const idPassed = ((await steps.loadSteps(user.id)).id_kyc || {}).status === 'passed';
  const b = mine.rows[0];
  const l = last.rows[0];
  return {
    required: true,
    canBook: idPassed && !b,
    blocked: idPassed ? null : 'id_check_first',
    slots: open.rows.map((r) => ({ id: r.id, startsAt: r.starts_at, minutes: r.minutes })),
    booking: b ? { id: b.id, startsAt: b.starts_at, minutes: b.minutes, meetingLink: b.meeting_link } : null,
    result: l ? { result: l.result, reason: l.reason, at: l.decided_at } : null
  };
}

async function book(user, slotId) {
  if (!(await requires(user))) throw new VerificationError('not_required');
  const stepRows = await steps.loadSteps(user.id);
  if ((stepRows.id_kyc || {}).status !== 'passed') throw new VerificationError('id_check_first');
  if ((stepRows[STEP] || {}).status === 'passed') throw new VerificationError('already_passed');
  if (!/^[0-9a-f-]{36}$/i.test(String(slotId))) throw new VerificationError('slot_unavailable');

  let slot;
  try {
    const { rows } = await query(
      `UPDATE interview_slots SET status = 'booked', booked_by = $2, booked_at = now()
        WHERE id = $1 AND status = 'open' AND starts_at > $3 RETURNING *`,
      [slotId, user.id, new Date(Date.now() + rules.LIMITS.interviewMinNoticeHours * HOUR)]
    );
    slot = rows[0];
  } catch (e) {
    if (e.code === '23505') throw new VerificationError('already_booked'); // one booked interview per mentor
    throw e;
  }
  if (!slot) throw new VerificationError('slot_unavailable');

  await steps.setStep(user.id, STEP, 'pending', { evidence: { requested: true, interview: slot.starts_at.toISOString() }, replaceEvidence: true, actor: steps.mentorActor(user) });
  await steps.audit(user.id, steps.mentorActor(user), 'interview_booked', { step: STEP, reason: slot.starts_at.toISOString() });
  notify.notifyInterviewBooked(user, slotFromRow(slot));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  notify.notifyAdmins('A mentor booked a video interview', `<p>${esc(user.name)} (${esc(user.email)}) booked an interview for ${slot.starts_at.toISOString()}. Add the meeting link in the admin panel.</p>`);
  return slotFromRow(slot);
}

// The mentor gives the slot back. Only possible well before it starts.
async function cancel(user) {
  const { rows } = await query(`SELECT * FROM interview_slots WHERE status = 'booked' AND booked_by = $1`, [user.id]);
  const slot = rows[0];
  if (!slot) throw new VerificationError('not_found');
  if (new Date(slot.starts_at).getTime() < Date.now() + rules.LIMITS.interviewMinNoticeHours * HOUR) throw new VerificationError('too_late');
  await tx(async (client) => {
    await client.query(`UPDATE interview_slots SET status = 'open', booked_by = NULL, booked_at = NULL, meeting_link = NULL, link_sent_at = NULL WHERE id = $1`, [slot.id]);
    await client.query(`UPDATE verification_steps SET evidence = '{"requested": true}'::jsonb, updated_at = now() WHERE user_id = $1 AND step = $2 AND status = 'pending'`, [user.id, STEP]);
  });
  await steps.audit(user.id, steps.mentorActor(user), 'interview_cancelled', { step: STEP, reason: 'cancelled by the mentor' });
}

module.exports = { createSlots, listForAdmin, deleteOpenSlot, setMeetingLink, adminCancel, recordResult, overview, book, cancel };
