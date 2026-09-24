// Flags raised for admins (see migrations/007_mentor_flags.sql). Opening and resolving are both audited.
const { query } = require('../db');
const steps = require('./steps');

const runner = (client) => (client ? client.query.bind(client) : query);

// Opens a flag unless one of that kind is already open. Returns true only when it is new.
async function openFlag(mentorId, kind, detail = {}, client) {
  const { rowCount } = await runner(client)(
    `INSERT INTO mentor_flags (mentor_id, kind, detail) VALUES ($1, $2, $3) ON CONFLICT (mentor_id, kind) WHERE status = 'open' DO NOTHING`,
    [mentorId, kind, JSON.stringify(detail)]
  );
  if (rowCount) await steps.audit(mentorId, steps.SYSTEM, 'flag_opened', { step: null, reason: kind }, client);
  return rowCount > 0;
}

// Resolves every open flag of the given kinds. `actor` is an admin, or steps.SYSTEM.
async function resolveFlags(mentorId, kinds, actor, resolution, client) {
  const { rows } = await runner(client)(
    `UPDATE mentor_flags SET status = 'resolved', resolved_at = now(), resolved_by = $3, resolution = $4
      WHERE mentor_id = $1 AND kind = ANY($2::text[]) AND status = 'open' RETURNING kind`,
    [mentorId, kinds, actor.id, resolution]
  );
  for (const r of rows) await steps.audit(mentorId, actor, 'flag_resolved', { reason: `${r.kind}: ${resolution}` }, client);
  return rows.length;
}

async function resolveById(flagId, actor, resolution) {
  const { rows } = await query(
    `UPDATE mentor_flags SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution = $3
      WHERE id = $1 AND status = 'open' RETURNING mentor_id, kind`,
    [flagId, actor.id, resolution]
  );
  if (!rows[0]) return null;
  await steps.audit(rows[0].mentor_id, actor, 'flag_resolved', { reason: `${rows[0].kind}: ${resolution}` });
  return rows[0];
}

async function openFlagsFor(mentorId) {
  const { rows } = await query(`SELECT id, kind, detail, created_at FROM mentor_flags WHERE mentor_id = $1 AND status = 'open' ORDER BY created_at`, [mentorId]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, detail: r.detail, createdAt: r.created_at }));
}

const hasOpenFlag = async (mentorId, kinds) => {
  const { rows } = await query(`SELECT 1 FROM mentor_flags WHERE mentor_id = $1 AND kind = ANY($2::text[]) AND status = 'open' LIMIT 1`, [mentorId, kinds]);
  return rows.length > 0;
};

module.exports = { openFlag, resolveFlags, resolveById, openFlagsFor, hasOpenFlag };
