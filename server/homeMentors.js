// Who "Meet our experts" on the home page may show (docs/CLAUDE-CODE-NEW-HOME.md 2.3): verified mentors who chose to be shown, with a
// username, not deleted or leaving, and not hidden. One rule for /api/home-mentors and for the page, which the server sends with the
// section already open (and its skeleton cards) when there is someone to show, so nothing below it moves when the cards arrive.
const { query } = require('./db');

const WHERE = `u.role IN ('mentor', 'both') AND u.verification_status = 'verified' AND u.show_on_home AND u.username IS NOT NULL
             AND u.deleted_at IS NULL AND u.deletion_requested_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM profile_settings ps WHERE ps.user_id = u.id AND ps.hidden_at IS NOT NULL)`;

async function anyShown() {
  const { rows } = await query(`SELECT EXISTS (SELECT 1 FROM users u WHERE ${WHERE}) AS any`);
  return rows[0].any;
}

module.exports = { WHERE, anyShown };
