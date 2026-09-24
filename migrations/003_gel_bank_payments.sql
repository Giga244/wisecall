-- Payments move from Stripe to a Georgian bank (BOG or TBC), in GEL.
-- Amounts stay whole "tetri" (1/100 lari) integers, so 25 GEL is stored as 2500.

-- Mentors no longer have a Stripe account; payout details arrive in a later migration.
ALTER TABLE users DROP COLUMN stripe_account_id;
ALTER TABLE users DROP COLUMN payouts_enabled;

-- Prices are whole lari between 5 and 2000. Existing values are kept, clamped into range.
UPDATE users SET price = 5 WHERE price IS NOT NULL AND price < 5;
UPDATE users SET price = 2000 WHERE price > 2000;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_price_check;
ALTER TABLE users ADD CONSTRAINT users_price_check CHECK (price IS NULL OR price BETWEEN 5 AND 2000);

DROP INDEX IF EXISTS bookings_untransferred_idx;
DROP INDEX IF EXISTS bookings_payment_intent_key;

ALTER TABLE bookings DROP COLUMN stripe_payment_intent_id;
ALTER TABLE bookings DROP COLUMN stripe_transfer_id;
ALTER TABLE bookings DROP COLUMN transferred_at;
ALTER TABLE bookings DROP COLUMN transfer_error;

-- The bank's id for the order, and for a refund request against it.
ALTER TABLE bookings RENAME COLUMN stripe_session_id TO provider_order_id;
ALTER TABLE bookings RENAME COLUMN stripe_refund_id TO provider_refund_id;
ALTER INDEX bookings_session_key RENAME TO bookings_provider_order_key;

-- Which payment provider handled the booking ('bog', 'tbc', 'mock' for local development).
-- Old Stripe bookings are labelled so they are never mistaken for bank payments.
ALTER TABLE bookings ADD COLUMN provider text;
UPDATE bookings SET provider = CASE mode WHEN 'stripe' THEN 'stripe_legacy' ELSE 'mock' END;
ALTER TABLE bookings ALTER COLUMN provider SET NOT NULL;
ALTER TABLE bookings DROP COLUMN mode;

-- Refunds at the bank are asynchronous: the request is accepted first and confirmed later.
ALTER TABLE bookings ADD COLUMN refund_requested_at timestamptz;
ALTER TABLE bookings ADD COLUMN refund_error text;
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending_payment', 'paid', 'answered', 'refund_pending', 'refunded', 'expired'));
ALTER TABLE bookings ALTER COLUMN currency SET DEFAULT 'gel';

CREATE INDEX bookings_refund_pending_idx ON bookings (refund_requested_at) WHERE status = 'refund_pending';
