-- Two-step verification (TOTP: an authenticator app) for admin accounts.
CREATE TABLE admin_two_factor (
  user_id         uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc      text        NOT NULL,                 -- the shared secret, encrypted (server/cryptoBox.js); never sent again after set-up
  enabled_at      timestamptz,                          -- null = set up but not yet confirmed with a first code
  last_step       bigint,                               -- the last 30-second step accepted: a code works once
  recovery_hashes text[]      NOT NULL DEFAULT '{}',    -- sha-256 of each unused recovery code (a used one is removed)
  failed_count    integer     NOT NULL DEFAULT 0,       -- wrong codes in a row
  locked_until    timestamptz,                          -- too many wrong codes: no attempts until then
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
