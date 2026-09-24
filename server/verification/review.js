// Admin decisions on a mentor's verification: pass or fail a single step, give final approval, reject.
// Every decision needs a written reason (for approvals of a whole application the reason is optional
// because each step already carries one) and every one is written to the audit log.
const rules = require('./rules');
const steps = require('./steps');
const flags = require('./flags');
const { VerificationError } = steps;
const { getUserById, updateUser } = require('../models');

const MANUAL = new Set(['admin', 'auto+admin']);
const isMentor = (u) => u && (u.role === 'mentor' || u.role === 'both');

function cleanReason(reason) {
  const text = String(reason || '').trim();
  if (text.length < 5) throw new VerificationError('reason_required');
  return text.slice(0, 1000);
}

async function mentorOrThrow(mentorId) {
  const mentor = await getUserById(mentorId);
  if (!isMentor(mentor)) throw new VerificationError('not_found');
  return mentor;
}

// Pass or fail one step. Only things a person decides can be decided here: the ID check comes from the
// provider's signed webhook, and the email steps are decided by the server.
async function decideStep({ mentorId, step, decision, reason, admin }) {
  if (!rules.STEPS[step]) throw new VerificationError('unknown_step');
  if (!['passed', 'failed'].includes(decision)) throw new VerificationError('invalid_decision');
  const text = cleanReason(reason);
  if (!MANUAL.has(rules.STEPS[step].decider)) throw new VerificationError('not_manual');

  const mentor = await mentorOrThrow(mentorId);
  const existing = (await steps.loadSteps(mentor.id))[step];
  // A person can only judge what the mentor actually submitted.
  if (!existing) throw new VerificationError('not_submitted');

  await steps.setStep(mentor.id, step, decision, { reason: text, actor: steps.adminActor(admin) });
  // An admin who accepts the names as they are closes the mismatch flags.
  if (step === 'name_match' && decision === 'passed') {
    await flags.resolveFlags(mentor.id, ['name_mismatch', 'payout_name_mismatch'], steps.adminActor(admin), text);
  }

  // A required step that fails takes a live mentor off the site until it is sorted out.
  if (decision === 'failed' && mentor.verificationStatus === 'verified' && rules.stepNamesFor(mentor.niche).includes(step)) {
    await updateUser(mentor.id, { verificationStatus: 'pending' });
    await steps.audit(mentor.id, steps.adminActor(admin), 'delisted', { from: 'verified', to: 'pending', step, reason: text });
  }
  return steps.describeFor(await getUserById(mentor.id));
}

// Final approval: allowed only when every required step for the niche has passed.
async function approve({ mentorId, admin }) {
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus !== 'pending') throw new VerificationError('invalid_state');
  const summary = await steps.describeFor(mentor);
  if (!summary.ready) throw new VerificationError('steps_incomplete', { missing: summary.missing });

  const updated = await updateUser(mentor.id, { verificationStatus: 'verified', verificationNote: null, verificationDecidedAt: new Date() });
  await steps.audit(mentor.id, steps.adminActor(admin), 'approved', { from: 'pending', to: 'verified' });
  return updated;
}

async function reject({ mentorId, reason, admin }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (!['pending', 'verified'].includes(mentor.verificationStatus)) throw new VerificationError('invalid_state');
  const updated = await updateUser(mentor.id, { verificationStatus: 'rejected', verificationNote: text, verificationDecidedAt: new Date() });
  await steps.audit(mentor.id, steps.adminActor(admin), 'rejected', { from: mentor.verificationStatus, to: 'rejected', reason: text });
  return updated;
}

module.exports = { decideStep, approve, reject, VerificationError };
