-- Undoes 054_minor_questions.sql.
ALTER TABLE bookings DROP COLUMN IF EXISTS adult_payer_confirmed_at, DROP COLUMN IF EXISTS asker_minor;
