// ID verification for mentors. The provider (server/kyc/) does the actual document and selfie check;
// this file starts sessions and records the outcome. The outcome is only ever set from
// provider-authenticated data: a signature-verified webhook, or the provider's own API called with
// our secret key. Never from the browser, and never from anything the mentor sends us.
const { query, tx } = require('../db');
const config = require('../config');
const kyc = require('../kyc');
const steps = require('./steps');
const { encrypt, decrypt } = require('../cryptoBox');

// What the mentor is told when the provider declines or the session times out. Kept generic on purpose.
const REASON = {
  declined: 'The ID check was not approved. Please try again with a valid, undamaged ID and good lighting.',
  expired: 'The ID check was not completed in time. Please start it again.'
};

async function latestSession(userId) {
  const { rows } = await query('SELECT * FROM kyc_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  return rows[0] || null;
}

// Sends the mentor to the provider's hosted check, which sends them back to the application (/apply.html, its step 5: the one place where a
// mentor applies, docs/CLAUDE-CODE-ONE-APPLY-PATH.md).
async function startForMentor(user) {
  const provider = kyc.current();
  const mine = await steps.loadSteps(user.id);
  const current = mine.id_kyc;
  // Under 18 on the ID is final for that ID: the check cannot simply be taken again. Only an admin can open it again
  // (adminRerun below), for example when the date was read wrongly.
  if (mine.age && mine.age.status === 'failed') throw new steps.VerificationError('age_final');
  if (current && current.status === 'passed') throw new steps.VerificationError('already_verified');

  const { sessionId, url } = await provider.startVerification({
    userId: user.id,
    callbackUrl: `${config.PUBLIC_URL}/apply.html?step=5&kyc=returned`
  });
  await query('INSERT INTO kyc_sessions (user_id, provider, provider_session_id) VALUES ($1, $2, $3)', [user.id, provider.name, sessionId]);
  await steps.setStep(user.id, 'id_kyc', 'pending', {
    evidence: { provider: provider.name, state: 'started' }, replaceEvidence: true, actor: steps.mentorActor(user)
  });
  return { url };
}

// Records a provider result. Safe to call any number of times with the same result.
// result: { eventId, sessionId, vendorData, status, person }
async function applyResult(providerName, result) {
  const { rows } = await query('SELECT * FROM kyc_sessions WHERE provider = $1 AND provider_session_id = $2', [providerName, result.sessionId]);
  const session = rows[0];
  if (!session) return { known: false };
  // The provider echoes back the id we gave it. If it names someone else, ignore the message.
  if (result.vendorData && result.vendorData !== session.user_id) {
    console.warn(`[kyc] session ${result.sessionId} does not belong to the user the provider named. Ignored.`);
    return { known: false };
  }

  let changed = false;
  let stepChanged = false; // (the id_kyc step itself moved: only then is the mentor emailed about it)
  await tx(async (client) => {
    if (result.eventId) {
      const seen = await client.query('INSERT INTO kyc_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [result.eventId]);
      if (!seen.rowCount) return; // already handled (providers retry deliveries)
    }
    const locked = (await client.query('SELECT * FROM kyc_sessions WHERE id = $1 FOR UPDATE', [session.id])).rows[0];
    const final = ['approved', 'declined'].includes(locked.status);
    // A finished result is not overwritten by "not finished" or "expired" noise that arrives later.
    if (final && ['not_finished', 'expired'].includes(result.status)) return;

    const p = result.person;
    const before = (await client.query(`SELECT status FROM verification_steps WHERE user_id = $1 AND step = 'id_kyc'`, [session.user_id])).rows[0];
    const after = { approved: 'passed', declined: 'failed', in_review: 'pending', expired: 'failed' }[result.status];
    stepChanged = Boolean(after) && (!before || before.status !== after);
    await client.query(
      `UPDATE kyc_sessions SET status = $2, verified_name_enc = COALESCE($3, verified_name_enc), birth_date_enc = COALESCE($4, birth_date_enc),
              country = COALESCE($5, country), decided_at = CASE WHEN $2 IN ('approved', 'declined') THEN now() ELSE decided_at END,
              last_event_id = COALESCE($6, last_event_id), updated_at = now() WHERE id = $1`,
      [session.id, result.status, p && p.fullName ? encrypt(p.fullName) : null, p && p.dateOfBirth ? encrypt(p.dateOfBirth) : null, p && p.country ? String(p.country).slice(0, 3) : null, result.eventId]
    );

    if (result.status === 'approved') {
      require('../analytics').event('id_check_passed', null);
      await steps.setStep(session.user_id, 'id_kyc', 'passed', { evidence: { provider: providerName, state: 'approved', country: p && p.country }, replaceEvidence: true, actor: steps.PROVIDER, client });
    } else if (result.status === 'declined') {
      await steps.setStep(session.user_id, 'id_kyc', 'failed', { evidence: { provider: providerName, state: 'declined' }, replaceEvidence: true, reason: REASON.declined, actor: steps.PROVIDER, client });
    } else if (result.status === 'in_review') {
      await steps.setStep(session.user_id, 'id_kyc', 'pending', { evidence: { provider: providerName, state: 'in_review' }, replaceEvidence: true, actor: steps.PROVIDER, client });
    } else if (result.status === 'expired') {
      await steps.setStep(session.user_id, 'id_kyc', 'failed', { evidence: { provider: providerName, state: 'expired' }, replaceEvidence: true, reason: REASON.expired, actor: steps.PROVIDER, client });
    }
    changed = true;
  });
  return { known: true, changed, stepChanged, userId: session.user_id, status: result.status };
}

// The provider's webhook arrives here (already raw bytes).
async function handleWebhook({ rawBody, headers }) {
  let provider;
  try { provider = kyc.current(); } catch (e) { throw new steps.VerificationError('invalid_webhook', { detail: 'ID checks are not set up on this site' }); } // (before launch there is no provider: nothing here is genuine)
  let result;
  try { result = provider.handleWebhook({ rawBody, headers }); }
  catch (e) { throw new steps.VerificationError('invalid_webhook', { detail: e.message }); }
  const out = await applyResult(provider.name, result);
  if (out.changed && out.status === 'approved') await afterApproved(out.userId);
  else if (out.changed && ['declined', 'expired'].includes(out.status)) require('./analysis').afterIdentityChange(out.userId);
  await tellMentor(out);
  return out;
}

// Asks the provider for the current result of the mentor's latest session (used by an admin, and as
// a safety net if a webhook was lost). Authenticated by our secret key, not by anything from a browser.
async function refresh(userId) {
  const s = await latestSession(userId);
  if (!s) return { known: false };
  const provider = kyc.forProvider(s.provider);
  const result = await provider.getStatus(s.provider_session_id);
  const out = await applyResult(s.provider, { ...result, eventId: null });
  if (out.changed && out.status === 'approved') await afterApproved(userId);
  await tellMentor(out);
  return out;
}

// The mentor is emailed when the ID check ends (approved, declined or expired), never for "in review".
const OUTCOME = { approved: ['passed', null], declined: ['failed', 'kyc_declined'], expired: ['failed', 'kyc_expired'] };
async function tellMentor(out) {
  const o = out.changed && out.stepChanged && OUTCOME[out.status];
  if (o) await require('./updates').stepDecided(out.userId, 'id_kyc', o[0], null, o[1]);
}

// Things that depend on the verified person run here once an ID check is approved: the age step and the name-match step. Then the
// application is looked at again (a finished Experience form is analysed, or the earlier analysis decided again).
async function afterApproved(userId) {
  try { await updateAge(userId); } catch (e) { console.error('[kyc] age check failed:', e.message); }
  try { await require('./names').recompute(userId); } catch (e) { console.error('[kyc] name match failed:', e.message); }
  require('./analysis').afterIdentityChange(userId);
}

// Age in whole years on a given day, from 'YYYY-MM-DD' (null when the date is missing or not a real date).
function ageOn(dateOfBirth, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOfBirth || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d || born > today) return null;
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age -= 1;
  return age;
}

// The age step: 18 or older according to the date of birth on the ID. Only the result is stored (never the date itself). A missing date
// waits for an admin; under 18 fails the step (a person then decides on the application: the computer never rejects one).
// `force` (an admin's re-run) works it out again even when a person decided it before.
async function updateAge(userId, { force = false } = {}) {
  const { rows } = await query(`SELECT birth_date_enc FROM kyc_sessions WHERE user_id = $1 AND status = 'approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [userId]);
  if (!rows[0]) return null;
  const current = (await steps.loadSteps(userId)).age;
  if (current && current.decidedBy && !force) return current.status; // an admin already decided it
  const age = ageOn(decrypt(rows[0].birth_date_enc));
  const min = require('./rules').LIMITS.minAge;
  if (age === null) {
    await steps.setStep(userId, 'age', 'pending', { evidence: { dateOfBirth: 'missing' }, replaceEvidence: true, reason: 'The ID check gave no date of birth: an admin checks it', actor: steps.PROVIDER });
    return 'pending';
  }
  if (age >= min) {
    if (!current || current.status !== 'passed') await steps.setStep(userId, 'age', 'passed', { evidence: { adult: true }, replaceEvidence: true, reason: `${min} or older according to the ID`, actor: steps.PROVIDER });
    return 'passed';
  }
  // (A listed mentor is taken off the site by setStep and emailed the reason in their language.)
  await steps.setStep(userId, 'age', 'failed', { evidence: { adult: false }, replaceEvidence: true, reason: `Under ${min} according to the ID`, reasonKey: 'age_under_min', actor: steps.PROVIDER });
  return 'failed';
}

// Admin only: "re-run the ID check", for when the ID may have been read wrongly. First the provider is asked again for the latest
// result (a reading corrected on the provider's side shows up here) and the age is worked out again from it. If it is still under 18
// (or there is no usable result), the ID check is opened again so the mentor can take it once more; the audit log keeps the old
// result. Returns { outcome: 'age_passed' | 'reopened' | 'unchanged' }.
async function adminRerun(userId, admin, reason) {
  const actor = steps.adminActor(admin);
  try { await refresh(userId); } catch (e) { console.error('[kyc] re-run: provider refresh failed:', e.message); }
  const age = await updateAge(userId, { force: true });
  await steps.audit(userId, actor, 'id_check_rerun', { step: 'id_kyc', reason });
  if (age === 'passed' || age === 'pending') {
    require('./analysis').afterIdentityChange(userId);
    return { outcome: age === 'passed' ? 'age_passed' : 'unchanged' };
  }
  await query(`DELETE FROM verification_steps WHERE user_id = $1 AND step IN ('id_kyc', 'age')`, [userId]);
  await steps.audit(userId, actor, 'id_check_reopened', { step: 'id_kyc', reason });
  require('./analysis').afterIdentityChange(userId);
  return { outcome: 'reopened' };
}

// For admins only: the verified person as the provider reported it.
async function summaryFor(userId) {
  const s = await latestSession(userId);
  if (!s) return null;
  return {
    provider: s.provider, status: s.status, country: s.country, decidedAt: s.decided_at, startedAt: s.created_at,
    verifiedName: decrypt(s.verified_name_enc), dateOfBirth: decrypt(s.birth_date_enc)
  };
}

// The verified name, or null if there is no approved check yet.
async function verifiedNameFor(userId) {
  const { rows } = await query(`SELECT verified_name_enc FROM kyc_sessions WHERE user_id = $1 AND status = 'approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [userId]);
  return rows[0] ? decrypt(rows[0].verified_name_enc) : null;
}

module.exports = { startForMentor, applyResult, handleWebhook, refresh, summaryFor, verifiedNameFor, latestSession, updateAge, adminRerun, ageOn };
