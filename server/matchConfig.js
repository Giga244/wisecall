// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md, stage 1): every number the matching uses, in one place. Change a weight here and
// the results change; nothing else needs to be touched (server/matching.js reads this file, tests/matching.test.js checks the rules).
//
// Only approved, ID-verified, listed mentors of the chosen category take part. A mentor outside the category never appears, whatever
// their points.
module.exports = {
  // How many mentors are shown.
  top: 3,
  // The points.
  points: {
    direction: 3,   // each direction the student chose that the mentor also has
    startTag: 3,    // each starting-point tag the student and the mentor share
    stageFit: 2,    // the mentor's own start or way of working fits where the student is now: once per mentor (at most +2), however many signs fit
    hasPath: 1,     // the mentor filled in "My path"
    hasSample: 1    // the mentor has a sample answer
  },
  // Where the student is now -> which mentors fit: any of these starting-point tags (tags), or how the mentor mainly works (kinds:
  // academic = teaches, practitioner = works in the field, both).
  stageFit: {
    school: { tags: ['region', 'grant', 'firstgen', 'abroad'], kinds: ['academic', 'both'] },
    university: { tags: ['worked', 'grant', 'abroad'], kinds: ['academic', 'both'] },
    switching: { tags: ['switched', 'selftaught'], kinds: [] },
    working: { tags: ['worked', 'switched'], kinds: ['practitioner', 'both'] }
  },
  // The starting points a student can choose in "Where are you starting from?". The page asks them in the student's own words ("I'm from a
  // region", "I need a grant"); each is scored against the mentors' tag of the same id. "Changed fields" is not asked: the stage
  // "I'm changing fields" already says it.
  studentTags: ['region', 'grant', 'worked', 'selftaught', 'abroad', 'firstgen'],
  // The form's limits.
  directionsMax: 3,
  startTagsMax: 3,
  worryMax: 500,
  // A signed-in person's free text is emptied after this many days (a visitor's is never stored).
  worryDays: 30
};
