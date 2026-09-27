// A FAKE Claude API for the tests (POST /v1/messages), so the AI review can be tested without a key or any cost.
// By default it answers like a satisfied reviewer (every score 90, no red flags, "approve"). A test can queue other answers:
//   fake.queue.push({ refusal: true }) | { text: 'not json' } | { result: {...} } | { status: 500 } | { scores: {...}, recommendation: '...' }
// Every request body is kept in fake.requests, so a test can check exactly what was sent to the AI.
const http = require('http');

const KEYS = ['expertise_credibility', 'story_consistency', 'sample_answer_quality', 'advice_safety', 'niche_fit'];

function defaultResult(over = {}) {
  return {
    scores: Object.fromEntries(KEYS.map((k) => [k, (over.scores && over.scores[k]) !== undefined ? over.scores[k] : 90])),
    red_flags: over.red_flags || [],
    evidence_summary: over.evidence_summary || 'The portfolio page opened and shows the applicant\'s name and several finished projects.',
    admin_summary: over.admin_summary || 'A designer with years of client work. The portfolio and the sample answer are specific and practical. Nothing worrying stands out.',
    recommendation: over.recommendation || 'approve'
  };
}

function createFakeAnthropic() {
  const fake = { requests: [], queue: [], port: null, server: null };
  fake.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch (e) { /* keep empty */ }
      fake.requests.push({ path: req.url, headers: req.headers, body });
      const next = fake.queue.shift() || {};
      if (next.status) {
        res.writeHead(next.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'fake failure' } }));
      }
      const usage = { input_tokens: next.inputTokens || 1200, output_tokens: next.outputTokens || 400 };
      const message = {
        id: 'msg_fake_' + fake.requests.length, type: 'message', role: 'assistant', model: body.model,
        stop_reason: next.refusal ? 'refusal' : 'end_turn', stop_sequence: null, usage,
        content: next.refusal ? [] : [{ type: 'text', text: next.text !== undefined ? next.text : JSON.stringify(next.result || defaultResult(next)) }]
      };
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fake' });
      res.end(JSON.stringify(message));
    });
  });
  fake.start = () => new Promise((resolve) => fake.server.listen(0, '127.0.0.1', () => { fake.port = fake.server.address().port; resolve(fake); }));
  fake.stop = () => new Promise((resolve) => fake.server.close(() => resolve()));
  fake.url = () => `http://127.0.0.1:${fake.port}`;
  // The application JSON the server sent (parsed back out of the <application> block of the last request, or of request i).
  fake.application = (i = fake.requests.length - 1) => {
    const msg = fake.requests[i].body.messages[0].content;
    const inner = msg.slice(msg.indexOf('<application>') + '<application>'.length, msg.indexOf('</application>'));
    return JSON.parse(inner);
  };
  return fake;
}

// A FAKE web: evidence pages the link checker can open, and RDAP answers for domain ages.
//   web.pages['/p/anna'] = { status: 200, html: '<title>Anna ...</title>' } (or { redirect: 'http://...' }, { slow: true }, { bytes: n })
//   web.rdap['example.ge'] = '2026-09-01T00:00:00Z'
function createFakeWeb() {
  const web = { pages: {}, rdap: {}, hits: [], port: null };
  web.server = http.createServer((req, res) => {
    web.hits.push(req.url);
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/rdap/')) {
      const domain = decodeURIComponent(url.pathname.slice('/rdap/'.length));
      if (!web.rdap[domain]) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/rdap+json' });
      return res.end(JSON.stringify({ ldhName: domain, events: [{ eventAction: 'registration', eventDate: web.rdap[domain] }] }));
    }
    const page = web.pages[url.pathname];
    if (!page) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<title>Not found</title>'); }
    if (page.redirect) { res.writeHead(302, { location: page.redirect }); return res.end(); }
    if (page.slow) return; // never answers (the checker's timeout ends it)
    if (page.bytes) {
      res.writeHead(200, { 'content-type': 'text/html' });
      const chunk = '<p>' + 'x'.repeat(1020) + '</p>';
      let sent = 0;
      const write = () => { while (sent < page.bytes) { sent += chunk.length; if (!res.write(chunk)) return res.once('drain', write); } res.end(); };
      return write();
    }
    res.writeHead(page.status || 200, { 'content-type': page.type || 'text/html; charset=utf-8' });
    res.end(page.html || '');
  });
  web.start = () => new Promise((resolve) => web.server.listen(0, '127.0.0.1', () => { web.port = web.server.address().port; resolve(web); }));
  web.stop = () => new Promise((resolve) => { web.server.closeAllConnections && web.server.closeAllConnections(); web.server.close(() => resolve()); });
  web.url = (p) => `http://127.0.0.1:${web.port}${p}`;
  return web;
}

module.exports = { createFakeAnthropic, createFakeWeb, defaultResult, KEYS };
