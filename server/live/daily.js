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

async function createRoom({ name: roomName, startsAt, endsAt, maxSeats, screenshare, recording }) {
  const r = await call('POST', '/rooms', {
    name: roomName,
    privacy: 'private', // (only people with a meeting token from us get in)
    properties: {
      ...(recording ? { enable_recording: 'cloud' } : {}), // (a session with a replay; the server starts and stops it, below)
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

// ---- Replays (cloud recording of the mentor alone) ---------------------------------------------------------------------------------------
//   GET  /rooms/:name/presence            -> {data: [{id (session id), userId, ...}]}   (the mentor's session id, from our user id)
//   POST /rooms/:name/recordings/start    {layout: {preset: 'single-participant', session_id}}
//   POST /rooms/:name/recordings/stop
//   GET  /recordings?room_name=           -> {data: [{id, status, duration, start_ts}]}
//   GET  /recordings/:id/access-link      -> {download_link, expires}   (a short-lived address, made for each viewer)
//   DELETE /recordings/:id
// Is this person in the call right now? (the mentor's presence decides the payout: docs/REVIEW-2.md #4)
async function isPresent({ roomName, userId }) {
  const presence = await call('GET', `/rooms/${encodeURIComponent(roomName)}/presence`);
  return (presence.data || []).some((p) => String(p.userId) === String(userId).slice(0, 36));
}

// Takes this person out of the call now (a ticket refunded while the session runs: docs/REVIEW-2.md #12). Their call sessions are found in
// the presence list by the id their token carries. [VERIFY the eject body against Daily's REST docs before turning live sessions on.]
async function eject({ roomName, userId }) {
  const presence = await call('GET', `/rooms/${encodeURIComponent(roomName)}/presence`);
  const ids = (presence.data || []).filter((p) => String(p.userId) === String(userId).slice(0, 36)).map((p) => p.id);
  if (ids.length) await call('POST', `/rooms/${encodeURIComponent(roomName)}/eject`, { ids });
  return ids.length;
}

async function startRecording({ roomName, ownerUserId }) {
  const presence = await call('GET', `/rooms/${encodeURIComponent(roomName)}/presence`);
  const me = (presence.data || []).find((p) => String(p.userId) === String(ownerUserId).slice(0, 36));
  if (!me) throw new Error('the mentor is not in the call yet');
  await call('POST', `/rooms/${encodeURIComponent(roomName)}/recordings/start`, { layout: { preset: 'single-participant', session_id: me.id } });
}
async function stopRecording({ roomName }) {
  await call('POST', `/rooms/${encodeURIComponent(roomName)}/recordings/stop`);
}
// The finished recording of a room (the longest, if the mentor stopped and started again: later parts are kept as one replay only when
// there is one; see docs/QUESTIONS.md).
async function findRecording({ roomName }) {
  const r = await call('GET', `/recordings?room_name=${encodeURIComponent(roomName)}`);
  const done = (r.data || []).filter((x) => x.status === 'finished').sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return done[0] ? { id: done[0].id, durationS: done[0].duration || null } : null;
}
async function playbackUrl(recordingId) {
  const r = await call('GET', `/recordings/${encodeURIComponent(recordingId)}/access-link`);
  const url = new URL(r.download_link);
  if (url.protocol !== 'https:') throw new Error('not an https address');
  return { kind: 'video', url: url.toString(), origin: url.origin };
}
async function deleteRecording(recordingId) {
  await call('DELETE', `/recordings/${encodeURIComponent(recordingId)}`);
}

const owns = (roomUrl) => /^https:\/\/[a-z0-9-]+\.daily\.co\//i.test(String(roomUrl || ''));
function frameOrigin(roomUrl) {
  const u = new URL(roomUrl);
  if (u.protocol !== 'https:' || !/\.daily\.co$/i.test(u.hostname)) throw new Error('not a Daily room address');
  return u.origin;
}

module.exports = { name, isConfigured, createRoom, token, endRoom, owns, frameOrigin, isPresent, eject, startRecording, stopRecording, findRecording, playbackUrl, deleteRecording };
