-- Undoes migrations/051_waitlist_source.sql (run by hand, then delete its row from schema_migrations).
ALTER TABLE waitlist DROP COLUMN IF EXISTS source;
