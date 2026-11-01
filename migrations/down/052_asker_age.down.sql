-- Undoes 052_asker_age.sql.
DROP INDEX IF EXISTS users_minor_idx;
ALTER TABLE users DROP COLUMN IF EXISTS age_confirmed_at, DROP COLUMN IF EXISTS age_group, DROP COLUMN IF EXISTS birth_ym;
