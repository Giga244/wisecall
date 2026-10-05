-- UNDO for 036_live_sessions.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/036_live_sessions.down.sql
-- What it loses: every live session, ticket, question and report, and the payout / receipt / dispute rows that belong to them (export
-- them first if any money was taken: SELECT * FROM live_tickets WHERE status <> 'expired').
DELETE FROM disputes WHERE ticket_id IS NOT NULL;
DELETE FROM receipts WHERE ticket_id IS NOT NULL;
DELETE FROM payouts WHERE live_session_id IS NOT NULL;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_reason_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_reason_check CHECK (reason IN ('not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other'));
DROP INDEX IF EXISTS disputes_one_per_ticket;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_one_source;
ALTER TABLE disputes DROP COLUMN IF EXISTS ticket_id;
ALTER TABLE disputes ALTER COLUMN booking_id SET NOT NULL;
DROP INDEX IF EXISTS receipts_one_ticket_payment;
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_one_source;
ALTER TABLE receipts DROP COLUMN IF EXISTS ticket_id;
ALTER TABLE receipts ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_one_source;
ALTER TABLE payouts DROP COLUMN IF EXISTS live_session_id;
ALTER TABLE payouts ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE users DROP COLUMN IF EXISTS live_approved_at;
DROP TABLE IF EXISTS live_reports;
DROP TABLE IF EXISTS live_speakers;
DROP TABLE IF EXISTS live_question_votes;
DROP TABLE IF EXISTS live_questions;
DROP TABLE IF EXISTS live_tickets;
DROP TABLE IF EXISTS live_session_covers;
DROP TABLE IF EXISTS live_sessions;
DELETE FROM schema_migrations WHERE name = '036_live_sessions.sql';
