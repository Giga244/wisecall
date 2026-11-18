-- Undoes migrations/073_user_drafts.sql (run by hand, then delete its row from schema_migrations). The drafts kept on the server are
-- lost (each browser still has its own copy of what was typed there).
DROP TABLE IF EXISTS user_drafts;
