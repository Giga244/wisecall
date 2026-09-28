-- PART 3: when a mentor changes saved payout details, their payouts wait PAYOUT_CHANGE_HOLD_HOURS (72 by default), so a stolen account
-- cannot redirect money before the real owner (who gets an email) can react. ADDITIVE ONLY: one new column, NULL for everybody.
-- Undo: migrations/down/029_payout_change_hold.down.sql.
ALTER TABLE users ADD COLUMN payout_hold_until timestamptz;
