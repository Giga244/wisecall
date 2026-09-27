-- Signed-in devices, and a session version (docs/AUDIT.md #3). Additive only; the undo script is migrations/down/025_sessions.down.sql.
-- Every login creates a session row; the login cookie names it and carries the account's session version. A session ends when it is
-- signed out or revoked ("sign out other devices"); every session of an account ends when the password is reset or changed (the
-- version goes up). A login cookie from before this migration has no session: it keeps working until the account's version changes.
CREATE TABLE sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_label text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
