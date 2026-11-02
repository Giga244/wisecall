// Professional credentials a mentor submits: a licence or registration (regulated niches), private documents (a licence document,
// a diploma as evidence), and an optional work email. Everything is checked by the server first, then waits for an admin (except the
// work-email step, which the server decides after the mentor proves they can read that mailbox).
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const config = require('../config');
const rules = require('./rules');
const steps = require('./steps');
const { encrypt, decrypt, encryptBytes, decryptBytes } = require('../cryptoBox');
const { sendTemplate } = require('../mail');

const { VerificationError } = steps;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENT_STEPS = Object.keys(rules.STEPS).filter((s) => rules.STEPS[s].document);

const text = (v, min, max) => {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return s.length >= min && s.length <= max ? s : null;
};

// A mentor can only submit what their niche asks for, or one of the optional badges.
function requireStep(user, step) {
  if (!rules.canSubmit(user.niche, step)) throw new VerificationError('not_required');
}

// ---- Licence or registration number -----------------------------------------------------------
async function submitLicense(user, input) {
  requireStep(user, 'license');
  const number = text(input.number, 3, 40);
  const issuingBody = text(input.issuingBody, 2, 120);
  const holderName = text(input.holderName || user.name, 3, 100);
  const validUntil = String(input.validUntil || '');
  if (!number || !/^[\p{L}\p{N}][\p{L}\p{N}\s./\-]*$/u.test(number)) throw new VerificationError('invalid_license_number');
  if (!issuingBody) throw new VerificationError('invalid_issuing_body');
  if (!holderName) throw new VerificationError('invalid_holder_name');
  // A diploma or certificate (psychology, nursing: no licence exists) has no end date: it may be left empty; given, it is checked.
  const diploma = (rules.REGULATED[user.niche] || {}).credential === 'diploma';
  const until = /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? new Date(`${validUntil}T23:59:59Z`) : null;
  const latest = Date.now() + 15 * 365 * 86400000;
  if (!(diploma && !validUntil) && (!until || Number.isNaN(until.getTime()) || until.getTime() < Date.now() || until.getTime() > latest)) throw new VerificationError('invalid_valid_until');

  await query(
    `INSERT INTO mentor_credentials (user_id, license_number_enc, license_last4, issuing_body, holder_name, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET license_number_enc = EXCLUDED.license_number_enc, license_last4 = EXCLUDED.license_last4,
       issuing_body = EXCLUDED.issuing_body, holder_name = EXCLUDED.holder_name, valid_until = EXCLUDED.valid_until, updated_at = now()`,
    [user.id, encrypt(number), number.replace(/\s/g, '').slice(-4), issuingBody, holderName, validUntil || null]
  );
  // Never the number itself in evidence: only the last characters, the body and the expiry.
  await steps.setStep(user.id, 'license', 'pending', {
    evidence: { issuingBody, validUntil: validUntil || null, numberEnding: number.replace(/\s/g, '').slice(-4) }, replaceEvidence: true, actor: steps.mentorActor(user)
  });
  await require('./names').recompute(user.id); // the name on the licence is compared with the ID
}

// For admins only: what the mentor entered, with the number decrypted.
async function credentialsFor(userId) {
  const { rows } = await query('SELECT *, valid_until::text AS valid_until_text FROM mentor_credentials WHERE user_id = $1', [userId]);
  const r = rows[0];
  if (!r) return null;
  return { licenseNumber: decrypt(r.license_number_enc), issuingBody: r.issuing_body, holderName: r.holder_name, validUntil: r.valid_until_text, submittedAt: r.submitted_at };
}

// For the mentor: enough to show what they submitted, never the full number.
async function ownCredentials(userId) {
  const { rows } = await query('SELECT license_last4, issuing_body, holder_name, valid_until::text AS valid_until FROM mentor_credentials WHERE user_id = $1', [userId]);
  const r = rows[0];
  return r ? { numberEnding: r.license_last4, issuingBody: r.issuing_body, holderName: r.holder_name, validUntil: r.valid_until } : null;
}

// ---- Work email --------------------------------------------------------------------------------
function domainOf(email) { return String(email).split('@')[1].toLowerCase(); }
const isFreeDomain = (domain) => rules.FREE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));

// Sends a 6-digit code to the work address. Free mailbox providers are refused.
async function startWorkEmail(user, email) {
  requireStep(user, 'work_email');
  const value = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(value) || value.length > 254) throw new VerificationError('invalid_email');
  const domain = domainOf(value);
  if (isFreeDomain(domain)) throw new VerificationError('free_email_domain');

  const code = String(crypto.randomInt(100000, 1000000));
  await query(
    `UPDATE users SET work_email = $2, work_email_verified_at = NULL, work_email_code_hash = $3, work_email_code_expires_at = $4, work_email_code_attempts = 0 WHERE id = $1`,
    [user.id, value, await bcrypt.hash(code, 10), new Date(Date.now() + rules.LIMITS.workEmailCodeMinutes * 60000)]
  );
  await steps.setStep(user.id, 'work_email', 'pending', { evidence: { domain }, replaceEvidence: true, actor: steps.mentorActor(user) });

  let emailSent = false;
  if (config.EMAIL_ENABLED) {
    try { await sendTemplate('workEmailCode', { to: value, lang: user.language, data: { code, domain } }); emailSent = true; }
    catch (e) { console.error('[email] work email code failed:', e.message); }
  }
  return { emailSent, devCode: (!emailSent && !config.IS_PROD) ? code : undefined };
}

async function verifyWorkEmail(user, code) {
  requireStep(user, 'work_email');
  const { rows } = await query('SELECT work_email, work_email_code_hash, work_email_code_expires_at FROM users WHERE id = $1', [user.id]);
  const u = rows[0];
  if (!u || !u.work_email_code_hash) throw new VerificationError('no_pending_code');
  if (new Date(u.work_email_code_expires_at).getTime() < Date.now()) throw new VerificationError('expired');
  // At most 5 tries per code (docs/AUDIT.md #2); then a new code must be asked for.
  const codeAttempts = require('../codeAttempts');
  const used = await codeAttempts.takeTry(user.id, 'work_email');
  if (used === null) throw new VerificationError('too_many_attempts');
  if (!(await bcrypt.compare(String(code || '').trim(), u.work_email_code_hash))) {
    throw new VerificationError((await codeAttempts.wrongCode(user.id, 'work_email', used)) ? 'invalid_code' : 'too_many_attempts');
  }

  await query('UPDATE users SET work_email_verified_at = now(), work_email_code_hash = NULL, work_email_code_expires_at = NULL, work_email_code_attempts = 0 WHERE id = $1', [user.id]);
  // The server decides this step: the mentor proved they can read mail at that company or institution address.
  await steps.setStep(user.id, 'work_email', 'passed', {
    evidence: { domain: domainOf(u.work_email), verifiedAt: new Date().toISOString() }, replaceEvidence: true, actor: steps.SYSTEM
  });
  // It also counts as a piece of evidence for the application (verified automatically; the address itself is not shown).
  await query(
    `INSERT INTO mentor_evidence (user_id, kind, check_status, auto_verified, check_result, checked_at)
     SELECT $1, 'work_email', 'ok', true, $2, now() WHERE NOT EXISTS (SELECT 1 FROM mentor_evidence WHERE user_id = $1 AND kind = 'work_email')`,
    [user.id, JSON.stringify({ domain: domainOf(u.work_email) })]);
}

// ---- Private documents -------------------------------------------------------------------------
const MAX_PER_STEP = 3;
const MAX_TOTAL = 10;

// PDF or JPEG only, judged by the file's own first bytes (the declared type is not trusted).
function detectMime(buf) {
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

function safeFilename(name, mime) {
  const base = String(name || 'document').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
  const ext = mime === 'application/pdf' ? '.pdf' : '.jpg';
  return /\.(pdf|jpe?g)$/i.test(base) ? base : base + ext;
}

// opts.evenIfSent: a diploma after sending, which an admin checks (server/mentorEdit.js).
async function storeDocument(user, step, { filename, buffer }, opts = {}) {
  if (!DOCUMENT_STEPS.includes(step)) throw new VerificationError('unknown_step');
  requireStep(user, step);
  // A diploma is a piece of evidence: it cannot be added while the application is locked for review (except from "My details").
  if (step === 'diploma' && require('./experience').isLocked(user) && !opts.evenIfSent) throw new VerificationError('application_locked');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new VerificationError('empty_file');
  if (buffer.length > rules.LIMITS.maxUploadBytes) throw new VerificationError('file_too_large');
  const mime = detectMime(buffer);
  if (!mime) throw new VerificationError('unsupported_file_type');

  const counts = await query(`SELECT count(*) FILTER (WHERE step = $2)::int AS per_step, count(*)::int AS total FROM verification_documents WHERE user_id = $1`, [user.id, step]);
  if (counts.rows[0].per_step >= MAX_PER_STEP || counts.rows[0].total >= MAX_TOTAL) throw new VerificationError('too_many_files');

  const name = safeFilename(filename, mime);
  const { rows } = await query(
    `INSERT INTO verification_documents (user_id, step, filename, mime, size, data_enc) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [user.id, step, name, mime, buffer.length, encryptBytes(buffer)]
  );
  const total = (await query('SELECT count(*)::int AS n FROM verification_documents WHERE user_id = $1 AND step = $2', [user.id, step])).rows[0].n;
  await steps.setStep(user.id, step, 'pending', { evidence: { files: total }, replaceEvidence: true, actor: steps.mentorActor(user) });
  await steps.audit(user.id, steps.mentorActor(user), 'document_uploaded', { step, reason: `${name} (${buffer.length} bytes)` });
  if (step === 'diploma') {
    await query(`INSERT INTO mentor_evidence (user_id, kind, document_id, check_status) VALUES ($1, 'diploma', $2, 'admin_check')`, [user.id, rows[0].id]);
  }
  return { id: rows[0].id };
}

const docMeta = (r) => ({ id: r.id, step: r.step, filename: r.filename, mime: r.mime, size: r.size, uploadedAt: r.uploaded_at, decidedAt: r.decided_at, deleteAfter: r.delete_after });

async function listDocuments(userId) {
  const { rows } = await query('SELECT id, step, filename, mime, size, uploaded_at, decided_at, delete_after FROM verification_documents WHERE user_id = $1 ORDER BY uploaded_at', [userId]);
  return rows.map(docMeta);
}

// Admin only. Returns { meta, bytes } or null.
async function getDocument(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM verification_documents WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const bytes = decryptBytes(rows[0].data_enc);
  return bytes ? { meta: { ...docMeta(rows[0]), userId: rows[0].user_id }, bytes } : null;
}

// The mentor removes something they uploaded. If that leaves a waiting step with no files, the step is withdrawn.
async function deleteOwnDocument(user, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new VerificationError('not_found');
  const doc = (await query('SELECT step FROM verification_documents WHERE id = $1 AND user_id = $2', [id, user.id])).rows[0];
  if (doc && doc.step === 'diploma' && require('./experience').isLocked(user)) throw new VerificationError('application_locked');
  await query('DELETE FROM mentor_evidence WHERE document_id = $1 AND user_id = $2', [id, user.id]); // (the diploma's evidence item goes with it)
  const { rows } = await query('DELETE FROM verification_documents WHERE id = $1 AND user_id = $2 RETURNING step, filename', [id, user.id]);
  if (!rows[0]) throw new VerificationError('not_found');
  const left = (await query('SELECT count(*)::int AS n FROM verification_documents WHERE user_id = $1 AND step = $2', [user.id, rows[0].step])).rows[0].n;
  await steps.audit(user.id, steps.mentorActor(user), 'document_deleted', { step: rows[0].step, reason: rows[0].filename });
  if (!left) {
    const removed = await query(`DELETE FROM verification_steps WHERE user_id = $1 AND step = $2 AND status = 'pending' RETURNING step`, [user.id, rows[0].step]);
    if (removed.rowCount) await steps.audit(user.id, steps.mentorActor(user), 'step_withdrawn', { step: rows[0].step });
  }
}

// A decision was made on this mentor's documents (for a step, or for the whole application): they are
// kept for the retention period so a decision can be checked, then deleted.
async function scheduleDeletion(userId, step, client) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE verification_documents SET decided_at = COALESCE(decided_at, now()), delete_after = now() + ($3 || ' days')::interval
      WHERE user_id = $1 AND ($2::text IS NULL OR step = $2) AND delete_after IS NULL`,
    [userId, step, String(rules.LIMITS.documentRetentionDays)]
  );
}

// Deletes documents past their retention date. Run by the background job.
async function purgeExpiredDocuments() {
  const { rows } = await query(`DELETE FROM verification_documents WHERE delete_after IS NOT NULL AND delete_after < now() RETURNING user_id, step`);
  const perUser = new Map();
  rows.forEach((r) => perUser.set(r.user_id, (perUser.get(r.user_id) || 0) + 1));
  for (const [userId, n] of perUser) await steps.audit(userId, steps.SYSTEM, 'documents_purged', { reason: `${n} document(s) deleted after ${rules.LIMITS.documentRetentionDays} days` });
  return rows.length;
}

module.exports = {
  DOCUMENT_STEPS, submitLicense, credentialsFor, ownCredentials, startWorkEmail, verifyWorkEmail,
  storeDocument, listDocuments, getDocument, deleteOwnDocument, scheduleDeletion, purgeExpiredDocuments, isFreeDomain
};
