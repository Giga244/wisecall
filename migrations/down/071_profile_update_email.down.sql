-- Undoes migrations/071_profile_update_email.sql (run by hand, then delete its row from schema_migrations). The record of who got the
-- "profile update" email, and when, is lost: the admin page would offer it to them again.
ALTER TABLE users DROP COLUMN IF EXISTS profile_update_sent_at;
