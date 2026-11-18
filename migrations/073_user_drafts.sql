-- "Never lose what was typed": a signed-in person's unsaved long texts (a question, an answer, "My path" and "About", the application's
-- story step) are kept as drafts on the server too, so they come back on another device or after the browser's own copy is gone
-- (server/drafts.js). One row per person and field; the text is encrypted; a draft is deleted when its text is saved, when the account
-- is deleted, and by itself after 60 days.
-- ADDITIVE ONLY: one new table. Undo: migrations/down/073_user_drafts.down.sql.
CREATE TABLE IF NOT EXISTS user_drafts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value_enc text NOT NULL,
  base text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS user_drafts_updated_at ON user_drafts (updated_at);
