-- UNDO for 035_attribution.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/035_attribution.down.sql
-- What it loses: which campaign or site each sign-up, application and question came from (nothing else).
ALTER TABLE bookings DROP COLUMN IF EXISTS source;
ALTER TABLE users DROP COLUMN IF EXISTS application_source;
ALTER TABLE users DROP COLUMN IF EXISTS signup_source;
DELETE FROM schema_migrations WHERE name = '035_attribution.sql';
