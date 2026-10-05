// How a live session ends, and the background jobs that keep sessions honest (run with the existing sweep, server/jobs.js):
//   - fewer paid tickets than the minimum 6 hours before -> cancelled, everybody refunded
//   - the mentor has not joined 15 minutes after the start -> cancelled (no-show), everybody refunded
//   - at the end: the mentor was there for at least half the planned time -> 'normal' -> one pending payout (Σ net of the paid
//     tickets), payable after the hold; otherwise 'short' -> everybody refunded
//   - reminders 24 h and 1 h before; questions and room data deleted 30 days after the session
const { query, tx } = require('../db');
const config = require('../config');
const sessions = require('./sessions');

const PRESENT_SHARE = 0.5;

// Ends a session that is published or live. `by`: 'mentor' (pressed End), 'time' (the planned end passed).
async function finish(sessionId, { by = 'time' } = {}) {
  let ended = null;
  let short = false;
  await tx(async (client) => {
    const { rows: [s] } = await client.query('SELECT * FROM live_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!s || !['published', 'live'].includes(s.status)) return;
    if (!s.mentor_joined_at) { short = true; ended = s; return; }
    const present = s.mentor_seconds >= s.duration_min * 60 * PRESENT_SHARE;
    if (!present) { short = true; ended = s; return; }
    const { rows: [u] } = await client.query(
      `UPDATE live_sessions SET status = 'ended', end_kind = 'normal', ended_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [s.id]);
    await require('../ledger').onLiveEnded(client, u);
    ended = u;
  });
  if (!ended) return null;
  if (short) {
    // (not held as promised: everybody gets their money back)
    return sessions.cancel(ended.id, ended.mentor_joined_at ? 'short' : 'no_show');
  }
  await stopRecording(ended);
  if (ended.room_name) require('./rooms').end(ended).catch(() => {});
  await require('./waitlist').close(ended.id).catch(() => {});
  require('./notices').ended(ended, by).catch((e) => console.error('[live] end notices failed:', e.message));
  // (everybody who was in the room: a one-time 15 % code for a question with this mentor)
  require('./after').issueCodes(ended).catch((e) => console.error('[live] discount codes failed:', e.message));
  return ended;
}

// A recording still running when the session ends is stopped (the sweep then attaches it as the replay: server/live/replays.js).
async function stopRecording(s) {
  if (!s.recording_started_at || s.recording_stopped_at) return;
  await query('UPDATE live_sessions SET recording_stopped_at = now() WHERE id = $1 AND recording_stopped_at IS NULL', [s.id]);
  if (s.room_name) await require('./provider').forRoomUrl(s.room_url).stopRecording({ roomName: s.room_name }).catch((e) => console.error('[live] stopping the recording failed:', e.message));
}

async function autoCancelUnderMinimum() {
  const { rows } = await query(
    `SELECT s.id FROM live_sessions s
      WHERE s.status = 'published' AND s.starts_at <= now() + interval '6 hours' AND s.starts_at > now()
        AND (SELECT count(*) FROM live_tickets t WHERE t.session_id = s.id AND t.status = 'paid') < s.min_seats`);
  for (const { id } of rows) await sessions.cancel(id, 'min_not_reached').catch((e) => console.error(`[live] auto-cancel ${id} failed:`, e.message));
  return rows.length;
}

async function cancelNoShows() {
  const { rows } = await query(
    `SELECT id FROM live_sessions WHERE status = 'published' AND mentor_joined_at IS NULL AND starts_at <= now() - interval '15 minutes'`);
  for (const { id } of rows) await sessions.cancel(id, 'no_show').catch((e) => console.error(`[live] no-show cancel ${id} failed:`, e.message));
  return rows.length;
}

async function finishDue() {
  const { rows } = await query(
    `SELECT id FROM live_sessions WHERE status IN ('published', 'live') AND starts_at + make_interval(mins => duration_min + 10) <= now()`);
  for (const { id } of rows) await finish(id, { by: 'time' }).catch((e) => console.error(`[live] finishing ${id} failed:`, e.message));
  return rows.length;
}

async function sendReminders() {
  const notices = require('./notices');
  for (const [col, hours] of [['reminded_24h_at', 24], ['reminded_1h_at', 1]]) {
    const { rows } = await query(
      `UPDATE live_sessions SET ${col} = now()
        WHERE status = 'published' AND ${col} IS NULL AND starts_at > now() AND starts_at <= now() + make_interval(hours => $1)
          AND (published_at IS NULL OR published_at < starts_at - make_interval(hours => $1)) RETURNING *`, [hours]);
    for (const s of rows) await notices.reminder(s, hours).catch((e) => console.error('[live] reminder failed:', e.message));
  }
}

// 30 days after a session: its questions, hands and room details are deleted (the tickets and the money records stay).
async function purgeOld() {
  const { rows } = await query(
    `UPDATE live_sessions SET data_purged_at = now(), room_name = NULL, room_url = NULL
      WHERE data_purged_at IS NULL AND status IN ('ended', 'cancelled') AND COALESCE(ended_at, cancelled_at) < now() - interval '30 days' RETURNING id`);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  await query('DELETE FROM live_questions WHERE session_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM live_speakers WHERE session_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM live_waitlist WHERE session_id = ANY($1::uuid[])', [ids]);
  // (the address a gift was sent to is somebody else's: not kept once the session is over)
  await query('UPDATE live_tickets SET gift_email = NULL, gift_token_hash = NULL WHERE session_id = ANY($1::uuid[]) AND gift_email IS NOT NULL', [ids]);
  return ids.length;
}

async function sweep() {
  const tickets = require('./tickets');
  const waitlist = require('./waitlist');
  await tickets.expireHolds();
  await tickets.retryRefunds();
  await waitlist.expireOffers();
  await waitlist.offerFreedSeats();
  await require('./series').expireHolds();
  const replays = require('./replays');
  await replays.expireHolds();
  await replays.sweep();
  await autoCancelUnderMinimum();
  await cancelNoShows();
  await finishDue();
  await sendReminders();
  await purgeOld();
}

module.exports = { stopRecording, finish, autoCancelUnderMinimum, cancelNoShows, finishDue, sendReminders, purgeOld, sweep, PRESENT_SHARE, config };
