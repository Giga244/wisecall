-- UNDO for 025_sessions.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/025_sessions.down.sql
-- What it loses: the list of signed-in devices. Login cookies keep working with the older code.
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
DROP TABLE IF EXISTS sessions;
DELETE FROM schema_migrations WHERE name = '025_sessions.sql';
