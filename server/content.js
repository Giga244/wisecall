// What a question and an answer must look like. The pages show the same numbers (they are sent in /api/config), but only these checks decide.
//
// A text is judged after it is trimmed and its runs of spaces and line breaks are made into single spaces, so padding with blanks does not
// count as writing. An answer must also look like writing: not one letter repeated, not a few words or letters over and over.
const LIMITS = { questionMin: 50, questionMax: 4000, answerMin: 150, answerMax: 8000 };

// The text rules (tidy, size, looksRepeated) are shared with the pages: public/js/text-rules.js (docs/CLAUDE-CODE-STORY-STEP-CHECK.md).
const { tidy, size, looksRepeated } = require('../public/js/text-rules');

// -> { text } when it is fine, or { error, min?, max? } (an error code the pages know).
function checkQuestion(input) {
  if (typeof input !== 'string') return { error: 'missing_fields' };
  const text = tidy(input);
  if (size(text) < LIMITS.questionMin) return { error: 'question_too_short', min: LIMITS.questionMin };
  if ([...text].length > LIMITS.questionMax) return { error: 'question_too_long', max: LIMITS.questionMax };
  return { text };
}

function checkAnswer(input) {
  if (typeof input !== 'string') return { error: 'missing_answer' };
  const text = tidy(input);
  if (size(text) < LIMITS.answerMin) return { error: 'answer_too_short', min: LIMITS.answerMin };
  if ([...text].length > LIMITS.answerMax) return { error: 'answer_too_long', max: LIMITS.answerMax };
  if (looksRepeated(text)) return { error: 'answer_repetitive' };
  return { text };
}

module.exports = { LIMITS, tidy, size, looksRepeated, checkQuestion, checkAnswer };
