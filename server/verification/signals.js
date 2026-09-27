// Account signals for the risk level: many applications from one network or device, copied stories, the same evidence link on several
// accounts, a brand-new email domain. Only keyed hashes of the IP address and of a random device identifier are stored: they can be
// compared with each other but never turned back into an address. They are deleted after LIMITS.signalRetentionDays.
const crypto = require('crypto');
const config = require('../config');
const { query } = require('../db');
const { LIMITS } = require('./rules');

const KEY = crypto.createHmac('sha256', config.DATA_ENCRYPTION_KEY).update('wisecall account signals v1').digest();
const hash = (v) => (v ? crypto.createHmac('sha256', KEY).update(String(v)).digest('hex').slice(0, 32) : null);

// A random identifier for this browser, only used to notice several accounts applying from one device (fraud prevention).
const DEVICE_COOKIE = 'wisecall_device';
function deviceId(req, res) {
  let id = req.cookies && req.cookies[DEVICE_COOKIE];
  if (!/^[a-f0-9]{32}$/.test(String(id || ''))) {
    id = crypto.randomBytes(16).toString('hex');
    if (res && !res.headersSent) res.cookie(DEVICE_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.IS_PROD, maxAge: 365 * 86400000, path: '/' });
  }
  return id;
}

// kind: 'signup' | 'login' | 'application'. Never throws: a lost signal must not break signing in.
// A private or local address (a developer's computer, a request that did not come through the internet) is not a network signal.
async function record(req, res, userId, kind) {
  try {
    const ip = req.ip && !require('./linkCheck').isBlockedAddress(String(req.ip)) ? req.ip : null;
    await query('INSERT INTO account_signals (user_id, kind, ip_hash, device_hash) VALUES ($1, $2, $3, $4)', [userId, kind, hash(ip), hash(deviceId(req, res))]);
  } catch (e) {
    console.error('[signals] could not record:', e.message);
  }
}

// ---- Copied text ---------------------------------------------------------------------------------------------------------------------
const words = (t) => String(t || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
function shingles(t, n = 5) {
  const w = words(t);
  const out = new Set();
  if (w.length < n) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
function similarity(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const s of A) if (B.has(s)) common += 1;
  return common / Math.min(A.size, B.size); // how much of the shorter text also appears in the other
}

// Normalised for comparing links: no "www.", no trailing slash, no #fragment, lower case.
function linkKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./i, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch (e) { return String(url || '').toLowerCase(); }
}

// -> { sharedNetwork, sharedDevice, duplicateStory, duplicateSample, duplicateEvidence, newEmailDomain, details }
//    Each is a number of other accounts (0 = no signal), except newEmailDomain (true/false).
async function assess(user, evidenceUrls, { domainCreated } = {}) {
  const days = LIMITS.signalWindowDays;
  const [net, dev] = await Promise.all(['ip_hash', 'device_hash'].map((col) => query(
    `SELECT DISTINCT o.user_id FROM account_signals mine
       JOIN account_signals o ON o.${col} = mine.${col} AND o.user_id <> mine.user_id AND o.kind = 'application'
      WHERE mine.user_id = $1 AND mine.${col} IS NOT NULL AND mine.created_at > now() - ($2 || ' days')::interval
        AND o.created_at > now() - ($2 || ' days')::interval LIMIT 20`, [user.id, String(days)])));

  // Stories and sample answers of other mentors (newest 3000).
  const others = (await query(
    `SELECT id, story, sample_answer FROM users WHERE id <> $1 AND role IN ('mentor', 'both') AND (story IS NOT NULL OR sample_answer IS NOT NULL)
      ORDER BY created_at DESC LIMIT 3000`, [user.id])).rows;
  const copiedStory = user.story ? others.filter((o) => o.story && similarity(user.story, o.story) >= LIMITS.duplicateTextSimilarity).map((o) => o.id) : [];
  const copiedSample = user.sampleAnswer ? others.filter((o) => o.sample_answer && similarity(user.sampleAnswer, o.sample_answer) >= LIMITS.duplicateTextSimilarity).map((o) => o.id) : [];

  let sameEvidence = [];
  const keys = [...new Set(evidenceUrls.map(linkKey))];
  if (keys.length) {
    const { rows } = await query(`SELECT user_id, url FROM mentor_evidence WHERE user_id <> $1 AND url IS NOT NULL LIMIT 20000`, [user.id]);
    sameEvidence = [...new Set(rows.filter((r) => keys.includes(linkKey(r.url))).map((r) => r.user_id))];
  }

  let newEmailDomain = false;
  let emailDomainAgeDays = null;
  const domain = String(user.email || '').split('@')[1];
  const free = require('./credentials').isFreeDomain;
  if (domain && !free(domain.toLowerCase()) && domainCreated) {
    const created = await domainCreated(require('./linkCheck').registrableDomain(domain));
    if (created) {
      emailDomainAgeDays = Math.floor((Date.now() - Date.parse(created)) / 86400000);
      newEmailDomain = emailDomainAgeDays < 90;
    }
  }
  return {
    sharedNetwork: net.rows.length >= 2 ? net.rows.length : 0, // (one other person on the same network is normal: a family, an office)
    sharedDevice: dev.rows.length,
    duplicateStory: copiedStory.length,
    duplicateSample: copiedSample.length,
    duplicateEvidence: sameEvidence.length,
    newEmailDomain,
    details: {
      emailDomainAgeDays,
      // Other accounts involved, for the admin to open (never shown to the mentor).
      accounts: [...new Set([...net.rows.map((r) => r.user_id), ...dev.rows.map((r) => r.user_id), ...copiedStory, ...copiedSample, ...sameEvidence])].slice(0, 10)
    }
  };
}

async function purgeOld() {
  const { rowCount } = await query(`DELETE FROM account_signals WHERE created_at < now() - ($1 || ' days')::interval`, [String(LIMITS.signalRetentionDays)]);
  return rowCount;
}

module.exports = { record, assess, purgeOld, similarity, linkKey, hash, DEVICE_COOKIE };
