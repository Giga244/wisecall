// Before a question is paid for, it is checked for an emergency (EN and KA): someone who may harm themselves, a medical emergency,
// violence happening now, or abuse. Wisecall is not an emergency service, so such a question is NOT sent to the bank: the person
// sees calm help text (112, and support lines), and the event is kept for an admin to review (the text encrypted, deleted after
// SAFETY_RETENTION_DAYS). The patterns look for the person's own urgent situation in the first person, not for a topic: "how do I
// support a friend with depression" or a lawyer's question about domestic-violence law is not an emergency.
const { query } = require('./db');
const { encrypt, decrypt } = require('./cryptoBox');

const RETENTION_DAYS = 90;

const PATTERNS = {
  self_harm: [
    /\b(?:kill|hurt|harm|cut)\s+myself\b/i,
    /\b(?:i\s+(?:want|wanna|plan|am\s+going)\s+to\s+(?:die|end\s+(?:it|my\s+life)))\b/i,
    /\b(?:end(?:ing)?\s+my\s+(?:own\s+)?life|suicidal|no\s+reason\s+to\s+(?:live|go\s+on)|better\s+off\s+dead)\b/i,
    /თავს\s?მოვიკლავ|თავის\s?მოკვლა\s?მინდა|მინდა\s?მოვკვდე|სიცოცხლე\s?აღარ\s?მინდა|აღარ\s?მინდა\s?ცხოვრება|თავს\s?ვიზიანებ|სუიციდ/
  ],
  medical_emergency: [
    /\b(?:i\s+(?:can'?t|cannot)\s+breathe|having\s+a\s+heart\s+attack|chest\s+pain\s+(?:right\s+)?now|i\s+(?:took|have\s+taken)\s+an?\s+overdose|overdosed|(?:is|he'?s|she'?s)\s+unconscious|won'?t\s+stop\s+bleeding|having\s+a\s+stroke|having\s+a\s+seizure)\b/i,
    /ვერ\s?ვსუნთქავ|გულის\s?შეტევა\s?მაქვს|ზედოზა\s?მივიღე|ზედოზირება|გონება\s?დაკარგა|სისხლდენა\s?არ\s?ჩერდება|ინსულტი\s?აქვს|კრუნჩხვები\s?აქვს/
  ],
  violence: [
    /\b(?:(?:he|she|they)\s+(?:is|are|'s|'re)\s+(?:going\s+to|gonna)\s+kill\s+me|threaten(?:s|ed|ing)\s+to\s+kill\s+me|someone\s+is\s+(?:attacking|following)\s+me|i'?m\s+being\s+attacked|i\s+(?:will|'ll|am\s+going\s+to)\s+kill\s+(?:him|her|them|someone))\b/i,
    /მომკლავს|მოკვლით\s?მემუქრება|თავს\s?დამესხა|მოვკლავ\s?(?:მას|მათ)/
  ],
  abuse: [
    /\b(?:(?:he|she|my\s+(?:husband|wife|partner|father|mother|dad|mom|boyfriend|girlfriend))\s+(?:hits|beats|rapes|abuses)\s+me|i\s+(?:was|am\s+being|'m\s+being)\s+(?:raped|abused|beaten|sexually\s+abused))\b/i,
    /მცემს|მეძალადება|გამაუპატიურა|სექსუალურად\s?მეძალადება|ოჯახში\s?ძალადობის\s?მსხვერპლი\s?ვარ/
  ]
};

const normalise = (text) => String(text || '').normalize('NFKC').replace(/[’`]/g, "'");

// -> the categories found, e.g. ['self_harm'] (empty when nothing was found).
function checkEmergency(text) {
  const t = normalise(text);
  return Object.keys(PATTERNS).filter((k) => PATTERNS[k].some((re) => re.test(t)));
}

// Kept for an admin: who, which mentor, which categories, and the question (encrypted).
async function record({ userId, mentorId, categories, text }) {
  await query('INSERT INTO safety_events (user_id, mentor_id, categories, excerpt_enc) VALUES ($1, $2, $3, $4)',
    [userId || null, mentorId || null, categories, encrypt(String(text || '').slice(0, 2000))]);
}

async function listForAdmin({ open = true } = {}) {
  const { rows } = await query(
    `SELECT s.*, u.name AS user_name, u.email AS user_email, m.name AS mentor_name, r.email AS reviewed_by_email
       FROM safety_events s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users m ON m.id = s.mentor_id LEFT JOIN users r ON r.id = s.reviewed_by
      WHERE ($1::boolean IS FALSE OR s.reviewed_at IS NULL) ORDER BY s.created_at DESC LIMIT 200`, [open]);
  return rows.map((r) => ({
    id: r.id, categories: r.categories, createdAt: r.created_at, text: r.excerpt_enc ? decrypt(r.excerpt_enc) : null,
    user: r.user_id ? { name: r.user_name, email: r.user_email } : null, mentor: r.mentor_name || null,
    reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by_email, note: r.note
  }));
}

async function markReviewed(id, admin, note) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return false;
  const { rowCount } = await query('UPDATE safety_events SET reviewed_at = now(), reviewed_by = $2, note = $3 WHERE id = $1 AND reviewed_at IS NULL',
    [id, admin.id, String(note || '').trim().slice(0, 500) || null]);
  return rowCount > 0;
}

// The question text is deleted after the retention period (the rest of the row stays, for the counts).
async function purgeOld() {
  const { rowCount } = await query(`UPDATE safety_events SET excerpt_enc = NULL WHERE excerpt_enc IS NOT NULL AND created_at < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
  return rowCount;
}

module.exports = { checkEmergency, record, listForAdmin, markReviewed, purgeOld, RETENTION_DAYS, PATTERNS };
