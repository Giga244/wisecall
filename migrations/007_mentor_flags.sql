-- Things an admin needs to look at, raised by the system: a name that does not match the ID
-- (name_mismatch), a payout account holder that does not match (payout_name_mismatch), and later
-- low ratings, reports and expiring licences. A flag is never deleted, only resolved with a reason.
CREATE TABLE mentor_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         text        NOT NULL,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid        REFERENCES users (id),
  resolution   text
);
-- At most one open flag of each kind per mentor.
CREATE UNIQUE INDEX mentor_flags_open_key ON mentor_flags (mentor_id, kind) WHERE status = 'open';
CREATE INDEX mentor_flags_status_idx ON mentor_flags (status, created_at DESC);
