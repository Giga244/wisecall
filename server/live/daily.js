// Daily.co (https://docs.daily.co/reference/rest-api): private rooms and per-person meeting tokens. The call is Daily Prebuilt, embedded in
// an iframe on /live/<slug>/room (room URL + ?t=token): no Daily script runs on our pages.
//   POST /v1/rooms            {name, privacy:'private', properties:{nbf, exp, max_participants, ...}}  -> {name, url}
//   POST /v1/meeting-tokens   {properties:{room_name, user_name, user_id, is_owner, nbf, exp, ...}}    -> {token}
//   DELETE /v1/rooms/:name    ends the call (everybody is removed) and deletes the room
const config = require('../config');

const name = 'daily';
const API = () => config.DAILY_API_URL;
const isConfigured = () => Boolean(config.DAILY_API_KEY);
const TIMEOUT_MS = 10000;

async function call(method, path, body) {
  const res = await fetch(API() + path, {
    method,
    headers: { Authorization: `Bearer ${config.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
  // (a room that is already gone is not an error when we wanted it gone)
  if (method === 'DELETE' && res.status === 404) return {};
  if (!res.ok) throw new Error(`Daily ${method} ${path} answered ${res.status}: ${String(data.info || data.error || text).slice(0, 200)}`);
  return data;
}

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

async function createRoom({ name: roomName, startsAt, endsAt, maxSeats, screenshare }) {
  const r = await call('POST', '/rooms', {
    name: roomName,
    privacy: 'private', // (only people with a meeting token from us get in)
    properties: {
      nbf: unix(new Date(new Date(startsAt).getTime() - 15 * 60000)),
      exp: unix(endsAt),
      eject_at_room_exp: true,
      max_participants: maxSeats + 2, // (the mentor, and a reconnecting tab)
      enable_knocking: false,
      enable_chat: false, // (questions go through our own panel: moderated and anonymous)
      enable_screenshare: Boolean(screenshare),
      start_video_off: true,
      start_audio_off: true,
      enable_prejoin_ui: true
    }
  });
  return { roomName: r.name, roomUrl: r.url };
}

// canSend: [] (watch and listen), or ['audio', 'video'] (+ 'screenVideo', 'screenAudio' for the mentor).
async function token({ roomName, roomUrl, userId, userName, owner, canSend, notBefore, expires, lang }) {
  const r = await call('POST', '/meeting-tokens', {
    properties: {
      room_name: roomName,
      user_name: String(userName).slice(0, 40),
      user_id: String(userId).slice(0, 36),
      is_owner: Boolean(owner),
      nbf: unix(notBefore),
      exp: unix(expires),
      eject_at_token_exp: true,
      start_video_off: true,
      start_audio_off: true,
      enable_screenshare: Boolean(owner) || (canSend || []).includes('screenVideo'),
      lang: lang === 'ka' ? 'en' : lang, // (Daily Prebuilt has no Georgian; the page around it is in Georgian)
      ...(owner ? {} : { permissions: { hasPresence: true, canSend: canSend || [], canAdmin: false } })
    }
  });
  return { token: r.token, joinUrl: `${roomUrl}?t=${encodeURIComponent(r.token)}` };
}

async function endRoom(roomName) {
  await call('DELETE', `/rooms/${encodeURIComponent(roomName)}`);
}

const owns = (roomUrl) => /^https:\/\/[a-z0-9-]+\.daily\.co\//i.test(String(roomUrl || ''));
function frameOrigin(roomUrl) {
  const u = new URL(roomUrl);
  if (u.protocol !== 'https:' || !/\.daily\.co$/i.test(u.hostname)) throw new Error('not a Daily room address');
  return u.origin;
}

module.exports = { name, isConfigured, createRoom, token, endRoom, owns, frameOrigin };
