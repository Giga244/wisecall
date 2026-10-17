-- Undoes migrations/042_security_audit_1.sql (run by hand, then delete its row from schema_migrations). Only the new columns go: the older
-- code reads sign-ins from sessions.created_at, pays requests to the account's current details and reads debts from debt_settled_batch_id.
ALTER TABLE payouts DROP COLUMN IF EXISTS debt_batch_amount;
ALTER TABLE payouts DROP COLUMN IF EXISTS debt_settled_amount;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS payout_name;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS payout_iban_enc;
ALTER TABLE sessions DROP COLUMN IF EXISTS auth_at;
