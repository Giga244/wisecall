-- Undoes migrations/038_live_series_replays.sql (run by hand, then delete its row from schema_migrations). Deletes series, series
-- payments, replays and replay passes, and the receipts and payouts that point at them. Back up first (docs/BACKUP-RESTORE.md).
DELETE FROM receipts WHERE series_order_id IS NOT NULL OR replay_purchase_id IS NOT NULL;
DELETE FROM payouts WHERE replay_purchase_id IS NOT NULL;
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_one_source;
ALTER TABLE receipts ADD CONSTRAINT receipts_one_source CHECK ((booking_id IS NULL) <> (ticket_id IS NULL));
DROP INDEX IF EXISTS receipts_one_replay_refund;
DROP INDEX IF EXISTS receipts_one_replay_payment;
DROP INDEX IF EXISTS receipts_one_series_payment;
ALTER TABLE receipts DROP COLUMN IF EXISTS replay_purchase_id;
ALTER TABLE receipts DROP COLUMN IF EXISTS series_order_id;
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_one_source;
ALTER TABLE payouts ADD CONSTRAINT payouts_one_source CHECK ((booking_id IS NULL) <> (live_session_id IS NULL));
DROP INDEX IF EXISTS payouts_one_replay_purchase;
ALTER TABLE payouts DROP COLUMN IF EXISTS replay_purchase_id;
DROP TABLE IF EXISTS live_replay_purchases;
DROP TABLE IF EXISTS live_replays;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS recording_stopped_at;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS recording_started_at;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS replay_price;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS replay_enabled;
DROP INDEX IF EXISTS live_tickets_series_order_idx;
ALTER TABLE live_tickets DROP COLUMN IF EXISTS series_order_id;
DROP TABLE IF EXISTS live_series_orders;
DROP INDEX IF EXISTS live_sessions_series_idx;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS series_id;
DROP TABLE IF EXISTS live_series;
