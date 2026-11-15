-- Undoes migrations/066_mentor_story.sql (run by hand, then delete its row from schema_migrations). What mentors wrote in "My path", their
-- starting-point tags, sample answers, "I can help with" lines and work links are lost; the story text (users.story) stays.
DROP INDEX IF EXISTS users_start_tags;
ALTER TABLE users DROP COLUMN IF EXISTS path_card_dismissed_at;
ALTER TABLE users DROP COLUMN IF EXISTS field_suggestion;
ALTER TABLE users DROP COLUMN IF EXISTS work_links;
ALTER TABLE users DROP COLUMN IF EXISTS help_points;
ALTER TABLE users DROP COLUMN IF EXISTS sample_reply;
ALTER TABLE users DROP COLUMN IF EXISTS sample_question;
ALTER TABLE users DROP COLUMN IF EXISTS start_tags;
ALTER TABLE users DROP COLUMN IF EXISTS path_now;
ALTER TABLE users DROP COLUMN IF EXISTS path_how;
ALTER TABLE users DROP COLUMN IF EXISTS path_start;
