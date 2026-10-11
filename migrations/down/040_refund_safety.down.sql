-- Undoes migrations/040_refund_safety.sql (run by hand, then delete its row from schema_migrations). Only safe while no partial refund is
-- waiting for the bank's answer (SELECT count(*) FROM bookings WHERE partial_refund_amount IS NOT NULL, and the same for live_tickets).
DROP INDEX IF EXISTS public_answers_asker_idx;
DROP INDEX IF EXISTS notifications_booking_idx;
DROP INDEX IF EXISTS mentor_requests_user_idx;
DROP INDEX IF EXISTS live_ratings_session_idx;
DROP INDEX IF EXISTS live_waitlist_user_idx;
DROP INDEX IF EXISTS live_questions_author_idx;
DROP INDEX IF EXISTS live_questions_ticket_idx;
DROP INDEX IF EXISTS messages_sender_idx;
DROP INDEX IF EXISTS ratings_rater_idx;
ALTER TABLE live_tickets DROP COLUMN IF EXISTS partial_refund_amount;
ALTER TABLE bookings DROP COLUMN IF EXISTS partial_refund_amount;
