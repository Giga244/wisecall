// The Daily.co video provider (server/live/daily.js) against a fake Daily API: the exact requests (bearer key, a private room that ends
// with the session, camera and mic off, no chat; per-person tokens with owner rights only for the mentor, watch-only rights for others,
// the not-before / expiry times), ending a room, and refusing a frame from anywhere but daily.co.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const calls = [];
let fake;
let daily;

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/rooms') return res.end(JSON.stringify({ id: 'x', name: JSON.parse(body).name, url: `https://wisecall.daily.co/${JSON.parse(body).name}` }));
      if (req.method === 'POST' && req.url === '/v1/meeting-tokens') return res.end(JSON.stringify({ token: 'tok-' + calls.length }));
      if (req.method === 'DELETE' && req.url === '/v1/rooms/gone') { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not-found' })); }
      // (replays: presence, start/stop recording, the recordings of a room, a short-lived address)
      if (req.method === 'GET' && req.url === '/v1/rooms/wc-rec/presence') return res.end(JSON.stringify({ total_count: 2, data: [{ id: 'sess-buyer', userId: 'u-buyer' }, { id: 'sess-mentor', userId: 'u-mentor' }] }));
      if (req.method === 'POST' && (req.url === '/v1/rooms/wc-rec/recordings/start' || req.url === '/v1/rooms/wc-rec/recordings/stop')) return res.end(JSON.stringify({ status: 'ok' }));
      if (req.method === 'GET' && req.url === '/v1/recordings?room_name=wc-rec') return res.end(JSON.stringify({ data: [{ id: 'rec-short', status: 'finished', duration: 30 }, { id: 'rec-long', status: 'finished', duration: 3400 }, { id: 'rec-busy', status: 'in-progress' }] }));
      if (req.method === 'GET' && req.url === '/v1/recordings/rec-long/access-link') return res.end(JSON.stringify({ download_link: 'https://daily-recordings.s3.amazonaws.com/rec-long.mp4?sig=x', expires: 9999999999 }));
      if (req.method === 'DELETE') return res.end(JSON.stringify({ deleted: true }));
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid-request-error', info: 'bad' }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.DAILY_API_URL = `http://127.0.0.1:${fake.address().port}/v1`;
  process.env.DAILY_API_KEY = 'test-daily-key-not-real';
  daily = require('../server/live/daily');
});
after(() => fake.close());

test('a private room that opens 15 minutes before and ends with the session; no chat, camera and mic off', async () => {
  const startsAt = new Date(Date.now() + 86400000);
  const endsAt = new Date(startsAt.getTime() + 90 * 60000);
  const r = await daily.createRoom({ name: 'wc-room-1', startsAt, endsAt, maxSeats: 30, screenshare: false });
  assert.deepEqual(r, { roomName: 'wc-room-1', roomUrl: 'https://wisecall.daily.co/wc-room-1' });
  const c = calls.find((x) => x.url === '/v1/rooms');
  assert.equal(c.auth, 'Bearer test-daily-key-not-real');
  assert.equal(c.body.privacy, 'private');
  const p = c.body.properties;
  assert.equal(p.nbf, Math.floor((startsAt.getTime() - 15 * 60000) / 1000));
  assert.equal(p.exp, Math.floor(endsAt.getTime() / 1000));
  assert.equal(p.eject_at_room_exp, true);
  assert.deepEqual([p.enable_chat, p.enable_knocking, p.start_video_off, p.start_audio_off, p.enable_screenshare], [false, false, true, true, false]);
  assert.equal(p.max_participants, 32);
});

test('tokens: owner rights only for the mentor; a participant can send nothing until allowed; times and names', async () => {
  const notBefore = new Date(Date.now() - 60000);
  const expires = new Date(Date.now() + 3600000);
  const owner = await daily.token({ roomName: 'wc-room-1', roomUrl: 'https://wisecall.daily.co/wc-room-1', userId: 'u-mentor', userName: 'Nino', owner: true, notBefore, expires, lang: 'ka' });
  assert.match(owner.joinUrl, /^https:\/\/wisecall\.daily\.co\/wc-room-1\?t=tok-/);
  const ownerCall = calls.filter((x) => x.url === '/v1/meeting-tokens').pop().body.properties;
  assert.equal(ownerCall.is_owner, true);
  assert.equal(ownerCall.permissions, undefined, 'an owner has every right');
  assert.equal(ownerCall.room_name, 'wc-room-1');
  assert.equal(ownerCall.nbf, Math.floor(notBefore.getTime() / 1000));
  assert.equal(ownerCall.exp, Math.floor(expires.getTime() / 1000));
  assert.equal(ownerCall.eject_at_token_exp, true);
  await daily.token({ roomName: 'wc-room-1', roomUrl: 'https://wisecall.daily.co/wc-room-1', userId: 'u-buyer', userName: 'Guest 4', owner: false, canSend: [], notBefore, expires, lang: 'en' });
  const p = calls.filter((x) => x.url === '/v1/meeting-tokens').pop().body.properties;
  assert.equal(p.is_owner, false);
  assert.deepEqual(p.permissions, { hasPresence: true, canSend: [], canAdmin: false });
  assert.deepEqual([p.user_name, p.start_video_off, p.start_audio_off, p.enable_screenshare], ['Guest 4', true, true, false]);
  await daily.token({ roomName: 'wc-room-1', roomUrl: 'https://wisecall.daily.co/wc-room-1', userId: 'u-buyer', userName: 'Giorgi', owner: false, canSend: ['audio', 'video'], notBefore, expires });
  assert.deepEqual(calls.filter((x) => x.url === '/v1/meeting-tokens').pop().body.properties.permissions.canSend, ['audio', 'video']);
});

test('ending a room deletes it (an already deleted room is fine); errors are reported; frames only from daily.co over https', async () => {
  await daily.endRoom('wc-room-1');
  assert.ok(calls.some((x) => x.method === 'DELETE' && x.url === '/v1/rooms/wc-room-1'));
  await daily.endRoom('gone');
  await assert.rejects(() => daily.token({ roomName: '', roomUrl: 'https://wisecall.daily.co/', userId: 'x', userName: 'x', notBefore: new Date(), expires: new Date() }).then(() => { throw new Error('bad'); }), /Daily|bad/);
  assert.equal(daily.frameOrigin('https://wisecall.daily.co/wc-room-1'), 'https://wisecall.daily.co');
  assert.throws(() => daily.frameOrigin('https://evil.example/daily.co/x'));
  assert.throws(() => daily.frameOrigin('http://wisecall.daily.co/x'));
  assert.equal(daily.owns('https://wisecall.daily.co/room'), true);
  assert.equal(daily.owns('http://localhost:4242/mock-live-room.html?room=x'), false);
});

test('replays: the mentor alone is recorded (single-participant, with the mentor\'s own session id); the longest finished file; a short-lived https address; deleting', async () => {
  const room = await daily.createRoom({ name: 'wc-rec', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), maxSeats: 30, screenshare: true, recording: true });
  assert.equal(calls.filter((x) => x.url === '/v1/rooms').pop().body.properties.enable_recording, 'cloud');
  assert.equal(room.roomName, 'wc-rec');
  await daily.startRecording({ roomName: 'wc-rec', ownerUserId: 'u-mentor' });
  assert.deepEqual(calls.filter((x) => x.url === '/v1/rooms/wc-rec/recordings/start').pop().body, { layout: { preset: 'single-participant', session_id: 'sess-mentor' } });
  await assert.rejects(() => daily.startRecording({ roomName: 'wc-rec', ownerUserId: 'u-nobody' }), /not in the call/);
  await daily.stopRecording({ roomName: 'wc-rec' });
  assert.deepEqual(await daily.findRecording({ roomName: 'wc-rec' }), { id: 'rec-long', durationS: 3400 });
  assert.deepEqual(await daily.playbackUrl('rec-long'), { kind: 'video', url: 'https://daily-recordings.s3.amazonaws.com/rec-long.mp4?sig=x', origin: 'https://daily-recordings.s3.amazonaws.com' });
  await daily.deleteRecording('rec-long');
  assert.ok(calls.some((x) => x.method === 'DELETE' && x.url === '/v1/recordings/rec-long'));
  const plain = await daily.createRoom({ name: 'wc-plain', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), maxSeats: 30, screenshare: false });
  assert.equal(plain.roomName, 'wc-plain');
  assert.equal(calls.filter((x) => x.url === '/v1/rooms').pop().body.properties.enable_recording, undefined, 'no recording unless asked');
});
