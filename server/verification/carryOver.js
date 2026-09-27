// Verification rules v2: what the server does once after migration 018 (and harmlessly on every start after that).
//   1 The new "age 18+" step is worked out from the ID check for everyone who already passed it (only the result is stored).
//   2 Approved mentors with a required step that failed (for example "under 18" from step 1, or an ID check declined later) are
//     taken off the site: status back to review, logged, admins told, the mentor emailed the reason. An approval never outlives a
//     failed required step (docs/AUDIT.md #8).
//   3 Applications that were waiting under the first rules are analysed again with what the mentor already gave, so an admin sees the
//     link checks and the AI summary at once (never approved automatically), and the mentor gets one email: "we simplified
//     verification: add a few details (about 2 minutes) and submit". Approved mentors keep their approval (the migration did that).
// Runs under an advisory lock, so two servers starting together do not both do it.
const { pool, query } = require('../db');

const LOCK_ID = 7272018;

async function run() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])).rows[0].ok;
    if (!locked) return { skipped: true };
    const kyc = require('./kyc');
    const steps = require('./steps');
    const analysis = require('./analysis');
    const { getUserById } = require('../models');

    const ages = (await query(
      `SELECT DISTINCT k.user_id FROM kyc_sessions k WHERE k.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM verification_steps s WHERE s.user_id = k.user_id AND s.step = 'age')`)).rows;
    for (const { user_id: id } of ages) {
      try { await kyc.updateAge(id); } catch (e) { console.error(`[carry-over] age for ${id}:`, e.message); }
    }

    const delisted = await steps.delistFailedApproved();

    const waiting = (await query(
      `SELECT u.id FROM users u
        WHERE u.role IN ('mentor', 'both') AND u.verification_status = 'pending' AND u.application_submitted_at IS NULL
          AND EXISTS (SELECT 1 FROM verification_audit a WHERE a.mentor_id = u.id AND a.action = 'migrated_to_rules_v2')
          AND NOT EXISTS (SELECT 1 FROM verification_audit a WHERE a.mentor_id = u.id AND a.action = 'migration_notice_sent')
        LIMIT 500`)).rows;
    for (const { id } of waiting) {
      try {
        // Claimed first, so the email goes out once even if this runs again.
        await steps.audit(id, steps.SYSTEM, 'migration_notice_sent', { reason: 'Verification rules v2: asked to finish the new Experience form' });
        await analysis.runMigrated(id);
        require('../notify').notifyVerificationSimplified(await getUserById(id));
      } catch (e) { console.error(`[carry-over] ${id}:`, e.message); }
    }
    if (ages.length || waiting.length || delisted) console.log(`[carry-over] verification rules v2: age step for ${ages.length}, ${delisted} approved mentor(s) with a failed step taken off the site, ${waiting.length} waiting application(s) analysed and told`);
    return { ages: ages.length, delisted, waiting: waiting.length };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { run };
