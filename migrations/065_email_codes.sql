-- docs/CLAUDE-CODE-EMAIL-CODE-FIX.md: a slow company mail server must never lock a mentor out. Each email code is kept on its own row, so a
-- code that arrives hours late still works (24 hours), and a resend does not kill the codes sent before it (the last 3 for the address
-- work). Five wrong codes in a row now mean a short wait (email_code_locked_until) instead of a dead code. A signed-in person changing
-- their confirmed address waits in pending_email until the code sent there is entered.
-- ADDITIVE ONLY: one new table, two nullable columns. Undo: migrations/down/065_email_codes.down.sql.
CREATE TABLE IF NOT EXISTS email_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       text        NOT NULL,                 -- the address the code was sent to (only codes for the address in use count)
  purpose     text        NOT NULL DEFAULT 'verify' CHECK (purpose IN ('verify', 'change')),
  reason      text        NOT NULL DEFAULT 'signup', -- signup | resend | switch | google | change (a resend waits a minute)
  code_hash   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS email_codes_user ON email_codes (user_id, purpose, created_at DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email text;
