// The video provider for live sessions: the one place that knows which video service runs the calls. Live-session code talks to this
// interface only, so the service can be swapped (Daily.co today; Whereby or another later):
//
//   createRoom({ name, startsAt, endsAt, maxSeats, screenshare })   -> { roomName, roomUrl }   a private room
//   token({ roomName, roomUrl, userId, userName, owner, canSend, notBefore, expires, lang })  -> { token, joinUrl }
//   endRoom(roomName)        ends the call for everybody now (the room is deleted)
//   isConfigured()           whether its keys are set
//   frameOrigin(roomUrl)     the origin the call page is embedded from (the room page's CSP allows only this)
//
// LIVE_PROVIDER = daily | fake. "fake" (a page on this site that shows who joined with which rights) exists only outside production.
const config = require('../config');

const providers = {
  daily: require('./daily'),
  fake: require('./fake')
};

class VideoUnavailable extends Error {
  constructor(name) { super(`video provider "${name}" is not available`); this.code = 'video_unavailable'; }
}

function forName(name) {
  const p = providers[name];
  if (!p || !p.isConfigured()) throw new VideoUnavailable(name || '(none)');
  return p;
}
const current = () => forName(config.LIVE_PROVIDER);
const enabled = () => { try { current(); return true; } catch (e) { return false; } };
// The provider that made this room (a room remembers it, so switching LIVE_PROVIDER never strands a scheduled session).
const forRoomUrl = (roomUrl) => {
  for (const p of Object.values(providers)) if (p.owns(roomUrl)) return forName(p.name);
  return current();
};

module.exports = { forName, current, enabled, forRoomUrl, VideoUnavailable, providers };
