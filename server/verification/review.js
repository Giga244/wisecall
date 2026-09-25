// Admin decisions on a mentor's verification: pass or fail a single step, give final approval, reject.
// Every decision needs a written reason (for approvals of a whole application the reason is optional
// because each step already carries one) and every one is written to the audit log.
const rules = require('./rules');
const steps = require('./steps');
const flags = require('./flags');
const credentials = require('./credentials');
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

  // A passed licence is only good until the date on it; after that it stops counting (see steps.effectiveStatus).
  let expiresAt = null;
  if (step === 'license' && decision === 'passed') {
    const c = await credentials.credentialsFor(mentor.id);
    if (c && c.validUntil) expiresAt = new Date(c.validUntil + 'T23:59:59Z');
  }
  await steps.setStep(mentor.id, step, decision, { reason: text, actor: steps.adminActor(admin), expiresAt });
  // Uploaded documents for a decided step are deleted 90 days later.
  if (credentials.DOCUMENT_STEPS.includes(step)) await credentials.scheduleDeletion(mentor.id, step);
  // The mentor is emailed the outcome and what is still missing (after the delisting below, so the list is current).
  const emailAfter = () => require('./updates').stepDecided(mentor.id, step, decision, text);
  // An admin who accepts the names as they are closes the mismatch flags.
  if (step === 'name_match' && decision === 'passed') {
    await flags.resolveFlags(mentor.id, ['name_mismatch', 'payout_name_mismatch'], steps.adminActor(admin), text);
  }

  // A renewed license closes the expiry warnings.
  if (step === 'license' && decision === 'passed') {
    await flags.resolveFlags(mentor.id, ['license_expiring', 'license_expired'], steps.adminActor(admin), `renewed license approved: ${text}`);
  }

  // A required step that fails takes a live mentor off the site until it is sorted out.
  if (decision === 'failed' && mentor.verificationStatus === 'verified' && rules.stepNamesFor(mentor.niche).includes(step)) {
    await updateUser(mentor.id, { verificationStatus: 'pending' });
    await steps.audit(mentor.id, steps.adminActor(admin), 'delisted', { from: 'verified', to: 'pending', step, reason: text });
  }
  await emailAfter();
  return steps.describeFor(await getUserById(mentor.id));
}

// Final approval: allowed only when every required step for the niche has passed.
async function approve({ mentorId, admin, reason }) {
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus !== 'pending') throw new VerificationError('invalid_state');
  const summary = await steps.describeFor(mentor);
  if (!summary.ready) throw new VerificationError('steps_incomplete', { missing: summary.missing });

  const updated = await updateUser(mentor.id, { verificationStatus: 'verified', verificationNote: null, verificationDecidedAt: new Date() });
  await steps.audit(mentor.id, steps.adminActor(admin), 'approved', { from: 'pending', to: 'verified', ...(reason ? { reason } : {}) });
  await credentials.scheduleDeletion(mentor.id, null);
  return updated;
}

async function reject({ mentorId, reason, admin }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (!['pending', 'verified'].includes(mentor.verificationStatus)) throw new VerificationError('invalid_state');
  const updated = await updateUser(mentor.id, { verificationStatus: 'rejected', verificationNote: text, verificationDecidedAt: new Date() });
  await steps.audit(mentor.id, steps.adminActor(admin), 'rejected', { from: mentor.verificationStatus, to: 'rejected', reason: text });
  await credentials.scheduleDeletion(mentor.id, null);
  return updated;
}

// Suspension takes effect at once: the mentor disappears from Browse experts (only verified mentors are
// listed), every question still waiting for their answer is refunded, and so is any answer that was
// being held for review. Payouts already earned stay for an admin to decide.
async function suspend({ mentorId, reason, admin }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus === 'suspended') throw new VerificationError('invalid_state');
  const from = mentor.verificationStatus;

  await updateUser(mentor.id, { verificationStatus: 'suspended', suspendedAt: new Date(), suspensionReason: text, verificationNote: text, verificationDecidedAt: new Date() });
  await steps.audit(mentor.id, steps.adminActor(admin), 'suspended', { from, to: 'suspended', reason: text });

  const payments = require('../payments');
  const { rows } = await require('../db').query(
    `SELECT id, answer_review FROM bookings WHERE mentor_id = $1 AND (status = 'paid' OR (status = 'answered' AND answer_review = 'held'))`, [mentor.id]
  );
  let refunded = 0;
  for (const b of rows) {
    try {
      if (b.answer_review === 'held') await require('../db').query(`UPDATE bookings SET answer_review = 'rejected' WHERE id = $1`, [b.id]);
      await payments.refundBooking(b.id, 'mentor_suspended');
      refunded += 1;
    } catch (e) {
      console.error(`[verification] could not refund booking ${b.id} while suspending ${mentor.id}:`, e.message); // the refund retry job picks it up
    }
  }
  require('../notify').notifyMentorSuspended(mentor, text);
  return { refunded, total: rows.length };
}

// Lifts a suspension. The mentor goes back to "pending" on purpose: a suspended mentor may have lost a step (a licence that ran out, a
// name that no longer matches) while away, so an admin looks again before they are listed. When every required step is still valid the
// admin can do both in one click (`reapprove`): the mentor is reinstated and approved again in the same request, and both are logged.
// Returns { mentor, reapproved } (reapproved is false when steps are missing: the mentor stays in review, and `missing` says what).
async function reinstate({ mentorId, reason, admin, reapprove }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus !== 'suspended') throw new VerificationError('invalid_state');
  const pending = await updateUser(mentor.id, { verificationStatus: 'pending', suspendedAt: null, suspensionReason: null, verificationNote: null });
  await steps.audit(mentor.id, steps.adminActor(admin), 'reinstated', { from: 'suspended', to: 'pending', reason: text });
  if (!reapprove) return { mentor: pending, reapproved: false };
  const summary = await steps.describeFor(pending);
  if (!summary.ready) return { mentor: pending, reapproved: false, missing: summary.missing };
  const approved = await approve({ mentorId: mentor.id, admin, reason: `approved again on reinstatement: ${text}` });
  return { mentor: approved, reapproved: true };
}

module.exports = { decideStep, approve, reject, suspend, reinstate, VerificationError };
