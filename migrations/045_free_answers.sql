-- Free answers (docs/CLAUDE-CODE-FREE-ANSWERS.md): a mentor may answer for free (price 0). A free question is a booking of amount 0 with
-- provider 'free': no bank, no receipt, no fee, no payout. ADDITIVE ONLY: three checks are widened (they accept every row they accepted
-- before), one column with a default and one new check are added; nothing existing changes and nothing is deleted.
-- Undo: migrations/down/045_free_answers.down.sql.

-- The price: 0 (free), or 5 to 2000 lari as before.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_price_check;
ALTER TABLE users ADD CONSTRAINT users_price_check CHECK (price IS NULL OR price = 0 OR price BETWEEN 5 AND 2000);

-- How many free questions a mentor takes a week (Monday to Sunday, UTC).
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_weekly_cap integer NOT NULL DEFAULT 10 CHECK (free_weekly_cap BETWEEN 1 AND 100);

-- A booking may be free: amount 0, and then always provider 'free' with no fee and no share; a 'free' booking is never paid.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_amount_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_amount_check CHECK (amount >= 0);
ALTER TABLE bookings ADD CONSTRAINT bookings_free_check CHECK (
  (amount = 0) = (provider = 'free') AND (amount > 0 OR (platform_fee_amount = 0 AND mentor_net_amount = 0 AND discount_code_id IS NULL)));
CREATE INDEX IF NOT EXISTS bookings_free_open_idx ON bookings (seeker_id, mentor_id) WHERE amount = 0 AND status = 'paid';

-- A report about a free answer can be upheld (the team agrees) with no money to return.
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_outcome_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_outcome_check CHECK (outcome IS NULL OR outcome IN ('full_refund', 'partial_refund', 'rejected', 'upheld'));
