// Name matching. Compares the name on the ID (as the ID provider verified it) with the profile name, the
// name on a licence or registry, and the name on the payout account, tolerating:
//   - Georgian script vs Latin script (transliteration), and the many ways Latin spellings of Georgian
//     names vary (Giorgi/Giorgy, Kapanadze/Kapanadse, Gelashvili/Gelasvili ...)
//   - a different word order (Beridze Nino vs Nino Beridze)
//   - titles (Dr., Prof.) and a missing middle name
// A mismatch is NEVER approved by the computer: it is flagged for an admin.
const { LIMITS } = require('./rules');
const config = require('../config');

// Georgian (Mkhedruli) to Latin, following the national romanization system.
const GEORGIAN = {
  'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm',
  'ნ': 'n', 'ო': 'o', 'პ': 'p', 'ჟ': 'zh', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'p', 'ქ': 'k', 'ღ': 'gh', 'ყ': 'q',
  'შ': 'sh', 'ჩ': 'ch', 'ც': 'ts', 'ძ': 'dz', 'წ': 'ts', 'ჭ': 'ch', 'ხ': 'kh', 'ჯ': 'j', 'ჰ': 'h'
};

// Words that are not part of a person's name.
const TITLES = new Set(['dr', 'doctor', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'md', 'phd', 'esq', 'atty', 'attorney', 'lawyer']);

function transliterate(text) {
  return [...String(text || '')].map((ch) => (GEORGIAN[ch] !== undefined ? GEORGIAN[ch] : ch)).join('');
}

// Lower-case Latin letters only: "Dr. Ana-Maria Éliade" -> ['ana', 'maria', 'eliade'].
function tokens(name) {
  const latin = transliterate(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return latin.split(/[^a-z]+/).filter((t) => t && !TITLES.has(t));
}

// Spelling variants of the same sounds are folded together, so "Kapanadze" and "Kapanadse" compare equal.
function canon(token) {
  return token
    .replace(/dzh|dj|zh/g, 'J')
    .replace(/ch/g, 'H')
    .replace(/sh/g, 'S')
    .replace(/kh|x/g, 'X')
    .replace(/gh/g, 'g')
    .replace(/ts|dz|ds|tz|c(?!h)/g, 'Z')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1'); // "anna" and "ana" are the same name
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function tokenSimilarity(a, b) {
  const x = canon(a), y = canon(b);
  if (x === y) return 1;
  // An initial ("N." or "Nino B") matches any word that starts with the same letter, a bit less strongly.
  if (a.length === 1 || b.length === 1) return x[0] === y[0] ? 0.85 : 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// 0 to 1: how alike two names are. Word order does not matter, and the shorter name may be a part of the
// longer (first + last name against a full name with a middle name).
function similarity(a, b) {
  let A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  if (A.length > B.length) [A, B] = [B, A]; // A is the shorter list
  const used = new Set();
  let total = 0;
  for (const ta of A) {
    let best = 0, bestIdx = -1;
    B.forEach((tb, i) => {
      if (used.has(i)) return;
      const s = tokenSimilarity(ta, tb);
      if (s > best) { best = s; bestIdx = i; }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  return total / A.length;
}

// A single word is not enough to call two names the same person.
function compareNames(a, b, threshold = LIMITS.nameMatchThreshold) {
  const score = similarity(a, b);
  const enough = Math.min(tokens(a).length, tokens(b).length) >= 2;
  return { score: Math.round(score * 100) / 100, match: enough && score >= threshold };
}

// ---- Recomputing the name-match step ---------------------------------------------------------
// The name on the ID is compared with the profile name and (regulated niches) the name on the licence. All matching: the step passes
// by itself. A mismatch is NEVER a rejection: the step waits, the mentor can correct their profile name (it is compared again at once),
// or an admin looks at it. The payout account holder is compared too, but only for payouts: a different name there holds the money
// until an admin checks it, and has no effect on the application.
const crypto = require('crypto');
const { query } = require('../db');
const steps = require('./steps');
const flags = require('./flags');
const kyc = require('./kyc');
const { getUserById, updateUser } = require('../models');

// The name the mentor gave as it appears on their licence, when they have submitted one.
async function licenseName(userId) {
  try {
    const { rows } = await query('SELECT holder_name FROM mentor_credentials WHERE user_id = $1', [userId]);
    return rows[0] ? rows[0].holder_name : null;
  } catch (e) {
    if (e.code === '42P01') return null; // the credentials table does not exist yet
    throw e;
  }
}

// A keyed hash, so the names cannot be guessed back from it. It only tells us whether the inputs changed.
const hashOf = (parts) => crypto.createHmac('sha256', config.DATA_ENCRYPTION_KEY).update(parts.join('|').toLowerCase()).digest('hex');

// The payout name only matters for paying out: its own flag, which blocks payouts until an admin closes it.
async function recomputePayout(user, idName) {
  if (!user.payoutName) return flags.resolveFlags(user.id, ['payout_name_mismatch'], steps.SYSTEM, 'No payout account');
  const r = compareNames(idName, user.payoutName);
  if (r.match) return flags.resolveFlags(user.id, ['payout_name_mismatch'], steps.SYSTEM, 'The payout name now matches');
  const opened = await flags.openFlag(user.id, 'payout_name_mismatch', { mismatches: [{ source: 'iban', name: user.payoutName, score: r.score }] });
  if (opened) {
    require('../notify').notifyAdmins('A payout account name does not match the ID',
      `<p>${user.name} (${user.email}): the payout account holder "${user.payoutName}" does not match the name on the ID (${Math.round(r.score * 100)}%).</p><p>Payouts to this mentor are held until an admin checks it.</p>`);
  }
  return opened;
}

async function recompute(userId) {
  const user = await getUserById(userId);
  if (!user || !(user.role === 'mentor' || user.role === 'both')) return null;
  const idName = await kyc.verifiedNameFor(user.id);
  if (!idName) return null; // nothing to compare against until the ID check is approved
  await recomputePayout(user, idName);

  const candidates = [
    { source: 'profile', label: 'Profile name', name: user.name },
    { source: 'license', label: 'License name', name: await licenseName(user.id) }
  ].filter((c) => c.name);
  const results = candidates.map((c) => ({ ...c, ...compareNames(idName, c.name) }));
  const inputsHash = hashOf([idName, ...candidates.map((c) => `${c.source}:${c.name}`)]);

  const current = (await steps.loadSteps(user.id)).name_match;
  // An admin already looked at exactly these names and approved them: leave that decision alone.
  if (current && current.status === 'passed' && current.decidedBy && current.evidence.inputsHash === inputsHash) return { unchanged: true };

  // The name on the ID is never written here (it lives encrypted with the ID check), and a name that
  // matched is not repeated either. A name that did NOT match is shown so the admin sees what differs.
  const evidence = {
    inputsHash,
    results: results.map((r) => (r.match
      ? `${r.label} matches the ID (${Math.round(r.score * 100)}%)`
      : `${r.label} DOES NOT MATCH the ID: "${r.name}" (${Math.round(r.score * 100)}%)`))
  };
  const mismatches = results.filter((r) => !r.match);
  const before = current ? current.status : null;

  if (!mismatches.length) {
    await steps.setStep(user.id, 'name_match', 'passed', { evidence, replaceEvidence: true, reason: 'All names match the ID', actor: steps.SYSTEM });
    await flags.resolveFlags(user.id, ['name_mismatch'], steps.SYSTEM, 'The names now match');
    if (before !== 'passed') await require('./analysis').afterIdentityChange(user.id);
    return { match: true };
  }

  await steps.setStep(user.id, 'name_match', 'pending', { evidence, replaceEvidence: true, reason: 'A name does not match the ID: the mentor can correct it, or an admin checks it', actor: steps.SYSTEM });
  const detail = { mismatches: mismatches.map((m) => ({ source: m.source, name: m.name, score: m.score })) };
  const newFlag = await flags.openFlag(user.id, 'name_mismatch', detail);

  // A live mentor whose public name no longer matches the ID goes back to review.
  if (user.verificationStatus === 'verified') {
    await updateUser(user.id, { verificationStatus: 'pending' });
    await steps.audit(user.id, steps.SYSTEM, 'delisted', { from: 'verified', to: 'pending', step: 'name_match', reason: 'The name no longer matches the ID' });
  }
  if (newFlag) {
    require('../notify').notifyAdmins('A mentor name does not match their ID',
      `<p>${user.name} (${user.email}): ${evidence.results.join('; ')}.</p><p>It was not approved (or rejected) automatically: the mentor can correct their profile name, or you can check it in the admin panel.</p>`);
  }
  if (before === 'passed') await require('./analysis').afterIdentityChange(user.id);
  return { match: false, mismatches };
}
module.exports = { transliterate, tokens, canon, similarity, compareNames, recompute };
