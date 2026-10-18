-- Undoes migrations/043_follow_up_deadline.sql (run by hand, then delete its row from schema_migrations). Only the new columns and index
-- go: the older code has no reply deadline (the follow-up reply is optional again and never holds a payout). Only when no dispute has the
-- reason 'mentor_ignored_follow_up' (SELECT count(*) FROM disputes WHERE reason = 'mentor_ignored_follow_up' must be 0; change it to 'other').
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_reason_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_reason_check
  CHECK (reason IN ('not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other', 'not_as_described', 'technical'));
DROP INDEX IF EXISTS threads_follow_up_waiting_idx;
ALTER TABLE threads DROP COLUMN IF EXISTS follow_up_missed_at;
ALTER TABLE threads DROP COLUMN IF EXISTS follow_up_reminded_at;
ALTER TABLE threads DROP COLUMN IF EXISTS follow_up_replied_at;
ALTER TABLE threads DROP COLUMN IF EXISTS follow_up_due_at;
