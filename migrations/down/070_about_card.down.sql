-- Undoes migrations/070_about_card.sql (run by hand, then delete its row from schema_migrations). Mentors who closed the
-- "add „შენ შესახებ“" card see it again.
ALTER TABLE users DROP COLUMN IF EXISTS about_card_dismissed_at;
