-- Undoes migrations/072_payout_reminder.sql (run by hand, then delete its row from schema_migrations). When each mentor was last
-- reminded to add a bank account is lost: the next sweep may remind them again at once.
ALTER TABLE users DROP COLUMN IF EXISTS payout_reminder_sent_at;
