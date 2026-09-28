-- UNDO for 028_your_field.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/028_your_field.down.sql
-- What it loses: the admins' "not a regulated profession" decisions, and the end of any field text longer than 40 characters (cut to 40
-- so the old limit can be restored).
ALTER TABLE users DROP COLUMN IF EXISTS field_override;
UPDATE users SET custom_niche = rtrim(left(custom_niche, 40)) WHERE char_length(custom_niche) > 40;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_custom_niche_check;
ALTER TABLE users ADD CONSTRAINT users_custom_niche_check CHECK (custom_niche IS NULL OR length(custom_niche) BETWEEN 3 AND 40);
DELETE FROM schema_migrations WHERE name = '028_your_field.sql';
