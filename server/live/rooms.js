// The video side of a live session (server/live/provider.js does the talking): making the room when the session goes public, the
// personal tokens, ending it. Kept apart so the rules about WHO may join live in one place (room.js) and HOW in another (here).
const config = require('../config');
const video = require('./provider');

const ensureProvider = () => {
  try { return video.current(); } catch (e) { throw new (require('./sessions').LiveError)('video_unavailable'); }
};
const endsAt = (s) => new Date(new Date(s.starts_at).getTime() + s.duration_min * 60000);
const roomNameFor = (s) => `wc-${String(s.id).replace(/-/g, '').slice(0, 20)}-${Date.now().toString(36)}`;

async function create(s) {
  const p = ensureProvider();
  return p.createRoom({ name: roomNameFor(s), startsAt: s.starts_at, endsAt: new Date(endsAt(s).getTime() + 30 * 60000), maxSeats: s.max_seats,
    screenshare: s.kind !== 'qa' });
}

// A new time: a new room for the new time (the old one is ended).
async function moveRoom(s) {
  const { query } = require('../db');
  const room = await create(s);
  const old = s.room_name;
  await query('UPDATE live_sessions SET room_name = $2, room_url = $3 WHERE id = $1', [s.id, room.roomName, room.roomUrl]);
  if (old) await video.forRoomUrl(s.room_url).endRoom(old).catch(() => {});
  return room;
}

async function end(s) {
  if (!s.room_name) return;
  await video.forRoomUrl(s.room_url).endRoom(s.room_name);
}

// The personal, short-lived token: from 10 minutes before the start, until the end + 30 minutes (and never more than 3 hours).
async function token(s, { userId, userName, owner, canSend, lang }) {
  const p = video.forRoomUrl(s.room_url);
  const start = new Date(s.starts_at).getTime();
  const notBefore = new Date(Math.max(Date.now() - 60000, start - 10 * 60000));
  const expires = new Date(Math.min(endsAt(s).getTime() + 30 * 60000, Date.now() + 3 * 3600000));
  return p.token({ roomName: s.room_name, roomUrl: s.room_url, userId, userName, owner, canSend, notBefore, expires, lang });
}

const frameOrigin = (s) => video.forRoomUrl(s.room_url).frameOrigin(s.room_url);

module.exports = { ensureProvider, create, moveRoom, end, token, frameOrigin, endsAt, enabled: () => video.enabled(), config };
