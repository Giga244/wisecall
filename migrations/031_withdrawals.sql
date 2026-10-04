-- PART 5: mentors ask for their available money ("Withdraw"); an admin sends it and records the bank reference. A request is a
-- payout_batches row with status 'requested' (its payout rows point at it through payouts.batch_id); it becomes 'paid' or 'rejected'.
-- ADDITIVE: new columns; the two relaxed NOT NULLs only allow a request to have no reference and no payment date yet. Every existing batch
-- is a transfer that was made, so it gets status 'paid' (the default). Undo: migrations/down/031_withdrawals.down.sql.
ALTER TABLE payout_batches ALTER COLUMN reference DROP NOT NULL;
ALTER TABLE payout_batches ALTER COLUMN paid_at DROP NOT NULL;
ALTER TABLE payout_batches ADD COLUMN status          text        NOT NULL DEFAULT 'paid' CHECK (status IN ('requested', 'paid', 'rejected'));
ALTER TABLE payout_batches ADD COLUMN method          text        NOT NULL DEFAULT 'manual';
ALTER TABLE payout_batches ADD COLUMN requested_at    timestamptz;
ALTER TABLE payout_batches ADD COLUMN rejected_at     timestamptz;
ALTER TABLE payout_batches ADD COLUMN rejected_by     uuid        REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE payout_batches ADD COLUMN reject_reason   text;
ALTER TABLE payout_batches ADD COLUMN debt_deducted   integer     NOT NULL DEFAULT 0 CHECK (debt_deducted >= 0);
ALTER TABLE payout_batches ADD COLUMN exported_at     timestamptz;
ALTER TABLE payout_batches ADD COLUMN exported_amount integer;
ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_paid_complete CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND reference IS NOT NULL));
-- One open request per mentor, whatever happens at the same moment.
CREATE UNIQUE INDEX payout_batches_one_open_request ON payout_batches (mentor_id) WHERE status = 'requested';
CREATE INDEX payout_batches_open_idx ON payout_batches (requested_at) WHERE status = 'requested';
CREATE INDEX payouts_batch_idx ON payouts (batch_id) WHERE batch_id IS NOT NULL;
