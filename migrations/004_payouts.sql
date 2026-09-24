-- Mentor payouts. Wisecall collects the money and pays mentors by bank transfer, by hand, so the
-- database keeps a ledger: one payout row per answered booking, grouped into batches when an
-- admin marks a mentor's earnings as paid.

-- Where to send a mentor's money. The IBAN is stored encrypted (AES-256-GCM); only the last four
-- characters are kept in clear so lists can show which account without decrypting it.
ALTER TABLE users ADD COLUMN payout_name text;
ALTER TABLE users ADD COLUMN payout_iban_enc text;
ALTER TABLE users ADD COLUMN payout_iban_last4 text;
ALTER TABLE users ADD COLUMN payout_updated_at timestamptz;

-- One record per manual bank transfer to a mentor.
CREATE TABLE payout_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id   uuid        NOT NULL REFERENCES users (id),
  amount      integer     NOT NULL CHECK (amount >= 0),         -- tetri actually sent (after debts); 0 = earnings and refunds cancelled out
  currency    text        NOT NULL DEFAULT 'gel',
  reference   text        NOT NULL,                             -- bank transfer reference / note
  iban_last4  text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  paid_by     uuid        REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_batches_mentor_idx ON payout_batches (mentor_id, paid_at DESC);

-- What a mentor earned from one answered booking (price minus the platform fee).
--   pending  earned, waiting to be paid (payable once payable_at has passed)
--   paid     sent to the mentor in a batch
--   void     the booking was refunded before the mentor was paid
-- debt_flagged_at is set when a booking is refunded AFTER its payout was paid: the mentor now owes
-- that amount back, and it is deducted from their next payout (debt_settled_batch_id).
CREATE TABLE payouts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid        NOT NULL UNIQUE REFERENCES bookings (id),
  mentor_id              uuid        NOT NULL REFERENCES users (id),
  amount                 integer     NOT NULL CHECK (amount >= 0),
  currency               text        NOT NULL DEFAULT 'gel',
  status                 text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  payable_at             timestamptz NOT NULL,
  batch_id               uuid        REFERENCES payout_batches (id),
  debt_flagged_at        timestamptz,
  debt_settled_batch_id  uuid        REFERENCES payout_batches (id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_mentor_idx ON payouts (mentor_id, status);
