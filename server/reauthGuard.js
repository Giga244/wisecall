// Wrong passwords typed to confirm an action while signed in (changing the password, deleting the account), counted per account
// (docs/REVIEW-2.md #5). Someone holding a stolen session cookie cannot try passwords at full speed from many addresses: after
// MAX_FAILURES wrong ones within the hour, these checks answer "too many" until the hour is over. (Per address there is also the
// rate limit in server/index.js.) Kept in memory, like the rate limiter: a restart forgets it, which only ever helps the owner.
const MAX_FAILURES = 10;
const WINDOW_MS = 60 * 60 * 1000;
const failures = new Map(); // user id -> { count, reset }

function blocked(userId) {
  const f = failures.get(userId);
  if (!f) return 0;
  if (Date.now() > f.reset) { failures.delete(userId); return 0; }
  return f.count >= MAX_FAILURES ? Math.ceil((f.reset - Date.now()) / 1000) : 0;
}
function fail(userId) {
  const f = failures.get(userId);
  if (!f || Date.now() > f.reset) failures.set(userId, { count: 1, reset: Date.now() + WINDOW_MS });
  else f.count += 1;
}
const succeed = (userId) => failures.delete(userId);

setInterval(() => { const now = Date.now(); for (const [k, v] of failures) if (now > v.reset) failures.delete(k); }, 10 * 60 * 1000).unref();

module.exports = { blocked, fail, succeed, MAX_FAILURES };
