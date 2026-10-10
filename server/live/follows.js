// Following a mentor (Milestone 2): a "Follow" button on their profile. Followers get an email when the mentor publishes a live session,
// at most one per mentor per week; every email has a one-click "unfollow" link (signed, so it works without signing in).
const crypto = require('crypto');
const { query } = require('../db');
const config = require('../config');
const { getUserById } = require('../models');
const { isListable } = require('../util');
const { LiveError } = require('./sessions');

const WEEK_MS = 7 * 86400000;
const sign = (followerId, mentorId) => crypto.createHmac('sha256', config.SESSION_SECRET).update(`unfollow:${followerId}:${mentorId}`).digest('base64url');
const tokenFor = (followerId, mentorId) => `${followerId}.${mentorId}.${sign(followerId, mentorId)}`;

async function follow(user, mentorId) {
  if (!user) throw new LiveError('not_authenticated');
  if (user.id === mentorId) throw new LiveError('own_profile');
  const mentor = /^[0-9a-f-]{36}$/i.test(String(mentorId || '')) ? await getUserById(mentorId) : null;
  if (!mentor || !isListable(mentor)) throw new LiveError('not_found');
  await query('INSERT INTO mentor_follows (follower_id, mentor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, mentor.id]);
  return state(user.id, mentor.id);
}
async function unfollow(user, mentorId) {
  await query('DELETE FROM mentor_follows WHERE follower_id = $1 AND mentor_id = $2', [user.id, mentorId]);
  return state(user.id, mentorId);
}
async function state(userId, mentorId) {
  const { rows: [r] } = await query(
    `SELECT EXISTS (SELECT 1 FROM mentor_follows WHERE follower_id = $1 AND mentor_id = $2) AS following,
            (SELECT count(*)::int FROM mentor_follows WHERE mentor_id = $2) AS followers`, [userId || null, mentorId]);
  return { following: r.following, followers: r.followers };
}
const countFor = async (mentorId) => (await query('SELECT count(*)::int AS n FROM mentor_follows WHERE mentor_id = $1', [mentorId])).rows[0].n;

// The link in the email.
async function unfollowByToken(token) {
  const [followerId, mentorId, mac] = String(token || '').split('.');
  if (!followerId || !mentorId || !mac) throw new LiveError('not_found');
  const want = sign(followerId, mentorId);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new LiveError('not_found');
  await query('DELETE FROM mentor_follows WHERE follower_id = $1 AND mentor_id = $2', [followerId, mentorId]);
  return { ok: true };
}

// A session went public: each follower is emailed, unless this mentor already emailed them in the last 7 days.
async function notifyFollowers(session) {
  if (!config.LIVE_ENABLED) return 0; // (live sessions switched off: no "new session" emails)
  const { rowCount } = await query(`UPDATE live_sessions SET followers_notified_at = now() WHERE id = $1 AND followers_notified_at IS NULL`, [session.id]);
  if (!rowCount) return 0;
  const mentor = await getUserById(session.mentor_id);
  const { rows } = await query(
    `UPDATE mentor_follows f SET last_emailed_at = now() FROM users u
      WHERE f.mentor_id = $1 AND u.id = f.follower_id AND u.deleted_at IS NULL AND u.deletion_requested_at IS NULL AND (f.last_emailed_at IS NULL OR f.last_emailed_at < now() - make_interval(secs => $2))
      RETURNING u.id, u.email, u.language`, [session.mentor_id, WEEK_MS / 1000]);
  const notices = require('./notices');
  for (const u of rows) {
    await notices.followerNewSession(u, mentor, session, `${config.PUBLIC_URL}/unfollow.html?t=${encodeURIComponent(tokenFor(u.id, session.mentor_id))}`)
      .catch((e) => console.error('[live] follower email failed:', e.message));
  }
  return rows.length;
}

module.exports = { follow, unfollow, state, countFor, unfollowByToken, notifyFollowers, tokenFor };
