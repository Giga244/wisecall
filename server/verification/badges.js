// Public trust badges: one per check a mentor has really passed, with the date. Nothing else about
// the check is ever public (no license number, no document, no personal data).
const steps = require('./steps');

// badge key -> the step that earns it. "Work email" and "Diploma" are optional: they appear only for mentors who added them.
// (Mentors approved under the first rules keep "Video interviewed" if they had one.)
const BADGE_STEPS = { id: 'id_kyc', experience: 'experience', license: 'license', workEmail: 'work_email', diploma: 'diploma', interview: 'video_interview' };

// -> { [mentorId]: [{ key, date }] }. An expired step (for example a lapsed license) earns nothing.
async function badgesFor(mentorIds) {
  const map = await steps.loadStepsFor(mentorIds);
  const out = {};
  for (const id of mentorIds) {
    out[id] = Object.entries(BADGE_STEPS)
      .filter(([, step]) => steps.effectiveStatus(map[id][step]) === 'passed')
      .map(([key, step]) => ({ key, date: map[id][step].decidedAt }));
  }
  return out;
}

module.exports = { badgesFor, BADGE_STEPS };
