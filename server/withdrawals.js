// A mentor's balance and withdrawals, kept on the payout ledger (server/ledger.js): the payout rows are the only record of who owns
// what. All money lands in Wisecall's bank account; a mentor asks for their available money, an admin sends it by bank transfer.
//
//   available  pending payouts that can be paid now (ledger.payableSql: the hold passed, no open dispute, no payout-details hold, and
//              not already in a request)
//   on hold    pending payouts not payable yet (the refund window, an open dispute, a payout-details hold)
//   requested  pending payouts locked into an open request (payouts.batch_id -> a payout_batches row with status 'requested')
//   paid out   the transfers made (payout_batches with status 'paid')
//   owed back  paid payouts whose question was refunded later (a debt): subtracted from the next withdrawal
//
// A request is ONE transaction: the mentor's payout rows are locked (FOR UPDATE), the available ones and any debts are tied to a new
// payout_batches row with status 'requested', and its amount is computed here (never taken from the page). A payout row belongs to at
// most one batch (payouts.batch_id); one open request per mentor (a unique index). An admin marks it paid (with the bank reference) or
// rejects it (with a reason: the rows become available again). A refund of a requested payout takes it out of the request.
const bcrypt = require('bcryptjs');
const { query, tx, afterCommit } = require('./db');
const config = require('./config');
const ledger = require('./ledger');
const { getUserById } = require('./models');
const { decrypt } = require('./cryptoBox');
const { pretty } = require('./iban');
const payoutMethods = require('./payoutMethods');

class WithdrawalError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const minimum = () => Math.round(config.PAYOUT_MIN_GEL * 100); // tetri
const isMentorAccount = (u) => u.role === 'mentor' || u.role === 'both';
// Closing: the account is being deleted, or they stopped being a mentor. Then any amount above zero can be taken out.
const isClosing = (u) => Boolean(u.deletionRequestedAt) || !isMentorAccount(u);

// ---- The balance ---------------------------------------------------------------------------------------------------------------------
async function balanceOf(mentorId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows: [b] } = await run(
    `SELECT COALESCE(sum(p.amount) FILTER (WHERE ${ledger.payableSql('p')}), 0)::int AS available,
            COALESCE(sum(p.amount) FILTER (WHERE ${ledger.holdingSql('p')}), 0)::int AS on_hold,
            COALESCE(sum(p.amount) FILTER (WHERE ${ledger.requestedSql('p')}), 0)::int AS requested,
            COALESCE(sum(${ledger.debtAmountSql('p')}) FILTER (WHERE ${ledger.debtSql('p')}), 0)::int AS owed_back
       FROM payouts p WHERE p.mentor_id = $1`, [mentorId]);
  const { rows: [paid] } = await run(`SELECT COALESCE(sum(amount), 0)::int AS n FROM payout_batches WHERE mentor_id = $1 AND status = 'paid'`, [mentorId]);
  return { available: b.available, onHold: b.on_hold, requested: b.requested, paidOut: paid.n, owedBack: b.owed_back };
}

// When each part of the money on hold becomes available (a date per day), and what holds the rest (a dispute, a payout-details hold).
async function holdsOf(mentorId) {
  const { rows } = await query(
    `SELECT p.amount, GREATEST(p.payable_at, COALESCE(u.payout_hold_until, p.payable_at),
              COALESCE((SELECT ft.follow_up_due_at FROM threads ft WHERE ft.booking_id = p.booking_id AND ft.follow_up_replied_at IS NULL AND ft.follow_up_due_at > now()), p.payable_at)) AS until,
            EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = p.booking_id AND d.status = 'open') AS disputed
       FROM payouts p JOIN users u ON u.id = p.mentor_id WHERE p.mentor_id = $1 AND ${ledger.holdingSql('p')}
      ORDER BY until`, [mentorId]);
  const byDay = new Map();
  let disputed = 0;
  for (const r of rows) {
    if (r.disputed) { disputed += r.amount; continue; }
    // (the day in Tbilisi, as the per-question list shows it: by the UTC day, money free just after midnight showed a day early)
    const day = new Date(r.until).toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
    byDay.set(day, (byDay.get(day) || 0) + r.amount);
  }
  return { until: [...byDay].map(([date, amount]) => ({ date, amount })), disputed };
}

const batchView = (r) => ({
  id: r.id, amount: r.amount, status: r.status, method: r.method, requestedAt: r.requested_at, paidAt: r.paid_at, reference: r.reference,
  rejectedAt: r.rejected_at || r.failed_at || null, reason: r.reject_reason || r.failure_reason || null, debtDeducted: r.debt_deducted, ibanLast4: r.iban_last4,
  sendStartedAt: r.send_started_at || null
});

async function historyOf(mentorId) {
  const { rows } = await query(
    `SELECT * FROM payout_batches WHERE mentor_id = $1 ORDER BY COALESCE(requested_at, paid_at) DESC LIMIT 100`, [mentorId]);
  return rows.map(batchView);
}

// What stands between the mentor and a withdrawal right now (codes the page explains), besides the password.
async function blockersFor(user, balance) {
  const out = [];
  if (user.verificationStatus === 'suspended') out.push('suspended');
  if (!user.payoutIbanEnc) out.push('no_payout_details');
  const { rows } = await query(`SELECT kind FROM mentor_flags WHERE mentor_id = $1 AND status = 'open'`, [user.id]);
  if (rows.some((r) => r.kind === 'payout_name_mismatch' || r.kind === 'name_mismatch')) out.push('name_mismatch');
  else if (rows.length) out.push('open_flags');
  const { rows: open } = await query(`SELECT 1 FROM payout_batches WHERE mentor_id = $1 AND status IN ('requested', 'sending')`, [user.id]);
  if (open.length) out.push('request_open');
  if (balance.available <= 0) out.push('nothing_available');
  else if (!isClosing(user) && balance.available < minimum()) out.push('below_minimum');
  else if (balance.available - balance.owedBack <= 0) out.push('debt_exceeds_available');
  return out;
}

// Everything the mentor's Balance card shows.
async function summary(user) {
  const balance = await balanceOf(user.id);
  const [holds, history, blockers] = await Promise.all([holdsOf(user.id), historyOf(user.id), blockersFor(user, balance)]);
  return {
    currency: config.CURRENCY, minimum: minimum(), closing: isClosing(user), holdDays: ledger.holdDays(),
    balance, holds, history, blockers, canWithdraw: blockers.length === 0,
    withdrawAmount: Math.max(balance.available - balance.owedBack, 0),
    needsPassword: Boolean(user.passwordHash), reauthMinutes: config.REAUTH_MINUTES
  };
}

// ---- Asking for the money ------------------------------------------------------------------------------------------------------------
async function checkIdentity(user, { password, sessionId }) {
  if (user.passwordHash) {
    if (typeof password !== 'string' || !password) throw new WithdrawalError('password_required');
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new WithdrawalError('wrong_password');
    return;
  }
  // (a real sign-in on this device in the last few minutes, server/auth.js: a new session for a new password or "sign out other devices"
  // does not count)
  if (!(await require('./auth').signedInRecently(user.id, sessionId, config.REAUTH_MINUTES))) {
    throw new WithdrawalError('reauth_required', { minutes: config.REAUTH_MINUTES });
  }
}

// -> { request, existing } (existing: the open request that was already there; asking twice changes nothing).
async function request({ mentorId, password, sessionId }) {
  const user = await getUserById(mentorId);
  if (!user) throw new WithdrawalError('not_found');
  await checkIdentity(user, { password, sessionId });
  const pre = await blockersFor(user, await balanceOf(user.id));
  const hard = pre.filter((b) => ['suspended', 'no_payout_details', 'name_mismatch', 'open_flags'].includes(b));
  if (hard.length) throw new WithdrawalError(hard[0]);

  let result;
  try {
    result = await tx(async (client) => {
      // Every payout row of this mentor is locked: a second request, an admin's payment or a refund waits for this one.
      await client.query('SELECT id FROM payouts WHERE mentor_id = $1 FOR UPDATE', [user.id]);
      const { rows: open } = await client.query(`SELECT * FROM payout_batches WHERE mentor_id = $1 AND status IN ('requested', 'sending') FOR UPDATE`, [user.id]);
      if (open[0]) return { request: batchView(open[0]), existing: true };
      const { rows: avail } = await client.query(`SELECT id, amount FROM payouts p WHERE p.mentor_id = $1 AND ${ledger.payableSql('p')}`, [user.id]);
      const { rows: debts } = await client.query(`SELECT id, ${ledger.owedSql('p')} AS owed FROM payouts p WHERE p.mentor_id = $1 AND ${ledger.debtSql('p')}`, [user.id]);
      const available = avail.reduce((s, r) => s + r.amount, 0);
      const debt = debts.reduce((s, r) => s + r.owed, 0);
      if (available <= 0) throw new WithdrawalError('nothing_available');
      if (!isClosing(user) && available < minimum()) throw new WithdrawalError('below_minimum', { minimum: minimum() });
      const amount = available - debt;
      if (amount <= 0) throw new WithdrawalError('debt_exceeds_available');
      const method = payoutMethods.current();
      // (the request is paid to the details saved now, and only to them: changing them later never redirects it, docs/security-audit M1)
      const { rows: [batch] } = await client.query(
        `INSERT INTO payout_batches (mentor_id, amount, currency, reference, iban_last4, paid_at, status, requested_at, method, debt_deducted, payout_iban_enc, payout_name)
         VALUES ($1, $2, $3, NULL, $4, NULL, 'requested', now(), $5, $6, $7, $8) RETURNING *`,
        [user.id, amount, config.CURRENCY, user.payoutIbanLast4 || null, method.name, debt, user.payoutIbanEnc, user.payoutName || null]);
      await client.query('UPDATE payouts SET batch_id = $2 WHERE id = ANY($1::uuid[])', [avail.map((r) => r.id), batch.id]);
      // (each debt's part taken off this request is remembered, so a rejected or failed request gives back exactly that)
      for (const d of debts) {
        await client.query(`UPDATE payouts SET debt_settled_amount = debt_settled_amount + $2, debt_batch_amount = $2, debt_settled_batch_id = $3 WHERE id = $1`, [d.id, d.owed, batch.id]);
      }
      await audit(client, user.id, { id: user.id, label: user.email }, 'withdrawal_requested', `${money(amount)}${debt ? ` (${money(debt)} owed back deducted)` : ''}`);
      afterCommit(client, async () => {
        const notify = require('./notify');
        notify.notifyWithdrawal(user, 'requested', batch);
        notify.notifyAdmins('New withdrawal request', `<p>${escapeHtml(user.name)} asked for ${money(amount)}. Open Payouts in the admin panel.</p>`);
        await method.onRequested(batch).catch((e) => console.error('[withdrawals] payout method:', e.message));
      });
      return { request: batchView(batch), existing: false };
    });
  } catch (e) {
    // (the unique index on open requests: a request that raced this one won; return it)
    if (e && e.code === '23505') {
      const { rows } = await query(`SELECT * FROM payout_batches WHERE mentor_id = $1 AND status IN ('requested', 'sending')`, [user.id]);
      if (rows[0]) return { request: batchView(rows[0]), existing: true };
    }
    throw e;
  }
  return result;
}

// ---- The admin's side ------------------------------------------------------------------------------------------------------------------
async function lockOpen(client, batchId) {
  const { rows } = await client.query('SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE', [batchId]);
  if (!rows[0]) throw new WithdrawalError('not_found');
  if (rows[0].status !== 'requested') throw new WithdrawalError('not_open');
  return rows[0];
}

// The mentor's payout details changed in the last PAYOUT_CHANGE_HOLD_HOURS: nothing is paid or sent to them until that hold ends.
async function refuseIfHeld(client, mentorId) {
  const { rows: [u] } = await client.query('SELECT payout_hold_until > now() AS held FROM users WHERE id = $1', [mentorId]);
  if (u && u.held) throw new WithdrawalError('payout_hold');
}

// Where a request is paid: the details saved with it when it was asked for. (A request from before they were saved with it: the account's
// details, but only when they have not changed since it was asked for.)
async function destinationOf(b) {
  if (b.payout_iban_enc) return { iban: decrypt(b.payout_iban_enc), name: b.payout_name || null };
  const mentor = await getUserById(b.mentor_id);
  if (!mentor || !mentor.payoutIbanEnc || (mentor.payoutUpdatedAt && b.requested_at && new Date(mentor.payoutUpdatedAt) > new Date(b.requested_at))) return { iban: null, name: null };
  return { iban: decrypt(mentor.payoutIbanEnc), name: mentor.payoutName || null };
}

// A request that is not paid (rejected, or failed at the bank): the debts it took off are owed again, exactly the part it took.
const giveBackDebts = (client, batchId) => client.query(
  `UPDATE payouts SET debt_settled_amount = GREATEST(debt_settled_amount - COALESCE(debt_batch_amount, 0), 0), debt_batch_amount = NULL, debt_settled_batch_id = NULL
    WHERE debt_settled_batch_id = $1`, [batchId]);

// The transfer was made. `amount` is what the admin saw (and sent): if the request changed since (a refund), nothing is recorded.
async function markPaid({ batchId, reference, amount, admin }) {
  const ref = String(reference || '').trim();
  if (ref.length < 2 || ref.length > 100) throw new WithdrawalError('reference_required');
  return tx(async (client) => {
    const b = await lockOpen(client, batchId);
    await refuseIfHeld(client, b.mentor_id);
    if (amount !== undefined && Number(amount) !== b.amount) throw new WithdrawalError('amount_changed', { amount: b.amount });
    const { rows: [paid] } = await client.query(
      `UPDATE payout_batches SET status = 'paid', paid_at = now(), reference = $2, paid_by = $3 WHERE id = $1 RETURNING *`, [b.id, ref, admin.id]);
    await client.query(`UPDATE payouts SET status = 'paid' WHERE batch_id = $1 AND status = 'pending'`, [b.id]);
    await audit(client, b.mentor_id, { id: admin.id, label: admin.email }, 'withdrawal_paid', `${money(b.amount)}, reference ${ref}`);
    afterCommit(client, async () => {
      const mentor = await getUserById(b.mentor_id);
      if (mentor) require('./notify').notifyPayoutPaid(mentor, paid);
    });
    return batchView(paid);
  });
}

// Not sent: the payouts become available again and any debt is owed again. `system`: a refund left nothing to pay.
async function reject({ batchId, reason, admin, client: outer }) {
  const why = String(reason || '').trim();
  if (why.length < 5 || why.length > 500) throw new WithdrawalError('reason_required');
  const work = async (client) => {
    const b = await lockOpen(client, batchId);
    const { rows: [done] } = await client.query(
      `UPDATE payout_batches SET status = 'rejected', rejected_at = now(), rejected_by = $2, reject_reason = $3 WHERE id = $1 RETURNING *`,
      [b.id, admin ? admin.id : null, why]);
    await client.query(`UPDATE payouts SET batch_id = NULL WHERE batch_id = $1 AND status = 'pending'`, [b.id]);
    await giveBackDebts(client, b.id);
    await audit(client, b.mentor_id, admin ? { id: admin.id, label: admin.email } : { id: null, label: 'system' }, 'withdrawal_rejected', `${money(b.amount)}: ${why}`);
    afterCommit(client, async () => {
      const mentor = await getUserById(b.mentor_id);
      if (mentor) require('./notify').notifyWithdrawal(mentor, 'rejected', done);
    });
    return batchView(done);
  };
  return outer ? work(outer) : tx(work);
}

// The mentor changed their payout details: a request not sent yet is closed (its money is available again once the hold ends) and the
// mentor is told why, in their language (docs/security-audit M1). A request being sent is already at the bank, with the details it was
// asked with.
const DETAILS_CHANGED = {
  en: 'Your payout details changed after you asked for this withdrawal, so it was not sent. Ask again once the hold ends.',
  ka: 'ანაზღაურების მონაცემები ამ მოთხოვნის შემდეგ შეიცვალა, ამიტომ თანხა არ გადაირიცხა. მოითხოვე თავიდან, როცა შეჩერება დასრულდება.'
};
async function rejectOpenRequest(mentor) {
  const { rows: [open] } = await query(`SELECT id FROM payout_batches WHERE mentor_id = $1 AND status = 'requested'`, [mentor.id]);
  if (!open) return null;
  try {
    return await reject({ batchId: open.id, reason: DETAILS_CHANGED[mentor.language === 'ka' ? 'ka' : 'en'], admin: null });
  } catch (e) {
    if (e instanceof WithdrawalError && e.code === 'not_open') return null; // (an admin decided it a moment ago)
    throw e;
  }
}

// ---- Sending a payout through the bank (PAYOUT_METHOD=flitt_iban) ---------------------------------------------------------------------
// An admin presses "Send payout" and types a current code from their authenticator app (every payout, docs/BANK-GOLIVE.md). Only an open
// request; only to the mentor's saved IBAN, and only when its holder's name matches the name on their verified ID; never past
// PAYOUT_DAILY_LIMIT_GEL in a day (Tbilisi time). The request becomes 'sending' with its own bank order id (payout-<request id>): sending it
// again can never pay twice. It becomes 'paid' once the bank's status says so (after its callback, or the sweep's check), or 'failed' with
// the bank's reason, and then the money is available to the mentor again.
async function sendPayout({ batchId, admin, code }) {
  const method = payoutMethods.current();
  if (!method.automatic) throw new WithdrawalError('manual_method');
  try {
    await require('./twoFactor').verifyLogin(admin, { code: String(code || '') });
  } catch (e) {
    if (e && e.code === 'locked') throw new WithdrawalError('code_locked');
    if (e && e.code === 'not_enabled') throw new WithdrawalError('two_factor_required');
    throw new WithdrawalError('invalid_code');
  }
  let batch = null;
  let mentor = null;
  let iban = null;
  let name = null;
  await tx(async (client) => {
    const b = await lockOpen(client, batchId);
    mentor = await getUserById(b.mentor_id);
    if (!mentor) throw new WithdrawalError('not_found');
    const hard = (await blockersFor(mentor, await balanceOf(mentor.id, client))).filter((x) => ['suspended', 'no_payout_details', 'name_mismatch', 'open_flags'].includes(x));
    if (hard.length) throw new WithdrawalError(hard[0]);
    await refuseIfHeld(client, mentor.id);
    // (to the details saved with the request, never to ones changed after it was asked for)
    ({ iban, name } = await destinationOf(b));
    if (!iban || !name) throw new WithdrawalError('no_payout_details');
    // (the account holder must be the person on the verified ID)
    const idName = await require('./verification/kyc').verifiedNameFor(mentor.id);
    if (!idName || !require('./verification/names').compareNames(idName, name).match) throw new WithdrawalError('name_mismatch');
    const { rows: [today] } = await client.query(
      `SELECT COALESCE(sum(amount), 0)::bigint AS n FROM payout_batches
        WHERE method = $1 AND status IN ('sending', 'paid') AND send_started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tbilisi') AT TIME ZONE 'Asia/Tbilisi')`, [method.name]);
    const limit = config.PAYOUT_DAILY_LIMIT_GEL * 100;
    if (Number(today.n) + b.amount > limit) throw new WithdrawalError('daily_limit', { left: Math.max(0, limit - Number(today.n)) });
    ({ rows: [batch] } = await client.query(
      `UPDATE payout_batches SET status = 'sending', send_started_at = now(), sent_by = $2, method = $3, provider_order_id = COALESCE(provider_order_id, $4)
        WHERE id = $1 RETURNING *`, [b.id, admin.id, method.name, `payout-${b.id}`]));
    await audit(client, b.mentor_id, { id: admin.id, label: admin.email }, 'withdrawal_sending', `${money(b.amount)} to the IBAN ending ${iban.slice(-4)}`);
  });
  try {
    await method.send(batch, { iban, name });
  } catch (e) {
    // (no answer, or a refusal: the bank's status decides; the same order id means it can never be paid twice)
    console.error(`[withdrawals] sending payout ${batch.id} failed or its answer was lost:`, e.message);
    if (e.status === 422) return finishFailed(batch.id, String(e.message).slice(0, 300));
  }
  return syncPayout(batch.id);
}

// Asks the bank what happened to a payout being sent, and records it. Safe to call any number of times (the callback, the sweep, the
// admin's "Check" button). An order the bank never received (no answer reached it) is sent again after 5 minutes, with the same id.
async function syncPayout(batchId) {
  const { rows: [b] } = await query('SELECT * FROM payout_batches WHERE id = $1', [batchId]);
  if (!b) throw new WithdrawalError('not_found');
  if (b.status !== 'sending') return batchView(b);
  const method = payoutMethods.byName(b.method);
  let s;
  try {
    s = await method.status(b);
  } catch (e) {
    const unknownOrder = e.status === 422 && /not found|1018/i.test(`${e.message}`);
    if (unknownOrder && Date.now() - new Date(b.send_started_at).getTime() > 5 * 60000) {
      const to = await destinationOf(b); // (the same details as the first time)
      if (to.iban && to.name) await method.send(b, to).catch((err) => console.error('[withdrawals] sending again failed:', err.message));
    }
    return batchView(b);
  }
  if (s.status === 'paid') return finishPaid(b.id, s.reference);
  if (s.status === 'failed') return finishFailed(b.id, s.reason || s.raw || 'declined by the bank');
  return batchView(b);
}

async function finishPaid(batchId, reference) {
  return tx(async (client) => {
    const { rows: [b] } = await client.query('SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE', [batchId]);
    if (!b || b.status !== 'sending') return b && batchView(b);
    const { rows: [paid] } = await client.query(
      `UPDATE payout_batches SET status = 'paid', paid_at = now(), reference = $2, paid_by = sent_by WHERE id = $1 RETURNING *`, [b.id, `flitt:${reference || b.provider_order_id}`]);
    await client.query(`UPDATE payouts SET status = 'paid' WHERE batch_id = $1 AND status = 'pending'`, [b.id]);
    await audit(client, b.mentor_id, { id: null, label: 'bank' }, 'withdrawal_paid', `${money(b.amount)}, bank reference ${paid.reference}`);
    afterCommit(client, async () => {
      const mentor = await getUserById(b.mentor_id);
      if (mentor) require('./notify').notifyPayoutPaid(mentor, paid);
    });
    return batchView(paid);
  });
}

async function finishFailed(batchId, reason) {
  return tx(async (client) => {
    const { rows: [b] } = await client.query('SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE', [batchId]);
    if (!b || b.status !== 'sending') return b && batchView(b);
    const why = String(reason || 'declined by the bank').slice(0, 300);
    const { rows: [done] } = await client.query(
      `UPDATE payout_batches SET status = 'failed', failed_at = now(), failure_reason = $2 WHERE id = $1 RETURNING *`, [b.id, why]);
    // (a refund that came while it was being sent was recorded as a debt, server/ledger.js: the money did not leave, so it comes off the
    // payout itself; then the money is available again, and any debt is owed again)
    await client.query(
      `UPDATE payouts SET status = CASE WHEN COALESCE(debt_amount, amount) >= amount THEN 'void' ELSE status END,
              amount = CASE WHEN COALESCE(debt_amount, amount) >= amount THEN amount ELSE amount - debt_amount END,
              debt_flagged_at = NULL, debt_amount = NULL
        WHERE batch_id = $1 AND status = 'pending' AND debt_flagged_at IS NOT NULL`, [b.id]);
    await client.query(`UPDATE payouts SET batch_id = NULL WHERE batch_id = $1 AND status = 'pending'`, [b.id]);
    await giveBackDebts(client, b.id);
    await audit(client, b.mentor_id, { id: null, label: 'bank' }, 'withdrawal_failed', `${money(b.amount)}: ${why}`);
    afterCommit(client, async () => {
      const mentor = await getUserById(b.mentor_id);
      const notify = require('./notify');
      if (mentor) notify.notifyWithdrawal(mentor, 'rejected', { ...done, reject_reason: why });
      notify.notifyAdmins('A payout failed', `<p>The bank did not send ${money(b.amount)} (request ${b.id}): ${escapeHtml(why)}. The money is available to the mentor again.</p>`);
    });
    return batchView(done);
  });
}

// The sweep: payouts still being sent (a callback that never came).
async function syncSending() {
  const { rows } = await query(`SELECT id FROM payout_batches WHERE status = 'sending' AND send_started_at < now() - interval '1 minute' ORDER BY send_started_at LIMIT 20`);
  for (const { id } of rows) await syncPayout(id).catch((e) => console.error(`[withdrawals] checking payout ${id} failed:`, e.message));
  return rows.length;
}

// Called by the ledger (inside a refund's transaction) when a payout in a request was voided or reduced: the request's amount is
// computed again; when nothing is left to pay, the request is closed (with `reason`) and the mentor told.
async function recompute(client, batchId, reason = 'A refund left nothing to pay in this request.') {
  const { rows: [b] } = await client.query('SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE', [batchId]);
  if (!b || b.status !== 'requested') return;
  await client.query(`UPDATE payouts SET batch_id = NULL WHERE batch_id = $1 AND status = 'void'`, [batchId]);
  const { rows: [s] } = await client.query(
    `SELECT COALESCE(sum(amount) FILTER (WHERE batch_id = $1 AND status = 'pending'), 0)::int AS gross,
            COALESCE(sum(debt_batch_amount) FILTER (WHERE debt_settled_batch_id = $1), 0)::int AS debt
       FROM payouts WHERE batch_id = $1 OR debt_settled_batch_id = $1`, [batchId]);
  const amount = s.gross - s.debt;
  if (amount <= 0) {
    await reject({ batchId, reason, admin: null, client });
    return;
  }
  await client.query('UPDATE payout_batches SET amount = $2, debt_deducted = $3 WHERE id = $1', [batchId, amount, s.debt]);
}

// A payout that has to wait again (a follow-up question its mentor must reply to first, server/inbox.js) leaves a request that was not
// sent yet: the request's amount is computed again, or it is closed with `reason` when nothing is left. A request being sent, or paid, is
// not touched (the money is on its way). Inside the caller's transaction.
async function takeOutOfRequest(client, bookingId, reason) {
  const { rows: [p] } = await client.query(`SELECT id, batch_id FROM payouts WHERE booking_id = $1 AND status = 'pending' AND batch_id IS NOT NULL FOR UPDATE`, [bookingId]);
  if (!p) return false;
  const { rows: [b] } = await client.query('SELECT status FROM payout_batches WHERE id = $1 FOR UPDATE', [p.batch_id]);
  if (!b || b.status !== 'requested') return false;
  await client.query('UPDATE payouts SET batch_id = NULL WHERE id = $1', [p.id]);
  await recompute(client, p.batch_id, reason);
  return true;
}

// The open requests, with what the transfer needs: the account holder, the verified name, the FULL IBAN (decrypted only here; each
// view is written to the mentor's audit log). The holder and IBAN are the ones saved with the request (destinationOf).
async function queue(admin) {
  const { rows } = await query(
    `SELECT pb.*, u.name, u.email FROM payout_batches pb JOIN users u ON u.id = pb.mentor_id
      WHERE pb.status IN ('requested', 'sending') ORDER BY pb.requested_at`);
  const kyc = require('./verification/kyc');
  const out = [];
  for (const r of rows) {
    const { iban, name: payoutName } = await destinationOf(r);
    out.push({ ...batchView(r), mentorId: r.mentor_id, name: r.name, email: r.email, payoutName, verifiedName: await kyc.verifiedNameFor(r.mentor_id),
      iban: iban ? pretty(iban) : null, exportedAt: r.exported_at, exportedAmount: r.exported_amount });
    await audit(null, r.mentor_id, { id: admin.id, label: admin.email }, 'iban_viewed', 'withdrawals queue');
  }
  return out;
}

async function recent() {
  const { rows } = await query(
    `SELECT pb.*, u.name FROM payout_batches pb JOIN users u ON u.id = pb.mentor_id WHERE pb.status NOT IN ('requested', 'sending')
      ORDER BY COALESCE(pb.paid_at, pb.rejected_at, pb.failed_at) DESC NULLS LAST LIMIT 100`);
  return rows.map((r) => ({ ...batchView(r), name: r.name }));
}

// The money in Wisecall's account: received, Wisecall's part (gross), an estimate of bank fees, and the mentors' money held there.
async function overview() {
  const { rows: [m] } = await query(
    `SELECT COALESCE(sum(amount - COALESCE(refunded_amount, 0)) FILTER (WHERE status IN ('paid', 'answered')), 0)::bigint AS received,
            COALESCE(sum(platform_fee_amount - round(COALESCE(refunded_amount, 0)::numeric * platform_fee_amount / NULLIF(amount, 0))) FILTER (WHERE status = 'answered' AND amount > 0), 0)::bigint AS fee
       FROM bookings`);
  const { rows: [h] } = await query(`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::bigint AS held FROM payouts`);
  const received = Number(m.received);
  return {
    received, revenue: Number(m.fee), feePercent: config.PLATFORM_FEE_PERCENT,
    bankFeesEstimate: Math.round((received * config.BANK_FEE_PERCENT) / 100), bankFeePercent: config.BANK_FEE_PERCENT,
    mentorMoneyHeld: Number(h.held)
  };
}

// A CSV of the open requests for one bulk transfer in the bank's portal. Each exported request remembers the amount exported, so
// "mark all exported as paid" never records a request whose amount changed after the export.
const csvCell = (v) => { const s = String(v === null || v === undefined ? '' : v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
async function exportCsv(admin) {
  const list = await queue(admin);
  await query(`UPDATE payout_batches SET exported_at = now(), exported_amount = amount WHERE status = 'requested'`);
  const lines = [['request', 'beneficiary', 'iban', 'amount', 'currency', 'purpose', 'verified_name', 'email']]
    .concat(list.map((r) => [r.id, r.payoutName, (r.iban || '').replace(/\s/g, ''), (r.amount / 100).toFixed(2), 'GEL', `Wisecall payout ${r.id.slice(0, 8)}`, r.verifiedName || '', r.email]));
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Every exported request whose amount did not change is marked paid with one reference; the others are listed for a look.
async function markExportedPaid({ reference, admin }) {
  const { rows } = await query(`SELECT id, amount, exported_amount FROM payout_batches WHERE status = 'requested' AND exported_at IS NOT NULL ORDER BY requested_at`);
  const paid = [];
  const changed = [];
  for (const r of rows) {
    if (r.amount !== r.exported_amount) { changed.push(r.id); continue; }
    try { paid.push(await markPaid({ batchId: r.id, reference, amount: r.exported_amount, admin })); }
    catch (e) { if (e instanceof WithdrawalError) changed.push(r.id); else throw e; }
  }
  return { paid: paid.length, changed };
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
const money = (tetri) => `${(tetri / 100).toFixed(2)} GEL`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function audit(client, mentorId, actor, action, reason) {
  const run = client ? client.query.bind(client) : query;
  await run(`INSERT INTO verification_audit (mentor_id, actor_id, actor_label, action, reason) VALUES ($1, $2, $3, $4, $5)`,
    [mentorId, actor.id || null, actor.label, action, reason]);
}

module.exports = { WithdrawalError, balanceOf, summary, request, markPaid, reject, rejectOpenRequest, recompute, takeOutOfRequest, queue, recent, overview, exportCsv, markExportedPaid, minimum,
  sendPayout, syncPayout, syncSending };
