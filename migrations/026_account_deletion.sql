-- Deleting an account (server/account.js): asked for, then carried out after a 14-day grace period. The row stays, without the
-- person's details, because bookings, payouts and receipts point at it. Additive only; the undo script is
-- migrations/down/026_account_deletion.down.sql.
ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE users ADD COLUMN deleted_at            timestamptz;
CREATE INDEX users_deletion_idx ON users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
