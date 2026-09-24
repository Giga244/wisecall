-- "Get notified when mentors in your field join": an email address and a field ('any' or a niche key).
-- The person gets ONE email when a mentor in that field is listed (notified_at is then set), with a link
-- that removes them (token). Admins can see the list.
CREATE TABLE waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  niche       text        NOT NULL DEFAULT 'any',
  language    text        NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ka')),
  token       text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE UNIQUE INDEX waitlist_email_niche ON waitlist (lower(email), niche);
CREATE INDEX waitlist_pending_idx ON waitlist (niche) WHERE notified_at IS NULL;
