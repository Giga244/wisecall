-- PART 7B: "Find me a mentor" requests: who people need when nobody fits. ADDITIVE ONLY: one new table.
-- Undo: migrations/down/033_mentor_requests.down.sql.
CREATE TABLE mentor_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  user_id             uuid        REFERENCES users (id) ON DELETE CASCADE,
  field_text          text        NOT NULL CHECK (char_length(field_text) BETWEEN 3 AND 60),
  field_key           text        NOT NULL,                       -- the same field, whatever the spelling (server/customNiche.js groupKey)
  niche               text        NOT NULL,                       -- the closest category, or 'other'
  need                text        NOT NULL CHECK (char_length(need) BETWEEN 20 AND 500),
  language            text        NOT NULL DEFAULT 'any' CHECK (language IN ('any', 'en', 'ka')),
  budget_min          integer,
  budget_max          integer,
  show_public         boolean     NOT NULL DEFAULT false,         -- "show my request anonymously" on the public board
  status              text        NOT NULL CHECK (status IN ('unconfirmed', 'active', 'notified', 'expired', 'removed')),
  confirm_token_hash  text,
  token               text        NOT NULL UNIQUE,                -- the "remove my request" link in every email
  lang                text        NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ka')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  expires_at          timestamptz NOT NULL,
  notified_at         timestamptz,
  notified_mentor_id  uuid        REFERENCES users (id) ON DELETE SET NULL
);
-- One active request per email and field.
CREATE UNIQUE INDEX mentor_requests_one_active ON mentor_requests (lower(email), field_key) WHERE status IN ('unconfirmed', 'active');
CREATE INDEX mentor_requests_active_idx ON mentor_requests (created_at) WHERE status = 'active';
