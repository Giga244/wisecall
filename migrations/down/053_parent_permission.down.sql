-- Undoes 053_parent_permission.sql.
ALTER TABLE users DROP COLUMN IF EXISTS parent_permission_at;
