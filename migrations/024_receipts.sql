-- Phase 4 (receipts): a numbered receipt for every payment and every refund. The PDF is made when it is opened. Additive only; the
-- undo script is migrations/down/024_receipts.down.sql.
CREATE TABLE receipts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  number     bigserial   UNIQUE,
  booking_id uuid        NOT NULL REFERENCES bookings (id),
  kind       text        NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount     integer     NOT NULL CHECK (amount > 0),
  currency   text        NOT NULL DEFAULT 'gel',
  issued_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX receipts_one_payment ON receipts (booking_id) WHERE kind = 'payment';
CREATE INDEX receipts_booking_idx ON receipts (booking_id);
