-- Undoes migrations/041_payouts_flitt.sql (run by hand, then delete its row from schema_migrations). Only when no payout is being sent
-- (SELECT count(*) FROM payout_batches WHERE status = 'sending' must be 0): a failed one becomes "rejected" with its reason.
UPDATE payout_batches SET status = 'rejected', rejected_at = COALESCE(rejected_at, failed_at), reject_reason = COALESCE(reject_reason, failure_reason) WHERE status = 'failed';
DROP INDEX IF EXISTS payout_batches_one_open_request;
CREATE UNIQUE INDEX payout_batches_one_open_request ON payout_batches (mentor_id) WHERE status = 'requested';
DROP INDEX IF EXISTS payout_batches_sending_idx;
DROP INDEX IF EXISTS payout_batches_provider_order_idx;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS failure_reason;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS failed_at;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS sent_by;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS send_started_at;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS provider_order_id;
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS payout_batches_status_check;
ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_status_check CHECK (status IN ('requested', 'paid', 'rejected'));
