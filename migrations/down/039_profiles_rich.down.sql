-- Undoes migrations/039_profiles_rich.sql (run by hand, then delete its row from schema_migrations). Deletes every rich profile section,
-- picture, visibility choice and profile report. Back up first (docs/BACKUP-RESTORE.md).
DROP TABLE IF EXISTS profile_reports;
DROP TABLE IF EXISTS profile_settings;
DROP TABLE IF EXISTS profile_item_images;
DROP TABLE IF EXISTS profile_items;
