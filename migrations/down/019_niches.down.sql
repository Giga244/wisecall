-- UNDO for 019_niches.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/019_niches.down.sql
-- What it loses: niches an admin added after 019, and the "Other" labels mentors typed. Mentors who chose "Other" are left with
-- users.niche = 'other' (the older code does not know it): move them to a real niche first if any exist.
-- Take a backup first (Render: Dashboard > the database > Backups).

DROP INDEX IF EXISTS users_custom_niche_idx;
ALTER TABLE users DROP COLUMN IF EXISTS custom_niche;
DROP TABLE IF EXISTS niches;
DELETE FROM schema_migrations WHERE name = '019_niches.sql';
