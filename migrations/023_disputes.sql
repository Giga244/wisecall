-- Phase 4 (disputes): "Report a problem with this answer", and partial refunds. Additive only; the undo script is
-- migrations/down/023_disputes.down.sql.

-- One report per booking, within 7 days of being able to read the answer. The mentor's payout for it is held while it is open.
CREATE TABLE disputes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  opened_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason          text        NOT NULL CHECK (reason IN ('not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other')),
  details         text,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  outcome         text        CHECK (outcome IS NULL OR outcome IN ('full_refund', 'partial_refund', 'rejected')),
  refund_amount   integer     CHECK (refund_amount IS NULL OR refund_amount > 0),
  resolution_note text,
  resolved_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX disputes_one_per_booking ON disputes (booking_id);
CREATE INDEX disputes_open_idx ON disputes (created_at) WHERE status = 'open';

-- A partial refund: how much went back to the asker (the booking stays answered). partial_refund_started_at marks a request to the
-- bank that is under way, so two admins cannot send it twice.
ALTER TABLE bookings ADD COLUMN refunded_amount integer CHECK (refunded_amount IS NULL OR refunded_amount > 0);
ALTER TABLE bookings ADD COLUMN partial_refund_started_at timestamptz;

-- The mentor's part of a partial refund, split in proportion to the price: taken off a payout that was not paid yet (refunded_share),
-- or owed back when it was already paid (debt_amount; null = the whole payout, as for a full refund after payment).
ALTER TABLE payouts ADD COLUMN refunded_share integer NOT NULL DEFAULT 0 CHECK (refunded_share >= 0);
ALTER TABLE payouts ADD COLUMN debt_amount    integer CHECK (debt_amount IS NULL OR debt_amount >= 0);
