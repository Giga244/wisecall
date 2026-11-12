-- Every change of a mentor's "About me" (users.bio) is kept: the old text, the new one, when, and through what. A profile once showed a
-- shortened third-person text that no code of ours writes, and nothing told when or how it came (docs/CLAUDE-CODE-FINISH.md part 2).
-- Recorded by the database itself, so a change from any path (the site, a script, a manual query) is kept and can be undone.
-- ADDITIVE: a new table and a trigger; no existing row changes. Undo: migrations/down/063_bio_changes.down.sql.
CREATE TABLE IF NOT EXISTS bio_changes (
  id          bigserial   PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  old_bio     text,
  new_bio     text,
  source      text,       -- what the site said it was doing (wisecall.bio_source), or the database session's application name
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bio_changes_user_idx ON bio_changes (user_id, changed_at DESC);

CREATE OR REPLACE FUNCTION bio_changes_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bio_changes (user_id, old_bio, new_bio, source)
  VALUES (NEW.id, OLD.bio, NEW.bio, coalesce(nullif(current_setting('wisecall.bio_source', true), ''), nullif(current_setting('application_name', true), ''), 'unknown'));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_bio_changes ON users;
CREATE TRIGGER users_bio_changes AFTER UPDATE OF bio ON users
  FOR EACH ROW WHEN (OLD.bio IS DISTINCT FROM NEW.bio) EXECUTE FUNCTION bio_changes_record();
