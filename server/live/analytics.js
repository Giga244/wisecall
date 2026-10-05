// Numbers about live sessions: for a mentor (Dashboard → Live sessions) and for the admin overview (Milestone 2). Integer tetri.
const { query } = require('../db');

// Per session and in total: tickets sold, attendance (in the room at least a minute), money (what people paid after refunds, the fee,
// the mentor's share), the rating, questions asked; and the mentor's followers.
async function forMentor(mentorId) {
  const { rows } = await query(
    `SELECT s.id, s.title, s.slug, s.starts_at, s.status, s.end_kind, s.max_seats,
            count(t.id) FILTER (WHERE t.status IN ('paid', 'refund_pending', 'refunded'))::int AS sold,
            count(t.id) FILTER (WHERE t.status = 'paid')::int AS kept,
            count(t.id) FILTER (WHERE t.status = 'paid' AND t.attended_seconds >= 60)::int AS attended,
            COALESCE(sum(t.price - COALESCE(t.refunded_amount, 0)) FILTER (WHERE t.status = 'paid'), 0)::int AS gross,
            COALESCE(sum(t.fee - round(COALESCE(t.refunded_amount, 0)::numeric * t.fee / t.price)) FILTER (WHERE t.status = 'paid'), 0)::int AS fee,
            (SELECT round(avg(r.stars)::numeric, 1) FROM live_ratings r WHERE r.session_id = s.id AND r.hidden_at IS NULL) AS rating,
            (SELECT count(*)::int FROM live_ratings r WHERE r.session_id = s.id AND r.hidden_at IS NULL) AS ratings,
            (SELECT count(*)::int FROM live_questions q WHERE q.session_id = s.id) AS questions
       FROM live_sessions s LEFT JOIN live_tickets t ON t.session_id = s.id
      WHERE s.mentor_id = $1 AND s.status <> 'draft'
      GROUP BY s.id ORDER BY s.starts_at DESC LIMIT 200`, [mentorId]);
  const sessions = rows.map((r) => ({
    id: r.id, title: r.title, slug: r.slug, startsAt: r.starts_at, status: r.status, endKind: r.end_kind, maxSeats: r.max_seats, sold: r.sold,
    // (attendance only for a session that took place)
    attended: r.attended, attendanceRate: r.kept && r.status === 'ended' && r.end_kind === 'normal' ? Math.round((r.attended / r.kept) * 100) : null,
    gross: r.gross, fee: r.fee, net: r.gross - r.fee, rating: r.rating === null ? null : Number(r.rating), ratings: r.ratings, questions: r.questions
  }));
  const held = sessions.filter((s) => s.status === 'ended' && s.endKind === 'normal');
  const sum = (k, list = sessions) => list.reduce((a, s) => a + (s[k] || 0), 0);
  const kept = held.reduce((a, s) => a + (s.attended || 0), 0);
  const { rows: [f] } = await query('SELECT count(*)::int AS n FROM mentor_follows WHERE mentor_id = $1', [mentorId]);
  const { rows: [rt] } = await query(`SELECT round(avg(stars)::numeric, 1) AS avg, count(*)::int AS n FROM live_ratings WHERE mentor_id = $1 AND hidden_at IS NULL`, [mentorId]);
  const soldHeld = sum('sold', held);
  return {
    sessions,
    totals: { sessions: sessions.length, held: held.length, sold: sum('sold'), attended: kept, attendanceRate: soldHeld ? Math.round((kept / soldHeld) * 100) : null,
      // (money: only sessions that took place; an upcoming one is earned once it is held)
      gross: sum('gross', held), fee: sum('fee', held), net: sum('gross', held) - sum('fee', held), rating: rt.avg === null ? null : Number(rt.avg), ratings: rt.n, questions: sum('questions'), followers: f.n }
  };
}

// The admin overview: what is coming, what is live, the last 30 days.
async function forAdmin() {
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE status = 'published')::int AS upcoming,
            count(*) FILTER (WHERE status = 'review')::int AS review,
            count(*) FILTER (WHERE status = 'live')::int AS live_now,
            count(*) FILTER (WHERE status = 'ended' AND ended_at > now() - interval '30 days')::int AS ended30,
            count(*) FILTER (WHERE status = 'cancelled' AND cancelled_at > now() - interval '30 days')::int AS cancelled30
       FROM live_sessions`);
  const { rows: [m] } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('paid', 'refund_pending', 'refunded'))::int AS tickets30,
            COALESCE(sum(price - COALESCE(refunded_amount, 0)) FILTER (WHERE status = 'paid'), 0)::bigint AS gross30,
            COALESCE(sum(fee - round(COALESCE(refunded_amount, 0)::numeric * fee / price)) FILTER (WHERE status = 'paid'), 0)::bigint AS fee30
       FROM live_tickets WHERE paid_at > now() - interval '30 days'`);
  const { rows: [rep] } = await query(`SELECT count(*)::int AS n FROM live_reports WHERE status = 'open'`);
  return { upcoming: r.upcoming, review: r.review, liveNow: r.live_now, ended30: r.ended30, cancelled30: r.cancelled30, tickets30: m.tickets30,
    gross30: Number(m.gross30), fee30: Number(m.fee30), reportsOpen: rep.n };
}

module.exports = { forMentor, forAdmin };
