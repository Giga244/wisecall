// Wrong one-time codes are counted per account, not only per IP address (docs/AUDIT.md #2): a 6-digit code gets at most
// MAX_WRONG_CODES tries, then it is cleared and a new one must be asked for. Used for the email-verification code and the work-email
// code. Each try is counted BEFORE the code is compared, in one atomic update, so parallel guesses cannot get more tries.
const { query } = require('./db');

const MAX_WRONG_CODES = 5;
const KINDS = {
  email: { count: 'email_code_attempts', hash: 'email_code_hash', expires: 'email_code_expires_at' },
  work_email: { count: 'work_email_code_attempts', hash: 'work_email_code_hash', expires: 'work_email_code_expires_at' }
};

// Takes one try at the current code. Returns the number of tries used so far (1..MAX), or null when the code has none left.
async function takeTry(userId, kind) {
  const k = KINDS[kind];
  const { rows } = await query(
    `UPDATE users SET ${k.count} = ${k.count} + 1 WHERE id = $1 AND ${k.hash} IS NOT NULL AND ${k.count} < $2 RETURNING ${k.count} AS n`,
    [userId, MAX_WRONG_CODES]);
  if (rows[0]) return rows[0].n;
  await kill(userId, kind);
  return null;
}

// The code is cleared: the person has to ask for a new one.
async function kill(userId, kind) {
  const k = KINDS[kind];
  await query(`UPDATE users SET ${k.hash} = NULL, ${k.expires} = NULL WHERE id = $1`, [userId]);
}

// After a wrong code: how many tries are left (0 = the code was cleared just now).
async function wrongCode(userId, kind, used) {
  if (used < MAX_WRONG_CODES) return MAX_WRONG_CODES - used;
  await kill(userId, kind);
  return 0;
}

// A new code was sent, or the right one was entered: the count starts again.
async function reset(userId, kind) {
  await query(`UPDATE users SET ${KINDS[kind].count} = 0 WHERE id = $1`, [userId]);
}

module.exports = { MAX_WRONG_CODES, takeTry, kill, wrongCode, reset };
