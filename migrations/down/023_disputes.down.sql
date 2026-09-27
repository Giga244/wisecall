-- UNDO for 023_disputes.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/023_disputes.down.sql
-- What it loses: the disputes, and the record of partial refunds (the older code only knows full refunds). Do NOT run it after any
-- partial refund was made unless the ledger is corrected by hand. Take a backup first.
ALTER TABLE payouts DROP COLUMN IF EXISTS debt_amount;
ALTER TABLE payouts DROP COLUMN IF EXISTS refunded_share;
ALTER TABLE bookings DROP COLUMN IF EXISTS partial_refund_started_at;
ALTER TABLE bookings DROP COLUMN IF EXISTS refunded_amount;
DROP TABLE IF EXISTS disputes;
DELETE FROM schema_migrations WHERE name = '023_disputes.sql';
