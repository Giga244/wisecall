// The step engine: reads and writes a mentor's verification steps, keeps the audit log, and decides
// whether a mentor is ready for final approval. All rules come from ./rules.js.
const { query, tx } = require('../db');
const rules = require('./rules');

class VerificationError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const runner = (client) => (client ? client.query.bind(client) : query);

// Who is acting. `label` is stored with every audit row, so it stays readable even if the account is deleted.
const SYSTEM = { id: null, label: 'system' };
const PROVIDER = { id: null, label: 'kyc-provider' };
const adminActor = (admin) => ({ id: admin.id, label: admin.email });
const mentorActor = (mentor) => ({ id: mentor.id, label: mentor.email });

async function audit(mentorId, actor, action, { step = null, from = null, to = null, reason = null } = {}, client) {
  await runner(client)(
    `INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, step, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [mentorId, actor.id, actor.label, action, step, from, to, reason]
  );
}

const rowToStep = (r) => ({
  step: r.step, status: r.status, evidence: r.evidence || {}, reason: r.reason, decidedBy: r.decided_by,
  decidedAt: r.decided_at, expiresAt: r.expires_at, updatedAt: r.updated_at
});

// -> { [step]: { step, status, evidence, reason, decidedAt, expiresAt, ... } }
async function loadSteps(userId, client) {
  const { rows } = await runner(client)('SELECT * FROM verification_steps WHERE user_id = $1', [userId]);
  const out = {};
  rows.forEach((r) => { out[r.step] = rowToStep(r); });
  return out;
}

// Steps for many mentors at once: { [userId]: { [step]: ... } }
async function loadStepsFor(userIds) {
  const out = {};
  userIds.forEach((id) => { out[id] = {}; });
  if (!userIds.length) return out;
  const { rows } = await query('SELECT * FROM verification_steps WHERE user_id = ANY($1::uuid[])', [userIds]);
  rows.forEach((r) => { out[r.user_id][r.step] = rowToStep(r); });
  return out;
}

// An expired step no longer counts (for example a licence past its expiry date).
function effectiveStatus(row) {
  if (!row) return undefined;
  if (row.status === 'passed' && row.expiresAt && new Date(row.expiresAt) < new Date()) return 'failed';
  return row.status;
}

// Creates or updates one step and writes the audit row. Returns the new row.
//   evidence is merged into what is already there unless `replaceEvidence` is set.
async function setStep(userId, step, status, opts = {}) {
  if (!rules.STEPS[step]) throw new VerificationError('unknown_step');
  const { evidence = {}, reason = null, actor = SYSTEM, expiresAt = null, replaceEvidence = false, client } = opts;
  const run = runner(client);
  const prev = (await run('SELECT * FROM verification_steps WHERE user_id = $1 AND step = $2', [userId, step])).rows[0];
  const decided = status === 'passed' || status === 'failed';
  const merged = replaceEvidence || !prev ? evidence : { ...(prev.evidence || {}), ...evidence };
  const { rows } = await run(
    `INSERT INTO verification_steps (user_id, step, status, evidence, reason, decided_by, decided_at, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (user_id, step) DO UPDATE
       SET status = EXCLUDED.status, evidence = EXCLUDED.evidence, reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by,
           decided_at = EXCLUDED.decided_at, expires_at = COALESCE(EXCLUDED.expires_at, verification_steps.expires_at), updated_at = now()
     RETURNING *`,
    [userId, step, status, JSON.stringify(merged), reason, decided ? actor.id : null, decided ? new Date() : null, expiresAt]
  );
  const action = status === 'pending' ? 'step_submitted' : `step_${status}`;
  if (!prev || prev.status !== status || status === 'pending') {
    await audit(userId, actor, action, { step, from: prev ? prev.status : null, to: status, reason }, client);
  }
  return rowToStep(rows[0]);
}

// The email step is decided by the system: passed exactly when the account's email is verified.
async function syncEmailStep(user, client) {
  const steps = await loadSteps(user.id, client);
  const has = steps.email && steps.email.status === 'passed';
  if (user.emailVerified && !has) await setStep(user.id, 'email', 'passed', { evidence: { email: user.email }, actor: SYSTEM, client });
  if (!user.emailVerified && has) await setStep(user.id, 'email', 'failed', { reason: 'Email not verified', actor: SYSTEM, client });
}

// Steps this mentor needs on top of their niche's: a video interview, once an admin has asked for one.
const extraStepsFor = (steps) => (steps.video_interview ? ['video_interview'] : []);

// Where a mentor stands: every requirement with its status (and its place in Identity -> Experience -> Review), the optional badges,
// and whether final approval is possible.
function describe(user, steps) {
  const niche = user.niche;
  const statusOf = (s) => effectiveStatus(steps[s]);
  const extra = extraStepsFor(steps);
  const requirements = [...rules.requiredFor(niche), ...extra].map((s) => ({ type: 'step', step: s, group: rules.STEPS[s].group, status: statusOf(s) || 'todo' }));
  const { ready, missing } = rules.evaluate(niche, statusOf, extra);
  return {
    niche, level: rules.levelFor(niche), regulated: rules.isRegulated(niche), requirements, ready, missing,
    optional: rules.OPTIONAL_STEPS.map((s) => ({ step: s, status: statusOf(s) || 'todo' }))
  };
}

// -> the same shape as describe(), loading the steps itself.
async function describeFor(user, client) {
  return describe(user, await loadSteps(user.id, client));
}

module.exports = {
  VerificationError, SYSTEM, PROVIDER, adminActor, mentorActor, audit, loadSteps, loadStepsFor, effectiveStatus, setStep, syncEmailStep, describe, describeFor, extraStepsFor
};
