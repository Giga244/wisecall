-- docs/CLAUDE-CODE-MENTOR-STORY.md: what makes a student trust a mentor. "My path" (three short blocks: where I started, how I coped, where I
-- am now) takes the place of the free-text story for mentors who fill it in; old stories stay as they are. Optional: up to 3 neutral
-- starting-point tags the mentor sets (never income or family wealth), a sample question with a short sample answer, three "I can help
-- with" lines, up to 3 work links. field_suggestion: "my field is not in the list" (what the mentor typed; they still pick the closest
-- category, and the admins see it as a suggestion). path_card_dismissed_at: the dashboard's "add your path" card was closed.
-- ADDITIVE ONLY: nullable columns and empty-array defaults; no existing row changes. Undo: migrations/down/066_mentor_story.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS path_start text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS path_how text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS path_now text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS start_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS sample_question text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sample_reply text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS help_points text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_links text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS field_suggestion text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS path_card_dismissed_at timestamptz;
CREATE INDEX IF NOT EXISTS users_start_tags ON users USING gin (start_tags) WHERE start_tags <> '{}';
