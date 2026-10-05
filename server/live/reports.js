// Reporting a live session (from its page or from the room). An open report holds the session's payout (server/ledger.js) until an admin
// closes it; an admin can also end a live room at once, which refunds everybody (server/live/sessions.js cancel 'admin_safety').
const { query } = require('../db');
const textSafety = require('../textSafety');
const { LiveError } = require('./sessions');

const REASONS = ['not_as_described', 'unsafe', 'abuse', 'spam', 'other'];

async function report(user, sessionId, { reason, details } = {}) {
  if (!REASONS.includes(reason)) throw new LiveError('invalid_reason');
  const { rows: [s] } = await query('SELECT id, title, mentor_id, status FROM live_sessions WHERE id = $1', [sessionId]);
  if (!s || !['published', 'live', 'ended'].includes(s.status)) throw new LiveError('not_found');
  if (s.mentor_id === user.id) throw new LiveError('own_session');
  const note = typeof details === 'string' ? textSafety.cleanText(details).slice(0, 1000) : '';
  const { rowCount } = await query(
    `INSERT INTO live_reports (session_id, reporter_id, reason, details) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id, reporter_id) WHERE status = 'open' DO NOTHING`,
    [s.id, user.id, reason, note || null]);
  if (!rowCount) throw new LiveError('already_reported');
  require('../notify').notifyAdmins(s.status === 'live' ? 'A LIVE session was reported (it is happening now)' : 'A live session was reported',
    `<p>Reason: ${reason}. See the admin panel, Live sessions. The mentor's payout for it is on hold until the report is closed.</p>`);
  return { ok: true };
}

async function listOpen() {
  const { rows } = await query(
    `SELECT r.*, s.title, s.slug, s.status AS session_status, u.email AS reporter_email
       FROM live_reports r JOIN live_sessions s ON s.id = r.session_id LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 200`);
  return rows.map((r) => ({ id: r.id, sessionId: r.session_id, title: r.title, slug: r.slug, sessionStatus: r.session_status, reason: r.reason,
    details: r.details, reporter: r.reporter_email, createdAt: r.created_at }));
}

async function resolve(admin, reportId, resolution) {
  const text = textSafety.cleanText(String(resolution || ''));
  if (text.length < 3) throw new LiveError('reason_required');
  const { rowCount } = await query(
    `UPDATE live_reports SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 AND status = 'open'`, [reportId, text.slice(0, 500), admin.id]);
  if (!rowCount) throw new LiveError('not_found');
  return { ok: true };
}

module.exports = { REASONS, report, listOpen, resolve };
