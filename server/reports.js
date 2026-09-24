// "Report this mentor": from a mentor's profile or from an answer. Reports go to an admin queue.
// Who reported is visible only to admins. Two or more people reporting the same mentor flags them.
const { query } = require('./db');
const rules = require('./verification/rules');
const steps = require('./verification/steps');
const flags = require('./verification/flags');
const notify = require('./notify');
const { getUserById } = require('./models');

const REASONS = ['misleading', 'fake_credentials', 'inappropriate', 'spam', 'other'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class ReportError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function create({ reporter, mentorId, bookingId, reason, details }) {
  if (!REASONS.includes(reason)) throw new ReportError('invalid_reason');
  const text = details === undefined || details === null ? '' : String(details).trim();
  if (text.length > 1000) throw new ReportError('details_too_long');
  const mentor = await getUserById(mentorId);
  if (!mentor || !(mentor.role === 'mentor' || mentor.role === 'both')) throw new ReportError('not_found');
  if (mentor.id === reporter.id) throw new ReportError('cannot_report_self');

  let booking = null;
  if (bookingId) {
    const { rows } = await query('SELECT id FROM bookings WHERE id = $1 AND seeker_id = $2 AND mentor_id = $3', [/^[0-9a-f-]{36}$/i.test(String(bookingId)) ? bookingId : null, reporter.id, mentor.id]);
    if (!rows[0]) throw new ReportError('invalid_booking');
    booking = rows[0].id;
  }
  try {
    await query(`INSERT INTO mentor_reports (mentor_id, reporter_id, booking_id, reason, details) VALUES ($1, $2, $3, $4, $5)`, [mentor.id, reporter.id, booking, reason, text || null]);
  } catch (e) {
    if (e.code === '23505') throw new ReportError('already_reported'); // one open report per person per mentor
    throw e;
  }
  await steps.audit(mentor.id, steps.SYSTEM, 'report_received', { reason });

  const { rows } = await query(`SELECT count(DISTINCT reporter_id)::int AS n FROM mentor_reports WHERE mentor_id = $1 AND status = 'open'`, [mentor.id]);
  const flagged = rows[0].n >= rules.LIMITS.reportsToFlag && await flags.openFlag(mentor.id, 'reports', { count: rows[0].n });
  notify.notifyAdmins('A mentor was reported',
    `<p>${esc(mentor.name)} (${esc(mentor.email)}) was reported: ${esc(reason)}.${flagged ? ` This is report number ${rows[0].n}, so the mentor was flagged.` : ''} Open the review queue in the admin panel.</p>`);
}

async function listOpen() {
  const { rows } = await query(
    `SELECT r.*, m.name AS mentor_name, m.email AS mentor_email, m.verification_status AS mentor_status, p.name AS reporter_name, p.email AS reporter_email,
            (SELECT count(*)::int FROM mentor_reports x WHERE x.mentor_id = r.mentor_id AND x.status = 'open') AS open_for_mentor
       FROM mentor_reports r JOIN users m ON m.id = r.mentor_id LEFT JOIN users p ON p.id = r.reporter_id
      WHERE r.status = 'open' ORDER BY r.created_at LIMIT 200`
  );
  return rows.map((r) => ({
    id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, bookingId: r.booking_id, openForMentor: r.open_for_mentor,
    mentor: { id: r.mentor_id, name: r.mentor_name, email: r.mentor_email, status: r.mentor_status },
    reporter: r.reporter_id ? { name: r.reporter_name, email: r.reporter_email } : null
  }));
}

// An admin closes a report as "dismissed" or "upheld", with a written note. When fewer than the flag
// limit are left open, the "reports" flag closes by itself.
async function resolve(id, admin, resolution, note) {
  if (!['dismissed', 'upheld'].includes(resolution)) throw new ReportError('invalid_resolution');
  const text = String(note || '').trim();
  if (text.length < 5) throw new ReportError('reason_required');
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new ReportError('not_found');
  const { rows } = await query(
    `UPDATE mentor_reports SET status = 'resolved', resolution = $2, resolution_note = $3, resolved_by = $4, resolved_at = now()
      WHERE id = $1 AND status = 'open' RETURNING mentor_id`, [id, resolution, text.slice(0, 1000), admin.id]
  );
  if (!rows[0]) throw new ReportError('not_found');
  const mentorId = rows[0].mentor_id;
  await steps.audit(mentorId, steps.adminActor(admin), `report_${resolution}`, { reason: text });
  const left = (await query(`SELECT count(DISTINCT reporter_id)::int AS n FROM mentor_reports WHERE mentor_id = $1 AND status = 'open'`, [mentorId])).rows[0].n;
  if (left < rules.LIMITS.reportsToFlag) await flags.resolveFlags(mentorId, ['reports'], steps.adminActor(admin), `reports ${resolution}: ${text}`);
}

module.exports = { REASONS, ReportError, create, listOpen, resolve };
