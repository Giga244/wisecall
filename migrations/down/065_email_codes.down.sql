-- Undoes migrations/065_email_codes.sql (run by hand, then delete its row from schema_migrations). Codes waiting to be entered are lost:
-- people ask for a new one. An email change that was not confirmed yet is dropped (the account keeps its confirmed address).
DROP TABLE IF EXISTS email_codes;
ALTER TABLE users DROP COLUMN IF EXISTS email_code_locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS pending_email;
