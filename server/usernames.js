// Usernames: the /u/<username> address of a profile.
//   - 3 to 30 characters, a-z, 0-9 and single hyphens (never at the ends), always lower case
//   - unique, and never one of the reserved words (they would clash with a page or a route)
//   - a person may change theirs once every 30 days; the old one keeps redirecting to the new one and nobody else can take it
//   - a name we suggested (from their real name, or from Google) can be replaced at once; choosing their own starts the 30-day clock
//   - a name typed at sign-up can be corrected once straight away (the clock starts with that first change)
const { query, tx } = require('./db');

const CHANGE_EVERY_DAYS = 30;
const MIN = 3, MAX = 30;
const USERNAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Words that are pages, folders or routes of the site itself.
const RESERVED = new Set(['admin', 'administrator', 'api', 'u', 'user', 'users', 'me', 'settings', 'dashboard', 'login', 'logout', 'signup', 'register', 'expert', 'experts',
  'mentor', 'mentors', 'asker', 'about', 'contact', 'terms', 'privacy', 'help', 'support', 'wisecall', 'staff', 'team', 'moderator', 'root', 'system', 'null', 'undefined',
  'static', 'css', 'js', 'fonts', 'i18n', 'img', 'assets', 'public', 'robots', 'sitemap', 'favicon', 'healthz', 'verify', 'notifications', 'profile', 'profiles', 'search', 'browse',
  'faq', 'pricing', 'blog', 'news', 'welcome', 'auth', 'oauth', 'google', 'callback', 'reset-password', 'forgot-password', 'verify-email', 'choose-username', 'mock-bank', 'mock-kyc']);

// The Georgian national romanisation, and a plain Russian one (many people write their name either way).
const MAP = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u',
  ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya'
};

class UsernameError extends Error {
  constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra); }
}

// "Nino Beridze" -> "nino-beridze", "ნინო ბერიძე" -> "nino-beridze"
function slug(name) {
  const latin = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\u0000-\u007f]/g, (c) => MAP[c] || '');
  let s = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX).replace(/-+$/g, '');
  if (s.length < MIN) s = (s + '-user').replace(/^-/, '').slice(0, MAX);
  return s;
}

// null when it is fine, otherwise an error code.
function check(username) {
  const u = String(username || '').trim().toLowerCase();
  if (u.length < MIN || u.length > MAX || !USERNAME_RE.test(u)) return 'invalid_username';
  if (RESERVED.has(u)) return 'reserved_username';
  return null;
}

// Somebody else's (a live username or one they gave up).
async function isTaken(username, exceptUserId, run = query) {
  const u = String(username).toLowerCase();
  const { rows } = await run(
    `SELECT 1 FROM users WHERE lower(username) = $1 AND ($2::uuid IS NULL OR id <> $2)
     UNION ALL SELECT 1 FROM username_history WHERE old_username = $1 AND ($2::uuid IS NULL OR user_id <> $2) LIMIT 1`,
    [u, exceptUserId || null]
  );
  return rows.length > 0;
}

// A free username close to the person's name.
async function suggest(name, exceptUserId, run = query) {
  const base = slug(name);
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, MAX - 5)}-${Math.floor(1000 + Math.random() * 9000)}`.replace(/-+/g, '-');
    if (!check(candidate) && !(await isTaken(candidate, exceptUserId, run))) return candidate;
  }
  return `${slug('user')}-${Date.now().toString(36)}`.slice(0, MAX);
}

// For a brand new user: their own choice (confirmed) or one made from their name (suggested).
async function assignNew(userId, name, wanted, run = query) {
  let username, confirmed = false;
  if (wanted) {
    const problem = check(wanted);
    if (problem) throw new UsernameError(problem);
    username = String(wanted).trim().toLowerCase();
    if (await isTaken(username, userId, run)) throw new UsernameError('username_taken');
    confirmed = true;
  } else {
    username = await suggest(name, userId, run);
  }
  await run('UPDATE users SET username = $2, username_confirmed = $3 WHERE id = $1', [userId, username, confirmed]);
  return { username, confirmed };
}

// A person changes their own username.
async function change(userId, wanted) {
  const problem = check(wanted);
  if (problem) throw new UsernameError(problem);
  const next = String(wanted).trim().toLowerCase();
  return tx(async (client) => {
    const run = client.query.bind(client);
    const { rows } = await run('SELECT username, username_changed_at, username_confirmed FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const me = rows[0];
    if (!me) throw new UsernameError('not_found');
    if (me.username && me.username.toLowerCase() === next) {
      if (!me.username_confirmed) await run('UPDATE users SET username_confirmed = true WHERE id = $1', [userId]); // "keep the one you suggested"
      return { username: next, changed: false };
    }
    // Only a real change (of a username they had accepted) is limited to once in 30 days.
    const counts = me.username_confirmed && me.username_changed_at;
    if (counts) {
      const next30 = new Date(new Date(me.username_changed_at).getTime() + CHANGE_EVERY_DAYS * 86400000);
      if (next30 > new Date()) throw new UsernameError('username_change_too_soon', { nextChangeAt: next30 });
    }
    if (await isTaken(next, userId, run)) throw new UsernameError('username_taken');
    if (me.username && me.username_confirmed) {
      await run('INSERT INTO username_history (old_username, user_id) VALUES ($1, $2) ON CONFLICT (old_username) DO UPDATE SET user_id = EXCLUDED.user_id, changed_at = now()', [me.username.toLowerCase(), userId]);
    }
    await run('DELETE FROM username_history WHERE old_username = $1 AND user_id = $2', [next, userId]); // taking an old one back
    try {
      await run('UPDATE users SET username = $2, username_confirmed = true, username_changed_at = $3 WHERE id = $1', [userId, next, new Date()]);
    } catch (e) {
      if (e.code === '23505') throw new UsernameError('username_taken');
      throw e;
    }
    return { username: next, changed: true };
  });
}

// For a /u/<name> address: the person it belongs to, or (for a name they gave up) where it moved to.
async function resolve(username) {
  const u = String(username || '').toLowerCase();
  if (!u || u.length > 60) return null;
  const now = await query(`SELECT ${require('./models').userColumnsSql()} FROM users WHERE lower(username) = $1`, [u]);
  if (now.rows[0]) return { row: now.rows[0] };
  const old = await query('SELECT u.username FROM username_history h JOIN users u ON u.id = h.user_id WHERE h.old_username = $1', [u]);
  if (old.rows[0] && old.rows[0].username) return { redirectTo: old.rows[0].username };
  return null;
}

// Everybody who has no username yet (people who signed up before profiles existed) gets one made from their name.
async function backfill() {
  const { rows } = await query('SELECT id, name FROM users WHERE username IS NULL ORDER BY created_at');
  for (const u of rows) await assignNew(u.id, u.name, null);
  return rows.length;
}

module.exports = { UsernameError, slug, check, isTaken, suggest, assignNew, change, resolve, backfill, CHANGE_EVERY_DAYS, RESERVED };
