// A fake video provider for development and the tests: a "room" is a page on this site (/mock-live-room.html) that shows who joined, as
// whom, and with which rights. Tokens are signed by the server, so the page can show what a real provider would enforce. Refused in
// production (config.js).
const crypto = require('crypto');
const config = require('../config');

const name = 'fake';
const isConfigured = () => !config.IS_PROD;
const rooms = new Map(); // roomName -> { ended }

async function createRoom({ name: roomName, maxSeats, screenshare, recording }) {
  rooms.set(roomName, { ended: false, maxSeats, screenshare: Boolean(screenshare), recordingAllowed: Boolean(recording) });
  return { roomName, roomUrl: `${config.PUBLIC_URL}/mock-live-room.html?room=${encodeURIComponent(roomName)}` };
}

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', config.SESSION_SECRET).update('fake-room:' + body).digest('base64url')}`;
};
function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', config.SESSION_SECRET).update('fake-room:' + body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
}

async function token({ roomName, roomUrl, userId, userName, owner, canSend, notBefore, expires }) {
  const t = sign({ room: roomName, userId, userName, owner: Boolean(owner), canSend: owner ? ['audio', 'video', 'screenVideo'] : (canSend || []),
    nbf: new Date(notBefore).getTime(), exp: new Date(expires).getTime() });
  return { token: t, joinUrl: `${roomUrl}&t=${encodeURIComponent(t)}` };
}

async function endRoom(roomName) {
  const r = rooms.get(roomName) || {};
  rooms.set(roomName, { ...r, ended: true });
}

// Replays: a "recording" is remembered per room (only the mentor is in it, like the real one: the layout records one person); it plays as
// a page on this site (/mock-live-replay.html) instead of a video.
const recordings = new Map(); // recordingId -> { roomName, ownerUserId, startedAt, stoppedAt, deleted }
async function startRecording({ roomName, ownerUserId }) {
  const r = rooms.get(roomName);
  if (!r || !r.recordingAllowed) throw new Error('fake video: recording is not enabled for this room');
  const id = `fake-rec-${roomName}`;
  recordings.set(id, { roomName, ownerUserId, startedAt: Date.now(), stoppedAt: null, deleted: false });
}
async function stopRecording({ roomName }) {
  const rec = recordings.get(`fake-rec-${roomName}`);
  if (rec && !rec.stoppedAt) rec.stoppedAt = Date.now();
}
async function findRecording({ roomName }) {
  const rec = recordings.get(`fake-rec-${roomName}`);
  if (!rec || rec.deleted) return null;
  return { id: `fake-rec-${roomName}`, durationS: Math.round(((rec.stoppedAt || Date.now()) - rec.startedAt) / 1000) };
}
async function playbackUrl(recordingId) {
  const url = `${config.PUBLIC_URL}/mock-live-replay.html?rec=${encodeURIComponent(recordingId)}`;
  return { kind: 'frame', url, origin: new URL(config.PUBLIC_URL).origin };
}
async function deleteRecording(recordingId) {
  const rec = recordings.get(recordingId);
  if (rec) rec.deleted = true;
}
const recordingState = (recordingId) => recordings.get(recordingId) || null;

const owns = (roomUrl) => String(roomUrl || '').startsWith(`${config.PUBLIC_URL}/mock-live-room.html`);
const frameOrigin = () => new URL(config.PUBLIC_URL).origin;
// (for the fake room page and the tests)
const roomState = (roomName) => rooms.get(roomName) || null;

module.exports = { name, isConfigured, createRoom, token, endRoom, owns, frameOrigin, verify, roomState, startRecording, stopRecording, findRecording, playbackUrl,
  deleteRecording, recordingState };
