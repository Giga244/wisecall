-- UNDO for 027_adult_confirmed.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/027_adult_confirmed.down.sql
-- What it loses: when each person confirmed being 18 or older.
ALTER TABLE users DROP COLUMN IF EXISTS adult_confirmed_at;
DELETE FROM schema_migrations WHERE name = '027_adult_confirmed.sql';
