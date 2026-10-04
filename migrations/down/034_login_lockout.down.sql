-- UNDO for 034_login_lockout.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/034_login_lockout.down.sql
-- What it loses: the count of recent wrong passwords and the current locks (nothing else).
DROP TABLE IF EXISTS login_locks;
DROP TABLE IF EXISTS login_failures;
DELETE FROM schema_migrations WHERE name = '034_login_lockout.sql';
