// A mentor changes their details after applying; an admin changes a mentor's price (docs/CLAUDE-CODE-MENTOR-EDIT.md, docs/PLAN-MENTOR-EDIT.md).
//
//   price      0 (free) or PRICE_MIN to PRICE_MAX, by the mentor or an admin (with a reason). Every change is in price_changes. A question keeps the
//              price it was asked at (bookings.amount), so only new questions see a new price.
//   details    specializations, current role, university, country, years: saved at once, even while the application is locked.
//   fields     the main field, extra fields and chips. Before sending: saved as a draft as always. Sent, not decided yet: saved, and the admin sees
//              "updated". Approved: kept as a change for an admin (mentor_changes); the live profile stays as it is until it is approved, and a
//              licensed field is approved only once its licence step has passed.
//   evidence   a new proof link after sending: added unchecked, with a change for an admin.
// The name and birth date from the ID check, and its result, are not changed here: the mentor writes to support.
const { query } = require('./db');
const config = require('./config');
const { getUserById, updateUser } = require('./models');

// (the same errors as the application, so the routes answer them the same way)
const EditError = require('./verification/steps').VerificationError;
const isMentor = (u) => Boolean(u) && (u.role === 'mentor' || u.role === 'both');
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

// ---- The price -------------------------------------------------------------------------------------------------------------------------------
function cleanPrice(value) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n)) return null;
  if (n !== 0 && (n < config.PRICE_MIN || n > config.PRICE_MAX)) return null;
  return n;
}

// Records a change the mentor made through their own forms (PATCH /api/me): nothing else happens.
async function logPrice(userId, from, to, by, source, reason = null) {
  if (from === to) return;
  await query('INSERT INTO price_changes (user_id, old_price, new_price, by_id, by_label, source, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [userId, from === undefined ? null : from, to, by.id || null, by.label || null, source, reason]);
}

// An admin changes the price: a reason is required, it is logged, and the mentor gets an email. -> { user }
async function adminSetPrice({ mentorId, price, reason, admin }) {
  const mentor = isUuid(mentorId) ? await getUserById(mentorId) : null;
  if (!isMentor(mentor)) throw new EditError('not_found');
  const to = cleanPrice(price);
  if (to === null) throw new EditError('invalid_price', { min: config.PRICE_MIN, max: config.PRICE_MAX });
  const why = String(reason || '').trim();
  if (why.length < 5) throw new EditError('reason_required');
  if (to === mentor.price) throw new EditError('same_price');
  const user = await updateUser(mentor.id, { price: to });
  await logPrice(mentor.id, mentor.price, to, { id: admin.id, label: admin.email }, 'admin', why.slice(0, 500));
  await require('./verification/steps').audit(mentor.id, require('./verification/steps').adminActor(admin), 'price_changed', { reason: `${mentor.price} -> ${to}: ${why.slice(0, 300)}` });
  require('./notify').notifyPriceChanged(user, mentor.price, to);
  await require('./waitlist').afterMaybeListed(mentor.id);
  return { user };
}

async function priceHistory(userId) {
  const { rows } = await query('SELECT old_price, new_price, by_label, source, reason, created_at FROM price_changes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
  return rows.map((r) => ({ from: r.old_price, to: r.new_price, by: r.by_label, source: r.source, reason: r.reason, at: r.created_at }));
}
// (for the mentor's own page: who changed it, without the admin's address)
const priceHistoryForMentor = async (userId) => (await priceHistory(userId)).map(({ by, ...rest }) => rest);

// ---- What changed in an application that was sent and not decided yet ("updated", for the admin) ----------------------------------------------------
async function markUpdated(user, fields) {
  const experience = require('./verification/experience');
  if (!experience.submitted(user) || user.verificationStatus === 'verified') return;
  const before = (user.applicationChanges && user.applicationChanges.fields) || [];
  await query('UPDATE users SET application_changes = $2 WHERE id = $1', [user.id, JSON.stringify({ at: new Date(), fields: [...new Set([...before, ...fields])] })]);
}

// ---- The details anybody can change at any time ----------------------------------------------------------------------------------------------------
// (and, docs/CLAUDE-CODE-MENTOR-STORY.md: my path, the starting-point tags, the sample answer, "I can help with" and the work links. The
// mentor's own words about themselves, checked by the contact filter; they can change or remove them at any time.)
const FREE = ['specialtyTags', 'university', 'country', 'currentRole', 'yearsExperience', ...require('./mentorStory').KEYS];
// -> the mentor as saved. Throws an EditError when something was refused; when the rest was saved anyway, the error carries
// refused: [{ field, error }] (every refused part, each with its own reason), saved: the parts that were saved, and user: the mentor now.
async function saveDetails(user, input) {
  const out = await saveDetailsReport(user, input);
  if (!out.refused.length) return out.user;
  const [first] = out.refused;
  throw new EditError(first.error, { field: first.field, refused: out.refused, saved: out.saved, user: out.saved.length ? out.user : null });
}

// My details, part by part (docs/CLAUDE-CODE-STORY-SAVE.md): the specializations, role, university, country and years as before (one
// refusal stops them), and the story form's parts (server/mentorStory.js GROUPS) each on its own, so a refused "I can help with" line
// never takes "My path" and the rest with it. -> { user, refused: [{ field, error }], saved: [keys] }
async function saveDetailsReport(user, input) {
  if (!isMentor(user)) throw new EditError('not_a_mentor');
  const ms = require('./mentorStory');
  const body = Object.fromEntries(FREE.filter((k) => (input || {})[k] !== undefined).map((k) => [k, input[k]]));
  const experience = require('./verification/experience');
  const pick = (keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  const others = pick(FREE.filter((k) => !ms.KEYS.includes(k)));
  const { patch, error, field } = experience.parseExperience(others, { strict: true, current: user });
  if (error) throw new EditError(error, { field });
  const saved = Object.keys(others);
  const refused = [];
  for (const group of ms.GROUPS) {
    const part = pick(group);
    if (!Object.keys(part).length) continue;
    const r = experience.parseExperience(part, { strict: true, current: user });
    if (r.error) { refused.push({ field: r.field, error: r.error }); continue; }
    // "შენ შესახებ" is required here too (150 characters at least) when the section sends it: one that is new or changed, and an empty one.
    // An About the mentor already had and sent back as it was is kept as it is, however short (nothing that was there is ever refused).
    // An approved mentor is never refused for its length (docs/CLAUDE-CODE-CARD-CHECKS.md): the form counts and hints, and the admins' daily
    // check lists a card with a short or missing About; the 150 is for an application that is not approved yet.
    if (part.about !== undefined) {
      const sent = r.patch.bio; // (undefined: the same About as before, which parseExperience leaves out)
      const kept = sent === undefined && ms.ownAbout(user).trim();
      const found = kept ? null : ms.aboutReason(sent === undefined ? ms.ownAbout(user) : sent);
      // (the length, for an approved mentor, is only hinted; one letter or a few words over and over is still refused)
      const reason = found === 'short' && user.verificationStatus === 'verified' ? null : found;
      if (reason) { refused.push({ field: 'about', error: reason === 'repeated' ? 'about_repeated' : 'about_short' }); continue; }
    }
    Object.assign(patch, r.patch);
    saved.push(...Object.keys(part));
  }
  experience.pathToStory(user, patch); // (a complete path is the story, and the About text while that follows it)
  if (!Object.keys(patch).length) return { user, refused, saved };
  const updated = await updateUser(user.id, patch);
  await markUpdated(user, saved);
  return { user: updated, refused, saved };
}

// ---- The field and chips --------------------------------------------------------------------------------------------------------------------------
const FIELD_KEYS = ['fieldId', 'extraFields', 'directions', 'directionOther'];
const snapshot = (u) => ({ fieldId: u.fieldId, extraFields: u.extraFields || [], directions: u.directions || [], directionOther: u.directionOther || null, niche: u.niche, extraNiches: u.extraNiches || [] });

async function openChange(userId, kind = 'fields') {
  const { rows } = await query(`SELECT * FROM mentor_changes WHERE user_id = $1 AND kind = $2 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [userId, kind]);
  return rows[0] || null;
}

// What the mentor's choice would make of their profile: the same rules as saving it (server/verification/experience.js), on a copy. Throws the same
// errors (a regulated extra field for somebody who does not mainly teach, ...).
function previewFields(user, input) {
  const experience = require('./verification/experience');
  const body = Object.fromEntries(FIELD_KEYS.filter((k) => (input || {})[k] !== undefined).map((k) => [k, input[k]]));
  const { patch, error, field } = experience.parseExperience(body);
  if (error) throw new EditError(error, { field });
  experience.applyChoice(user, patch);
  return { ...snapshot(user), ...Object.fromEntries(Object.entries(patch).filter(([k]) => [...FIELD_KEYS, 'niche', 'extraNiches'].includes(k))) };
}

// -> { user, change } (change: when it waits for an admin)
async function saveFields(user, input) {
  if (!isMentor(user)) throw new EditError('not_a_mentor');
  // At least one direction (docs/CLAUDE-CODE-NEW-CATEGORIES.md): asked when the field and directions are saved. A mentor who has none keeps
  // their profile as it is; only this save asks for one.
  const next = (input || {}).directions !== undefined ? input.directions : user.directions;
  // (with a field chosen: a mentor whose work fits no field, "Other", has no directions to choose)
  const field = (input || {}).fieldId !== undefined ? input.fieldId : user.fieldId;
  if (field && (!Array.isArray(next) || new Set(next).size < require('./categories').LIMITS.directionsMin)) throw new EditError('too_few_directions', { field: 'directions' });
  const experience = require('./verification/experience');
  const approved = user.verificationStatus === 'verified';
  if (!approved) {
    // (not sent yet: the draft; sent and not decided: saved, and the admin sees what changed)
    const body = Object.fromEntries(FIELD_KEYS.filter((k) => (input || {})[k] !== undefined).map((k) => [k, input[k]]));
    const updated = await experience.saveExperience(user, body, { evenIfSent: true });
    await markUpdated(user, FIELD_KEYS.filter((k) => (input || {})[k] !== undefined));
    return { user: updated, change: null };
  }
  const proposed = previewFields(user, input);
  const current = snapshot(user);
  if (JSON.stringify(proposed) === JSON.stringify(current)) throw new EditError('nothing_changed');
  await query(`UPDATE mentor_changes SET status = 'replaced', decided_at = now() WHERE user_id = $1 AND kind = 'fields' AND status = 'open'`, [user.id]);
  const { rows: [change] } = await query(`INSERT INTO mentor_changes (user_id, kind, proposed, current) VALUES ($1, 'fields', $2, $3) RETURNING *`,
    [user.id, JSON.stringify(proposed), JSON.stringify(current)]);
  require('./notify').notifyAdmins('A mentor changed their field: waiting for your check',
    `<p>A listed mentor wants to change their field or directions. Their profile stays as it was until you decide (admin panel, Review queue).</p>`);
  return { user, change: changeView(change) };
}

// A new proof link after the application was sent: added unchecked, and the admins see it in the queue.
async function addEvidence(user, input) {
  const experience = require('./verification/experience');
  const item = await experience.addEvidence(user, input, { evenIfSent: true });
  if (experience.isLocked(user)) {
    await query(`INSERT INTO mentor_changes (user_id, kind, evidence_id, proposed) VALUES ($1, 'evidence', $2, $3)`, [user.id, item.id, JSON.stringify({ kind: item.kind, url: item.url })]);
    await markUpdated(user, ['evidence']);
  }
  return item;
}

// A diploma or certificate after sending: stored as at sign-up, and the admins see it in the queue.
async function storeDocument(user, step, file) {
  const experience = require('./verification/experience');
  const credentials = require('./verification/credentials');
  const sent = step === 'diploma' && experience.isLocked(user) && user.verificationStatus !== 'suspended';
  const out = await credentials.storeDocument(await forLicence(user), step, file, { evenIfSent: sent });
  if (sent) {
    const { rows: [e] } = await query('SELECT id FROM mentor_evidence WHERE document_id = $1', [out.id]);
    if (e) await query(`INSERT INTO mentor_changes (user_id, kind, evidence_id, proposed) VALUES ($1, 'evidence', $2, $3)`, [user.id, e.id, JSON.stringify({ kind: 'diploma' })]);
    await markUpdated(user, ['evidence']);
  }
  return out;
}

// The licence of the field a mentor is moving into can be sent before the move is approved: the checks see that field.
async function forLicence(user) {
  const change = isMentor(user) ? await openChange(user.id) : null;
  return change && change.proposed.niche ? { ...user, niche: change.proposed.niche } : user;
}

// ---- The admin --------------------------------------------------------------------------------------------------------------------------------------
const changeView = (c) => ({ id: c.id, kind: c.kind, status: c.status, proposed: c.proposed, current: c.current, evidenceId: c.evidence_id, reason: c.reason, createdAt: c.created_at, decidedAt: c.decided_at });

// What the move still needs: the steps of the new field that have not passed (a licence, its document).
async function missingFor(userId, niche) {
  const rules = require('./verification/rules');
  const steps = require('./verification/steps');
  const mine = await steps.loadSteps(userId);
  return rules.requiredFor(niche).filter((s) => steps.effectiveStatus(mine[s]) !== 'passed');
}

async function queue() {
  const { rows } = await query(
    `SELECT c.*, u.name, u.email, u.verification_status, e.url AS evidence_url, e.kind AS evidence_kind
       FROM mentor_changes c JOIN users u ON u.id = c.user_id LEFT JOIN mentor_evidence e ON e.id = c.evidence_id
      WHERE c.status = 'open' AND (c.kind <> 'evidence' OR e.id IS NOT NULL) ORDER BY c.created_at LIMIT 200`);
  const out = [];
  for (const r of rows) {
    const missing = r.kind === 'fields' && r.proposed.niche ? await missingFor(r.user_id, r.proposed.niche) : [];
    out.push({ ...changeView(r), mentor: { id: r.user_id, name: r.name, email: r.email, status: r.verification_status },
      evidence: r.evidence_id ? { kind: r.evidence_kind, url: r.evidence_url } : null, missing, regulated: r.kind === 'fields' && require('./verification/rules').isRegulated(r.proposed.niche) });
  }
  return out;
}

async function decide({ changeId, approve, reason, admin }) {
  if (!isUuid(changeId)) throw new EditError('not_found');
  const { rows: [c] } = await query(`SELECT * FROM mentor_changes WHERE id = $1 AND status = 'open'`, [changeId]);
  if (!c) throw new EditError('not_found');
  const mentor = await getUserById(c.user_id);
  const steps = require('./verification/steps');
  const actor = steps.adminActor(admin);
  const note = String(reason || '').trim().slice(0, 500) || null;
  if (approve && c.kind === 'fields') {
    // (into a licensed field only with its licence: exactly as at sign-up)
    const missing = c.proposed.niche ? await missingFor(c.user_id, c.proposed.niche) : [];
    if (missing.length) throw new EditError('licence_missing', { missing });
    const p = c.proposed;
    await updateUser(c.user_id, { fieldId: p.fieldId, extraFields: p.extraFields, directions: p.directions, directionOther: p.directionOther, niche: p.niche, extraNiches: p.extraNiches });
    await steps.audit(c.user_id, actor, 'field_change_approved', { reason: `${c.current.niche} -> ${p.niche}${note ? ': ' + note : ''}` });
  }
  const evidenceThere = c.kind === 'evidence' && c.evidence_id && (await query('SELECT 1 FROM mentor_evidence WHERE id = $1', [c.evidence_id])).rows.length;
  if (evidenceThere) {
    await require('./verification/review').decideEvidence({ mentorId: c.user_id, evidenceId: c.evidence_id, decision: approve ? 'ok' : 'failed', reason: note || (approve ? 'Checked' : 'Not accepted'), admin });
  }
  if (!approve) await steps.audit(c.user_id, actor, 'change_rejected', { reason: note || c.kind });
  await query(`UPDATE mentor_changes SET status = $2, decided_by = $3, decided_at = now(), reason = $4 WHERE id = $1`, [c.id, approve ? 'approved' : 'rejected', admin.id, note]);
  require('./notify').notifyChangeDecided(mentor, approve, note);
  return { ok: true };
}

// What the mentor's "my details" page shows: what can be changed at once, what waits for an admin, and what only support can change.
async function detailsFor(user) {
  const [change, kyc, history] = await Promise.all([openChange(user.id), require('./verification/kyc').summaryFor(user.id), priceHistoryForMentor(user.id)]);
  return {
    details: { specialtyTags: user.specialtyTags || [], university: user.university || '', country: user.country || '', currentRole: user.currentWork || '', yearsExperience: user.yearsExperience },
    // (my path and what goes with it: server/mentorStory.js; oldStory: the free-text story shown until the path is filled in)
    story: { ...require('./mentorStory').formOf(user), oldStory: require('./mentorStory').pathComplete(user) ? '' : (user.story || ''), limits: require('./mentorStory').LIMITS, startTags: require('./mentorStory').START_TAGS },
    fields: snapshot(user),
    pendingChange: change ? changeView(change) : null,
    licenceNeeded: change && change.proposed.niche ? await missingFor(user.id, change.proposed.niche) : [],
    identity: kyc && kyc.status === 'approved' ? { name: kyc.verifiedName, dateOfBirth: kyc.dateOfBirth } : null,
    price: user.price, priceHistory: history
  };
}

module.exports = { EditError, cleanPrice, logPrice, adminSetPrice, priceHistory, priceHistoryForMentor, saveDetails, saveDetailsReport, saveFields, addEvidence, storeDocument, forLicence, queue, decide, detailsFor, openChange };
