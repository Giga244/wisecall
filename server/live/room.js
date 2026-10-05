// Inside a live session: who may join and with which rights, attendance (heartbeats), the question panel (anonymous to the other
// participants, upvotes, "answering now" / "answered"), raise hand -> the mentor lets a participant speak, and the mentor's controls.
const { query, tx } = require('../db');
const textSafety = require('../textSafety');
const sessions = require('./sessions');
const rooms = require('./rooms');
const { LiveError } = sessions;

const BEFORE_MS = 10 * 60000; // the room opens 10 minutes before the start
const AFTER_MS = 30 * 60000; // and closes 30 minutes after the planned end
const BEAT_MAX_S = 45; // one heartbeat counts at most this many seconds of presence
const firstName = (name) => String(name || '').trim().split(/\s+/)[0].slice(0, 30) || 'Guest';

// -> { session, role: 'mentor' | 'participant', ticket }  (throws when this person may not be in this room now)
async function access(user, sessionId, { timeWindow = true } = {}) {
  if (!user) throw new LiveError('not_authenticated');
  const s = await sessions.rowById(sessionId);
  if (!s || !['published', 'live'].includes(s.status) || !s.room_name) throw new LiveError('not_found');
  const start = new Date(s.starts_at).getTime();
  if (timeWindow) {
    if (Date.now() < start - BEFORE_MS) throw new LiveError('not_open_yet', { opensAt: new Date(start - BEFORE_MS) });
    if (Date.now() > rooms.endsAt(s).getTime() + AFTER_MS) throw new LiveError('closed');
  }
  if (s.mentor_id === user.id) return { session: s, role: 'mentor', ticket: null };
  const { rows: [t] } = await query(`SELECT * FROM live_tickets WHERE session_id = $1 AND buyer_id = $2 AND status = 'paid'`, [s.id, user.id]);
  if (!t) throw new LiveError('no_ticket');
  return { session: s, role: 'participant', ticket: t };
}

async function speakerState(sessionId, userId) {
  const { rows } = await query('SELECT state FROM live_speakers WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  return rows[0] ? rows[0].state : null;
}

// The personal token for the call. The mentor's first join marks the session as live.
async function join(user, sessionId, { anonymous } = {}) {
  const a = await access(user, sessionId);
  const s = a.session;
  if (a.role === 'mentor') {
    await query(`UPDATE live_sessions SET status = 'live', mentor_joined_at = COALESCE(mentor_joined_at, now()), updated_at = now() WHERE id = $1 AND status IN ('published', 'live')`, [s.id]);
    const t = await rooms.token(s, { userId: user.id, userName: firstName(user.name), owner: true, canSend: ['audio', 'video', 'screenVideo', 'screenAudio'], lang: user.language });
    return { role: 'mentor', joinUrl: t.joinUrl, frameOrigin: rooms.frameOrigin(s), displayName: firstName(user.name), kind: s.kind };
  }
  if (anonymous !== undefined) await query('UPDATE live_tickets SET join_anonymous = $2 WHERE id = $1', [a.ticket.id, anonymous === true]);
  const anon = anonymous === undefined ? a.ticket.join_anonymous : anonymous === true;
  const displayName = anon ? `Guest ${a.ticket.guest_number || 1}` : firstName(user.name);
  const allowed = s.kind === 'circle' || (await speakerState(s.id, user.id)) === 'allowed';
  const t = await rooms.token(s, { userId: user.id, userName: displayName, owner: false, canSend: allowed ? ['audio', 'video'] : [], lang: user.language });
  return { role: 'participant', joinUrl: t.joinUrl, frameOrigin: rooms.frameOrigin(s), displayName, kind: s.kind, canSpeak: allowed };
}

// Every 30 seconds while the room page is open: presence (the mentor's decides the payout; see settle.js).
async function heartbeat(user, sessionId) {
  const a = await access(user, sessionId);
  const s = a.session;
  const start = new Date(s.starts_at).getTime();
  const end = rooms.endsAt(s).getTime();
  const now = Date.now();
  if (a.role === 'mentor') {
    await query(
      `UPDATE live_sessions SET mentor_seconds = mentor_seconds + CASE
          WHEN mentor_last_seen_at IS NULL OR $2::timestamptz < $3::timestamptz THEN 0
          ELSE LEAST($5, GREATEST(0, EXTRACT(EPOCH FROM (LEAST($2::timestamptz, $4::timestamptz) - GREATEST(mentor_last_seen_at, $3::timestamptz))))::int) END,
         mentor_last_seen_at = $2 WHERE id = $1`, [s.id, new Date(now), new Date(start), new Date(end), BEAT_MAX_S]);
  } else {
    await query(
      `UPDATE live_tickets SET attended_seconds = attended_seconds + CASE
          WHEN last_seen_at IS NULL OR $2::timestamptz < $3::timestamptz THEN 0
          ELSE LEAST($5, GREATEST(0, EXTRACT(EPOCH FROM (LEAST($2::timestamptz, $4::timestamptz) - GREATEST(last_seen_at, $3::timestamptz))))::int) END,
         last_seen_at = $2 WHERE id = $1`, [a.ticket.id, new Date(now), new Date(start), new Date(end), BEAT_MAX_S]);
  }
  return state(user, sessionId, a);
}

// ---- The question panel ---------------------------------------------------------------------------------------------------------------
// Everybody in the room sees the questions, never who asked them; questions sent at checkout come first, then the most wanted.
async function questions(user, sessionId, a0) {
  const a = a0 || await access(user, sessionId, { timeWindow: false });
  const { rows } = await query(
    `SELECT q.id, q.body, q.source, q.state, q.votes, q.created_at, q.author_id = $2 AS mine,
            EXISTS (SELECT 1 FROM live_question_votes v WHERE v.question_id = q.id AND v.user_id = $2) AS voted
       FROM live_questions q LEFT JOIN live_tickets t ON t.id = q.ticket_id
      WHERE q.session_id = $1 AND (q.ticket_id IS NULL OR t.status IN ('paid', 'refund_pending')) AND ($3 OR q.state <> 'hidden')
      ORDER BY (q.source = 'checkout') DESC, (q.state = 'answering') DESC, (q.state = 'answered') ASC, q.votes DESC, q.created_at ASC LIMIT 300`,
    [a.session.id, user.id, a.role === 'mentor']);
  return rows.map((q) => ({ id: q.id, body: q.body, source: q.source, state: q.state, votes: q.votes, mine: q.mine, voted: q.voted, createdAt: q.created_at }));
}

async function ask(user, sessionId, body) {
  const a = await access(user, sessionId);
  const t = textSafety.cleanText(String(body || ''));
  if ([...t].length < 3 || [...t].length > 300) throw new LiveError('invalid_question', { min: 3, max: 300 });
  if (textSafety.isOffensive(t)) throw new LiveError('offensive');
  if (textSafety.findContactDetails(t).length) throw new LiveError('contact_details');
  const { rows: [n] } = await query(`SELECT count(*)::int AS n FROM live_questions WHERE session_id = $1 AND author_id = $2 AND source = 'room'`, [a.session.id, user.id]);
  if (n.n >= 10) throw new LiveError('too_many_questions');
  await query(`INSERT INTO live_questions (session_id, ticket_id, author_id, body, source) VALUES ($1, $2, $3, $4, 'room')`,
    [a.session.id, a.ticket ? a.ticket.id : null, user.id, t]);
  return questions(user, sessionId, a);
}

async function vote(user, questionId) {
  const { rows: [q] } = await query('SELECT * FROM live_questions WHERE id = $1', [questionId]);
  if (!q) throw new LiveError('not_found');
  const a = await access(user, q.session_id);
  if (q.author_id === user.id) throw new LiveError('own_question');
  if (q.state === 'hidden') throw new LiveError('not_found');
  await tx(async (client) => {
    const { rowCount } = await client.query('DELETE FROM live_question_votes WHERE question_id = $1 AND user_id = $2', [q.id, user.id]);
    if (rowCount) await client.query('UPDATE live_questions SET votes = GREATEST(0, votes - 1) WHERE id = $1', [q.id]);
    else {
      await client.query('INSERT INTO live_question_votes (question_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [q.id, user.id]);
      await client.query('UPDATE live_questions SET votes = votes + 1 WHERE id = $1', [q.id]);
    }
  });
  return questions(user, q.session_id, a);
}

// The mentor: "answering now" (only one at a time), "answered", hide, or open again.
async function setQuestionState(user, questionId, state) {
  if (!['open', 'answering', 'answered', 'hidden'].includes(state)) throw new LiveError('invalid_state');
  const { rows: [q] } = await query('SELECT * FROM live_questions WHERE id = $1', [questionId]);
  if (!q) throw new LiveError('not_found');
  const a = await access(user, q.session_id, { timeWindow: false });
  if (a.role !== 'mentor') throw new LiveError('forbidden');
  if (state === 'answering') await query(`UPDATE live_questions SET state = 'answered' WHERE session_id = $1 AND state = 'answering'`, [q.session_id]);
  await query('UPDATE live_questions SET state = $2 WHERE id = $1', [q.id, state]);
  return questions(user, q.session_id, a);
}

// ---- Raise hand (Live Q&A and Workshop) -------------------------------------------------------------------------------------------------
async function hand(user, sessionId, raise) {
  const a = await access(user, sessionId);
  if (a.role !== 'participant') throw new LiveError('forbidden');
  if (a.session.kind === 'circle') throw new LiveError('not_needed');
  await query(`INSERT INTO live_speakers (session_id, user_id, state) VALUES ($1, $2, $3)
               ON CONFLICT (session_id, user_id) DO UPDATE SET state = CASE WHEN live_speakers.state = 'allowed' AND $3 = 'raised' THEN 'allowed' ELSE EXCLUDED.state END, updated_at = now()`,
  [a.session.id, user.id, raise ? 'raised' : 'lowered']);
  return state(user, sessionId, a);
}
// The mentor allows (or stops) a participant speaking. The participant's page then fetches a new token.
async function setSpeaker(user, sessionId, participantId, allow) {
  const a = await access(user, sessionId);
  if (a.role !== 'mentor') throw new LiveError('forbidden');
  const { rows: [t] } = await query(`SELECT 1 FROM live_tickets WHERE session_id = $1 AND buyer_id = $2 AND status = 'paid'`, [a.session.id, participantId]);
  if (!t) throw new LiveError('not_found');
  await query(`INSERT INTO live_speakers (session_id, user_id, state) VALUES ($1, $2, $3)
               ON CONFLICT (session_id, user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`, [a.session.id, participantId, allow ? 'allowed' : 'lowered']);
  return state(user, sessionId, a);
}

// What the room page polls: the questions, my hand, and for the mentor the people in the room (first names or "Guest N", never emails).
async function state(user, sessionId, a0) {
  const a = a0 || await access(user, sessionId, { timeWindow: false });
  const s = await sessions.rowById(a.session.id);
  const out = { sessionStatus: s.status, role: a.role, kind: s.kind, questions: await questions(user, sessionId, a) };
  if (a.role === 'participant') out.hand = (await speakerState(s.id, user.id)) || 'lowered';
  if (a.role === 'mentor') {
    const { rows } = await query(
      `SELECT t.buyer_id, t.join_anonymous, t.guest_number, u.name, t.last_seen_at > now() - interval '75 seconds' AS here, sp.state AS hand
         FROM live_tickets t JOIN users u ON u.id = t.buyer_id LEFT JOIN live_speakers sp ON sp.session_id = t.session_id AND sp.user_id = t.buyer_id
        WHERE t.session_id = $1 AND t.status = 'paid' ORDER BY (sp.state = 'raised') DESC NULLS LAST, t.created_at`, [s.id]);
    out.people = rows.map((r) => ({ id: r.buyer_id, name: r.join_anonymous ? `Guest ${r.guest_number || 1}` : firstName(r.name), here: Boolean(r.here), hand: r.hand || 'lowered' }));
    out.count = { tickets: rows.length, here: rows.filter((r) => r.here).length };
  }
  return out;
}

// ---- The mentor's controls --------------------------------------------------------------------------------------------------------------
async function endByMentor(user, sessionId) {
  const a = await access(user, sessionId, { timeWindow: false });
  if (a.role !== 'mentor') throw new LiveError('forbidden');
  return require('./settle').finish(a.session.id, { by: 'mentor' });
}
// The video service failed: a fresh room (same tokens rules); everybody's page reloads the call.
async function restart(user, sessionId) {
  const a = await access(user, sessionId);
  if (a.role !== 'mentor') throw new LiveError('forbidden');
  await rooms.moveRoom(a.session);
  return join(user, sessionId);
}

module.exports = { access, join, heartbeat, questions, ask, vote, setQuestionState, hand, setSpeaker, state, endByMentor, restart, firstName, BEFORE_MS, AFTER_MS };
