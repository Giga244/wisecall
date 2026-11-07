-- An admin deletes an address from the waiting list (Admin > Waitlist, "წაშლა"). The log keeps who, when and how much was removed, never the
-- address itself.
-- ADDITIVE: no existing row changes. Undo: migrations/down/060_waitlist_deletions.down.sql.
CREATE TABLE IF NOT EXISTS waitlist_deletions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  by_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  by_label    text,
  entries     integer     NOT NULL,                  -- waiting-list rows removed (one per field the address waited for)
  fields      text[]      NOT NULL DEFAULT '{}',
  requests    integer     NOT NULL DEFAULT 0,        -- open "find me a mentor" requests of the same address, closed
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_deletions_at ON waitlist_deletions (created_at DESC);
