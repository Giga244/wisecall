// "Report this mentor": from a mentor's profile or from an answer. Reports go to an admin queue.
// Who reported is visible only to admins. Two or more people reporting the same mentor flags them.
const { query } = require('./db');
const rules = require('./verification/rules');
const steps = require('./verification/steps');
const flags = require('./verification/flags');
const notify = require('./notify');
const { getUserById } = require('./models');

const REASONS = ['misleading', 'fake_credentials', 'inappropriate', 'spam', 'other', 'contact_request', 'unsafe'];
const QUESTION_REASONS = ['contact_request', 'inappropriate', 'unsafe', 'spam', 'other'];
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
            (SELECT count(*)::int FROM mentor_reports x WHERE x.mentor_id = r.mentor_id AND x.status = 'open') AS open_for_mentor,
            b.question AS booking_question, b.answer AS booking_answer, b.asker_minor
       FROM mentor_reports r JOIN users m ON m.id = r.mentor_id LEFT JOIN users p ON p.id = r.reporter_id LEFT JOIN bookings b ON b.id = r.booking_id
      WHERE r.status = 'open' ORDER BY r.created_at LIMIT 200`
  );
  return rows.map((r) => ({
    id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, bookingId: r.booking_id, openForMentor: r.open_for_mentor,
    question: r.booking_question || null, answer: r.booking_answer || null, askerMinor: Boolean(r.asker_minor),
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

// ---- A mentor reports a question. No money is touched: an admin reads it, and can mark the question's asker or suspend whoever it concerns by hand. ----
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
async function createForQuestion({ reporterId, bookingId, reason, details }) {
  if (!QUESTION_REASONS.includes(reason)) throw new ReportError('invalid_reason');
  const text = details === undefined || details === null ? '' : String(details).trim();
  if (text.length > 1000) throw new ReportError('details_too_long');
  const { rows: [b] } = await query('SELECT id, asker_minor FROM bookings WHERE id = $1 AND mentor_id = $2', [isUuid(bookingId) ? bookingId : null, reporterId]);
  if (!b) throw new ReportError('not_found');
  try {
    await query('INSERT INTO question_reports (booking_id, reporter_id, reason, details) VALUES ($1, $2, $3, $4)', [b.id, reporterId, reason, text || null]);
  } catch (e) {
    if (e.code === '23505') throw new ReportError('already_reported');
    throw e;
  }
  notify.notifyAdmins(`A question was reported${b.asker_minor ? ' (the asker is 16-17)' : ''}`, `<p>Reason: ${esc(reason)}. Open the review queue in the admin panel.</p>`);
}
async function listOpenForQuestions() {
  const { rows } = await query(
    `SELECT r.*, b.question, b.asker_minor, a.name AS asker_name, a.email AS asker_email, p.name AS reporter_name, p.email AS reporter_email
       FROM question_reports r JOIN bookings b ON b.id = r.booking_id JOIN users a ON a.id = b.seeker_id LEFT JOIN users p ON p.id = r.reporter_id
      WHERE r.status = 'open' ORDER BY r.created_at LIMIT 200`);
  return rows.map((r) => ({
    id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, bookingId: r.booking_id, question: r.question, askerMinor: Boolean(r.asker_minor),
    asker: { name: r.asker_name, email: r.asker_email }, reporter: r.reporter_id ? { name: r.reporter_name, email: r.reporter_email } : null
  }));
}
async function resolveForQuestion(id, admin, resolution, note) {
  if (!['dismissed', 'upheld'].includes(resolution)) throw new ReportError('invalid_resolution');
  const text = String(note || '').trim();
  if (text.length < 5) throw new ReportError('reason_required');
  if (!isUuid(id)) throw new ReportError('not_found');
  const { rowCount } = await query(
    `UPDATE question_reports SET status = 'resolved', resolution = $2, resolution_note = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 AND status = 'open'`,
    [id, resolution, text.slice(0, 1000), admin.id]);
  if (!rowCount) throw new ReportError('not_found');
}

// ---- The admin's list of people (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6): the minors, and whoever had contact details stopped, with the counts. ----
async function people({ minor = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT u.id, u.name, u.email, u.role, u.verification_status, u.birth_ym, u.age_group, u.parent_permission_at, u.created_at,
              (SELECT count(*)::int FROM contact_blocks c WHERE c.user_id = u.id) + (SELECT count(*)::int FROM blocked_messages m WHERE m.sender_id = u.id) AS blocked,
              EXISTS (SELECT 1 FROM mentor_flags f WHERE f.mentor_id = u.id AND f.kind = 'unsafe' AND f.status = 'open') AS unsafe
         FROM users u WHERE u.deleted_at IS NULL) p
      WHERE p.age_group = 'minor_16_17' OR (NOT $1::boolean AND (p.blocked > 0 OR p.unsafe))
      ORDER BY p.blocked DESC, p.created_at DESC LIMIT 300`, [minor]);
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, role: r.role, verificationStatus: r.verification_status, birthYm: r.birth_ym, minor: r.age_group === 'minor_16_17',
    parentPermissionAt: r.parent_permission_at, blocked: r.blocked, unsafe: r.unsafe
  }));
}

module.exports = { REASONS, QUESTION_REASONS, ReportError, create, listOpen, resolve, createForQuestion, listOpenForQuestions, resolveForQuestion, people };
