// "Add your bank account to withdraw": a bank account is never needed to be shown on the site, so a mentor can have money on their
// balance (available, or still on hold) and nowhere for it to go. Such a mentor sees a card on the dashboard (wantsCard, from the
// Balance summary) and gets one email, at most once in REMIND_EVERY_DAYS days, until they add the account (Settings → ანაზღაურება, or
// right at the withdrawal). Never to a suspended or deleted account. The row is claimed by the UPDATE, so two instances never send twice.
const { query } = require('./db');
const { getUserById } = require('./models');
const config = require('./config');

const REMIND_EVERY_DAYS = 7;
// Money earned and not paid out or asked for yet: payable now, or still inside its hold.
const EARNED_SQL = `p.status = 'pending' AND p.batch_id IS NULL`;

// The dashboard card: money on the balance, no bank account.
const wantsCard = (user, balance) => !user.payoutIbanEnc && (balance.available + balance.onHold) > 0;

async function sweep() {
  const { rows } = await query(
    `UPDATE users SET payout_reminder_sent_at = now()
      WHERE id IN (
        SELECT u.id FROM users u
         WHERE u.role IN ('mentor', 'both') AND u.payout_iban_enc IS NULL AND u.deleted_at IS NULL AND u.deletion_requested_at IS NULL
           AND u.email IS NOT NULL AND COALESCE(u.verification_status, 'none') <> 'suspended'
           AND (u.payout_reminder_sent_at IS NULL OR u.payout_reminder_sent_at < now() - make_interval(days => $1))
           AND (SELECT COALESCE(sum(p.amount), 0) FROM payouts p WHERE p.mentor_id = u.id AND ${EARNED_SQL}) > 0
         LIMIT 50)
      RETURNING id`, [REMIND_EVERY_DAYS]);
  let sent = 0;
  for (const { id } of rows) {
    const user = await getUserById(id);
    if (!user) continue;
    const { rows: [b] } = await query(`SELECT COALESCE(sum(p.amount), 0)::int AS n FROM payouts p WHERE p.mentor_id = $1 AND ${EARNED_SQL}`, [id]);
    await require('./notify').notifyAddBank(user, { amount: b.n, currency: config.CURRENCY });
    sent += 1;
  }
  return sent;
}

module.exports = { sweep, wantsCard, REMIND_EVERY_DAYS };
