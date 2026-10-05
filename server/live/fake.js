// A fake video provider for development and the tests: a "room" is a page on this site (/live-fake-room.html) that shows who joined, as
// whom, and with which rights. Tokens are signed by the server, so the page can show what a real provider would enforce. Refused in
// production (config.js).
const crypto = require('crypto');
const config = require('../config');

const name = 'fake';
const isConfigured = () => !config.IS_PROD;
const rooms = new Map(); // roomName -> { ended }

async function createRoom({ name: roomName, maxSeats, screenshare }) {
  rooms.set(roomName, { ended: false, maxSeats, screenshare: Boolean(screenshare) });
  return { roomName, roomUrl: `${config.PUBLIC_URL}/live-fake-room.html?room=${encodeURIComponent(roomName)}` };
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

const owns = (roomUrl) => String(roomUrl || '').startsWith(`${config.PUBLIC_URL}/live-fake-room.html`);
const frameOrigin = () => new URL(config.PUBLIC_URL).origin;
// (for the fake room page and the tests)
const roomState = (roomName) => rooms.get(roomName) || null;

module.exports = { name, isConfigured, createRoom, token, endRoom, owns, frameOrigin, verify, roomState };
