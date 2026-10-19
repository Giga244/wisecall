-- Undoes migrations/044_waitlist_question.sql (run by hand, then delete its row from schema_migrations). The typed questions are lost.
ALTER TABLE waitlist DROP COLUMN IF EXISTS wanted_question;
