// What a question and an answer must look like. The pages show the same numbers (they are sent in /api/config), but only these checks decide.
//
// A text is judged after it is trimmed and its runs of spaces and line breaks are made into single spaces, so padding with blanks does not
// count as writing. An answer must also look like writing: not one letter repeated, not a few words or letters over and over.
const LIMITS = { questionMin: 50, questionMax: 4000, answerMin: 150, answerMax: 8000 };

// The text as it is stored: line endings made the same, blanks at both ends removed.
const tidy = (text) => String(text).replace(/\r\n?/g, '\n').trim();
// How many characters count (letters of any alphabet, Georgian too, are one each).
const size = (text) => [...tidy(text).replace(/\s+/g, ' ')].length;

// True when the text is mostly the same few characters or words again and again ("aaaa...", "ok ok ok ...", "abcabcabc...", "!!!!!!!!!!!!").
function looksRepeated(text) {
  const t = tidy(text).toLowerCase();
  const letters = [...t].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (letters.length === 0) return true;                                   // no letters or digits at all (only punctuation or symbols)
  if (new Set(letters).size < 8) return true;                              // fewer than 8 different letters in a whole answer
  const counts = new Map();
  for (const c of letters) counts.set(c, (counts.get(c) || 0) + 1);
  if (Math.max(...counts.values()) / letters.length > 0.5) return true;   // one letter is more than half of everything
  if (/([^\s])\1{11,}/u.test(t)) return true;                              // the same character 12 times in a row
  const only = letters.join('');
  if (/^(.{1,12}?)\1{5,}$/u.test(only)) return true;                       // the whole text is one short unit repeated (ok ok ok / abcabcabc)
  if (/(.{1,6}?)\1{9,}/u.test(only)) return true;                          // a stretch of it is a short unit repeated ten times or more (hahahahaha...)
  const words = t.match(/[\p{L}\p{N}']+/gu) || [];
  if (words.length >= 20 && new Set(words).size / words.length < 0.2) return true; // a handful of words again and again
  return false;
}

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
