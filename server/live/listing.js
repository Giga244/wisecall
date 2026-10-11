// The public list of upcoming live sessions (/live and GET /api/live), with its filters: field, language, type, date, price.
const { query } = require('../db');
const sessions = require('./sessions');
const { getUsersByIds, listableSql } = require('../models');

// filters: { niche, language, kind, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', maxPrice (lari), mentor: userId, limit }
async function upcoming(f = {}) {
  const where = [`s.status IN ('published', 'live')`, `s.starts_at + make_interval(mins => s.duration_min) > now()`, `EXISTS (SELECT 1 FROM users u WHERE u.id = s.mentor_id AND ${listableSql('u')})`];
  const args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (f.niche && /^[a-z_]{2,40}$/.test(String(f.niche))) add('s.niche = ?', String(f.niche));
  if (['ka', 'en'].includes(f.language)) add('s.language = ?', f.language);
  if (sessions.KINDS.includes(f.kind)) add('s.kind = ?', f.kind);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.from || ''))) add(`s.starts_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Tbilisi'`, f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.to || ''))) add(`s.starts_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Tbilisi')`, f.to);
  const maxPrice = Number(f.maxPrice);
  if (Number.isInteger(maxPrice) && maxPrice > 0) add('LEAST(s.price, COALESCE(s.early_price, s.price)) <= ?', maxPrice * 100);
  if (f.mentor && /^[0-9a-f-]{36}$/i.test(String(f.mentor))) add('s.mentor_id = ?', f.mentor);
  const limit = Math.min(Math.max(Number(f.limit) || 60, 1), 100);
  const { rows } = await query(
    `SELECT s.*, ${sessions.TAKEN_SQL} AS taken,
            (SELECT count(*)::int FROM live_tickets t WHERE t.session_id = s.id AND t.early AND (t.status IN ('paid', 'refund_pending') OR (t.status = 'held' AND t.hold_until > now()))) AS early_taken,
            EXISTS (SELECT 1 FROM live_session_covers c WHERE c.session_id = s.id) AS has_cover
       FROM live_sessions s WHERE ${where.join(' AND ')} ORDER BY s.starts_at LIMIT ${limit}`, args);
  const mentors = await getUsersByIds(rows.map((r) => r.mentor_id)); // (one query for all of them)
  return rows.map((r) => sessions.publicView(r, mentors.get(r.mentor_id)));
}

module.exports = { upcoming };
