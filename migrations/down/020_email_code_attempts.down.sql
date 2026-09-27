-- UNDO for 020_email_code_attempts.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of
-- the code:  psql "$DATABASE_URL" -1 -f migrations/down/020_email_code_attempts.down.sql
-- What it loses: only the wrong-code counters (nothing a user entered).
ALTER TABLE users DROP COLUMN IF EXISTS work_email_code_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS email_code_attempts;
DELETE FROM schema_migrations WHERE name = '020_email_code_attempts.sql';
