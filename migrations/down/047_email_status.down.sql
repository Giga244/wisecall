-- Undoes migrations/047_email_status.sql (run by hand, then delete its row from schema_migrations). The last email results are lost.
ALTER TABLE users DROP COLUMN IF EXISTS email_status_at;
ALTER TABLE users DROP COLUMN IF EXISTS email_status;
