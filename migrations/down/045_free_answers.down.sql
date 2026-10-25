-- Undoes migrations/045_free_answers.sql (run by hand, then delete its row from schema_migrations). It refuses while free questions,
-- free prices or upheld reports exist: set those mentors' price back to a paid one (5 or more) first. The weekly caps are lost.
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_outcome_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_outcome_check CHECK (outcome IS NULL OR outcome IN ('full_refund', 'partial_refund', 'rejected'));
DROP INDEX IF EXISTS bookings_free_open_idx;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_free_check;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_amount_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_amount_check CHECK (amount > 0);
ALTER TABLE users DROP COLUMN IF EXISTS free_weekly_cap;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_price_check;
ALTER TABLE users ADD CONSTRAINT users_price_check CHECK (price IS NULL OR price BETWEEN 5 AND 2000);
