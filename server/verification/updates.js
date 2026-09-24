// Tells a mentor, by email, whenever a step of their application is decided by someone other than
// themselves (an admin, or the ID-check provider), and what is still missing.
const rules = require('./rules');
const steps = require('./steps');
const notify = require('../notify');
const { getUserById } = require('../models');

// What is still missing, as the email lists it: [{ steps: ['id_kyc'], state: 'pending' }, ...]
// An "at least one of" requirement is one entry that lists all its options.
function missingFor(user, stepMap) {
  const out = [];
  for (const r of steps.describe(user, stepMap).requirements) {
    if (r.type === 'step') {
      if (r.status !== 'passed') out.push({ steps: [r.step], state: r.status });
    } else if (!r.satisfied) {
      const states = r.options.map((o) => o.status);
      out.push({ steps: r.options.map((o) => o.step), state: states.includes('pending') ? 'pending' : (states.includes('failed') ? 'failed' : 'todo') });
    }
  }
  return out;
}

// `status` is 'passed' or 'failed'. `reasonKey` names a reason the email already has in both languages
// (for the system's own messages); otherwise `reason` is the admin's own words. Never throws: a lost
// email must not undo a decision.
async function stepDecided(mentorId, step, status, reason, reasonKey) {
  try {
    const mentor = await getUserById(mentorId);
    if (!mentor || !rules.STEPS[step]) return;
    notify.notifyVerificationUpdate(mentor, { step, status, reason, reasonKey, missing: missingFor(mentor, await steps.loadSteps(mentor.id)) });
  } catch (e) {
    console.error('[verification] could not send the status email:', e.message);
  }
}

module.exports = { stepDecided, missingFor };
