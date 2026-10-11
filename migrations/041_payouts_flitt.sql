-- Payouts sent through the bank (PAYOUT_METHOD=flitt_iban, docs/BANK-GOLIVE.md): a withdrawal request can now be "sending" (sent to Flitt,
-- not confirmed yet) and "failed" (the bank refused it; the money is available again). ADDITIVE ONLY: two more statuses and nullable
-- columns; nothing existing changes. Undo: migrations/down/041_payouts_flitt.down.sql.
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS payout_batches_status_check;
ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_status_check CHECK (status IN ('requested', 'sending', 'paid', 'rejected', 'failed'));
-- The bank order of the transfer (one per request, so sending it again can never pay twice), when it was sent, by whom, and why it failed.
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS provider_order_id text;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS send_started_at timestamptz;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS failure_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_provider_order_idx ON payout_batches (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payout_batches_sending_idx ON payout_batches (send_started_at) WHERE status = 'sending';
-- (a request being sent is still open: one open request per mentor)
DROP INDEX IF EXISTS payout_batches_one_open_request;
CREATE UNIQUE INDEX payout_batches_one_open_request ON payout_batches (mentor_id) WHERE status IN ('requested', 'sending');
