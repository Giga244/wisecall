-- Refund safety (docs/REVIEW-2.md #3) and the missing foreign-key indexes the launch rehearsal found (docs/TODO-REHEARSAL.md R-12).
-- ADDITIVE ONLY: two nullable columns and indexes; nothing existing changes. Undo: migrations/down/040_refund_safety.down.sql.

-- A partial refund that was sent to the bank but whose answer was lost ("sent, answer unknown") keeps its amount here until a status
-- check at the bank settles it: recorded when the bank shows the money went back, released when it shows nothing did. Nothing is sent to
-- the bank again in between (TBC has no idempotency key: a second request would return the money twice).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partial_refund_amount integer CHECK (partial_refund_amount IS NULL OR partial_refund_amount > 0);
ALTER TABLE live_tickets ADD COLUMN IF NOT EXISTS partial_refund_amount integer CHECK (partial_refund_amount IS NULL OR partial_refund_amount > 0);

-- (deleting an account checks these with a sequential scan without them; the tables are small, so no CONCURRENTLY, which the
-- migration runner's transaction would not allow)
CREATE INDEX IF NOT EXISTS ratings_rater_idx ON ratings (rater_id);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages (sender_id);
CREATE INDEX IF NOT EXISTS live_questions_ticket_idx ON live_questions (ticket_id);
CREATE INDEX IF NOT EXISTS live_questions_author_idx ON live_questions (author_id);
CREATE INDEX IF NOT EXISTS live_waitlist_user_idx ON live_waitlist (user_id);
CREATE INDEX IF NOT EXISTS live_ratings_session_idx ON live_ratings (session_id);
CREATE INDEX IF NOT EXISTS mentor_requests_user_idx ON mentor_requests (user_id);
CREATE INDEX IF NOT EXISTS notifications_booking_idx ON notifications (booking_id);
CREATE INDEX IF NOT EXISTS public_answers_asker_idx ON public_answers (asker_id);
