-- Mentors change their details and price after applying; an admin changes a price (docs/CLAUDE-CODE-MENTOR-EDIT.md, docs/PLAN-MENTOR-EDIT.md).
--   price_changes   every price change, by the mentor or an admin (an admin always with a reason). Questions keep bookings.amount: nothing is re-priced.
--   mentor_changes  a change an admin checks first (an approved mentor's field and chips, new proof): the live profile is unchanged until approved.
--   users.application_changes  what a mentor changed in an application that was sent and not decided yet ("updated", for the admin).
-- ADDITIVE: no existing row changes. Undo: migrations/down/059_mentor_edit.down.sql.
CREATE TABLE IF NOT EXISTS price_changes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  old_price   integer,
  new_price   integer     NOT NULL,
  by_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  by_label    text,
  source      text        NOT NULL CHECK (source IN ('mentor', 'admin')),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_changes_user ON price_changes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mentor_changes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('fields', 'evidence')),
  proposed     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  current      jsonb,
  evidence_id  uuid,       -- (no foreign key: the undo of 018 drops mentor_evidence; a change whose proof is gone is skipped)
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'replaced')),
  decided_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  decided_at   timestamptz,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mentor_changes_open ON mentor_changes (status, created_at) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS mentor_changes_one_fields ON mentor_changes (user_id) WHERE status = 'open' AND kind = 'fields';

ALTER TABLE users ADD COLUMN IF NOT EXISTS application_changes jsonb;
