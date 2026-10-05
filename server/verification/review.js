// Decisions on a mentor's verification: an admin passes or fails a single step, confirms a piece of evidence, asks for a video interview,
// gives final approval or rejects; the analysis (./analysis.js) may approve automatically when every rule allows it (never reject).
// Every admin decision needs a written reason (for approvals of a whole application the reason is optional) and every one is written to
// the audit log.
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
  // (A failed required step takes a listed mentor off the site inside setStep, and that sends the mentor the email.)
  const saved = await steps.setStep(mentor.id, step, decision, { reason: text, actor: steps.adminActor(admin), expiresAt });
  // Uploaded documents for a decided step are deleted 90 days later.
  if (credentials.DOCUMENT_STEPS.includes(step)) await credentials.scheduleDeletion(mentor.id, step);
  // The mentor is emailed the outcome and what is still missing (unless the delisting already did).
  const emailAfter = () => (saved.delisted ? null : require('./updates').stepDecided(mentor.id, step, decision, text));
  // An admin who accepts the names as they are closes the mismatch flag. (A payout-name flag is closed on its own: it only holds payouts.)
  if (step === 'name_match' && decision === 'passed') {
    await flags.resolveFlags(mentor.id, ['name_mismatch'], steps.adminActor(admin), text);
  }
  // A diploma decision is also the decision on that piece of evidence (and gives or removes the "Diploma verified" badge).
  if (step === 'diploma') {
    await require('../db').query(`UPDATE mentor_evidence SET check_status = $2, decided_by = $3, decided_at = now() WHERE user_id = $1 AND kind = 'diploma'`,
      [mentor.id, decision === 'passed' ? 'ok' : 'failed', admin.id]);
  }

  // A renewed license closes the expiry warnings.
  if (step === 'license' && decision === 'passed') {
    await flags.resolveFlags(mentor.id, ['license_expiring', 'license_expired'], steps.adminActor(admin), `renewed license approved: ${text}`);
  }

  await emailAfter();
  // The identity side changed: the latest analysis is decided again (it may now allow automatic approval, or no longer).
  if (['name_match', 'age'].includes(step)) require('./analysis').afterIdentityChange(mentor.id);
  return steps.describeFor(await getUserById(mentor.id));
}

// Final approval: allowed only when every required step for the niche has passed.
async function approve({ mentorId, admin, reason }) {
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus !== 'pending') throw new VerificationError('invalid_state');
  const summary = await steps.describeFor(mentor);
  if (!summary.ready) throw new VerificationError('steps_incomplete', { missing: summary.missing });

  return finishApproval(mentor, steps.adminActor(admin), reason || null);
}

// The Experience step is accepted with the approval, and the decision is recorded under the current rules.
async function finishApproval(mentor, actor, reason) {
  const exp = (await steps.loadSteps(mentor.id)).experience;
  if (!exp || exp.status !== 'passed') await steps.setStep(mentor.id, 'experience', 'passed', { reason: reason || 'Approved', actor });
  // (a listed mentor's profile is public: the field pages, the sitemap and search engines show it)
  const updated = await updateUser(mentor.id, { verificationStatus: 'verified', verificationNote: null, verificationDecidedAt: new Date(), verificationRules: rules.VERSION, profileVisibility: 'public' });
  await steps.audit(mentor.id, actor, 'approved', { from: 'pending', to: 'verified', ...(reason ? { reason } : {}) });
  await credentials.scheduleDeletion(mentor.id, null);
  return updated;
}

// Automatic approval by the analysis. Only reached when every condition in rules.decide holds (and AUTO_APPROVE=on); checks the steps
// once more, like an admin's approval. Returns the mentor, or null when it was not possible after all (it then waits for a person).
async function autoApprove({ mentorId, reviewId }) {
  const mentor = await getUserById(mentorId);
  if (!isMentor(mentor) || mentor.verificationStatus !== 'pending' || rules.isRegulated(mentor.niche)) return null;
  const summary = await steps.describeFor(mentor);
  if (!summary.ready) return null;
  const actor = { id: null, label: 'system (automatic approval)' };
  const updated = await finishApproval(mentor, actor, `Approved automatically under ${rules.DECISION.label}: every condition held (analysis ${reviewId})`);
  require('../notify').notifyMentorDecision(updated, true, null);
  require('../waitlist').afterMaybeListed(updated.id);
  return updated;
}

async function reject({ mentorId, reason, admin }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (!['pending', 'verified'].includes(mentor.verificationStatus)) throw new VerificationError('invalid_state');
  const updated = await updateUser(mentor.id, { verificationStatus: 'rejected', verificationNote: text, verificationDecidedAt: new Date(), verificationRules: rules.VERSION });
  await steps.audit(mentor.id, steps.adminActor(admin), 'rejected', { from: mentor.verificationStatus, to: 'rejected', reason: text });
  // The mentor sees the reason on their Experience step, can change their application and submit it again.
  const exp = (await steps.loadSteps(mentor.id)).experience;
  if (exp && exp.status === 'pending') await steps.setStep(mentor.id, 'experience', 'failed', { reason: text, actor: steps.adminActor(admin) });
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
  // Their live sessions that have not ended are cancelled too: everybody who bought a ticket is refunded (server/live/sessions.js).
  const live = await require('../db').query(`SELECT id FROM live_sessions WHERE mentor_id = $1 AND status IN ('draft', 'review', 'rejected', 'published', 'live')`, [mentor.id]);
  for (const s of live.rows) {
    await require('../live/sessions').cancel(s.id, 'mentor_suspended').catch((e) => console.error(`[verification] could not cancel live session ${s.id} while suspending ${mentor.id}:`, e.message));
  }
  require('../notify').notifyMentorSuspended(mentor, text);
  return { refunded, total: rows.length, liveCancelled: live.rows.length };
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

// An admin confirms (or refuses) one piece of evidence by hand: a company code looked up in the Public Registry, a document, a link.
async function decideEvidence({ mentorId, evidenceId, decision, reason, admin }) {
  if (!['ok', 'failed'].includes(decision)) throw new VerificationError('invalid_decision');
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (!/^[0-9a-f-]{36}$/i.test(String(evidenceId))) throw new VerificationError('not_found');
  const db = require('../db');
  const { rows } = await db.query(`UPDATE mentor_evidence SET check_status = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND user_id = $2 RETURNING kind`,
    [evidenceId, mentor.id, decision, admin.id]);
  if (!rows[0]) throw new VerificationError('not_found');
  await steps.audit(mentor.id, steps.adminActor(admin), decision === 'ok' ? 'evidence_confirmed' : 'evidence_refused', { reason: `${rows[0].kind}: ${text}` });
  // A diploma confirmed by an admin earns the "Diploma verified" badge.
  if (rows[0].kind === 'diploma') {
    await steps.setStep(mentor.id, 'diploma', decision === 'ok' ? 'passed' : 'failed', { reason: text, actor: steps.adminActor(admin) });
  }
}

// An admin asks for a video interview (never required by default). Until it has passed, the mentor cannot be approved.
async function requestInterview({ mentorId, reason, admin }) {
  const text = cleanReason(reason);
  const mentor = await mentorOrThrow(mentorId);
  if (mentor.verificationStatus !== 'pending') throw new VerificationError('invalid_state');
  const existing = (await steps.loadSteps(mentor.id)).video_interview;
  if (existing && existing.status === 'passed') throw new VerificationError('already_passed');
  if (!existing || existing.status !== 'pending') {
    await steps.setStep(mentor.id, 'video_interview', 'pending', { evidence: { requested: true }, replaceEvidence: true, reason: text, actor: steps.adminActor(admin) });
    await steps.audit(mentor.id, steps.adminActor(admin), 'interview_requested', { step: 'video_interview', reason: text });
    require('../notify').notifyInterviewRequested(mentor, text);
    require('./analysis').afterIdentityChange(mentor.id); // (an open interview request rules out automatic approval)
  }
  return steps.describeFor(await getUserById(mentor.id));
}

module.exports = { decideStep, approve, autoApprove, reject, suspend, reinstate, decideEvidence, requestInterview, VerificationError };
