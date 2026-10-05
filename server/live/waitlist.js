// The waiting list of a sold-out live session (Milestone 2). One click to join. When a seat frees up (a cancellation, a refund, a hold
// that ran out), the first person waiting gets an email and the seat is kept for them for 2 hours (or until the start, if sooner); while
// it is kept, the seat counts as taken for everybody else (sessions.SEATS_SQL). If they do not buy in time, the next person gets it.
// People still waiting also come before newcomers: a newcomer can buy only a seat nobody on the list is waiting for (aheadOf).
const { query } = require('../db');
const { LiveError } = require('./sessions');

const OFFER_HOURS = 2;
const OPEN = `('waiting', 'offered')`;

async function sessionFor(sessionId) {
  const s = await require('./sessions').rowById(sessionId);
  if (!s || !['published', 'live'].includes(s.status) || new Date(s.starts_at).getTime() <= Date.now()) throw new LiveError('not_on_sale');
  return s;
}

async function join(user, sessionId) {
  if (!user || !user.emailVerified) throw new LiveError('email_not_verified');
  const s = await sessionFor(sessionId);
  if (s.mentor_id === user.id) throw new LiveError('own_session');
  const { rows: [has] } = await query(`SELECT 1 FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND status IN ('held', 'paid', 'refund_pending')`, [s.id, user.id]);
  if (has) throw new LiveError('already_have_ticket');
  if (Number(s.taken) < s.max_seats && !(await waitingCount(s.id))) throw new LiveError('not_sold_out');
  await query(`INSERT INTO live_waitlist (session_id, user_id) VALUES ($1, $2) ON CONFLICT (session_id, user_id) WHERE status IN ${OPEN} DO NOTHING`, [s.id, user.id]);
  return mine(user.id, s.id);
}

async function leave(user, sessionId) {
  await query(`UPDATE live_waitlist SET status = 'removed' WHERE session_id = $1 AND user_id = $2 AND status IN ${OPEN}`, [sessionId, user.id]);
  offerFreedSeats(sessionId).catch((e) => console.error('[live] waiting list hand-off failed:', e.message));
  return { waiting: false };
}

const waitingCount = async (sessionId) => (await query(`SELECT count(*)::int AS n FROM live_waitlist WHERE session_id = $1 AND status = 'waiting'`, [sessionId])).rows[0].n;

// Where this person stands: { waiting, position } or { waiting, offered, offerExpiresAt }
async function mine(userId, sessionId) {
  if (!userId) return { waiting: false };
  const { rows: [w] } = await query(`SELECT * FROM live_waitlist WHERE session_id = $1 AND user_id = $2 AND status IN ${OPEN}`, [sessionId, userId]);
  if (!w) return { waiting: false };
  if (w.status === 'offered' && new Date(w.offer_expires_at).getTime() > Date.now()) return { waiting: true, offered: true, offerExpiresAt: w.offer_expires_at };
  // (compared in the database: a JavaScript date would lose the microseconds)
  const { rows: [p] } = await query(
    `SELECT count(*)::int AS n FROM live_waitlist o, live_waitlist me WHERE me.id = $1 AND o.session_id = me.session_id AND o.status = 'waiting'
        AND (o.created_at, o.id) <= (me.created_at, me.id)`, [w.id]);
  return { waiting: true, offered: false, position: Math.max(1, p.n) };
}

// For buying (inside the session lock): the seat kept for this person, if any, and how many people wait before them (everybody waiting,
// for a newcomer). -> { offer, ahead }
async function standing(client, sessionId, userId) {
  const { rows: [offer] } = await client.query(
    `SELECT id FROM live_waitlist WHERE session_id = $1 AND user_id = $2 AND status = 'offered' AND offer_expires_at > now()`, [sessionId, userId]);
  const { rows: [a] } = await client.query(
    `SELECT count(*)::int AS n FROM live_waitlist w WHERE w.session_id = $1 AND w.status = 'waiting' AND w.user_id <> $2
        AND w.created_at < COALESCE((SELECT created_at FROM live_waitlist WHERE session_id = $1 AND user_id = $2 AND status = 'waiting'), 'infinity')`,
    [sessionId, userId]);
  return { offer: offer || null, ahead: a.n };
}

// The ticket is paid: this person's place on the list is closed.
async function bought(client, sessionId, userId) {
  await client.query(`UPDATE live_waitlist SET status = 'bought' WHERE session_id = $1 AND user_id = $2 AND status IN ${OPEN}`, [sessionId, userId]);
}

// ---- The sweep ------------------------------------------------------------------------------------------------------------------------
async function expireOffers() {
  const { rowCount } = await query(`UPDATE live_waitlist SET status = 'expired' WHERE status = 'offered' AND offer_expires_at <= now()`);
  return rowCount;
}

// For every free seat of a session that still has people waiting: the first one gets the seat for 2 hours, and an email. With an id,
// only that session (right after a seat was freed); without, every session (the sweep).
async function offerFreedSeats(sessionId) {
  const sessions = require('./sessions');
  const { rows } = await query(
    `SELECT s.id FROM live_sessions s WHERE s.status IN ('published', 'live') AND s.starts_at > now() + interval '10 minutes'
        AND ($1::uuid IS NULL OR s.id = $1::uuid)
        AND EXISTS (SELECT 1 FROM live_waitlist w WHERE w.session_id = s.id AND w.status = 'waiting')`, [sessionId || null]);
  let offered = 0;
  for (const { id } of rows) {
    const s = await sessions.rowById(id);
    let free = s.max_seats - Number(s.taken);
    while (free > 0) {
      const until = new Date(Math.min(Date.now() + OFFER_HOURS * 3600000, new Date(s.starts_at).getTime()));
      // (one at a time, oldest first; SKIP LOCKED: the sweep and a cancellation never offer the same place twice)
      const { rows: [w] } = await query(
        `UPDATE live_waitlist SET status = 'offered', offered_at = now(), offer_expires_at = $2
          WHERE id = (SELECT id FROM live_waitlist WHERE session_id = $1 AND status = 'waiting' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`, [s.id, until]);
      if (!w) break;
      free -= 1;
      offered += 1;
      require('./notices').seatOffered(w, s).catch((e) => console.error('[live] seat offer email failed:', e.message));
    }
  }
  return offered;
}

// The session is over or cancelled: nobody waits any more.
async function close(sessionId) {
  await query(`UPDATE live_waitlist SET status = 'expired' WHERE session_id = $1 AND status IN ${OPEN}`, [sessionId]);
}

module.exports = { join, leave, mine, standing, bought, expireOffers, offerFreedSeats, close, OFFER_HOURS };
