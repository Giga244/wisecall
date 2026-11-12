-- Undoes 063_bio_changes.sql (the history of "About me" changes is lost).
DROP TRIGGER IF EXISTS users_bio_changes ON users;
DROP FUNCTION IF EXISTS bio_changes_record();
DROP TABLE IF EXISTS bio_changes;
