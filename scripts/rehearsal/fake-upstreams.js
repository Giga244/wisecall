#!/usr/bin/env node
// Fake outside services for the rehearsal, on one port (default 4399): an email API shaped like Resend's (POST /emails) and a video API
// shaped like Daily's (/v1/rooms, /v1/meeting-tokens, ...). Each can be switched to fail, for the resilience drills:
//   curl -XPOST localhost:4399/__mode -d '{"service":"email","mode":"down"}'     modes: up | down (503) | refuse (drop the connection) |
//                                                                                    hang (never answer) | slow (answer after 5 s)
//   curl localhost:4399/__stats                                                     requests seen per service and outcome
// Nothing here talks to the real Resend or Daily.
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || 4399);
const mode = { email: 'up', daily: 'up' };
const stats = {};
const count = (svc, what) => { stats[svc] = stats[svc] || {}; stats[svc][what] = (stats[svc][what] || 0) + 1; };

function answer(svc, req, res, ok) {
  const m = mode[svc];
  count(svc, m);
  if (m === 'down') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'service unavailable (rehearsal)' })); }
  if (m === 'refuse') return req.socket.destroy();
  if (m === 'hang') return; // never answers: the caller's timeout decides
  const send = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(ok())); };
  if (m === 'slow') return setTimeout(send, 5000);
  send();
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__mode' && req.method === 'POST') {
      const { service, mode: m } = JSON.parse(body || '{}');
      for (const s of service === 'all' ? Object.keys(mode) : [service]) mode[s] = m;
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(mode));
    }
    if (url.pathname === '/__stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ mode, stats })); }
    if (url.pathname === '/__reset') { Object.keys(stats).forEach((k) => delete stats[k]); res.writeHead(200); return res.end('{}'); }
    if (url.pathname === '/emails' || url.pathname === '/domains') return answer('email', req, res, () => ({ id: crypto.randomUUID(), data: [] }));
    if (url.pathname.startsWith('/v1/')) {
      const p = url.pathname.slice(3);
      return answer('daily', req, res, () => {
        if (p === '/rooms' && req.method === 'POST') { const name = (JSON.parse(body || '{}').name) || 'room-' + crypto.randomUUID().slice(0, 8); return { name, url: `https://rehearsal.daily.co/${name}` }; }
        if (p === '/meeting-tokens') return { token: crypto.randomBytes(16).toString('hex') };
        return { data: [] };
      });
    }
    res.writeHead(404); res.end('{}');
  });
}).listen(PORT, () => console.log(`fake upstreams (email, daily) on :${PORT}`));
