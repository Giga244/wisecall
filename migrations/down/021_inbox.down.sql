-- UNDO for 021_inbox.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/021_inbox.down.sql
-- What it loses: every Inbox conversation (follow-up questions and replies, support conversations, system messages), the notification
-- centre and the email settings. Bookings, answers and payments are not touched. Take a backup first.
DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS message_reports;
DROP TABLE IF EXISTS thread_reads;
DROP TABLE IF EXISTS blocked_messages;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS threads;
DELETE FROM schema_migrations WHERE name = '021_inbox.sql';
