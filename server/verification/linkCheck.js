// Checks a link a mentor gave as evidence: does it open, what is the page called, does it show the mentor's name or brand, is the
// website brand-new, is it hidden behind a URL shortener. It is SAFE TO POINT AT ANY ADDRESS a stranger types in (no SSRF):
//   - http and https only, no user:password@ in the address, standard ports only (80 and 443);
//   - every address the name resolves to is checked, and private, internal, loopback, link-local, cloud-metadata and other reserved
//     ranges are refused. The connection goes to the address that was checked (so a second DNS answer cannot swap it), on every
//     redirect too (at most 3);
//   - short timeouts and a size limit: at most 300 KB of a page is read, and only HTML is looked at.
// Test servers run on this computer, so a development-only setting (LINK_CHECK_ALLOW_PRIVATE) lets tests reach them. It is refused in
// production (config.js).
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const config = require('../config');
const { LIMITS } = require('./rules');
const names = require('./names');

class LinkError extends Error { constructor(code) { super(code); this.code = code; } }

// ---- Which addresses may never be reached ------------------------------------------------------------------------------------------
const V4_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32]
];
const V6_RANGES = [
  ['::', 128], ['::1', 128], ['::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
];
const blockList = new net.BlockList();
V4_RANGES.forEach(([a, p]) => blockList.addSubnet(a, p, 'ipv4'));
V6_RANGES.forEach(([a, p]) => blockList.addSubnet(a, p, 'ipv6'));

// The 8 groups of an IPv6 address as numbers (handles "::" and a dotted IPv4 tail).
function v6Groups(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = s.includes('::') ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g || '0', 16));
}
const v4FromGroups = (a, b) => [a >> 8, a & 255, b >> 8, b & 255].join('.');

function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family !== 6) return true;
  const g = v6Groups(ip);
  // IPv4 hidden inside IPv6 (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16): judge the IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedAddress(v4FromGroups(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(v4FromGroups(g[6], g[7]));
  if (g[0] === 0x2002) return isBlockedAddress(v4FromGroups(g[1], g[2]));
  return blockList.check(ip, 'ipv6');
}

// A DNS lookup that refuses the whole name if ANY of its addresses is internal. Node connects to the address returned here.
function safeLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { all: true, family: opts.family || 0 }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length) return callback(new LinkError('dns_failed'));
    if (addresses.some((a) => isBlockedAddress(a.address))) return callback(new LinkError('blocked_address'));
    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// ---- Addresses ------------------------------------------------------------------------------------------------------------------------
// -> a URL object that is allowed to be fetched, or throws a LinkError.
function checkAddress(value, { allowPrivate = config.LINK_CHECK_ALLOW_PRIVATE } = {}) {
  let u;
  try { u = new URL(String(value)); } catch (e) { throw new LinkError('invalid_url'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new LinkError('scheme_not_allowed');
  if (u.username || u.password) throw new LinkError('credentials_in_url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate) {
    if (u.port && !['80', '443'].includes(u.port)) throw new LinkError('port_not_allowed');
    if (net.isIP(host)) { if (isBlockedAddress(host)) throw new LinkError('blocked_address'); }
    else if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/i.test(host) || /^localhost$/i.test(host)) throw new LinkError('blocked_address');
  }
  return u;
}

// One request, no redirects followed. -> { status, headers, body (Buffer, at most maxBytes), truncated }
function requestOnce(u, { allowPrivate, timeoutMs, maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(deadline); fn(v); } };
    const req = lib.request(u, {
      method: 'GET',
      agent: false,
      lookup: allowPrivate ? undefined : safeLookup,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WisecallLinkCheck/1.0; +https://wisecallge.ge/how-we-verify.html)',
        Accept: accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
        'Accept-Language': 'en,ka;q=0.8',
        'Accept-Encoding': 'identity'
      }
    }, (res) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c) => {
        if (truncated) return;
        const room = maxBytes - size;
        if (c.length > room) { chunks.push(c.subarray(0, room)); size = maxBytes; truncated = true; res.destroy(); finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated }); return; }
        chunks.push(c); size += c.length;
      });
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on('error', (e) => finish(reject, e));
    });
    const deadline = setTimeout(() => { req.destroy(new LinkError('timeout')); }, timeoutMs); // the whole exchange, not just a quiet socket
    req.on('timeout', () => req.destroy(new LinkError('timeout')));
    req.on('error', (e) => finish(reject, e instanceof LinkError ? e : Object.assign(new LinkError(e.code === 'ENOTFOUND' ? 'dns_failed' : 'unreachable'), { cause: e.message })));
    req.end();
  });
}

// GET with redirects, each hop checked again. -> { url (final), status, headers, body, truncated, redirects }
async function safeGet(value, opts = {}) {
  const o = { allowPrivate: config.LINK_CHECK_ALLOW_PRIVATE, timeoutMs: LIMITS.linkTimeoutMs, maxBytes: LIMITS.linkMaxBytes, ...opts };
  let u = checkAddress(value, o);
  const hops = [];
  for (let i = 0; ; i++) {
    const r = await requestOnce(u, o);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (i >= LIMITS.linkMaxRedirects) throw new LinkError('too_many_redirects');
      hops.push(u.toString());
      u = checkAddress(new URL(r.headers.location, u).toString(), o);
      continue;
    }
    return { ...r, url: u.toString(), redirects: hops };
  }
}

// ---- Reading a page ---------------------------------------------------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}
const clean = (s, max) => decodeEntities(String(s || '')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function parseHtml(html) {
  const title = (html.match(/<title[^>]*>([\s\S]{0,2000}?)<\/title>/i) || [])[1];
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:name|property)\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && content !== undefined && meta[key.toLowerCase()] === undefined) meta[key.toLowerCase()] = content;
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, ' ');
  return {
    title: clean(meta['og:title'] || title, 200),
    description: clean(meta.description || meta['og:description'] || meta['twitter:description'], 400),
    siteName: clean(meta['og:site_name'], 100),
    text: clean(text, 20000)
  };
}

// ---- What the checks look for ---------------------------------------------------------------------------------------------------------
const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy',
  'tiny.cc', 'lnkd.in', 's.id', 't.ly', 'v.gd', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly', 'qr.ae', 'tr.im', 'x.co', 'soo.gd', 'clck.ru'
]);
// Big platforms that often refuse automatic visitors (a refusal there is not a dead link), and whose domains are old.
const WALLED = ['linkedin.com', 'instagram.com', 'facebook.com', 'fb.com', 'x.com', 'twitter.com', 'tiktok.com', 'threads.net'];
const OLD_PLATFORMS = new Set([...WALLED, 'behance.net', 'dribbble.com', 'github.com', 'gitlab.com', 'youtube.com', 'medium.com', 'substack.com',
  'google.com', 'apple.com', 'wikipedia.org', 'researchgate.net', 'scholar.google.com', 'orcid.org', 'wordpress.com', 'wix.com', 'notion.site',
  'artstation.com', 'vimeo.com', 'soundcloud.com', 'amazon.com', 'goodreads.com', 'play.google.com', 'apps.apple.com', 'upwork.com', 'fiverr.com']);
const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.ge', 'org.ge', 'edu.ge', 'gov.ge', 'net.ge', 'pvt.ge', 'school.ge',
  'com.au', 'net.au', 'co.jp', 'com.br', 'co.in', 'com.tr', 'com.ua', 'co.il', 'com.cn', 'co.nz', 'co.za', 'com.mx', 'com.ar', 'co.kr']);

function registrableDomain(hostname) {
  const parts = String(hostname).toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}
const onPlatform = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

// Domain age from RDAP (the public registration data service). Unknown (null) when the registry does not answer: that is never held
// against the mentor. Answers are remembered for a day.
const ageCache = new Map();
// Names reserved for examples and tests (RFC 2606 / 6761): they are never registered, so there is nothing to look up.
const RESERVED = /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost|local)$/i;

async function domainCreated(domain, opts = {}) {
  if (!domain || OLD_PLATFORMS.has(domain) || RESERVED.test(domain)) return null;
  const hit = ageCache.get(domain);
  if (hit && hit.at > Date.now() - 86400000) return hit.created;
  let created = null;
  try {
    const r = await safeGet(config.RDAP_BASE_URL + encodeURIComponent(domain), { ...opts, timeoutMs: 5000, maxBytes: 200 * 1024, accept: 'application/rdap+json, application/json' });
    if (r.status === 200) {
      const data = JSON.parse(r.body.toString('utf8'));
      const ev = (data.events || []).find((e) => e.eventAction === 'registration');
      if (ev && !Number.isNaN(Date.parse(ev.eventDate))) created = new Date(ev.eventDate).toISOString();
    }
  } catch (e) { /* unknown */ }
  ageCache.set(domain, { created, at: Date.now() });
  return created;
}
const ageDays = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

// Does the page (or its address) show this person? Name words are compared across Georgian and Latin spellings.
//   person: { name, brands: [strings] }
function findPerson(page, finalUrl, person) {
  const pageWords = new Set(names.tokens(`${page.title} ${page.description} ${page.siteName} ${page.text}`).map(names.canon));
  const nameWords = [...new Set(names.tokens(person.name).filter((w) => w.length >= 2).map(names.canon))];
  const found = nameWords.filter((w) => pageWords.has(w));
  if (nameWords.length && found.length >= Math.min(2, nameWords.length)) return 'name';
  for (const brand of person.brands || []) {
    const b = names.tokens(brand).filter((w) => w.length >= 3).map(names.canon);
    if (b.length && b.every((w) => pageWords.has(w))) return 'brand';
  }
  // A personal address (anna-beridze.com, behance.net/annaberidze) counts only when the page itself opened.
  const addr = names.canon(names.tokens(new URL(finalUrl).hostname.replace(/^www\./, '') + ' ' + new URL(finalUrl).pathname).join(''));
  const surname = nameWords.length ? nameWords[nameWords.length - 1] : '';
  if (surname.length >= 4 && addr.includes(surname)) return 'address';
  return null;
}

// Checks one link. -> { checkStatus: ok | warning | failed, autoVerified, result }
//   person: { name, brands }
async function checkLink(value, person, opts = {}) {
  const result = { url: value, flags: [] };
  let u;
  try { u = checkAddress(value, opts); } catch (e) {
    return { checkStatus: 'failed', autoVerified: false, result: { ...result, error: e.code, flags: ['refused_address'] } };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const domain = registrableDomain(host);
  result.domain = domain;
  if (SHORTENERS.has(host) || SHORTENERS.has(domain)) result.flags.push('shortener');
  if (u.protocol === 'http:') result.flags.push('no_https');

  let page = null;
  try {
    const r = await safeGet(u.toString(), opts);
    result.finalUrl = r.url;
    result.status = r.status;
    if (r.redirects.length) {
      result.redirects = r.redirects.length;
      const finalDomain = registrableDomain(new URL(r.url).hostname);
      if (finalDomain !== domain) { result.finalDomain = finalDomain; result.flags.push('redirected_elsewhere'); }
    }
    const type = String(r.headers['content-type'] || '');
    if (r.status >= 200 && r.status < 300) {
      if (/html|xml/i.test(type) || !type) page = parseHtml(r.body.toString('utf8'));
      else result.flags.push('not_a_web_page');
    } else if ((r.status === 999 || r.status === 401 || r.status === 403 || r.status === 429) && onPlatform(host, WALLED)) {
      result.flags.push('blocks_automatic_checks');
    } else {
      result.flags.push('dead_link');
    }
  } catch (e) {
    result.error = e.code || 'unreachable';
    result.flags.push(e.code === 'blocked_address' || e.code === 'port_not_allowed' ? 'refused_address' : 'dead_link');
  }

  const created = await domainCreated(result.finalDomain || domain, opts);
  if (created) {
    result.domainCreated = created;
    result.domainAgeDays = ageDays(created);
    if (result.domainAgeDays < LIMITS.newDomainDays) result.flags.push('new_domain');
  }

  if (page) {
    result.title = page.title;
    result.description = page.description;
    if (page.siteName) result.siteName = page.siteName;
    result.match = findPerson(page, result.finalUrl, person);
    if (!result.match) result.flags.push('name_not_found');
  }
  const opened = Boolean(page);
  const risky = result.flags.some((f) => ['shortener', 'new_domain', 'redirected_elsewhere'].includes(f));
  const autoVerified = opened && Boolean(result.match) && !risky;
  let checkStatus = 'warning';
  if (result.flags.includes('dead_link') || result.flags.includes('refused_address')) checkStatus = 'failed';
  else if (autoVerified) checkStatus = 'ok';
  return { checkStatus, autoVerified, result };
}

// Georgian Public Registry identification codes: 9 digits for a company (legal entity), 11 for an individual entrepreneur (the
// person's personal number). Only the format is checked here; an admin looks it up in the registry.
function companyIdFormat(value) {
  const v = String(value || '').replace(/\s/g, '');
  if (/^\d{9}$/.test(v)) return { value: v, type: 'legal_entity' };
  if (/^\d{11}$/.test(v)) return { value: v, type: 'individual_entrepreneur' };
  return null;
}

module.exports = { LinkError, isBlockedAddress, checkAddress, safeGet, parseHtml, registrableDomain, domainCreated, ageDays, checkLink, companyIdFormat, SHORTENERS };
