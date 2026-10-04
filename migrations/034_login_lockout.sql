-- PART 8: per-account login lockout (server/loginGuard.js). ADDITIVE ONLY: two new tables.
-- Undo: migrations/down/034_login_lockout.down.sql.
-- A wrong password, per email. The email is kept only as a keyed hash (also for addresses that have no account); rows go after a day.
CREATE TABLE login_failures (
  email_hash  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_failures_hash_idx ON login_failures (email_hash, created_at);
-- An email with too many wrong passwords waits until locked_until, whatever password is sent.
CREATE TABLE login_locks (
  email_hash    text        PRIMARY KEY,
  locked_until  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
