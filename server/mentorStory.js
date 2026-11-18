// What makes a student trust a mentor (docs/CLAUDE-CODE-MENTOR-STORY.md): the mentor's own path in three short blocks, neutral
// starting-point tags, a sample answer, "I can help with" lines and work links. All of it is written by the mentor, all of it can be
// changed or removed by them at any time, and nothing here is ever invented by the site.
//
//   My path      pathStart ("where I started / what was hard"), pathHow ("how I coped"), pathNow ("where I am now"): 40 to 400 characters
//                each. Shown as three blocks once all three are there; until then the old free-text story (the About text) is shown.
//                A complete path is also the application's story (users.story: the three blocks, one after the other), so the review,
//                the checks for copied text and the admin's page read it as before.
//   startTags    up to 3 of START_TAGS: where the mentor started from. Never about income or family wealth. Chips on the profile and the
//                Browse cards, and a Browse filter.
//   sample       a common question in their field and a short sample answer (100 to 600 characters), always labelled "Sample answer".
//   helpPoints   up to 3 short lines: "I can help with".
//   workLinks    up to 3 links to their work (Behance, Dribbble, a site, LinkedIn). http/https only; never a messenger, payment or contact link.
//   about        "შენ შესახებ" / "About you": the mentor's whole career in their own words (users.bio, the profile's About), up to 2000
//                characters. A new application needs at least 150 (aboutReason; experience.missingFor 'bio'), but a draft is saved however
//                short it is. Settings -> My details asks for 150 too when the About is new or changed (an About an approved mentor already
//                has is kept as it is). Never written by the site: the path is no longer copied into it. An About that is still the copy of
//                the path made before (ownAbout) counts as empty: the form shows nothing and the profile shows the path instead.
//
// Every text goes through the contact filter and the rude-word check (server/textSafety.js), like the answers people pay for.
const textSafety = require('./textSafety');
const { size, looksRepeated } = require('./content');

const LIMITS = { pathMin: 40, pathMax: 400, tagsMax: 3, questionMin: 10, questionMax: 160, replyMin: 100, replyMax: 600, pointsMax: 3, pointMin: 3, pointMax: 90, linksMax: 3, linkMax: 300, suggestionMax: 60, aboutMin: 150, aboutMax: 2000 };

// Where a mentor started from. Neutral on purpose: what they did and where they came from, never what their family had.
const START_TAGS = [
  { id: 'region', ka: 'რეგიონიდან ჩამოვედი', en: 'Came from the regions' },
  { id: 'grant', ka: 'გრანტით / სტიპენდიით ვისწავლე', en: 'Studied on a grant / scholarship' },
  { id: 'worked', ka: 'სწავლასთან ერთად ვმუშაობდი', en: 'Worked while studying' },
  { id: 'selftaught', ka: 'თვითნასწავლი ვარ', en: 'Self-taught' },
  { id: 'switched', ka: 'სფერო შევიცვალე', en: 'Changed fields' },
  { id: 'abroad', ka: 'საზღვარგარეთ ვისწავლე', en: 'Studied abroad' },
  { id: 'firstgen', ka: 'ოჯახში პირველი სტუდენტი ვარ', en: 'First in my family to study' }
];
const TAG_IDS = START_TAGS.map((x) => x.id);
const isTag = (id) => TAG_IDS.includes(id);

const PATH_KEYS = ['pathStart', 'pathHow', 'pathNow'];
const KEYS = [...PATH_KEYS, 'startTags', 'sampleQuestion', 'sampleReply', 'helpPoints', 'workLinks', 'fieldSuggestion', 'about'];

const bad = (error, field) => ({ error, field });
// A text as it is stored (or null), or what is wrong with it.
function cleanText(value, field, { max, oneLine = false }) {
  if (value !== null && value !== undefined && typeof value !== 'string') return bad('invalid_field', field);
  let v = textSafety.cleanText(value || '');
  if (oneLine) v = v.replace(/\s+/g, ' ');
  if (!v) return { value: null };
  if ([...v].length > max) return bad(`${field}_too_long`, field);
  if (textSafety.isOffensive(v)) return bad('offensive', field);
  if (textSafety.findBlockedContact(v).length) return bad('contact_details', field);
  return { value: v };
}

// Links that are a way to be contacted or paid outside the site, whatever the rest of the address says.
const CONTACT_HOSTS = /(^|\.)(t\.me|telegram\.(me|org|dog)|wa\.me|whatsapp\.com|m\.me|fb\.me|messenger\.com|ig\.me|viber\.com|signal\.me|signal\.group|discord\.(gg|com)|skype\.com|join\.skype\.com|zoom\.us|meet\.google\.com|calendly\.com|cal\.com|paypal\.(com|me)|revolut\.(com|me)|wise\.com|venmo\.com|cash\.app|buymeacoffee\.com|patreon\.com|ko-fi\.com|linktr\.ee|bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly)$/i;
function cleanLink(value) {
  if (typeof value !== 'string') return bad('invalid_link', 'workLinks');
  const raw = value.trim();
  if (!raw) return { value: null };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch (e) { return bad('invalid_link', 'workLinks'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.') || u.toString().length > LIMITS.linkMax) return bad('invalid_link', 'workLinks');
  if (CONTACT_HOSTS.test(u.hostname)) return bad('contact_details', 'workLinks');
  // A known profile site (LinkedIn, ResearchGate, ORCID, Google Scholar…): the address is all that is looked at. Their addresses are full
  // of numbers (an ORCID iD is 0000-0002-1825-0097), which must never be read as a phone number.
  if (require('./verification/linkCheck').isProfileSite(u.hostname)) return { value: u.toString() };
  // Anywhere else, only what is clearly a way to be contacted: an email address, "mailto:" or "tel:", a phone number written the
  // international way (+995…), or a phone given as a parameter (?phone=, ?tel=, ?whatsapp=). A run of digits alone is an id, not a phone.
  let rest = `${u.pathname}${u.search}${u.hash}`;
  try { rest = decodeURIComponent(rest); } catch (e) { /* as it is */ }
  if (/@|mailto:|tel:/i.test(rest) || /\+\s?\d(?:[\s().-]?\d){8,}/.test(rest) || /[?&](?:phone|tel|telephone|mobile|whatsapp|viber)=[^&]*\d{6,}/i.test(u.search)) return bad('contact_details', 'workLinks');
  if (textSafety.isOffensive(rest.replace(/[^\p{L}\p{N}]+/gu, ' '))) return bad('offensive', 'workLinks');
  return { value: u.toString() };
}

// Checks what was sent. draft: an application being written may still be short (the lengths are only checked up to the maximum; the step
// is not counted until the path is complete). Not a draft (Settings, a sent or approved mentor): the path is all three blocks or none,
// and a sample answer comes with its question. -> { patch } or { error, field }
function parse(input, { draft = false, current = {} } = {}) {
  const b = input || {};
  const patch = {};
  for (const key of PATH_KEYS) {
    if (b[key] === undefined) continue;
    const r = cleanText(b[key], key, { max: LIMITS.pathMax });
    if (r.error) return r;
    // (a draft is saved as it was typed, so nothing is lost: a block that is short or repeated just does not count yet, and the page says why)
    if (r.value && !draft && size(r.value) < LIMITS.pathMin) return bad('path_short', key);
    if (r.value && !draft && looksRepeated(r.value)) return bad('path_repeated', key);
    patch[key] = r.value;
  }
  if (b.startTags !== undefined) {
    if (!Array.isArray(b.startTags) || b.startTags.some((x) => !isTag(x))) return bad('invalid_start_tags', 'startTags');
    const tags = TAG_IDS.filter((id) => b.startTags.includes(id)); // (in the list's order, each once)
    if (tags.length > LIMITS.tagsMax) return bad('too_many_start_tags', 'startTags');
    patch.startTags = tags;
  }
  if (b.sampleQuestion !== undefined) {
    const r = cleanText(b.sampleQuestion, 'sampleQuestion', { max: LIMITS.questionMax, oneLine: true });
    if (r.error) return r;
    if (r.value && !draft && size(r.value) < LIMITS.questionMin) return bad('sample_question_short', 'sampleQuestion');
    patch.sampleQuestion = r.value;
  }
  if (b.sampleReply !== undefined) {
    const r = cleanText(b.sampleReply, 'sampleReply', { max: LIMITS.replyMax });
    if (r.error) return r;
    if (r.value && !draft && (size(r.value) < LIMITS.replyMin || looksRepeated(r.value))) return bad('sample_reply_short', 'sampleReply');
    patch.sampleReply = r.value;
  }
  if (b.helpPoints !== undefined) {
    if (!Array.isArray(b.helpPoints)) return bad('invalid_field', 'helpPoints');
    const out = [];
    for (const raw of b.helpPoints) {
      const r = cleanText(raw, 'helpPoints', { max: LIMITS.pointMax, oneLine: true });
      if (r.error) return r;
      if (!r.value) continue;
      if (size(r.value) < LIMITS.pointMin) return bad('help_point_short', 'helpPoints');
      if (!out.includes(r.value)) out.push(r.value);
    }
    if (out.length > LIMITS.pointsMax) return bad('too_many_help_points', 'helpPoints');
    patch.helpPoints = out;
  }
  if (b.workLinks !== undefined) {
    if (!Array.isArray(b.workLinks)) return bad('invalid_link', 'workLinks');
    const out = [];
    for (const raw of b.workLinks) {
      const r = cleanLink(raw);
      if (r.error) return r;
      if (r.value && !out.includes(r.value)) out.push(r.value);
    }
    if (out.length > LIMITS.linksMax) return bad('too_many_links', 'workLinks');
    patch.workLinks = out;
  }
  // About (users.bio): what is sent as it was is left exactly as it is, never cleaned or checked again (an old About is kept whole, and a
  // copy of the path is not emptied by a form that showed it as empty). A changed one goes through the same checks as every text here.
  // (patch.about: server/verification/experience.js stores it as the bio)
  if (b.about !== undefined) {
    if (b.about !== null && typeof b.about !== 'string') return bad('invalid_field', 'about');
    // (a browser sends line breaks as \n whatever the stored text has: the same words with other line breaks are the same About, so an
    // old About is never checked again, and never refuses the save of "My path" next to it)
    const lines = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();
    if (lines(b.about) !== lines(ownAbout(current))) {
      const r = cleanText(b.about, 'about', { max: LIMITS.aboutMax });
      if (r.error) return r;
      patch.about = r.value;
    }
  }
  if (b.fieldSuggestion !== undefined) {
    const r = cleanText(b.fieldSuggestion, 'fieldSuggestion', { max: LIMITS.suggestionMax, oneLine: true });
    if (r.error) return r;
    if (r.value && /[<>{}]|https?:|www\./i.test(r.value)) return bad('invalid_field', 'fieldSuggestion');
    patch.fieldSuggestion = r.value;
  }
  if (!draft) {
    const now = (k) => (patch[k] !== undefined ? patch[k] : current[k]) || null;
    // (all three blocks or none: one block alone would not be shown)
    if (PATH_KEYS.some((k) => patch[k] !== undefined)) {
      const filled = PATH_KEYS.filter((k) => now(k));
      if (filled.length && filled.length < PATH_KEYS.length) return bad('path_incomplete', PATH_KEYS.find((k) => !now(k)));
    }
    if (patch.sampleQuestion !== undefined || patch.sampleReply !== undefined) {
      if (now('sampleReply') && !now('sampleQuestion')) return bad('sample_question_short', 'sampleQuestion');
      if (now('sampleQuestion') && !now('sampleReply')) return bad('sample_reply_short', 'sampleReply');
    }
  }
  return { patch };
}

// All three blocks are there, each long enough and real writing (not one letter or a few words over and over).
const blockOk = (text) => Boolean(text) && size(text) >= LIMITS.pathMin && !looksRepeated(text);
const pathComplete = (u) => PATH_KEYS.every((k) => blockOk(u[k]));
// Why a path that was started does not count yet: 'repeated' | 'short' | null (complete, or not started).
const pathReason = (u) => (pathComplete(u) || !PATH_KEYS.some((k) => u[k]) ? null
  : (PATH_KEYS.some((k) => u[k] && size(u[k]) >= LIMITS.pathMin && looksRepeated(u[k])) ? 'repeated' : 'short'));
// The path as one text: the application's story (and the About text, while that follows the story).
const asStory = (u) => PATH_KEYS.map((k) => u[k]).join('\n\n');
// Whether the About text is only the copy of the path the site made before (the three blocks, one after the other), not the mentor's About.
const sameText = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
const aboutIsPathCopy = (u) => Boolean(pathComplete(u) && u.bio && sameText(u.bio, asStory(u)));
// The mentor's own About: their bio, or nothing while the bio is that copy.
const ownAbout = (u) => (u && u.bio && !aboutIsPathCopy(u) ? u.bio : '');
// Why an About does not count yet: 'short' (empty or under 150, counted like the path: public/js/text-rules.js size) | 'repeated' (one
// letter or a few words over and over) | null (it counts).
const aboutReason = (text) => (!text || size(text) < LIMITS.aboutMin ? 'short' : (looksRepeated(text) ? 'repeated' : null));
const hasSample = (u) => Boolean(u.sampleQuestion && size(u.sampleQuestion) >= LIMITS.questionMin && u.sampleReply && size(u.sampleReply) >= LIMITS.replyMin && !looksRepeated(u.sampleReply));

// A link as a chip: where it leads, by a name people know.
const KNOWN_HOSTS = [[/(^|\.)behance\.net$/, 'Behance'], [/(^|\.)dribbble\.com$/, 'Dribbble'], [/(^|\.)linkedin\.com$/, 'LinkedIn'], [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)medium\.com$/, 'Medium'], [/(^|\.)figma\.com$/, 'Figma'],
  [/(^|\.)researchgate\.net$/, 'ResearchGate'], [/(^|\.)orcid\.org$/, 'ORCID'], [/^scholar\.google\.[a-z.]{2,6}$/, 'Google Scholar'], [/(^|\.)academia\.edu$/, 'Academia.edu'],
  [/(^|\.)(webofscience\.com|publons\.com)$/, 'Web of Science']];
function linkChip(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; }
  const known = KNOWN_HOSTS.find(([re]) => re.test(host));
  return { url, label: known ? known[1] : host };
}

// What the mentor sees and edits (their own form).
const formOf = (u) => ({
  pathStart: u.pathStart || '', pathHow: u.pathHow || '', pathNow: u.pathNow || '', startTags: u.startTags || [],
  sampleQuestion: u.sampleQuestion || '', sampleReply: u.sampleReply || '', helpPoints: u.helpPoints || [], workLinks: u.workLinks || [],
  fieldSuggestion: u.fieldSuggestion || '', about: ownAbout(u)
});

// What everyone may see on the profile. showAbout: the About section is visible to this viewer (the path, the sample answer and the
// "I can help with" lines follow it; the tags, the links and the years are the mentor's own public choices).
function publicView(u, { showAbout = true } = {}) {
  const complete = pathComplete(u);
  return {
    path: showAbout && complete ? { start: u.pathStart, how: u.pathHow, now: u.pathNow } : null,
    // (the About text is the same words as the path: the page shows the three blocks instead of it, not both)
    aboutIsPath: aboutIsPathCopy(u),
    startTags: (u.startTags || []).filter(isTag),
    sample: showAbout && hasSample(u) ? { question: u.sampleQuestion, answer: u.sampleReply } : null,
    helpPoints: showAbout ? (u.helpPoints || []) : [],
    workLinks: (u.workLinks || []).map(linkChip).filter(Boolean),
    years: Number.isInteger(u.yearsExperience) ? u.yearsExperience : null
  };
}

// What a Browse card shows: the first line of "where I am now", up to 2 starting-point chips, and whether there is a sample answer.
function cardView(u, { showAbout = true } = {}) {
  const first = showAbout && pathComplete(u) ? String(u.pathNow).split(/\n|(?<=[.!?…])\s/)[0].trim() : null;
  return { nowLine: first || null, startTags: (u.startTags || []).filter(isTag), hasSample: showAbout && hasSample(u) };
}

// The dashboard's one card for mentors from before this ("add your path and a sample answer"): until it is closed, or both are there.
const wantsCard = (u) => !u.pathCardDismissedAt && (!pathComplete(u) || !hasSample(u));
// The dashboard's card for a mentor with no About of their own ("add „შენ შესახებ“"): until it is closed, or there is one. Only a card:
// such a mentor is never hidden, blocked or sent back to review for it.
const wantsAboutCard = (u) => !u.aboutCardDismissedAt && !ownAbout(u).trim();

module.exports = { LIMITS, START_TAGS, TAG_IDS, PATH_KEYS, KEYS, isTag, parse, pathComplete, pathReason, asStory, aboutIsPathCopy, ownAbout, aboutReason, hasSample, formOf, publicView, cardView, linkChip, wantsCard, wantsAboutCard };
