-- Payments: hold-then-release model (funds are held by the platform, the mentor's share is
-- transferred when they answer, and unanswered questions are refunded automatically).

ALTER TABLE users
  ADD COLUMN payouts_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE bookings
  ADD COLUMN stripe_transfer_id text,
  ADD COLUMN transferred_at     timestamptz,
  ADD COLUMN transfer_error     text,
  ADD COLUMN reminder_sent_at   timestamptz;

CREATE INDEX bookings_deadline_idx ON bookings (answer_deadline) WHERE status = 'paid';
CREATE INDEX bookings_untransferred_idx ON bookings (answered_at) WHERE status = 'answered' AND stripe_transfer_id IS NULL AND mode = 'stripe';
CREATE INDEX bookings_pending_idx ON bookings (created_at) WHERE status = 'pending_payment';
