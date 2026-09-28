-- UNDO for 030_private_profiles_by_default.sql. NOT applied automatically. Run by hand, in one transaction, only together with a
-- rollback of the code:  psql "$DATABASE_URL" -1 -f migrations/down/030_private_profiles_by_default.down.sql
-- What it loses: nothing (accounts keep the visibility they have; only the default for new accounts goes back to public).
ALTER TABLE users ALTER COLUMN profile_visibility SET DEFAULT 'public';
DROP INDEX IF EXISTS account_signals_user_idx;
DELETE FROM schema_migrations WHERE name = '030_private_profiles_by_default.sql';
