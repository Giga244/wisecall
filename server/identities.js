// Which outside accounts (Google) are linked to which Wisecall user.
const { query } = require('./db');

async function findGoogle(subject) {
  const { rows } = await query(`SELECT * FROM user_identities WHERE provider = 'google' AND subject = $1`, [subject]);
  return rows[0] || null;
}

async function googleFor(userId) {
  const { rows } = await query(`SELECT * FROM user_identities WHERE provider = 'google' AND user_id = $1`, [userId]);
  return rows[0] || null;
}

// claims: what Google said about the person (sub, email, email_verified).
async function linkGoogle(userId, claims) {
  const { rows } = await query(
    `INSERT INTO user_identities (user_id, provider, subject, email, email_verified, last_login_at)
     VALUES ($1, 'google', $2, $3, $4, now()) RETURNING *`,
    [userId, claims.sub, claims.email ? String(claims.email).toLowerCase() : null, claims.email_verified === true]
  );
  return rows[0];
}

async function unlinkGoogle(userId) {
  const { rowCount } = await query(`DELETE FROM user_identities WHERE provider = 'google' AND user_id = $1`, [userId]);
  return rowCount > 0;
}

async function touch(id) {
  await query('UPDATE user_identities SET last_login_at = now() WHERE id = $1', [id]);
}

module.exports = { findGoogle, googleFor, linkGoogle, unlinkGoogle, touch };
