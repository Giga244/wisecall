-- Fixes from security audit run 1 (docs/security-audit/REPORT.md). ADDITIVE ONLY: new columns (one filled from columns that already exist);
-- nothing existing changes and nothing is deleted. Undo: migrations/down/042_security_audit_1.down.sql.

-- C1: when this session last really signed in (a password, Google, or the code of two-step verification at sign-in). A session started
-- again on the same device (a new password, "sign out other devices", two-step verification turned on or off) carries it over; it is never
-- set for those. Sessions from before this have none: a "recent sign-in" check asks them to sign in again.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_at timestamptz;

-- M1: the payout details a withdrawal request is paid to, as they were when it was asked for (the IBAN encrypted like
-- users.payout_iban_enc). Changing the details later never redirects a request that was already made.
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS payout_iban_enc text;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS payout_name text;

-- M4: how much of a payout's debt (debt_amount, or the whole amount) has been taken off withdrawals already, and how much the latest one
-- (debt_settled_batch_id) took, so a rejected or failed withdrawal gives back exactly that. What is still owed: the debt minus the settled part.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS debt_settled_amount integer NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS debt_batch_amount integer;
-- (a debt that was already taken off a withdrawal was taken off in full)
UPDATE payouts SET debt_settled_amount = COALESCE(debt_amount, amount), debt_batch_amount = COALESCE(debt_amount, amount)
 WHERE debt_flagged_at IS NOT NULL AND debt_settled_batch_id IS NOT NULL AND debt_settled_amount = 0;
