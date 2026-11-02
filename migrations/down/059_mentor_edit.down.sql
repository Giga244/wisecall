-- Undoes 059_mentor_edit.sql. (The price history and the changes waiting for an admin are lost; every mentor's live price and field stay as they are.)
ALTER TABLE users DROP COLUMN IF EXISTS application_changes;
DROP TABLE IF EXISTS mentor_changes;
DROP TABLE IF EXISTS price_changes;
