-- UNDO for 026_account_deletion.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/026_account_deletion.down.sql
-- What it loses: pending deletion requests (those accounts stay open), and the mark on accounts already deleted (their details are
-- gone either way). Take a backup first.
DROP INDEX IF EXISTS users_deletion_idx;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_requested_at;
DELETE FROM schema_migrations WHERE name = '026_account_deletion.sql';
