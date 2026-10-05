-- Undoes migrations/037_live_growth.sql (run by hand, then delete its row from schema_migrations). Deletes the waiting lists, follows,
-- ratings of live sessions, mentors' summaries, discount codes and gift details. Back up first (docs/BACKUP-RESTORE.md).
DROP INDEX IF EXISTS live_tickets_gift_token;
DROP INDEX IF EXISTS live_tickets_holder_idx;
DROP INDEX IF EXISTS live_tickets_one_per_holder;
CREATE UNIQUE INDEX IF NOT EXISTS live_tickets_one_per_buyer ON live_tickets (session_id, buyer_id) WHERE status IN ('held', 'paid', 'refund_pending');
ALTER TABLE live_tickets DROP COLUMN IF EXISTS gift_claimed_at;
ALTER TABLE live_tickets DROP COLUMN IF EXISTS gift_token_hash;
ALTER TABLE live_tickets DROP COLUMN IF EXISTS gift_email;
ALTER TABLE live_tickets DROP COLUMN IF EXISTS holder_id;
ALTER TABLE bookings DROP COLUMN IF EXISTS list_price;
ALTER TABLE bookings DROP COLUMN IF EXISTS discount_code_id;
DROP TABLE IF EXISTS discount_codes;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS followers_notified_at;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS summary_sent_at;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS summary_links;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS summary;
DROP TABLE IF EXISTS live_ratings;
DROP TABLE IF EXISTS mentor_follows;
DROP TABLE IF EXISTS live_waitlist;
