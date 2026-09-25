-- Sign-in with another service (Google). One row says "this Google account is this Wisecall user".
-- The subject ("sub") is Google's stable id for the person: it never changes, unlike their email address.

CREATE TABLE user_identities (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider       text        NOT NULL CHECK (provider IN ('google')),
  subject        text        NOT NULL,
  email          text,                                   -- the address Google gave when it was linked (for showing it in Settings)
  email_verified boolean     NOT NULL DEFAULT false,     -- whether Google said that address is verified
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  UNIQUE (provider, subject),                            -- a Google account belongs to one Wisecall account
  UNIQUE (user_id, provider)                             -- and an account has at most one Google account
);
