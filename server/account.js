// A person's own account: download my data, and delete my account.
//   export    everything Wisecall keeps about the person, as JSON (their own data; other people appear only by the name they chose to
//             show publicly, or not at all).
//   delete    after re-authentication (the password, or a fresh Google sign-in) and only when nothing is still open (a question waiting
//             for an answer, a refund, a report, money not paid out yet). The account is closed at once (signed out everywhere,
//             hidden from Browse experts) and deleted after DELETION_GRACE_DAYS; signing in before then and choosing "keep my
//             account" stops it. Deleting keeps the payment and payout records (the law requires them) with the person's details
//             removed: they point at an anonymous account.
const bcrypt = require('bcryptjs');
const { query, tx } = require('./db');
const config = require('./config');
const auth = require('./auth');
const { getUserById } = require('./models');
const { decrypt } = require('./cryptoBox');

const DELETION_GRACE_DAYS = 14;
const FRESH_LOGIN_MINUTES = 10;

class AccountError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? null : o[k]]));
const rowsOf = async (sql, params) => (await query(sql, params)).rows;

async function exportData(user) {
  const id = user.id;
  const [asked, answered, ratingsGiven, ratingsReceived, messages, notifications, payouts, batches, steps, evidence, sessions, receipts, waitlist, identities, settings,
    publicAnswers, mentorRequests, liveHosted, liveTickets] = await Promise.all([
    rowsOf(`SELECT b.id, b.question, b.answer, b.amount, b.currency, b.status, b.created_at, b.paid_at, b.answered_at, b.refunded_at, b.refund_reason, b.refunded_amount,
                   m.name AS mentor_name FROM bookings b JOIN users m ON m.id = b.mentor_id WHERE b.seeker_id = $1 ORDER BY b.created_at`, [id]),
    rowsOf(`SELECT id, question, answer, amount, platform_fee_amount, mentor_net_amount, currency, status, created_at, paid_at, answered_at, refunded_at, refund_reason
              FROM bookings WHERE mentor_id = $1 AND status NOT IN ('pending_payment', 'expired') ORDER BY created_at`, [id]),
    rowsOf('SELECT booking_id, direction, stars, tags, review, private_note, submitted_at FROM ratings WHERE rater_id = $1 ORDER BY submitted_at', [id]),
    rowsOf('SELECT booking_id, direction, stars, tags, review, submitted_at FROM ratings WHERE ratee_id = $1 AND revealed_at IS NOT NULL AND hidden_at IS NULL ORDER BY submitted_at', [id]),
    rowsOf(`SELECT m.thread_id, t.kind AS thread_kind, m.kind, m.body, m.created_at FROM messages m JOIN threads t ON t.id = m.thread_id
             WHERE m.sender_id = $1 AND m.kind <> 'internal_note' ORDER BY m.created_at`, [id]),
    rowsOf('SELECT kind, data, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at', [id]),
    rowsOf('SELECT booking_id, amount, currency, status, payable_at, refunded_share, debt_amount, debt_flagged_at, created_at FROM payouts WHERE mentor_id = $1 ORDER BY created_at', [id]),
    rowsOf('SELECT amount, currency, status, reference, requested_at, paid_at, reject_reason FROM payout_batches WHERE mentor_id = $1 ORDER BY COALESCE(requested_at, paid_at)', [id]),
    rowsOf('SELECT step, status, reason, decided_at, expires_at FROM verification_steps WHERE user_id = $1 ORDER BY step', [id]),
    rowsOf('SELECT kind, url, registry_id, note, check_status, created_at FROM mentor_evidence WHERE user_id = $1 ORDER BY created_at', [id]),
    rowsOf('SELECT device_label, created_at, last_seen_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at', [id]),
    rowsOf('SELECT r.number, r.kind, r.amount, r.issued_at, r.booking_id FROM receipts r JOIN bookings b ON b.id = r.booking_id WHERE b.seeker_id = $1 ORDER BY r.number', [id]),
    rowsOf('SELECT niche, language, created_at, notified_at FROM waitlist WHERE lower(email) = lower($1)', [user.email]),
    rowsOf('SELECT provider, email, created_at, last_login_at FROM user_identities WHERE user_id = $1', [id]),
    rowsOf('SELECT email_off FROM notification_settings WHERE user_id = $1', [id]),
    // (public answers this person asked or answered, and "find me a mentor" requests sent from the account or its email)
    rowsOf(`SELECT CASE WHEN asker_id = $1 THEN 'asker' ELSE 'mentor' END AS my_role, status, asker_consent, mentor_consent, question_public, answer_public,
                   slug, published_at, withdrawn_at, created_at
              FROM public_answers WHERE asker_id = $1 OR mentor_id = $1 ORDER BY created_at`, [id]),
    rowsOf(`SELECT field_text, niche, need, language, budget_min, budget_max, show_public, status, created_at, expires_at, notified_at
              FROM mentor_requests WHERE user_id = $1 OR lower(email) = lower($2) ORDER BY created_at`, [id, user.email]),
    // (live sessions they host, and their tickets: the other participants never appear)
    rowsOf(`SELECT title, description, learn_points, niche, kind, language, starts_at, duration_min, price, max_seats, status, created_at FROM live_sessions WHERE mentor_id = $1 ORDER BY starts_at`, [id]),
    rowsOf(`SELECT s.title, s.starts_at, t.status, t.price, t.paid_at, t.refunded_at, t.refunded_amount, t.join_anonymous, t.attended_seconds
              FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.buyer_id = $1 AND t.status <> 'expired' ORDER BY t.created_at`, [id])
  ]);
  const iban = decrypt(user.payoutIbanEnc);
  return {
    exportedAt: new Date().toISOString(),
    about: 'Everything Wisecall keeps about your account. Other people appear only by the name they show publicly. ID-check images are never kept; the verified name and date of birth are kept encrypted and are not included here.',
    account: {
      ...pick(user, ['id', 'name', 'email', 'emailVerified', 'username', 'language', 'theme', 'role', 'headline', 'currentWork', 'city', 'languages',
        'linkedinUrl', 'websiteUrl', 'profileVisibility', 'bio', 'createdAt']),
      hasPhoto: Boolean(user.photoUpdatedAt),
      cameFrom: (await query('SELECT signup_source FROM users WHERE id = $1', [id])).rows[0].signup_source || null
    },
    mentorProfile: (user.role === 'mentor' || user.role === 'both') ? pick(user, ['roleTitle', 'niche', 'customNiche', 'price', 'specialtyTags', 'yearsExperience', 'story', 'sampleAnswer', 'verificationStatus', 'applicationSubmittedAt']) : null,
    payoutDetails: user.payoutName || iban ? { name: user.payoutName, ibanEndsWith: iban ? iban.slice(-4) : null } : null,
    questionsAsked: asked, questionsAnswered: answered, ratingsGiven, ratingsReceived, messagesWritten: messages, notifications,
    earnings: payouts, payoutsReceived: batches, verificationSteps: steps, evidence, signedInDevices: sessions, receipts,
    waitingList: waitlist, connectedAccounts: identities, emailSettings: settings[0] || { email_off: [] }, publicAnswers, mentorRequests,
    liveSessionsHosted: liveHosted, liveTickets
  };
}

// What still has to be finished before an account can be deleted (nothing may be left half-way for another person or for money).
async function openItems(userId) {
  const [b, d, p] = await Promise.all([
    query(`SELECT count(*) FILTER (WHERE seeker_id = $1 AND status IN ('paid', 'refund_pending'))::int AS asked,
                  count(*) FILTER (WHERE mentor_id = $1 AND status IN ('paid', 'refund_pending'))::int AS received
             FROM bookings WHERE (seeker_id = $1 OR mentor_id = $1)`, [userId]),
    query(`SELECT count(*)::int AS n FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.status = 'open' AND (b.seeker_id = $1 OR b.mentor_id = $1)`, [userId]),
    require('./ledger').balanceFor(userId)
  ]);
  const out = [];
  if (b.rows[0].asked) out.push('questions_waiting');
  if (b.rows[0].received) out.push('questions_to_answer');
  if (d.rows[0].n) out.push('open_reports');
  // (money in an open withdrawal request is still to be paid out: the payout needs the account's bank details until then)
  const { rows: [open] } = await query("SELECT count(*)::int AS n FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'", [userId]);
  if (p.payable + p.holding > 0 || open.n > 0) out.push('money_to_pay_out');
  if (p.debt > 0) out.push('money_owed');
  // Live sessions: one they host that has not ended, or a ticket for one that has not started (cancel them first: everybody refunded).
  const { rows: [lv] } = await query(
    `SELECT (SELECT count(*)::int FROM live_sessions WHERE mentor_id = $1 AND status IN ('review', 'published', 'live')) AS hosting,
            (SELECT count(*)::int FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id
              WHERE t.buyer_id = $1 AND t.status IN ('paid', 'refund_pending') AND s.status IN ('published', 'live')) AS tickets`, [userId]);
  if (lv.hosting) out.push('live_sessions_hosting');
  if (lv.tickets) out.push('live_tickets');
  return out;
}

// Re-authentication: the current password, or (an account with none, signed in with Google) a sign-in in the last few minutes.
async function checkReauth(user, password, sessionId) {
  if (user.passwordHash) {
    if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) throw new AccountError('wrong_password');
    return;
  }
  const { rows } = await query('SELECT created_at FROM sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [sessionId || null, user.id]).catch(() => ({ rows: [] }));
  if (!rows[0] || Date.now() - new Date(rows[0].created_at).getTime() > FRESH_LOGIN_MINUTES * 60000) throw new AccountError('reauth_required');
}

async function requestDeletion(user, { password, sessionId }) {
  await checkReauth(user, password, sessionId);
  if (user.deletionRequestedAt) throw new AccountError('already_requested');
  const open = await openItems(user.id);
  if (open.length) throw new AccountError('open_items', { items: open });
  await query('UPDATE users SET deletion_requested_at = now() WHERE id = $1', [user.id]);
  await require('./publicAnswers').onAccountDeleted(user.id);
  await require('./mentorRequests').onAccountDeleted(user);
  await auth.endAllSessions(user.id);
  const when = new Date(Date.now() + DELETION_GRACE_DAYS * 86400000);
  require('./notify').notifyDeletionScheduled(user, when);
  return { deletesOn: when };
}

async function cancelDeletion(user) {
  const { rowCount } = await query('UPDATE users SET deletion_requested_at = NULL WHERE id = $1 AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL', [user.id]);
  if (!rowCount) throw new AccountError('nothing_to_cancel');
}

// Removes the person from the account. The row stays (bookings, payouts and receipts point at it) but says nothing about them.
async function anonymize(userId) {
  await tx(async (c) => {
    const u = (await c.query('SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId])).rows[0];
    if (!u) return;
    await c.query(
      `UPDATE users SET name = 'Deleted user', email = $2, password_hash = NULL, email_verified = false, email_code_hash = NULL, email_code_expires_at = NULL,
              reset_token_hash = NULL, reset_token_expires_at = NULL, username = NULL, username_changed_at = NULL, headline = NULL, current_work = NULL,
              city = NULL, languages = '{}', linkedin_url = NULL, website_url = NULL, bio = NULL, photo_updated_at = NULL, profile_visibility = 'contacts',
              role_title = NULL, price = NULL, story = NULL, specialty_tags = '{}', sample_answer = NULL, proof_url = NULL, custom_niche = NULL,
              years_experience = NULL, payout_name = NULL, payout_iban_enc = NULL, payout_iban_last4 = NULL, work_email = NULL, work_email_code_hash = NULL,
              work_email_code_expires_at = NULL, verification_note = NULL, suspension_reason = NULL, deleted_at = now()
        WHERE id = $1`, [userId, `deleted-${userId}@deleted.invalid`]);
    for (const sql of [
      'DELETE FROM user_photos WHERE user_id = $1', 'DELETE FROM user_identities WHERE user_id = $1', 'DELETE FROM username_history WHERE user_id = $1',
      'DELETE FROM verification_documents WHERE user_id = $1', 'DELETE FROM mentor_credentials WHERE user_id = $1', 'DELETE FROM mentor_evidence WHERE user_id = $1',
      'DELETE FROM verification_reviews WHERE user_id = $1', 'DELETE FROM account_signals WHERE user_id = $1', 'DELETE FROM notifications WHERE user_id = $1',
      'DELETE FROM notification_settings WHERE user_id = $1', 'DELETE FROM admin_two_factor WHERE user_id = $1', 'DELETE FROM sessions WHERE user_id = $1',
      `DELETE FROM threads WHERE user_id = $1 AND kind IN ('support', 'system')`,
      'UPDATE kyc_sessions SET verified_name_enc = NULL, birth_date_enc = NULL WHERE user_id = $1',
      'UPDATE ratings SET review = NULL, private_note = NULL WHERE rater_id = $1',
      "UPDATE messages SET body = '' WHERE sender_id = $1 AND kind IN ('text', 'follow_up_question', 'follow_up_reply')",
      "UPDATE verification_audit SET actor_label = 'deleted user' WHERE actor_id = $1"
    ]) await c.query(sql, [userId]);
    await c.query('DELETE FROM waitlist WHERE lower(email) = lower($1)', [u.email]);
  });
}

// Accounts whose grace period is over (run by the regular sweep).
async function deletionSweep() {
  const { rows } = await query(
    `SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL AND deletion_requested_at < now() - make_interval(days => $1) LIMIT 50`,
    [DELETION_GRACE_DAYS]);
  for (const { id } of rows) {
    // (something may have been opened in the meantime, for example a refund: then it waits for the next sweep)
    if ((await openItems(id)).length) continue;
    try { await anonymize(id); } catch (e) { console.error(`[account] could not delete ${id}:`, e.message); }
  }
  return rows.length;
}

module.exports = { DELETION_GRACE_DAYS, AccountError, exportData, openItems, requestDeletion, cancelDeletion, anonymize, deletionSweep };
