-- The free follow-up's reply deadline (docs/CLAUDE-CODE-ANSWER-QUALITY.md #3): the mentor replies within 3 days, is reminded after 2, and
-- the booking's payout waits until the reply or the deadline. ADDITIVE ONLY: four nullable columns on threads, one partial index, and one
-- more allowed dispute reason; nothing existing changes and nothing is deleted. Undo: migrations/down/043_follow_up_deadline.down.sql.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz;      -- the mentor replies by then (set with the follow-up question)
ALTER TABLE threads ADD COLUMN IF NOT EXISTS follow_up_replied_at timestamptz;  -- when they replied
ALTER TABLE threads ADD COLUMN IF NOT EXISTS follow_up_reminded_at timestamptz; -- the reminder email went out
ALTER TABLE threads ADD COLUMN IF NOT EXISTS follow_up_missed_at timestamptz;   -- the deadline passed without a reply (the admins were told)
CREATE INDEX IF NOT EXISTS threads_follow_up_waiting_idx ON threads (follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL AND follow_up_replied_at IS NULL AND follow_up_missed_at IS NULL;

-- The asker may report a follow-up the mentor never replied to (server/disputes.js).
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_reason_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_reason_check
  CHECK (reason IN ('not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other', 'not_as_described', 'technical', 'mentor_ignored_follow_up'));

-- A follow-up question already waiting (asked in the last 3 days, no reply yet) gets its deadline now; older ones are left as they were.
UPDATE threads t SET follow_up_due_at = q.created_at + interval '3 days'
  FROM messages q
 WHERE q.thread_id = t.id AND q.kind = 'follow_up_question' AND t.follow_up_due_at IS NULL AND q.created_at > now() - interval '3 days'
   AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = t.id AND r.kind = 'follow_up_reply');
