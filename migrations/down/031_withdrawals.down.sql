-- UNDO for 031_withdrawals.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/031_withdrawals.down.sql
-- What it loses: open and rejected withdrawal requests (their payouts become simply "payable" again, as before PART 5). Transfers that
-- were made stay.
UPDATE payouts SET batch_id = NULL WHERE batch_id IN (SELECT id FROM payout_batches WHERE status <> 'paid') AND status = 'pending';
UPDATE payouts SET debt_settled_batch_id = NULL WHERE debt_settled_batch_id IN (SELECT id FROM payout_batches WHERE status <> 'paid');
DELETE FROM payout_batches WHERE status <> 'paid';
DROP INDEX IF EXISTS payouts_batch_idx;
DROP INDEX IF EXISTS payout_batches_open_idx;
DROP INDEX IF EXISTS payout_batches_one_open_request;
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS payout_batches_paid_complete;
ALTER TABLE payout_batches DROP COLUMN IF EXISTS exported_amount, DROP COLUMN IF EXISTS exported_at, DROP COLUMN IF EXISTS debt_deducted,
  DROP COLUMN IF EXISTS reject_reason, DROP COLUMN IF EXISTS rejected_by, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS requested_at,
  DROP COLUMN IF EXISTS method, DROP COLUMN IF EXISTS status;
ALTER TABLE payout_batches ALTER COLUMN paid_at SET NOT NULL;
ALTER TABLE payout_batches ALTER COLUMN reference SET NOT NULL;
DELETE FROM schema_migrations WHERE name = '031_withdrawals.sql';
